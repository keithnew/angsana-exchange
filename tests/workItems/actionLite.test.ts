// =============================================================================
// actionLite — pure-helper coverage:
//   - resolveSubject (Decision #1 conditional)
//   - parseDeadline
//   - buildCreatePayload (validation + defaults)
//   - defaultCheckInDeadline
//   - toActionLiteWire (raw → wire shape, including legacy field-name parity)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  ACTION_LITE_TYPE_ID,
  buildCreatePayload,
  defaultCheckInDeadline,
  parseDeadline,
  resolveSubject,
  toActionLiteWire,
  type ActionLiteRaisedBy,
} from '../../src/lib/workItems/actionLite';

const sampleRaisedBy: ActionLiteRaisedBy = {
  userId: 'keith@angsana.com',
  tenantId: 'angsana',
  role: 'am',
};

describe('resolveSubject', () => {
  it('resolves to a campaign subject when relatedCampaign is non-empty', () => {
    expect(
      resolveSubject({
        tenantId: 'angsana',
        clientId: 'cegid-spain',
        relatedCampaign: 'iberia-retail',
      })
    ).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'campaign',
      entityId: 'iberia-retail',
    });
  });

  it('resolves to a client subject when relatedCampaign is empty', () => {
    expect(
      resolveSubject({
        tenantId: 'angsana',
        clientId: 'cegid-spain',
        relatedCampaign: '',
      })
    ).toEqual({
      scope: 'tenant',
      scopeRef: 'angsana',
      entityType: 'client',
      entityId: 'cegid-spain',
    });
  });

  it('resolves to a client subject when relatedCampaign is null/undefined', () => {
    expect(
      resolveSubject({ tenantId: 'angsana', clientId: 'cegid-spain' })
        .entityType
    ).toBe('client');
    expect(
      resolveSubject({
        tenantId: 'angsana',
        clientId: 'cegid-spain',
        relatedCampaign: null,
      }).entityType
    ).toBe('client');
  });
});

describe('parseDeadline', () => {
  it('parses ISO-8601 strings', () => {
    const d = parseDeadline('2026-07-01');
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toContain('2026-07-01');
  });

  it('returns null for empty/null/undefined', () => {
    expect(parseDeadline(null)).toBeNull();
    expect(parseDeadline(undefined)).toBeNull();
    expect(parseDeadline('')).toBeNull();
    expect(parseDeadline('   ')).toBeNull();
  });

  it('throws on unparseable input', () => {
    expect(() => parseDeadline('not-a-date')).toThrow();
  });
});

