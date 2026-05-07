// =============================================================================
// lib/mentions/assigneePickerInput.ts
//
// Pure helpers for the AssigneePickerInput component (S3-code-P4 §4 —
// Assignee picker). These functions are JSDOM-free so the test suite
// can drive them without a React environment (current vitest config is
// `environment: 'node'`). The component's render-pass tests are banked
// at S5 alongside the P3-banked picker-component tests — same pooling-
// deferral rationale.
//
// The component itself wires these helpers to:
//   - Decide when the picker should open (caret or query change).
//   - Format the picked candidate's email into the storage shape.
//   - Recognise the leading-`@` typed by hand and derive the query from it.
//
// The component reuses `MentionPicker` (S3-P3) as the overlay primitive
// (Pattern A from the P4 plan — the P3 component is already a clean
// controlled-overlay shape with `open`/`query`/`anchor`/`onPick`/`onClose`,
// so no extraction is needed; AssigneePickerInput is a second caller).
// =============================================================================

/**
 * Decide whether the picker should be open given a current input value.
 *
 * Open conditions (any one):
 *   - Value is non-empty AND contains no whitespace (single token typed
 *     so far — the user is actively naming someone).
 *   - Value starts with `@` (operator explicitly invoked picker mode).
 *
 * Closed conditions:
 *   - Empty input (no query → no candidates worth showing).
 *   - Value contains whitespace (multi-word free-text — operator typed
 *     a name like "Mike Code" by hand; honour as free-text storage).
 *
 * Pure: no DOM, no React. Test against this directly.
 */
export function shouldOpenPickerForQuery(value: string): boolean {
  if (value.length === 0) return false;
  // Strip a leading `@` for the active-token semantics — the @ itself
  // should not count as whitespace and should not block the picker.
  const stripped = value.startsWith('@') ? value.slice(1) : value;
  if (stripped.length === 0) {
    // The user typed only `@`; picker SHOULD open (empty query is
    // valid — show the full candidate list).
    return true;
  }
  if (/\s/.test(stripped)) return false;
  return true;
}

/**
 * Derive the picker query string from the input value. Strips a leading
 * `@` (the §4.1 mention prefix is part of the storage shape but not
 * part of the search token).
 */
export function deriveQueryFromValue(value: string): string {
  if (value.startsWith('@')) return value.slice(1);
  return value;
}

/**
 * Format a candidate's email into the §4.1 mention-token storage shape.
 * Always prepends `@` to make the chip-renderable form. The check-in
 * form's existing storage takes the resulting string verbatim — same
 * field that historically held free-text "Mike Code" will now also hold
 * `@alice@cegid.com` for picked entries.
 *
 * Mirrors the CommentBox composer's pick-handler shape — the §4.1
 * styled-chip vs plain-text classifier downstream looks for the
 * leading `@` and the email syntax.
 */
export function formatPickedEmail(email: string): string {
  return `@${email}`;
}

/**
 * Recognise free-text input that should NOT trigger a picker open
 * (typed names with spaces, e.g. "Mike Code"). The §4.1 contract
 * preserves the free-text fallback verbatim — the picker is additive,
 * not replacement; users who type names by hand keep their old workflow.
 *
 * Returns true if the input is in "free-text mode" (no picker should
 * open). False if the input is in "picker mode" (a single query token
 * the picker should filter against).
 *
 * Note: the inverse of `shouldOpenPickerForQuery` for non-empty input.
 * Surfaced as its own helper for test signal clarity.
 */
export function isFreeTextMode(value: string): boolean {
  if (value.length === 0) return false;
  return !shouldOpenPickerForQuery(value);
}
