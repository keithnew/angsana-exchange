// =============================================================================
// runCheckInAutoGen — handler-level tests for the rewired check-in
// auto-generation path (POST + PUT semantics).
//
// We drive the helper with an injectable createWorkItem fake so the test
// covers the same code path the route handlers use, without standing up
// firebase-admin or the cross-project core-prod app.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  runCheckInAutoGen,
  type CreateWorkItemFn,
} from '../../src/lib/workItems/checkInAutoGen';
import type { ActionLiteCreatePayload } from '../../src/lib/workItems/actionLite';

interface RecordedCall {
  payload: ActionLiteCreatePayload;
  source: { type: string; ref: string };
  createdBy: { userId: string; tenantId: string };
}

function makeFake(): {
  fn: CreateWorkItemFn;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let counter = 0;
  const fn: CreateWorkItemFn = async (payload, options) => {
    counter += 1;
    calls.push({
      payload,
      source: options.source,
      createdBy: options.createdBy,
    });
    return { workItemId: `wi-${counter}` };
  };
  return { fn, calls };
}

const baseContext = {
  tenantId: 'angsana',
  clientId: 'cegid-spain',
  checkInId: 'check-1',
  checkInDate: '2026-06-01',
  inheritedCampaign: '',
  actor: { userId: 'keith@angsana.com', tenantId: 'angsana' },
};

describe('runCheckInAutoGen — POST semantics (newOnly: false)', () => {
  it('skips entries with createAction=false', async () => {
    const { fn, calls } = makeFake();
    const out = await runCheckInAutoGen({
      decisions: [
        { text: 'A', createAction: true },
        { text: 'B', createAction: false },
      ],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(out.count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.title).toBe('A');
  });

  it('skips entries with empty text', async () => {
    const { fn, calls } = makeFake();
    const out = await runCheckInAutoGen({
      decisions: [
        { text: '', createAction: true },
        { text: 'Real', createAction: true },
      ],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(out.count).toBe(1);
    expect(calls[0].payload.title).toBe('Real');
  });

  it('processes decisions then next-steps in order', async () => {
    const { fn, calls } = makeFake();
    const out = await runCheckInAutoGen({
      decisions: [{ text: 'D1', createAction: true }],
      nextSteps: [{ text: 'N1', createAction: true }],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(out.workItemIds).toEqual(['wi-1', 'wi-2']);
    expect(calls.map((c) => c.payload.title)).toEqual(['D1', 'N1']);
  });

  it('inherits the source crumb pointing at the check-in path', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [{ text: 'D', createAction: true }],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(calls[0].source).toEqual({
      type: 'check-in',
      ref: 'tenants/angsana/clients/cegid-spain/checkIns/check-1',
    });
  });

  it('inherits campaign subject when inheritedCampaign is non-empty', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [{ text: 'D', createAction: true }],
      nextSteps: [],
      context: { ...baseContext, inheritedCampaign: 'iberia-retail' },
      createWorkItem: fn,
    });
    expect(calls[0].payload.subject.entityType).toBe('campaign');
    expect(calls[0].payload.subject.entityId).toBe('iberia-retail');
  });

  it('uses client subject when inheritedCampaign is empty', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [{ text: 'D', createAction: true }],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(calls[0].payload.subject.entityType).toBe('client');
    expect(calls[0].payload.subject.entityId).toBe('cegid-spain');
  });

  it('sets raisedBy.role to system (auto-gen path)', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [{ text: 'D', createAction: true }],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(calls[0].payload.raisedBy.role).toBe('system');
    expect(calls[0].payload.raisedBy.userId).toBe('keith@angsana.com');
  });

  it('falls back to actor for assignedTo when not specified', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [{ text: 'D', createAction: true }],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(calls[0].payload.owner?.userId).toBe('keith@angsana.com');
  });

  it('honours an explicit assignee on the decision', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [
        { text: 'D', assignee: 'alice@angsana.com', createAction: true },
      ],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(calls[0].payload.owner?.userId).toBe('alice@angsana.com');
  });

  it('honours an explicit dueDate; otherwise +7d default', async () => {
    const { fn, calls } = makeFake();
    await runCheckInAutoGen({
      decisions: [
        { text: 'D-explicit', dueDate: '2026-08-01', createAction: true },
        { text: 'D-default', createAction: true },
      ],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
    });
    expect(calls[0].payload.deadline?.toISOString()).toContain('2026-08-01');
    expect(calls[1].payload.deadline?.toISOString()).toContain('2026-06-08');
  });

  it('rolls back via throw when createWorkItem rejects mid-loop', async () => {
    let counter = 0;
    const fn: CreateWorkItemFn = async () => {
      counter += 1;
      if (counter === 2) throw new Error('simulated network error');
      return { workItemId: `wi-${counter}` };
    };
    await expect(
      runCheckInAutoGen({
        decisions: [
          { text: 'D1', createAction: true },
          { text: 'D2', createAction: true },
        ],
        nextSteps: [],
        context: baseContext,
        createWorkItem: fn,
      })
    ).rejects.toThrow(/simulated network error/);
  });
});

describe('runCheckInAutoGen — PUT semantics (newOnly: true)', () => {
  it('skips entries at indices below the existing baseline', async () => {
    const { fn, calls } = makeFake();
    const out = await runCheckInAutoGen({
      decisions: [
        { text: 'old-1', createAction: true }, // index 0 — existing
        { text: 'old-2', createAction: true }, // index 1 — existing
        { text: 'new-1', createAction: true }, // index 2 — new
      ],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
      newOnly: true,
      existingDecisionCount: 2,
    });
    expect(out.count).toBe(1);
    expect(calls[0].payload.title).toBe('new-1');
  });

  it('correctly applies separate existing-counts for decisions vs next-steps', async () => {
    const { fn, calls } = makeFake();
    const out = await runCheckInAutoGen({
      decisions: [
        { text: 'old-d', createAction: true },
        { text: 'new-d', createAction: true },
      ],
      nextSteps: [
        { text: 'old-n', createAction: true },
        { text: 'old-n2', createAction: true },
        { text: 'new-n', createAction: true },
      ],
      context: baseContext,
      createWorkItem: fn,
      newOnly: true,
      existingDecisionCount: 1,
      existingNextStepCount: 2,
    });
    expect(out.count).toBe(2);
    expect(calls.map((c) => c.payload.title)).toEqual(['new-d', 'new-n']);
  });

  it('processes nothing when all entries are at-or-below the baseline', async () => {
    const { fn, calls } = makeFake();
    const out = await runCheckInAutoGen({
      decisions: [{ text: 'only-old', createAction: true }],
      nextSteps: [],
      context: baseContext,
      createWorkItem: fn,
      newOnly: true,
      existingDecisionCount: 5, // higher than the array length
    });
    expect(out.count).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
