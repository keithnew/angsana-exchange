// =============================================================================
// tests/mentions/assigneePickerInput.test.ts
//
// Pure-logic tests for the AssigneePickerInput helper module
// (S3-code-P4 §4 — Assignee picker). Component-level render-pass
// tests are banked at S5 alongside the P3-banked picker-component
// tests — same JSDOM-deferral rationale (vitest is `environment: 'node'`).
// =============================================================================

import { describe, expect, test } from 'vitest';
import {
  deriveQueryFromValue,
  formatPickedEmail,
  isFreeTextMode,
  shouldOpenPickerForQuery,
} from '../../src/lib/mentions/assigneePickerInput';

describe('lib/mentions/assigneePickerInput — shouldOpenPickerForQuery', () => {
  test('returns false for empty input (no query → no candidates)', () => {
    expect(shouldOpenPickerForQuery('')).toBe(false);
  });

  test('returns true for an active single-token query (no whitespace)', () => {
    expect(shouldOpenPickerForQuery('mi')).toBe(true);
    expect(shouldOpenPickerForQuery('alice@cegid.com')).toBe(true);
  });

  test('returns false when input contains whitespace (free-text mode — "Mike Code")', () => {
    expect(shouldOpenPickerForQuery('Mike Code')).toBe(false);
    expect(shouldOpenPickerForQuery('Alice ')).toBe(false);
    expect(shouldOpenPickerForQuery(' alice')).toBe(false);
  });

  test('returns true for leading-@ with no query yet (operator just typed @)', () => {
    expect(shouldOpenPickerForQuery('@')).toBe(true);
  });

  test('returns true for leading-@ with active sub-query (operator typing @mike)', () => {
    expect(shouldOpenPickerForQuery('@mike')).toBe(true);
  });

  test('returns false for leading-@ with whitespace beyond it (e.g. picker was opened then user typed space)', () => {
    expect(shouldOpenPickerForQuery('@mike code')).toBe(false);
  });
});

describe('lib/mentions/assigneePickerInput — deriveQueryFromValue', () => {
  test('strips a single leading @ for picker-search semantics', () => {
    expect(deriveQueryFromValue('@mike')).toBe('mike');
    expect(deriveQueryFromValue('@alice@cegid.com')).toBe('alice@cegid.com');
  });

  test('returns the value verbatim when no leading @', () => {
    expect(deriveQueryFromValue('mike')).toBe('mike');
    expect(deriveQueryFromValue('')).toBe('');
  });

  test('preserves non-leading @ characters (the email-address case)', () => {
    // Non-leading `@` is part of the email syntax; do NOT strip.
    expect(deriveQueryFromValue('alice@cegid.com')).toBe('alice@cegid.com');
  });
});

describe('lib/mentions/assigneePickerInput — formatPickedEmail', () => {
  test('prepends @ to make the §4.1 chip-renderable token shape', () => {
    expect(formatPickedEmail('alice@cegid.com')).toBe('@alice@cegid.com');
    expect(formatPickedEmail('mike@angsana.com')).toBe('@mike@angsana.com');
  });

  test('round-trips through deriveQueryFromValue and back', () => {
    // Picked → stored as `@<email>`. Subsequent re-render passes the
    // stored value through deriveQueryFromValue → query is the email
    // verbatim, suitable for re-querying the picker if reopened.
    const stored = formatPickedEmail('alice@cegid.com');
    expect(deriveQueryFromValue(stored)).toBe('alice@cegid.com');
  });
});

describe('lib/mentions/assigneePickerInput — isFreeTextMode (inverse signal)', () => {
  test('returns false for empty (treated as picker-eligible-but-empty)', () => {
    // Empty is its own state; not free-text and not picker-mode either.
    expect(isFreeTextMode('')).toBe(false);
  });

  test('returns true for whitespace-containing names ("Mike Code")', () => {
    expect(isFreeTextMode('Mike Code')).toBe(true);
  });

  test('returns false for an active token (picker-mode wins)', () => {
    expect(isFreeTextMode('mi')).toBe(false);
    expect(isFreeTextMode('@mike')).toBe(false);
  });
});
