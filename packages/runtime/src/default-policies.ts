import type { DeviceCommand } from '@dg-agent/core';
import type { PolicyRule } from './policy-engine.js';

const MAX_COLD_START_STRENGTH = 10;
const MAX_ADJUST_STEP = 10;
const MAX_BURST_DURATION_MS = 5_000;
const DEFAULT_USER_MAX_STRENGTH = 50;

export interface DefaultPolicyOptions {
  maxStrengthA?: number;
  maxStrengthB?: number;
}

function requiresConfirmation(command: DeviceCommand): boolean {
  return command.type !== 'stop' && command.type !== 'emergencyStop';
}

export function createDefaultPolicyRules(options: DefaultPolicyOptions = {}): PolicyRule[] {
  const maxStrengthA = normalizeStrengthLimit(options.maxStrengthA);
  const maxStrengthB = normalizeStrengthLimit(options.maxStrengthB);

  return [
    {
      name: 'require-device-connection',
      evaluate({ deviceState }) {
        if (!deviceState.connected) {
          return { type: 'deny', reason: '设备未连接' };
        }
        return null;
      },
    },
    {
      name: 'soft-start',
      evaluate({ command, deviceState }) {
        if (command.type !== 'start') return null;

        const current = command.channel === 'A' ? deviceState.strengthA : deviceState.strengthB;
        if (current > 0) return null;
        if (command.strength <= MAX_COLD_START_STRENGTH) return null;

        return {
          type: 'clamp',
          command: { ...command, strength: MAX_COLD_START_STRENGTH },
          reason: `冷启动强度上限为 ${MAX_COLD_START_STRENGTH}`,
        };
      },
    },
    {
      name: 'user-strength-cap',
      evaluate({ command, deviceState }) {
        switch (command.type) {
          case 'start': {
            const effectiveLimit = getEffectiveLimit(command.channel, deviceState, {
              A: maxStrengthA,
              B: maxStrengthB,
            });
            if (command.strength <= effectiveLimit) return null;
            return {
              type: 'clamp',
              command: { ...command, strength: effectiveLimit },
              reason: `${command.channel} 通道强度上限为 ${effectiveLimit}`,
            };
          }
          case 'burst': {
            const effectiveLimit = getEffectiveLimit(command.channel, deviceState, {
              A: maxStrengthA,
              B: maxStrengthB,
            });
            if (command.strength <= effectiveLimit) return null;
            return {
              type: 'clamp',
              command: { ...command, strength: effectiveLimit },
              reason: `${command.channel} 通道 burst 强度上限为 ${effectiveLimit}`,
            };
          }
          case 'adjustStrength': {
            const current = command.channel === 'A' ? deviceState.strengthA : deviceState.strengthB;
            const effectiveLimit = getEffectiveLimit(command.channel, deviceState, {
              A: maxStrengthA,
              B: maxStrengthB,
            });
            const target = clamp(current + command.delta, 0, effectiveLimit);
            const clampedDelta = target - current;
            if (clampedDelta === command.delta) return null;
            return {
              type: 'clamp',
              command: { ...command, delta: clampedDelta },
              reason: `调整后的强度需遵守 ${command.channel} 通道上限 ${effectiveLimit}`,
            };
          }
          default:
            return null;
        }
      },
    },
    {
      name: 'step-adjust',
      evaluate({ command }) {
        if (command.type !== 'adjustStrength') return null;
        if (Math.abs(command.delta) <= MAX_ADJUST_STEP) return null;

        return {
          type: 'clamp',
          command: {
            ...command,
            delta: Math.sign(command.delta || 1) * MAX_ADJUST_STEP,
          },
          reason: `单次调节幅度上限为 ±${MAX_ADJUST_STEP}`,
        };
      },
    },
    {
      name: 'burst-duration',
      evaluate({ command }) {
        if (command.type !== 'burst') return null;
        if (command.durationMs <= MAX_BURST_DURATION_MS) return null;

        return {
          type: 'clamp',
          command: {
            ...command,
            durationMs: MAX_BURST_DURATION_MS,
          },
          reason: `Burst 时长上限为 ${MAX_BURST_DURATION_MS}ms`,
        };
      },
    },
    {
      name: 'permission-gate',
      evaluate({ command }) {
        if (!requiresConfirmation(command)) return null;
        return {
          type: 'require-confirm',
          reason: '该操作会修改设备状态，需要先获取权限',
        };
      },
    },
  ];
}

function normalizeStrengthLimit(value: number | undefined): number {
  const raw = typeof value === 'number' ? value : DEFAULT_USER_MAX_STRENGTH;
  return clamp(raw, 0, 200);
}

function getEffectiveLimit(
  channel: 'A' | 'B',
  deviceState: { limitA: number; limitB: number },
  userLimits: { A: number; B: number },
): number {
  const hardware = channel === 'A' ? deviceState.limitA : deviceState.limitB;
  const user = userLimits[channel];
  return Math.min(hardware, user);
}

function clamp(value: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}
