import { useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  createBrowserServices,
  type BrowserServices,
  type PermissionRequestInput,
} from '@dg-agent/agent-browser';
import type { MessageOrigin } from '@dg-agent/bridge';
import type { PermissionDecision } from '@dg-agent/core';
import type { BrowserAppSettings } from '@dg-agent/storage-browser';
import { BrowserUpdateChecker } from '../services/update-checker.js';

export interface PendingPermissionRequest {
  input: PermissionRequestInput;
  resolve: (decision: PermissionDecision) => void;
}

export interface UseBrowserAppServicesOptions {
  settings: BrowserAppSettings;
  setPendingPermission: Dispatch<SetStateAction<PendingPermissionRequest | null>>;
  resolveBridgeSessionId: (origin: MessageOrigin) => string | null | Promise<string | null>;
}

export interface UseBrowserAppServicesResult extends BrowserServices {
  updateChecker: BrowserUpdateChecker;
  serviceInitWarnings: string[];
}

export function useBrowserAppServices(
  options: UseBrowserAppServicesOptions,
): UseBrowserAppServicesResult {
  const { resolveBridgeSessionId, settings, setPendingPermission } = options;

  const updateChecker = useMemo(
    () =>
      new BrowserUpdateChecker({
        currentBuildId: __BUILD_ID__,
        versionUrl: `${import.meta.env.BASE_URL}version.json`,
      }),
    [],
  );

  const services = useMemo(
    () =>
      createBrowserServices({
        settings,
        resolveBridgeSessionId,
        onPermissionRequest: (input) =>
          new Promise<PermissionDecision>((resolve) => {
            setPendingPermission({ input, resolve });
          }),
      }),
    [settings, resolveBridgeSessionId, setPendingPermission],
  );

  return {
    ...services,
    updateChecker,
    serviceInitWarnings: services.warnings,
  };
}
