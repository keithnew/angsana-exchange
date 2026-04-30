// =============================================================================
// stateMachine — unit tests.
//
// Covers spec §4.3 — the only state machine in this slice
// (`wishlist-clarification` only). Focus is the matrix of legal/illegal
// transitions and the comment-required gate on the shortcut close.
//
// `nextStates` is the UI's source of truth for which buttons to render —
// these tests pin its shape so a UI regression (button missing or extra)
// shows up here first.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  isTerminalState,
  nextStates,
  validateTransition,
} from '@/lib/workItems/stateMachine';

describe('validateTransition (wishlist-clarification)', () => {
  describe('legal transitions', () => {
    it('raised → clarified is legal without a comment', () => {
      const result = validateTransition('wishlist-clarification', 'raised', 'clarified', false);
      expect(result).toEqual({ ok: true, commentRequired: false });
    });

    it('clarified → closed is legal without a comment', () => {
      const result = validateTransition('wishlist-clarification', 'clarified', 'closed', false);
      expect(result).toEqual({ ok: true, commentRequired: false });
    });

    it('raised → closed is legal *only* with a comment', () => {
      const result = validateTransition('wishlist-clarification', 'raised', 'closed', true);
      expect(result).toEqual({ ok: true, commentRequired: true });
    });
  });

  describe('comment-required gate', () => {
    it('raised → closed without a comment fails with reason=comment-required', () => {
      const result = validateTransition('wishlist-clarification', 'raised', 'closed', false);
      expect(result).toEqual({ ok: false, reason: 'comment-required' });
    });
  });

  describe('illegal transitions', () => {
    it('rejects identical from and to (already-in-target-state)', () => {
      const result = validateTransition('wishlist-clarification', 'raised', 'raised', false);
      expect(result).toEqual({ ok: false, reason: 'already-in-target-state' });
    });

    it('rejects clarified → raised (no backwards moves)', () => {
      const result = validateTransition('wishlist-clarification', 'clarified', 'raised', false);
      expect(result).toEqual({ ok: false, reason: 'no-such-transition' });
    });

    it('rejects closed → clarified (terminal can\'t reopen in this slice)', () => {
      const result = validateTransition('wishlist-clarification', 'closed', 'clarified', false);
      expect(result).toEqual({ ok: false, reason: 'no-such-transition' });
    });

    it('rejects closed → raised', () => {
      const result = validateTransition('wishlist-clarification', 'closed', 'raised', false);
      expect(result).toEqual({ ok: false, reason: 'no-such-transition' });
    });
  });

  describe('unknown work item type', () => {
    it('returns no-such-type for an unsupported type', () => {
      const result = validateTransition(
        // @ts-expect-error — deliberately pass an unsupported type to exercise the guard
        'unknown-type',
        'raised',
        'closed',
        true
      );
      expect(result).toEqual({ ok: false, reason: 'no-such-type' });
    });
  });
});

describe('nextStates (wishlist-clarification)', () => {
  it('returns clarified + closed (with comment) from raised', () => {
    const next = nextStates('wishlist-clarification', 'raised');
    // Sort by state name to make the test order-insensitive.
    const sorted = [...next].sort((a, b) => a.state.localeCompare(b.state));
    expect(sorted).toEqual([
      { state: 'clarified', commentRequired: false },
      { state: 'closed', commentRequired: true },
    ]);
  });

  it('returns closed (no comment) from clarified', () => {
    const next = nextStates('wishlist-clarification', 'clarified');
    expect(next).toEqual([{ state: 'closed', commentRequired: false }]);
  });

  it('returns no transitions from closed (terminal)', () => {
    expect(nextStates('wishlist-clarification', 'closed')).toEqual([]);
  });

  it('returns no transitions for an unknown type', () => {
    // @ts-expect-error — exercise the unknown-type guard
    expect(nextStates('unknown-type', 'raised')).toEqual([]);
  });
});

describe('isTerminalState', () => {
  it('treats closed as terminal', () => {
    expect(isTerminalState('closed')).toBe(true);
  });

  it('does not treat raised as terminal', () => {
    expect(isTerminalState('raised')).toBe(false);
  });

  it('does not treat clarified as terminal', () => {
    expect(isTerminalState('clarified')).toBe(false);
  });
});
