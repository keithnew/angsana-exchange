// =============================================================================
// Mention parsing — pure helpers used by the patched CommentBox.
//
// Two responsibilities:
//
//  1. `findActiveMentionToken` — given the textarea's value + the caret
//     position, return the `@`-prefixed token currently being typed (or
//     null when the caret is not inside a mention token). Drives the
//     MentionPicker's open/close state from the textarea.
//
//  2. `extractMentionTokens` — given a finalised comment body, extract
//     the list of `@<email>` tokens for the §4.1 styled-chip vs
//     plain-text rendering pass. The parent then hands each token's
//     email through `classifyHandTypedMention` (in `audienceClass.ts`)
//     to decide which path applies.
//
// Pure; no React, no DOM. Drivable from tests.
// =============================================================================

const EMAIL_LIKE = /@[^\s@]+@?[^\s@]*/;

/**
 * Find the `@`-prefixed token the caret is currently inside.
 *
 * Returns:
 *   - The `start` index of the `@` in the original string.
 *   - The `end` index (exclusive) — where the token currently ends.
 *   - The `query` — the part after the `@` up to the caret.
 *
 * Returns `null` when:
 *   - No `@` exists before the caret on the current line, OR
 *   - There's whitespace between the most-recent `@` and the caret
 *     (the user has moved on past the token), OR
 *   - The most-recent `@` is preceded by a non-space character (it's
 *     part of an email address being typed in regular prose, not a
 *     mention starter).
 */
export interface ActiveMention {
  start: number;
  end: number;
  query: string;
}

export function findActiveMentionToken(
  text: string,
  caret: number
): ActiveMention | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  // Walk backwards to find the most-recent `@` that's a mention starter.
  let i = before.length - 1;
  while (i >= 0) {
    const ch = before[i];
    if (ch === '@') {
      // Confirm this `@` is at start-of-text or preceded by whitespace.
      if (i === 0 || /\s/.test(before[i - 1])) {
        const query = before.slice(i + 1);
        // If the query already contains whitespace, the mention has
        // ended; the user has moved past it.
        if (/\s/.test(query)) return null;
        // Cap the query length to a reasonable bound so we don't search
        // forever on malformed input.
        if (query.length > 80) return null;
        return { start: i, end: caret, query };
      }
      // `@` is in the middle of a non-mention token (e.g. a stray email
      // pasted directly into prose without space before it).
      return null;
    }
    if (/\s/.test(ch)) {
      // Crossed a whitespace boundary without finding an `@`.
      return null;
    }
    i--;
  }
  return null;
}

/**
 * Extract `@<email>` tokens from a finalised comment body.
 *
 * Greedy email-like match — anything from `@` up to the next whitespace.
 * The parent passes each match through `classifyHandTypedMention` to
 * decide styled-chip vs plain-text.
 *
 * Tokens that don't look like an email at all (e.g. just `@bob`) still
 * surface; the classifier returns 'plain-text' for unknowns, which is
 * the correct §4.1 behaviour either way.
 */
export interface MentionToken {
  /** Including the leading `@`. */
  raw: string;
  /** Without the leading `@` — the email-or-handle portion. */
  identifier: string;
  start: number;
  end: number;
}

export function extractMentionTokens(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  const re = /(^|\s)@([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lead = m[1] ?? '';
    const ident = m[2];
    const atIndex = m.index + lead.length;
    out.push({
      raw: `@${ident}`,
      identifier: ident,
      start: atIndex,
      end: atIndex + 1 + ident.length,
    });
  }
  return out;
}

// Re-export the regex for callers that want to do their own pre-checks
// (e.g. a "looks-like-email" early-return). Kept here so the email-shape
// definition lives in one place.
export const EMAIL_LIKE_PATTERN = EMAIL_LIKE;
