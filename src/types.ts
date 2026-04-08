/** Coyote device state */
export interface DeviceState {
  connected: boolean;
  deviceName: string;
  address: string;
  battery: number;
  strengthA: number;
  strengthB: number;
  limitA: number;
  limitB: number;
  waveActiveA: boolean;
  waveActiveB: boolean;
}

/** Channel identifier */
export type Channel = 'A' | 'B';

/** Waveform preset name */
export type WavePreset = 'breath' | 'tide' | 'pulse_low' | 'pulse_mid' | 'pulse_high' | 'tap';

/** A single waveform frame: [encoded_frequency, intensity] */
export type WaveFrame = [number, number];

/** Custom wave step descriptor */
export interface WaveStep {
  freq: number;
  intensity: number;
  repeat?: number;
}

/** Unified AI tool definition */
export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** AI chat message */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | unknown[];
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  parts?: unknown[];
}

/** AI chat response */
export interface ChatResponse {
  role: 'assistant';
  content: string;
}

/** Tool call handler */
export type ToolCallHandler = (name: string, args: Record<string, unknown>) => Promise<string>;

/** Stream text handler */
export type StreamTextHandler = (chunk: string) => void;

/** Scene prompt preset */
export interface PromptPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt: string;
}

/** Saved custom prompt */
export interface SavedPrompt {
  id: string;
  name: string;
  prompt: string;
}

/** Conversation record for persistence */
export interface ConversationRecord {
  id: string;
  title: string;
  messages: { role: string; content: string }[];
  presetId: string;
  createdAt: number;
  updatedAt: number;
}

/** App settings persisted in localStorage */
export interface AppSettings {
  provider: string;
  configs: Record<string, Record<string, string>>;
  presetId: string;
  customPrompt: string;
}

/** Provider field definition */
export interface ProviderField {
  key: string;
  label: string;
  type: string;
  placeholder: string;
}

/** Provider definition for UI */
export interface ProviderDef {
  id: string;
  name: string;
  hint?: string;
  fields: ProviderField[];
}
