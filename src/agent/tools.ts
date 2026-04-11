/**
 * tools.ts — Tool definitions and executor for Coyote device control.
 * Each tool co-locates its schema and handler. Common boilerplate is unified.
 */

import type { ToolDef, WaveStep } from '../types';
import * as bt from './bluetooth';
import { getMaxStrength } from './providers';
import { MAX_START_STRENGTH, MAX_BURST_DURATION_MS } from './policies';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CH = { type: 'string', enum: ['A', 'B'], description: '通道 A 或 B' } as const;

function snap() {
  const s = bt.getStatus();
  return { strengthA: s.strengthA, strengthB: s.strengthB, waveActiveA: s.waveActiveA, waveActiveB: s.waveActiveB };
}

function clamp(value: number, channel: string): { value: number; limited: boolean } {
  const limits = bt.getStrengthLimits();
  const ch = channel.toUpperCase() === 'A' ? 'A' : 'B';
  const deviceLimit = ch === 'A' ? limits.limitA : limits.limitB;
  const effectiveLimit = Math.min(deviceLimit, getMaxStrength(ch));
  const v = num(value, 0);
  const clamped = Math.min(Math.max(0, v), effectiveLimit);
  return { value: clamped, limited: clamped !== v };
}

/** Coerce arbitrary input (string, number, null) to a finite integer. */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

// ---------------------------------------------------------------------------
// Burst auto-restore tracking
// ---------------------------------------------------------------------------
// `burst` temporarily raises a channel's strength and schedules a setTimeout
// to drop it back down. The safety contract is that the elevated strength
// MUST NOT persist past duration_ms, regardless of what happens in between.
// The timer is only cancelled when the channel has already been zeroed —
// i.e. by `stop` or by emergency stop via fullStop(). All other mutating
// tools (adjust_strength, change_wave, design_wave, start) let the timer
// fire; the handler's min(current, prev) floor keeps the outcome safe.
const burstRestores = new Map<'A' | 'B', ReturnType<typeof setTimeout>>();

function normChannel(ch: string): 'A' | 'B' {
  return ch.toUpperCase() === 'A' ? 'A' : 'B';
}

/** Cancel the pending burst-restore on a channel (no-op if none pending). */
function cancelBurstRestore(channel: 'A' | 'B' | 'all'): void {
  if (channel === 'all') {
    for (const [, timer] of burstRestores) clearTimeout(timer);
    burstRestores.clear();
    return;
  }
  const timer = burstRestores.get(channel);
  if (timer !== undefined) {
    clearTimeout(timer);
    burstRestores.delete(channel);
  }
}

/**
 * Cancel every pending burst-restore timer. Exposed for the emergency-stop
 * paths that bypass the tool layer (visibilitychange, beforeunload) so a
 * pending restore cannot revive the device after the user or lifecycle
 * handler has already zeroed it.
 */
export function cancelAllBurstRestores(): void {
  cancelBurstRestore('all');
}

// ---------------------------------------------------------------------------
// Tool registry — definition + handler in one place
// ---------------------------------------------------------------------------

interface ToolEntry {
  def: ToolDef;
  handler: (args: any) => any;
}

