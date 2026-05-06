// =============================================================================
// reseedActionsLoop — integration-style tests against in-memory fakes.
//
// Drives the same loop the script wires to real Firestore, against a
// FakeFirestore-shaped collection that records writes and supports the
// minimal where('migrationSource.sourceId', '==', X).limit(1).get() shape
// the loop uses for idempotency.
//
// Coverage maps onto the pre-code §"P2 deliverable → Tests" list:
//   • read-13 finds 13 (canonical Cegid Spain shape)
//   • re-run idempotency skips already-reseeded
//   • field map produces the expected shape (mapper-driven, sanity-checked
//     end-to-end at the loop level)
//   • missing assignedTo → owner: null
//   • missing createdBy → raisedBy.userId: 'system'
//   • non-empty relatedCampaign → campaign subject
//   • empty/absent relatedCampaign → client subject
//   • --delete-old only deletes after verification gate
//   • dry-run does not write
//   • per-doc errors don't stop the loop
//
// (The mapper-level field-map cases live in the dedicated mapper test
// file; the loop tests focus on the loop's idempotency, dry-run, and
// delete-gate logic.)
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  runReseedLoop,
  runDeleteOldLoop,
  type FakeCollectionRef,
  type FakeDocSnap,
  type FakeQuerySnap,
} from '@/lib/migrations/reseedActionsLoop';

// ─── In-memory fake Firestore collection ────────────────────────────────────
//
// Implements only what the loop uses:
//   .get()                                          — full collection snap
//   .where('migrationSource.sourceId','==',X)
//     .limit(N).get()                              — idempotency lookup
//   .doc(id).set(doc) / .doc(id).delete()          — writes
//
// The collection holds documents as a Map<id, data>. Writes mutate the
// Map; deletes remove the entry. The where() narrowing is hand-implemented
// for the single field path the loop queries on.

interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

class FakeCollection implements FakeCollectionRef {
  private store = new Map<string, Record<string, unknown>>();
  private filter: { field: string; value: unknown } | null = null;
  private limitN: number | null = null;

  /** Seed the collection (initial state). */
  static of(docs: FakeDoc[]): FakeCollection {
    const c = new FakeCollection();
    for (const d of docs) c.store.set(d.id, d.data);
    return c;
  }

  /** Snapshot of the current store (post-test assertions). */
  snapshot(): FakeDoc[] {
    return [...this.store.entries()].map(([id, data]) => ({ id, data }));
  }

  // ─── Query surface ─────────────────────────────────────────────────────

  where(field: string, _op: '==', value: unknown): FakeCollectionRef {
    // Return a new wrapper so the mutation here doesn't leak into the
    // shared instance — the loop calls `targetWorkItems.where(...).limit(...).get()`
    // and expects each call to be independent.
    const next = Object.create(this) as FakeCollection;
    next.filter = { field, value };
    next.limitN = this.limitN;
    return next;
  }

  limit(n: number): FakeCollectionRef {
    const next = Object.create(this) as FakeCollection;
    next.filter = this.filter;
    next.limitN = n;
    return next;
  }

  async get(): Promise<FakeQuerySnap> {
    let entries = [...this.store.entries()];
    if (this.filter) {
      const f = this.filter;
      entries = entries.filter(([_id, data]) => {
        const v = lookup(data, f.field);
        return v === f.value;
      });
    }
    if (this.limitN !== null) {
      entries = entries.slice(0, this.limitN);
    }
    const docs: FakeDocSnap[] = entries.map(([id, data]) => ({
      id,
      exists: true,
      data: () => data,
    }));
    return { size: docs.length, empty: docs.length === 0, docs };
  }

  // ─── Doc surface ───────────────────────────────────────────────────────

  doc(id?: string) {
    const docId = id ?? `auto-${Math.random().toString(36).slice(2, 10)}`;
    const store = this.store;
    return {
      id: docId,
      set: async (data: Record<string, unknown>): Promise<void> => {
        store.set(docId, data);
      },
      delete: async (): Promise<void> => {
        store.delete(docId);
      },
    };
  }
}

/** Minimal dotted-path lookup for the where() filter. */
function lookup(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined,
      obj
    );
}

// ─── Fixture builder ───────────────────────────────────────────────────────

function action(
  id: string,
  overrides: Record<string, unknown> = {}
): FakeDoc {
  return {
    id,
    data: {
      title: `T-${id}`,
      description: '',
      assignedTo: 'Keith New',
      dueDate: { _seconds: 1700000000, _nanoseconds: 0 },
      status: 'open',
      priority: 'medium',
      source: { type: 'checkin', ref: 'checkin-x' },
      relatedCampaign: 'campaign-1',
      createdBy: 'keith@angsana.com',
      createdAt: { _seconds: 1699000000, _nanoseconds: 0 },
      updatedAt: { _seconds: 1699000000, _nanoseconds: 0 },
      ...overrides,
    },
  };
}

