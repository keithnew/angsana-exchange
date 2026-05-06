// =============================================================================
// parseMentions — caret-driven active-token detection + finalised-body
// `@<email>` token extraction.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  findActiveMentionToken,
  extractMentionTokens,
} from '../../src/lib/mentions/parseMentions';

describe('findActiveMentionToken', () => {
  it('returns the active token at start-of-text', () => {
    const result = findActiveMentionToken('@bob', 4);
    expect(result).toEqual({ start: 0, end: 4, query: 'bob' });
  });

  it('returns the active token after a space', () => {
    const result = findActiveMentionToken('hi @bob', 7);
    expect(result).toEqual({ start: 3, end: 7, query: 'bob' });
  });

  it('returns null when caret is past a closed token (whitespace seen)', () => {
    const result = findActiveMentionToken('hi @bob ', 8);
    expect(result).toBeNull();
  });

  it('returns null when no @ exists before the caret on the current run', () => {
    const result = findActiveMentionToken('plain text here', 5);
    expect(result).toBeNull();
  });

  it('returns null when @ is preceded by a non-space character', () => {
    // E.g. an inline email `bob@cegid.com` — the @ is part of an address,
    // not a mention starter.
    const result = findActiveMentionToken('bob@cegid.com', 13);
    expect(result).toBeNull();
  });

  it('returns the most-recent @ token when multiple are present', () => {
    const result = findActiveMentionToken('@alice and @bo', 14);
    expect(result).toEqual({ start: 11, end: 14, query: 'bo' });
  });

  it('handles empty query (just @ typed)', () => {
    const result = findActiveMentionToken('@', 1);
    expect(result).toEqual({ start: 0, end: 1, query: '' });
  });

  it('returns null on out-of-range caret', () => {
    expect(findActiveMentionToken('@bob', -1)).toBeNull();
    expect(findActiveMentionToken('@bob', 99)).toBeNull();
  });
});

describe('extractMentionTokens', () => {
  it('extracts a single @<email> token', () => {
    const out = extractMentionTokens('hello @bob@cegid.com');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      raw: '@bob@cegid.com',
      identifier: 'bob@cegid.com',
    });
  });

  it('extracts multiple tokens', () => {
    const out = extractMentionTokens('@a@x.com hi @b@y.com');
    expect(out.map((t) => t.identifier)).toEqual(['a@x.com', 'b@y.com']);
  });

  it('returns an empty array when there are no @ tokens', () => {
    expect(extractMentionTokens('plain prose')).toEqual([]);
    expect(extractMentionTokens('')).toEqual([]);
  });

  it('does not extract @ that is part of a non-mention email (no leading space)', () => {
    // `bob@cegid.com` at start of text counts because start-of-text is
    // an acceptable boundary — but `Xbob@cegid.com` does not.
    const out = extractMentionTokens('Xbob@cegid.com');
    expect(out).toEqual([]);
  });

  it('extracts @ at start-of-text', () => {
    const out = extractMentionTokens('@first@x.com last');
    expect(out).toHaveLength(1);
    expect(out[0].identifier).toBe('first@x.com');
  });

  it('records correct start/end indices', () => {
    const text = 'hi @a@x.com tail';
    const out = extractMentionTokens(text);
    expect(out[0].start).toBe(3);
    expect(out[0].end).toBe(11); // length of '@a@x.com' from index 3
    expect(text.slice(out[0].start, out[0].end)).toBe('@a@x.com');
  });
});
