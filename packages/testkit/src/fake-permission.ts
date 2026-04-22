import type { PermissionService, PermissionRequest } from '@dg-agent/contracts';
import type { PermissionDecision } from '@dg-agent/core';

export class FakePermissionService implements PermissionService {
  constructor(private readonly decision: PermissionDecision = { type: 'approve-once' }) {}

  async request(_input: PermissionRequest): Promise<PermissionDecision> {
    return this.decision;
  }
}