const baseLoopArgs = {
  tenantId: 'angsana',
  clientId: 'cegid-spain',
  reseedRun: 'action-lite-2026-06-05T00-00-00-000Z',
  operatorId: 'test-operator',
  mode: 'execute' as const,
  mintWorkItemId: () => 'fixed-work-item-id',
  now: () => 'fixed-now-token',
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('runReseedLoop', () => {
  it('reads 13 source documents and reseeds them all', async () => {
    const sourceActions = FakeCollection.of(
      Array.from({ length: 13 }, (_, i) => action(`A${i}`))
    );
    const targetWorkItems = FakeCollection.of([]);

    let counter = 0;
    const result = await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
      mintWorkItemId: () => `wi-${counter++}`,
    });

    expect(result.read).toBe(13);
    expect(result.reseeded).toBe(13);
    expect(result.skippedAlreadyReseeded).toBe(0);
    expect(result.errored).toBe(0);
    expect(targetWorkItems.snapshot()).toHaveLength(13);
  });

  it('idempotency: re-run skips already-reseeded Actions', async () => {
    // Seed the target with a doc that carries migrationSource.sourceId='A0'.
    const sourceActions = FakeCollection.of([action('A0'), action('A1')]);
    const targetWorkItems = FakeCollection.of([
      {
        id: 'existing-wi',
        data: {
          workItemId: 'existing-wi',
          migrationSource: {
            sourceCollection: 'actions',
            sourceClientId: 'cegid-spain',
            sourceId: 'A0',
            reseedRun: 'previous-run',
          },
        },
      },
    ]);

    const result = await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
    });

    expect(result.skippedAlreadyReseeded).toBe(1);
    expect(result.reseeded).toBe(1);
    const skip = result.outcomes.find((o) => o.outcome === 'skipped-already-reseeded');
    expect(skip).toBeDefined();
    expect(skip?.workItemId).toBe('existing-wi');
  });

  it('dry-run does not write to target', async () => {
    const sourceActions = FakeCollection.of([action('A0'), action('A1')]);
    const targetWorkItems = FakeCollection.of([]);

    const result = await runReseedLoop({
      ...baseLoopArgs,
      mode: 'dry-run',
      sourceActions,
      targetWorkItems,
    });

    expect(result.outcomes.every((o) => o.outcome === 'would-reseed')).toBe(true);
    expect(targetWorkItems.snapshot()).toHaveLength(0);
  });

  it('writes carry the mapped shape: subject, owner, raisedBy, migrationSource', async () => {
    const sourceActions = FakeCollection.of([action('A0')]);
    const targetWorkItems = FakeCollection.of([]);

    await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
      mintWorkItemId: () => 'wi-A0',
    });

    const written = targetWorkItems.snapshot();
    expect(written).toHaveLength(1);
    const doc = written[0].data as Record<string, unknown>;
    expect(doc.workItemType).toBe('action-lite');
    expect(doc.workItemId).toBe('wi-A0');
    expect(doc.scope).toBe('tenant');
    expect(doc.tenantId).toBe('angsana');
    expect(doc.subject).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'campaign',
      entityId: 'campaign-1',
    });
    expect(doc.owner).toEqual({ userId: 'Keith New', tenantId: 'angsana' });
    expect(doc.raisedBy).toEqual({
      userId: 'keith@angsana.com',
      tenantId: 'angsana',
      role: 'system',
    });
    expect(doc.migrationSource).toMatchObject({
      sourceCollection: 'actions',
      sourceClientId: 'cegid-spain',
      sourceId: 'A0',
      reseedRun: 'action-lite-2026-06-05T00-00-00-000Z',
    });
    expect(doc.schemaVersion).toBe('r3-action-lite-v1');
    expect(doc.activityLog).toEqual([]);
  });

  it('missing assignedTo → owner: null on the written doc', async () => {
    const sourceActions = FakeCollection.of([
      action('A0', { assignedTo: undefined }),
    ]);
    const targetWorkItems = FakeCollection.of([]);

    await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
    });

    const doc = targetWorkItems.snapshot()[0].data as Record<string, unknown>;
    expect(doc.owner).toBeNull();
  });

  it('missing createdBy → raisedBy.userId: "system" on the written doc', async () => {
    const sourceActions = FakeCollection.of([
      action('A0', { createdBy: undefined }),
    ]);
    const targetWorkItems = FakeCollection.of([]);

    await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
    });

    const doc = targetWorkItems.snapshot()[0].data as Record<string, unknown>;
    expect((doc.raisedBy as { userId: string }).userId).toBe('system');
  });

  it('non-empty relatedCampaign → campaign subject', async () => {
    const sourceActions = FakeCollection.of([
      action('A0', { relatedCampaign: 'iberia-pos' }),
    ]);
    const targetWorkItems = FakeCollection.of([]);

    await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
    });

    const doc = targetWorkItems.snapshot()[0].data as Record<string, unknown>;
    expect((doc.subject as { entityType: string; entityId: string })).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'campaign',
      entityId: 'iberia-pos',
    });
  });

  it('empty relatedCampaign → client subject (entityId = clientId)', async () => {
    const sourceActions = FakeCollection.of([
      action('A0', { relatedCampaign: '' }),
    ]);
    const targetWorkItems = FakeCollection.of([]);

    await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
    });

    const doc = targetWorkItems.snapshot()[0].data as Record<string, unknown>;
    expect((doc.subject as { entityType: string; entityId: string })).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'client',
      entityId: 'cegid-spain',
    });
  });

  it('per-doc errors do not stop the loop; loop continues to next doc', async () => {
    // Force a mapper throw on A1 by giving it an invalid status.
    const sourceActions = FakeCollection.of([
      action('A0'),
      action('A1', { status: 'archived' }),
      action('A2'),
    ]);
    const targetWorkItems = FakeCollection.of([]);

    let counter = 0;
    const result = await runReseedLoop({
      ...baseLoopArgs,
      sourceActions,
      targetWorkItems,
      mintWorkItemId: () => `wi-${counter++}`,
    });

    expect(result.read).toBe(3);
    expect(result.reseeded).toBe(2);
    expect(result.errored).toBe(1);
    const erroredOutcome = result.outcomes.find((o) => o.outcome === 'errored');
    expect(erroredOutcome?.sourceId).toBe('A1');
    expect(erroredOutcome?.errorMessage).toMatch(/unexpected status/);
    // The two good docs landed.
    expect(targetWorkItems.snapshot()).toHaveLength(2);
  });
});

