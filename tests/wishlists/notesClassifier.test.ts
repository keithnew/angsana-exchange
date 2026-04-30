// =============================================================================
// notesClassifier — unit tests.
//
// Covers the four-route decision tree from spec §6.3 + the per-rule edge
// cases highlighted in the operational runbook (length thresholds, cue
// words, terminating punctuation). The classifier is the only business
// rule that decides where a legacy R1 `notes` value lands during the
// migration, so it gets first-class coverage.
//
// The test names are written so a `vitest run` failure reads as a spec
// citation: a regression in length boundaries names the affected rule.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { classifyNotes } from '@/lib/wishlists/notesClassifier';

describe('classifyNotes', () => {
  describe('rule 1 — empty', () => {
    it('returns empty for null', () => {
      expect(classifyNotes(null)).toEqual({ route: 'empty' });
    });

    it('returns empty for undefined', () => {
      expect(classifyNotes(undefined)).toEqual({ route: 'empty' });
    });

    it('returns empty for the empty string', () => {
      expect(classifyNotes('')).toEqual({ route: 'empty' });
    });

    it('returns empty for whitespace-only input', () => {
      expect(classifyNotes('   \n\t  ')).toEqual({ route: 'empty' });
    });
  });

  describe('rule 2 — short, hint-shaped → targeting-raw', () => {
    it('classifies a short phrase as targeting-raw', () => {
      expect(classifyNotes('Madrid hospitals')).toEqual({
        route: 'targeting-raw',
        raw: 'Madrid hospitals',
      });
    });

    it('allows the comma/ampersand/slash/hyphen punctuation set', () => {
      expect(classifyNotes('ENT, oncology & cardiology - tier-1')).toEqual({
        route: 'targeting-raw',
        raw: 'ENT, oncology & cardiology - tier-1',
      });
    });

    it('trims surrounding whitespace before checking the body', () => {
      expect(classifyNotes('  spain pharma  ')).toEqual({
        route: 'targeting-raw',
        raw: 'spain pharma',
      });
    });

    it('rejects a short phrase ending in `?` (forces work-item)', () => {
      const result = classifyNotes('Madrid hospitals?');
      expect(result.route).toBe('work-item');
    });

    it('rejects a short phrase ending in `.` (forces work-item)', () => {
      const result = classifyNotes('Madrid hospitals.');
      expect(result.route).toBe('work-item');
    });

    it('rejects a short phrase containing a colon (not in allowed set)', () => {
      const result = classifyNotes('Region: Iberia');
      expect(result.route).toBe('work-item');
    });

    it('rejects a phrase at the 50-char boundary (length must be < 50)', () => {
      const fiftyCharPhrase = 'a'.repeat(50); // length 50
      const result = classifyNotes(fiftyCharPhrase);
      expect(result.route).toBe('work-item');
    });

    it('accepts a phrase one shy of the 50-char boundary', () => {
      const fortyNine = 'a'.repeat(49);
      const result = classifyNotes(fortyNine);
      expect(result.route).toBe('targeting-raw');
    });
  });

  describe('rule 3 — long + case-study cue → so-what-draft', () => {
    const longBody = 'a'.repeat(220); // > 200

    it('routes to so-what-draft when long and contains "case study"', () => {
      const body = longBody + ' case study';
      const result = classifyNotes(body);
      expect(result).toEqual({ route: 'so-what-draft', body: body.trim() });
    });

    it('matches "deployed" as a cue (case-insensitive)', () => {
      const body = longBody + ' DEPLOYED in 2023';
      const result = classifyNotes(body);
      expect(result.route).toBe('so-what-draft');
    });

    it('matches "implementation" as a cue', () => {
      const body = longBody + ' implementation';
      expect(classifyNotes(body).route).toBe('so-what-draft');
    });

    it('matches "results" as a cue', () => {
      const body = longBody + ' results';
      expect(classifyNotes(body).route).toBe('so-what-draft');
    });

    it('matches "outcome" as a cue', () => {
      const body = longBody + ' outcome';
      expect(classifyNotes(body).route).toBe('so-what-draft');
    });

    it('does NOT route to so-what-draft when long but no cue word', () => {
      const result = classifyNotes(longBody);
      expect(result.route).toBe('work-item');
    });

    it('does NOT route to so-what-draft at the 200-char boundary', () => {
      const exactly200 = 'case study ' + 'a'.repeat(200 - 'case study '.length);
      // length is exactly 200; rule says > 200, so this falls through
      const result = classifyNotes(exactly200);
      expect(result.route).toBe('work-item');
    });
  });

  describe('rule 4 — work-item default', () => {
    it('routes a question sentence to work-item', () => {
      const result = classifyNotes('Should we include private hospitals?');
      expect(result).toEqual({
        route: 'work-item',
        body: 'Should we include private hospitals?',
      });
    });

    it('routes medium-length prose without cue words to work-item', () => {
      const body =
        'Need to confirm with the client whether oncology is in scope before adding tier-2 accounts.';
      expect(classifyNotes(body).route).toBe('work-item');
    });

    it('routes long prose without cue words to work-item', () => {
      const body =
        'This is a longer note that exceeds 50 characters but does not contain any of the case-study cue words and so should default to a work item rather than a so-what draft, even though it is descriptive.';
      const result = classifyNotes(body);
      expect(result.route).toBe('work-item');
    });
  });
});
