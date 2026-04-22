import { createEmbeddedAgentClient, type AgentClient } from '@dg-agent/client';
import type {
  DeviceClient,
  LlmClient,
  LlmTurnInput,
  LlmTurnResult,
  PermissionService,
  SessionStore,
  SessionTraceStore,
  WaveformLibrary,
} from '@dg-agent/contracts';
import { getWebBluetoothAvailability } from '@dg-agent/device-webbluetooth';
import { BrowserPermissionService } from '@dg-agent/permissions-browser';
import { resolveProviderRuntimeSettings } from '@dg-agent/providers-catalog';
import { OpenAiHttpLlmClient } from '@dg-agent/providers-openai-http';
import { PolicyEngine, createDefaultPolicyRules } from '@dg-agent/runtime';
import type { BrowserAppSettings } from '@dg-agent/storage-browser';
import { createBuildBrowserInstructions } from './build-browser-instructions.js';

class UnavailableLlmClient implements LlmClient {
  constructor(private readonly message: string) {}

  async runTurn(_input: LlmTurnInput): Promise<LlmTurnResult> {
    throw new Error(this.message);
  }
}

export interface CreateBrowserAgentClientOptions {
  settings: BrowserAppSettings;
  device: DeviceClient;
  sessionStore?: SessionStore;
  sessionTraceStore?: SessionTraceStore;
  waveformLibrary: WaveformLibrary;
  permissionService?: PermissionService;
}

export function createBrowserAgentClient(options: CreateBrowserAgentClientOptions): AgentClient {
  const { settings } = options;
  const config = settings;
  const provider = resolveProviderRuntimeSettings(config.provider);

  const llm =
    provider.browserSupported && provider.apiKey
      ? new OpenAiHttpLlmClient({
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
          endpoint: provider.endpoint,
          useStrict: provider.useStrict,
        })
      : new UnavailableLlmClient(
          provider.browserSupported
            ? '当前模型服务还没有配置完成，请先在设置里选择服务提供方并补全凭证'
            : `当前服务提供方“${config.provider.providerId}”不支持浏览器直连，请改用可在浏览器运行的服务`,
        );

  return createEmbeddedAgentClient({
    device: options.device,
    llm,
    permission:
      options.permissionService ??
      new BrowserPermissionService({
        mode: settings.permissionMode,
      }),
    policyEngine: new PolicyEngine(
      createDefaultPolicyRules({
        maxStrengthA: settings.maxStrengthA,
        maxStrengthB: settings.maxStrengthB,
      }),
    ),
    buildInstructions: createBuildBrowserInstructions({
      promptPresetId: settings.promptPresetId,
      customPrompt: settings.customPrompt,
      savedPromptPresets: settings.savedPromptPresets,
      maxStrengthA: settings.maxStrengthA,
      maxStrengthB: settings.maxStrengthB,
    }),
    modelContextStrategy: settings.modelContextStrategy,
    sessionStore: options.sessionStore,
    sessionTraceStore: options.sessionTraceStore,
    waveformLibrary: options.waveformLibrary,
  });
}

export function describeBrowserModes(settings: BrowserAppSettings): {
  deviceMode: 'fake' | 'web-bluetooth';
  llmMode: 'fake' | 'provider-http';
  bluetoothAvailability: ReturnType<typeof getWebBluetoothAvailability>;
  permissionMode: BrowserAppSettings['permissionMode'];
  providerId: BrowserAppSettings['provider']['providerId'];
} {
  const config = settings;

  return {
    deviceMode: config.deviceMode,
    llmMode: config.llmMode,
    permissionMode: config.permissionMode,
    providerId: config.provider.providerId,
    bluetoothAvailability: getWebBluetoothAvailability(),
  };
}