describe('runDeleteOldLoop', () => {
  it('verification gate: deletes only Actions with a corresponding reseed', async () => {
    const sourceActions = FakeCollection.of([
      action('A0'),
      action('A1'),
      action('A2'),
    ]);
    // Only A0 and A2 have been reseeded.
    const targetWorkItems = FakeCollection.of([
      {
        id: 'wi-0',
        data: {
          workItemId: 'wi-0',
          migrationSource: { sourceId: 'A0' },
        },
      },
      {
        id: 'wi-2',
        data: {
          workItemId: 'wi-2',
          migrationSource: { sourceId: 'A2' },
        },
      },
    ]);

    const result = await runDeleteOldLoop({
      sourceActions,
      targetWorkItems,
    });

    expect(result.deleted).toBe(2);
    expect(result.heldBack).toBe(1);
    const held = result.outcomes.find((o) => o.outcome === 'verified-only');
    expect(held?.sourceId).toBe('A1');

    const remaining = sourceActions.snapshot().map((d) => d.id).sort();
    expect(remaining).toEqual(['A1']);
  });

  it('does not call source.delete for docs without a reseed (verification-only)', async () => {
    const sourceActions = FakeCollection.of([action('A0')]);
    const targetWorkItems = FakeCollection.of([]);

    // Spy on the doc().delete() call. We do this by wrapping doc().
    const docSpy = vi.spyOn(sourceActions, 'doc');

    const result = await runDeleteOldLoop({
      sourceActions,
      targetWorkItems,
    });

    expect(result.heldBack).toBe(1);
    expect(result.deleted).toBe(0);
    // The loop must not call doc(sourceId) with intent to delete when the
    // verification gate fails. (The query path uses .where().limit().get(),
    // not doc(), so the spy here only captures the delete-path call.)
    expect(docSpy).not.toHaveBeenCalled();
    // Source still has A0.
    expect(sourceActions.snapshot()).toHaveLength(1);
  });

  it('happy path: all reseeded → all deleted', async () => {
    const sourceActions = FakeCollection.of([action('A0'), action('A1')]);
    const targetWorkItems = FakeCollection.of([
      {
        id: 'wi-0',
        data: { workItemId: 'wi-0', migrationSource: { sourceId: 'A0' } },
      },
      {
        id: 'wi-1',
        data: { workItemId: 'wi-1', migrationSource: { sourceId: 'A1' } },
      },
    ]);

    const result = await runDeleteOldLoop({
      sourceActions,
      targetWorkItems,
    });

    expect(result.deleted).toBe(2);
    expect(result.heldBack).toBe(0);
    expect(sourceActions.snapshot()).toHaveLength(0);
  });
});