const registry: ToolEntry[] = [
  {
    def: {
      name: 'start',
      description:
        '【启动工具】启动一个通道：同时设置「强度」和「预设波形」。**只在通道当前是停止状态、需要从零开始播放时使用**。与 stop 配对。\n\n' +
        `**软启动硬规则**：start 的 strength 上限为 ${MAX_START_STRENGTH}，超过会被自动夹紧。这是为了防止从零突然给用户高强度刺激——冷启动必须温柔，想要更高强度请先 start 再用 adjust_strength 一步步爬升。\n\n` +
        '使用场景：\n' +
        '• 第一次开始刺激：start(channel=A, strength=8, preset=breath)\n' +
        '• stop 之后重新启动：start(channel=A, strength=5, preset=tide)\n\n' +
        '不要用 start 的场景：\n' +
        '• 通道已经在播放，只想换波形 → 用 change_wave\n' +
        '• 通道已经在播放，只想调强度 → 用 adjust_strength\n' +
        '• 想要"停止" → 用 stop，不要传 strength=0\n' +
        '• 六个预设都不合适、需要自定义波形 → 用 design_wave',
      parameters: {
        type: 'object',
        properties: {
          channel: CH,
          strength: {
            type: 'integer',
            minimum: 0,
            maximum: MAX_START_STRENGTH,
            description: `启动时的强度，0-${MAX_START_STRENGTH}。这是软启动硬上限——超过 ${MAX_START_STRENGTH} 会被自动夹紧。建议从 5-8 起步，之后用 adjust_strength 一步步爬升。`,
          },
          preset: {
            type: 'string',
            enum: ['breath', 'tide', 'pulse_low', 'pulse_mid', 'pulse_high', 'tap'],
            description:
              '预设波形名，六选一：\n' +
              '  • breath — 呼吸节奏，渐强渐弱，最温柔\n' +
              '  • tide   — 潮汐感，波浪般起伏，适合铺垫\n' +
              '  • pulse_low  — 低脉冲，轻柔的规律节奏\n' +
              '  • pulse_mid  — 中脉冲，中等刺激\n' +
              '  • pulse_high — 高脉冲，强烈的规律节奏\n' +
              '  • tap    — 轻拍，带节奏停顿，有"点触"感',
          },
          loop: { type: 'boolean', default: true, description: '是否循环播放波形，默认 true' },
        },
        required: ['channel', 'strength', 'preset'],
      },
    },
    handler({ channel, strength, preset, loop }) {
      const requested = num(strength);
      // Soft-start: cold-launching a channel is always capped at MAX_START_STRENGTH.
      // Further escalation must go through adjust_strength step by step.
      const startCapped = Math.min(requested, MAX_START_STRENGTH);
      const safe = clamp(startCapped, channel);
      bt.setStrength(channel, safe.value);
      bt.sendWave(channel, preset, null, null, 10, loop !== false);
      return {
        channel,
        strength: { requested, actual: safe.value, limited: safe.value !== requested },
        preset,
        loop: loop !== false,
      };
    },
  },
  {
    def: {
      name: 'stop',
      description:
        '【关闭工具】完整关闭通道：同时把强度归零并停止波形输出。想要结束刺激时必须用这个工具——不要用 start(strength=0) 或其它变通方式来"关"设备。\n\n' +
        '使用场景：\n' +
        '• 停止 A 通道：stop(channel=A)\n' +
        '• 紧急全停（A 和 B 都关）：stop() 不传参数\n' +
        '• 用户说"停一下"、"够了"、"停止"、"关掉"等任何结束意图时',
      parameters: {
        type: 'object',
        properties: {
          channel: { ...CH, description: '要关闭的通道；不填则 A 和 B 同时关闭' },
        },
      },
    },
    handler({ channel }) {
      if (channel) {
        cancelBurstRestore(normChannel(channel));
        bt.setStrength(channel, 0);
        bt.stopWave(channel);
        return { channel, stopped: true };
      }
      cancelBurstRestore('all');
      bt.setStrength('A', 0);
      bt.setStrength('B', 0);
      bt.stopWave(null);
      return { channel: 'all', stopped: true };
    },
  },
  {
    def: {
      name: 'adjust_strength',
      description:
        '【强度调整工具】在不改变当前波形的前提下，相对调整一个通道的强度。这是通道运行中**唯一**的强度调整入口——边缘控制、渐进攀升、轻微回落都用它。\n\n' +
        '使用场景：\n' +
        '• 缓慢攀升：adjust_strength(channel=A, delta=3)\n' +
        '• 轻微回落：adjust_strength(channel=A, delta=-5)\n' +
        '• 已经 start 启动后，想在当前波形上做 +2/+3 的细腻变化\n\n' +
        '注意：如果同时还要换波形，请配合 change_wave 使用。',
      parameters: {
        type: 'object',
        properties: {
          channel: CH,
          delta: { type: 'integer', description: '变化量，正数增加，负数减少。典型值 ±1 到 ±10。' },
        },
        required: ['channel', 'delta'],
      },
    },
    handler({ channel, delta }) {
      const deltaN = num(delta);
      const current = channel.toUpperCase() === 'A' ? bt.getStatus().strengthA : bt.getStatus().strengthB;
      const safe = clamp(current + deltaN, channel);
      const actualDelta = safe.value - current;
      if (actualDelta !== 0) bt.addStrength(channel, actualDelta);
      return { channel, requestedDelta: deltaN, actualDelta, result: safe.value, limited: safe.limited };
    },
  },
  {
    def: {
      name: 'change_wave',
      description:
        '【换波形工具】在不改变强度的前提下，把一个通道的当前波形换成另一个预设。这是通道运行中**唯一**的波形切换入口——只动波形，不动强度。\n\n' +
        '使用场景：\n' +
        '• 用户说"换成潮汐"、"试试 tide"等更换波形的意图\n' +
        '• 已经 start 启动后，想从 breath 切到 pulse_mid 推进节奏\n' +
        '• 节奏铺垫阶段切换不同预设，但保持当前强度\n\n' +
        '注意：如果通道目前是停止状态（strength=0 或刚 stop 过），切了波形也不会有输出，应该改用 start。',
      parameters: {
        type: 'object',
        properties: {
          channel: CH,
          preset: {
            type: 'string',
            enum: ['breath', 'tide', 'pulse_low', 'pulse_mid', 'pulse_high', 'tap'],
            description:
              '要切换到的预设波形名，六选一：\n' +
              '  • breath — 呼吸节奏，渐强渐弱，最温柔\n' +
              '  • tide   — 潮汐感，波浪般起伏，适合铺垫\n' +
              '  • pulse_low  — 低脉冲，轻柔的规律节奏\n' +
              '  • pulse_mid  — 中脉冲，中等刺激\n' +
              '  • pulse_high — 高脉冲，强烈的规律节奏\n' +
              '  • tap    — 轻拍，带节奏停顿，有"点触"感',
          },
          loop: { type: 'boolean', default: true, description: '是否循环播放波形，默认 true' },
        },
        required: ['channel', 'preset'],
      },
    },
    handler({ channel, preset, loop }) {
      bt.sendWave(channel, preset, null, null, 10, loop !== false);
      return { channel, preset, loop: loop !== false };
    },
  },
  {
    def: {
      name: 'design_wave',
      description:
        '【自定义波形工具】start 的自定义伙伴——当六个预设都不合适时，用这个工具自己造一段波形并启动通道。一次性设置强度并播放。\n\n' +
        '使用场景：\n' +
        '• 制造渐强：steps=[{freq:20,intensity:20,repeat:3},{freq:20,intensity:50,repeat:3},{freq:20,intensity:90,repeat:3}]\n' +
        '• 制造断续节奏：steps=[{freq:10,intensity:100,repeat:1},{freq:10,intensity:0,repeat:2}]\n' +
        '• 模拟心跳、呼吸等有机节律\n' +
        '• 单一恒定的频率/强度也用本工具，传一个 step 即可：steps=[{freq:50,intensity:80,repeat:10}]\n\n' +
        '每一步(step)代表一段连续相同的帧，帧时长 100ms。repeat 决定这一步持续几帧。与 start 一样必须同时提供 strength。',
      parameters: {
        type: 'object',
        properties: {
          channel: CH,
          strength: {
            type: 'integer',
            minimum: 0,
            maximum: 200,
            description: '通道输出的绝对强度，0-200。',
          },
          steps: {
            type: 'array',
            description: '波形步骤数组，每一步是 {freq, intensity, repeat?}',
            items: {
              type: 'object',
              properties: {
                freq: { type: 'integer', minimum: 10, maximum: 1000, description: '这一步的频率(ms)，范围 10-1000' },
                intensity: { type: 'integer', minimum: 0, maximum: 100, description: '这一步的波形能量百分比，范围 0-100' },
                repeat: { type: 'integer', minimum: 1, default: 1, description: '这一步重复几帧（每帧 100ms）' },
              },
              required: ['freq', 'intensity'],
            },
          },
          loop: { type: 'boolean', default: true, description: '是否循环播放整段波形' },
        },
        required: ['channel', 'strength', 'steps'],
      },
    },
    handler({ channel, strength, steps, loop }: { channel: string; strength: number; steps: WaveStep[]; loop?: boolean }) {
      const strengthN = num(strength);
      const stepsN: WaveStep[] = (Array.isArray(steps) ? steps : []).map((s: any) => ({
        freq: num(s?.freq),
        intensity: num(s?.intensity),
        repeat: num(s?.repeat, 1),
      }));
      const safe = clamp(strengthN, channel);
      bt.setStrength(channel, safe.value);
      bt.designWave(channel, stepsN, loop !== false);
      return {
        channel,
        strength: { requested: strengthN, actual: safe.value, limited: safe.limited },
        stepsCount: stepsN.length,
        loop: loop !== false,
      };
    },
  },
  {
    def: {
      name: 'burst',
      description:
        '【短时突增工具】把一个**正在运行**的通道的强度瞬间拉高，持续一小段时间后自动回落到不高于调用前的水平。专门用于制造短暂的刺激峰值——惩罚、突袭、节奏爆点等。\n\n' +
        '示例：burst(channel=A, strength=40, duration_ms=2000) — A 通道强度瞬间拉到 40，2 秒后自动回落。\n\n' +
        '硬性约束：\n' +
        '  1. 通道必须已在运行，停止状态下会报错。\n' +
        `  2. duration_ms 范围 100-${MAX_BURST_DURATION_MS}，超过会被夹紧。\n` +
        '  3. 强度仍受设备/用户绝对上限约束。\n' +
        '  4. 不替换波形，只改变强度。\n' +
        '  5. 到时间一定会把强度降到不高于调用前的水平，期间任何其它工具调用都不会取消这个回落。尽可能将其作为最后一个工具调用。',
      parameters: {
        type: 'object',
        properties: {
          channel: CH,
          strength: {
            type: 'integer',
            minimum: 0,
            maximum: 200,
            description: '突增期间的目标强度绝对值，0-200。仍受设备/用户硬上限约束。',
          },
          duration_ms: {
            type: 'integer',
            minimum: 100,
            maximum: MAX_BURST_DURATION_MS,
            description: `突增持续时间（毫秒），100-${MAX_BURST_DURATION_MS}。时间到后强度一定回到不高于调用前的水平。`,
          },
        },
        required: ['channel', 'strength', 'duration_ms'],
      },
    },
    handler({ channel, strength, duration_ms }) {
      const ch = normChannel(channel);
      const status = bt.getStatus();
      const current = ch === 'A' ? status.strengthA : status.strengthB;
      const waveActive = ch === 'A' ? status.waveActiveA : status.waveActiveB;

      // Channel must already be running — burst is *not* a cold launcher.
      // Cold-launching at high strength is exactly what MAX_START_STRENGTH
      // is meant to prevent; burst would be a trivial bypass otherwise.
      if (current <= 0 || !waveActive) {
        throw new Error(
          `通道 ${ch} 当前未在运行 (strength=${current}, waveActive=${waveActive})，burst 只能在已启动的通道上使用。请先用 start 启动通道，再调用 burst。`,
        );
      }

      const requestedStrength = num(strength);
      const requestedDuration = num(duration_ms);
      const clampedDuration = Math.min(Math.max(100, requestedDuration), MAX_BURST_DURATION_MS);
      const safeTarget = clamp(requestedStrength, ch);

      // Clear any previous burst-restore on this channel (normally prevented
      // by the per-turn cap, but kept as a safety net so prev is well-defined).
      cancelBurstRestore(ch);

      const prev = current;
      bt.setStrength(ch, safeTarget.value);

      const timer = setTimeout(() => {
        // Safety floor: at restore time the strength MUST NOT remain above
        // prev. We compute the new strength as min(currentStrength, prev),
        // clamped to current device/provider limits. This guarantees:
        //   - elevated strength always comes down (the safety contract)
        //   - a strength that has already been lowered is not re-raised
        //   - stop() leaves the channel at 0 (min(0, prev) = 0)
        const nowStatus = bt.getStatus();
        const nowCurrent = ch === 'A' ? nowStatus.strengthA : nowStatus.strengthB;
        const safePrev = clamp(prev, ch).value;
        const target = Math.min(nowCurrent, safePrev);
        if (target !== nowCurrent) bt.setStrength(ch, target);
        burstRestores.delete(ch);
      }, clampedDuration);

      burstRestores.set(ch, timer);

      return {
        channel: ch,
        burst: {
          from: prev,
          to: { requested: requestedStrength, actual: safeTarget.value, limited: safeTarget.limited },
        },
        duration_ms: {
          requested: requestedDuration,
          actual: clampedDuration,
          limited: clampedDuration !== requestedDuration,
        },
        willRestoreAt: Date.now() + clampedDuration,
        _note: `${clampedDuration}ms 后强度必定回落到不高于 ${prev} 的水平——这是安全硬保证，不会因为其它工具调用而取消。`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const tools: ToolDef[] = registry.map((t) => t.def);

const handlerMap = new Map(registry.map((t) => [t.def.name, t.handler]));

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  const handler = handlerMap.get(name);
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });

  // Centralised disconnect guard: every tool in the registry is now
  // mutating, so we can fail fast unconditionally if the device isn't
  // connected. The friendly error tells the model to ask the user to
  // reconnect rather than retrying with the same args.
  if (!bt.getStatus().connected) {
    return JSON.stringify({
      error: '设备未连接，无法执行该操作。请告知用户先在 App 内连接郊狼设备，再继续。',
      deviceState: snap(),
    });
  }

  try {
    const result = handler(args);
    return JSON.stringify({
      success: true,
      ...result,
      deviceState: snap(),
      _hint: '以上 deviceState 是设备当前真实状态，请根据此状态回复用户。',
    });
  } catch (err: unknown) {
    console.error(`[tools] ${name}:`, err);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
