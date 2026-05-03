// =============================================================================
// Discussion-presence helper — unit tests
//
// The helper is a pure-ish in-memory bucketing function over a Firestore
// snapshot, with audience gating, recency-window logic, and entity-type
// filtering. The unit tests pin a fixed `now` so the recency-window
// boundary is deterministic, then exercise the cases that map onto the
// v0.2 spec §2.4 acceptance:
//
//   • One open Work Item                       → indicator on
//   • One closed but recently-updated WI       → indicator on
//   • One closed and stale WI                  → indicator off
//   • Mix of open + recent + stale per entity  → indicator on, count
//                                                reflects recent only
//   • `archived: true`                         → ignored
//   • `audience: 'internal'` + hideInternal    → ignored
//   • Different `subject.entityType`           → ignored when filtered
//
// We avoid the firebase-admin SDK by faking the QuerySnapshot shape that
// `computeDiscussionPresence` actually consumes. The helper imports the
// admin DB module directly, so we mock that with vi.mock at the top.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock target — the helper does
// `import { adminDb } from '@/lib/firebase/admin'` so we replace that
// before module load.
const getMock = vi.fn();
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              get: getMock,
            }),
          }),
        }),
      }),
    }),
  },
}));

import {
  computeDiscussionPresence,
  DEFAULT_RECENCY_WINDOW_DAYS,
} from '@/lib/workItems/discussionPresence';

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date('2026-05-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

interface FakeDocOverrides {
  state?: string;
  audience?: 'shared' | 'internal' | 'client-only';
  archived?: boolean;
  updatedAt?: string;
  entityType?: string;
  entityId?: string;
}

function makeDoc(id: string, o: FakeDocOverrides = {}) {
  return {
    id,
    data: () => ({
      state: o.state ?? 'closed',
      audience: o.audience ?? 'shared',
      archived: o.archived ?? false,
      updatedAt: o.updatedAt ?? isoDaysAgo(30),
      subject: {
        entityType: o.entityType ?? 'wishlist',
        entityId: o.entityId ?? 'w1',
      },
    }),
  };
}

function setSnapshot(docs: ReturnType<typeof makeDoc>[]) {
  getMock.mockResolvedValueOnce({ docs });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeDiscussionPresence', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('flags an entity with one open Work Item', async () => {
    setSnapshot([
      makeDoc('wi1', { state: 'raised', updatedAt: isoDaysAgo(20) }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.get('w1')).toEqual({
      hasOpenItem: true,
      // Updated 20 days ago — outside the 7-day recency window — so
      // it counts as open but not as a "recent update".
      recentlyUpdatedCount: 0,
      mostRecentUpdateAt: isoDaysAgo(20),
    });
  });

  it('flags an entity with a closed-but-recent Work Item', async () => {
    setSnapshot([
      makeDoc('wi1', { state: 'closed', updatedAt: isoDaysAgo(2) }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.get('w1')).toEqual({
      hasOpenItem: false,
      recentlyUpdatedCount: 1,
      mostRecentUpdateAt: isoDaysAgo(2),
    });
  });

  it('does NOT flag an entity whose only Work Item is closed and stale', async () => {
    setSnapshot([
      makeDoc('wi1', { state: 'closed', updatedAt: isoDaysAgo(30) }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.get('w1')).toBeUndefined();
  });

  it('combines open + recent + stale items on one entity correctly', async () => {
    setSnapshot([
      makeDoc('a', { entityId: 'w1', state: 'clarified', updatedAt: isoDaysAgo(15) }),
      makeDoc('b', { entityId: 'w1', state: 'closed', updatedAt: isoDaysAgo(3) }),
      makeDoc('c', { entityId: 'w1', state: 'closed', updatedAt: isoDaysAgo(60) }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    const b = buckets.get('w1')!;
    expect(b.hasOpenItem).toBe(true);
    expect(b.recentlyUpdatedCount).toBe(1); // 'b' only — 'c' is stale
    // The most recent across all contributing items (a is 15d, b is 3d).
    expect(b.mostRecentUpdateAt).toBe(isoDaysAgo(3));
  });

  it('excludes archived Work Items', async () => {
    setSnapshot([
      makeDoc('wi1', {
        state: 'raised',
        archived: true,
        updatedAt: isoDaysAgo(1),
      }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.size).toBe(0);
  });

  it('excludes audience=internal when hideInternal is true', async () => {
    setSnapshot([
      makeDoc('wi1', {
        state: 'raised',
        audience: 'internal',
        updatedAt: isoDaysAgo(1),
      }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: true,
      now: NOW,
    });

    expect(buckets.size).toBe(0);
  });

  it('keeps audience=internal when hideInternal is false', async () => {
    setSnapshot([
      makeDoc('wi1', {
        state: 'raised',
        audience: 'internal',
        updatedAt: isoDaysAgo(1),
      }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.get('w1')?.hasOpenItem).toBe(true);
  });

  it('filters by subject.entityType when supplied', async () => {
    setSnapshot([
      makeDoc('a', {
        entityType: 'wishlist',
        entityId: 'w1',
        state: 'raised',
        updatedAt: isoDaysAgo(1),
      }),
      makeDoc('b', {
        entityType: 'conflict',
        entityId: 'cf1',
        state: 'raised',
        updatedAt: isoDaysAgo(1),
      }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.has('w1')).toBe(true);
    expect(buckets.has('cf1')).toBe(false);
  });

  it('treats an item exactly at the recency boundary as recent', async () => {
    // Spec §2.4 default window is 7 days. An item updated exactly 7 days
    // ago should fall on the inclusive side of the boundary — otherwise
    // a 7-day-old comment (which a user just left a week ago) would be
    // classified as stale, which is surprising given the human framing.
    setSnapshot([
      makeDoc('wi1', {
        state: 'closed',
        updatedAt: isoDaysAgo(DEFAULT_RECENCY_WINDOW_DAYS),
      }),
    ]);

    const buckets = await computeDiscussionPresence({
      tenantId: 't',
      clientId: 'c',
      subjectEntityType: 'wishlist',
      hideInternal: false,
      now: NOW,
    });

    expect(buckets.get('w1')?.recentlyUpdatedCount).toBe(1);
  });
});