describe('buildCreatePayload', () => {
  it('builds a complete payload with explicit values', () => {
    const out = buildCreatePayload({
      tenantId: 'angsana',
      clientId: 'cegid-spain',
      title: 'Follow up with Alice',
      body: 'Confirm meeting time',
      assignedTo: 'alice@angsana.com',
      deadline: '2026-07-01',
      priority: 'high',
      relatedCampaign: 'iberia-retail',
      raisedBy: sampleRaisedBy,
    });
    expect(out.typeId).toBe(ACTION_LITE_TYPE_ID);
    expect(out.state).toBe('open');
    expect(out.priority).toBe('high');
    expect(out.title).toBe('Follow up with Alice');
    expect(out.body).toBe('Confirm meeting time');
    expect(out.subject.entityType).toBe('campaign');
    expect(out.subject.entityId).toBe('iberia-retail');
    expect(out.owner).toEqual({
      userId: 'alice@angsana.com',
      tenantId: 'angsana',
    });
    expect(out.deadline).toBeInstanceOf(Date);
    expect(out.audience).toBe('internal');
    expect(out.visibility).toBe('normal');
    expect(out.tenantId).toBe('angsana');
  });

  it('defaults priority to medium', () => {
    const out = buildCreatePayload({
      tenantId: 'angsana',
      clientId: 'cegid-spain',
      title: 'No-priority action',
      raisedBy: sampleRaisedBy,
    });
    expect(out.priority).toBe('medium');
  });

  it('produces null owner when assignedTo is empty', () => {
    const out = buildCreatePayload({
      tenantId: 'angsana',
      clientId: 'cegid-spain',
      title: 'Unowned',
      assignedTo: '',
      raisedBy: sampleRaisedBy,
    });
    expect(out.owner).toBeNull();
  });

  it('produces null deadline when not provided', () => {
    const out = buildCreatePayload({
      tenantId: 'angsana',
      clientId: 'cegid-spain',
      title: 'No deadline',
      raisedBy: sampleRaisedBy,
    });
    expect(out.deadline).toBeNull();
  });

  it('produces a client subject when relatedCampaign is absent', () => {
    const out = buildCreatePayload({
      tenantId: 'angsana',
      clientId: 'cegid-spain',
      title: 'Client-level',
      raisedBy: sampleRaisedBy,
    });
    expect(out.subject.entityType).toBe('client');
    expect(out.subject.entityId).toBe('cegid-spain');
  });

  it('throws on missing title', () => {
    expect(() =>
      buildCreatePayload({
        tenantId: 'angsana',
        clientId: 'cegid-spain',
        title: '',
        raisedBy: sampleRaisedBy,
      })
    ).toThrow(/title is required/);
  });

  it('throws on title overflow', () => {
    expect(() =>
      buildCreatePayload({
        tenantId: 'angsana',
        clientId: 'cegid-spain',
        title: 'x'.repeat(201),
        raisedBy: sampleRaisedBy,
      })
    ).toThrow(/title must be ≤200/);
  });

  it('throws on body overflow', () => {
    expect(() =>
      buildCreatePayload({
        tenantId: 'angsana',
        clientId: 'cegid-spain',
        title: 'OK',
        body: 'y'.repeat(2001),
        raisedBy: sampleRaisedBy,
      })
    ).toThrow(/body must be ≤2000/);
  });
});

describe('defaultCheckInDeadline', () => {
  it('honours an explicit override', () => {
    expect(defaultCheckInDeadline('2026-06-01', '2026-06-15')).toBe(
      '2026-06-15'
    );
  });

  it('returns +7d ISO when no override', () => {
    const out = defaultCheckInDeadline('2026-06-01');
    expect(out).toBeTruthy();
    // ISO string for 2026-06-08 starts with that date.
    expect(out!).toContain('2026-06-08');
  });

  it('returns null on unparseable check-in date with no override', () => {
    expect(defaultCheckInDeadline('garbage', null)).toBeNull();
  });
});

describe('toActionLiteWire', () => {
  it('rejects docs with the wrong typeId/workItemType', () => {
    expect(
      toActionLiteWire('id', { workItemType: 'wishlist-clarification' })
    ).toBeNull();
  });

  it('accepts the legacy reseed shape (workItemType set)', () => {
    const out = toActionLiteWire('id-1', {
      workItemType: ACTION_LITE_TYPE_ID,
      state: 'open',
      priority: 'medium',
      title: 'T',
      body: 'B',
    });
    expect(out).not.toBeNull();
    expect(out!.workItemId).toBe('id-1');
    expect(out!.title).toBe('T');
  });

  it('accepts the forward-compat shape (typeId set)', () => {
    const out = toActionLiteWire('id-2', {
      typeId: ACTION_LITE_TYPE_ID,
      state: 'in-progress',
      priority: 'high',
      title: 'T2',
    });
    expect(out!.state).toBe('in-progress');
    expect(out!.priority).toBe('high');
  });

  it('rejects unknown state/priority', () => {
    expect(
      toActionLiteWire('id', {
        typeId: ACTION_LITE_TYPE_ID,
        state: 'pending' as unknown as 'open',
      })
    ).toBeNull();
    expect(
      toActionLiteWire('id', {
        typeId: ACTION_LITE_TYPE_ID,
        priority: 'urgent' as unknown as 'high',
      })
    ).toBeNull();
  });
});
