// =============================================================================
// actionToWorkItem mapper — unit tests.
//
// Covers the field-by-field mapping table from
// `exchange-actions-retirement-handover-S3-pre-code.md` §"What S3 will
// deliver per phase → P2", with pivots:
//
//   • subject = {entityType:'campaign'}  when relatedCampaign non-empty
//   • subject = {entityType:'client'}    when relatedCampaign empty/absent
//   • owner = null                       when assignedTo missing
//   • raisedBy.userId = 'system'         when createdBy missing (Decision #9)
//   • raisedBy.role = 'system'           always (system-driven reseed)
//   • status / priority validated; throws on drift
//   • migrationSource provenance shape per Decision #1
//
// The mapper is pure; no Firestore, no time. Fixtures use a stand-in
// Timestamp shape because the firebase-admin Timestamp class instance
// itself isn't imported in the test (the mapper passes it through
// opaquely).
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  mapActionToWorkItem,
  type SourceAction,
} from '@/lib/migrations/actionToWorkItem';

// Stand-in for the Firestore Timestamp — the mapper just passes it through.
const fakeTs = (label: string) => ({ _seconds: 1700000000, _nanoseconds: 0, _label: label } as unknown as never);

const baseAction: SourceAction = {
  id: 'ACTION1',
  title: 'Follow up on POS roll-out',
  description: 'discuss timeline with Alessandro',
  assignedTo: 'Keith New',
  dueDate: fakeTs('due'),
  status: 'open',
  priority: 'medium',
  source: { type: 'checkin', ref: 'checkin-1' },
  relatedCampaign: 'iberia-retail-pos-fashion',
  createdBy: 'keith@angsana.com',
  createdAt: fakeTs('createdAt'),
  updatedAt: fakeTs('updatedAt'),
};

const baseInput = {
  action: baseAction,
  tenantId: 'angsana',
  clientId: 'cegid-spain',
  reseedRun: 'action-lite-2026-06-05T00-00-00-000Z',
};

describe('mapActionToWorkItem', () => {
  it('happy path — non-empty relatedCampaign maps to campaign subject', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.subject).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'campaign',
      entityId: 'iberia-retail-pos-fashion',
    });
    expect(result.workItemType).toBe('action-lite');
    expect(result.scope).toBe('tenant');
    expect(result.tenantId).toBe('angsana');
    expect(result.archived).toBe(false);
  });

  it('empty relatedCampaign maps to client subject', () => {
    const result = mapActionToWorkItem({
      ...baseInput,
      action: { ...baseAction, relatedCampaign: '' },
    });
    expect(result.subject).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'client',
      entityId: 'cegid-spain',
    });
  });

  it('absent relatedCampaign maps to client subject', () => {
    const { relatedCampaign: _drop, ...withoutCampaign } = baseAction;
    const result = mapActionToWorkItem({
      ...baseInput,
      action: withoutCampaign,
    });
    expect(result.subject.entityType).toBe('client');
    expect(result.subject.entityId).toBe('cegid-spain');
  });

  it('missing assignedTo → owner: null', () => {
    const { assignedTo: _drop, ...withoutAssignee } = baseAction;
    const result = mapActionToWorkItem({
      ...baseInput,
      action: withoutAssignee,
    });
    expect(result.owner).toBeNull();
  });

  it('empty-string assignedTo → owner: null', () => {
    const result = mapActionToWorkItem({
      ...baseInput,
      action: { ...baseAction, assignedTo: '' },
    });
    expect(result.owner).toBeNull();
  });

  it('present assignedTo → owner with userId+tenantId', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.owner).toEqual({
      userId: 'Keith New',
      tenantId: 'angsana',
    });
  });

  it('missing createdBy → raisedBy.userId: "system" (Decision #9)', () => {
    const { createdBy: _drop, ...withoutCreator } = baseAction;
    const result = mapActionToWorkItem({
      ...baseInput,
      action: withoutCreator,
    });
    expect(result.raisedBy).toEqual({
      userId: 'system',
      tenantId: 'angsana',
      role: 'system',
    });
  });

  it('present createdBy → raisedBy.userId carries it; role still "system"', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.raisedBy).toEqual({
      userId: 'keith@angsana.com',
      tenantId: 'angsana',
      role: 'system',
    });
  });

  it('migrationSource carries the Decision #1 provenance shape', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.migrationSource).toEqual({
      sourceCollection: 'actions',
      sourceClientId: 'cegid-spain',
      sourceId: 'ACTION1',
      reseedRun: 'action-lite-2026-06-05T00-00-00-000Z',
      notes: { sourceType: 'checkin', sourceRef: 'checkin-1' },
    });
  });

  it('migrationSource.notes is undefined when source is absent', () => {
    const { source: _drop, ...withoutSource } = baseAction;
    const result = mapActionToWorkItem({
      ...baseInput,
      action: withoutSource,
    });
    expect(result.migrationSource.notes).toBeUndefined();
  });

  it('preserves description as body (including empty)', () => {
    const result = mapActionToWorkItem({
      ...baseInput,
      action: { ...baseAction, description: '' },
    });
    expect(result.body).toBe('');
    const result2 = mapActionToWorkItem(baseInput);
    expect(result2.body).toBe('discuss timeline with Alessandro');
  });

  it('preserves dueDate as deadline (Timestamp passthrough)', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.deadline).toBe(baseAction.dueDate);
  });

  it('null dueDate → null deadline', () => {
    const { dueDate: _drop, ...withoutDue } = baseAction;
    const result = mapActionToWorkItem({
      ...baseInput,
      action: withoutDue,
    });
    expect(result.deadline).toBeNull();
  });

  it('throws on unknown status (drift surface)', () => {
    expect(() =>
      mapActionToWorkItem({
        ...baseInput,
        action: { ...baseAction, status: 'archived' },
      })
    ).toThrow(/unexpected status/);
  });

  it('throws on unknown priority (drift surface)', () => {
    expect(() =>
      mapActionToWorkItem({
        ...baseInput,
        action: { ...baseAction, priority: 'urgent' },
      })
    ).toThrow(/unexpected priority/);
  });

  it('1:1 status mapping for all four declared values', () => {
    for (const s of ['open', 'in-progress', 'done', 'blocked'] as const) {
      const result = mapActionToWorkItem({
        ...baseInput,
        action: { ...baseAction, status: s },
      });
      expect(result.state).toBe(s);
    }
  });

  it('audience defaults to "internal", visibility to "normal" (§7.1)', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.audience).toBe('internal');
    expect(result.visibility).toBe('normal');
  });

  it('source field is null on the mapped Work Item; legacy source preserved on migrationSource.notes', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.source).toBeNull();
    expect(result.migrationSource.notes?.sourceType).toBe('checkin');
    expect(result.migrationSource.notes?.sourceRef).toBe('checkin-1');
  });

  it('relations is empty on every reseeded item', () => {
    const result = mapActionToWorkItem(baseInput);
    expect(result.relations).toEqual([]);
  });
});
