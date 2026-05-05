/**
 * Unit tests for the Dimension Packs §6.1 migration heuristic.
 *
 * The heuristic is deliberately simple and deliberately produces wrong
 * answers for some Clients (Packs §6.1: "produces wrong answers for some
 * Clients. This is expected and is fine."). These tests pin the rule's
 * behaviour so future changes are deliberate, not accidental.
 */

import { describe, expect, it } from 'vitest';

import { applyMigrationHeuristic } from '@/lib/packs/heuristic';

describe('applyMigrationHeuristic', () => {
  describe('marketing-services pack (always added)', () => {
    it('is added even when no other signals are present (Packs §6.1)', () => {
      expect(applyMigrationHeuristic({})).toEqual(['marketing-services']);
    });

    it('appears alongside healthcare', () => {
      expect(
        applyMigrationHeuristic({ sfIndustry: 'Pharmaceutical Manufacturing' }),
      ).toEqual(['healthcare', 'marketing-services']);
    });
  });

  describe('healthcare pack', () => {
    it.each([
      'Pharmaceutical Manufacturing',
      'pharma',
      'Biotech',
      'Medical Devices',
      'Healthcare Services',
      'Health Care',
      'Life Sciences',
      'Hospital and Health Care',
      'Clinical Research',
    ])('toggles on for SF industry %s', (sfIndustry) => {
      expect(applyMigrationHeuristic({ sfIndustry })).toContain('healthcare');
    });

    it('toggles on for the healthcare-life-sciences sector id', () => {
      const result = applyMigrationHeuristic({
        sectors: ['healthcare-life-sciences'],
      });
      expect(result).toContain('healthcare');
    });

    it('toggles on when therapyAreas tags are present (Wavix-style early data)', () => {
      const result = applyMigrationHeuristic({ therapyAreas: ['oncology'] });
      expect(result).toContain('healthcare');
    });

    it('does not toggle on for unrelated SF industries', () => {
      expect(applyMigrationHeuristic({ sfIndustry: 'Retail' })).not.toContain(
        'healthcare',
      );
    });
  });

  describe('tech-b2b pack', () => {
    it.each([
      'Computer Software',
      'SaaS Platform',
      'IT Services',
      'Information Technology',
      'Technology',
      'Telecommunications',
      'Cloud Services',
      'Cybersecurity',
    ])('toggles on for SF industry %s', (sfIndustry) => {
      expect(applyMigrationHeuristic({ sfIndustry })).toContain('tech-b2b');
    });

    it('toggles on for the technology sector id', () => {
      expect(applyMigrationHeuristic({ sectors: ['technology'] })).toContain(
        'tech-b2b',
      );
    });

    it('toggles on for the media-telecoms sector id', () => {
      expect(applyMigrationHeuristic({ sectors: ['media-telecoms'] })).toContain(
        'tech-b2b',
      );
    });

    it('does not toggle on for unrelated SF industries', () => {
      expect(applyMigrationHeuristic({ sfIndustry: 'Retail' })).not.toContain(
        'tech-b2b',
      );
    });
  });

  describe('mixed-shape Clients (Packs §2.2: a Client can carry both)', () => {
    it('toggles both packs when SF industry is healthcare and sectors include technology', () => {
      const result = applyMigrationHeuristic({
        sfIndustry: 'Pharmaceutical Manufacturing',
        sectors: ['technology'],
      });
      expect(result).toEqual(['healthcare', 'tech-b2b', 'marketing-services']);
    });
  });

  describe('determinism', () => {
    it('produces a stable order: healthcare → tech-b2b → marketing-services', () => {
      const result = applyMigrationHeuristic({
        sfIndustry: 'SaaS',
        sectors: ['healthcare-life-sciences'],
      });
      expect(result).toEqual(['healthcare', 'tech-b2b', 'marketing-services']);
    });

    it('is case-insensitive on SF industry', () => {
      expect(
        applyMigrationHeuristic({ sfIndustry: 'PHARMACEUTICAL MANUFACTURING' }),
      ).toContain('healthcare');
    });

    it('treats null/undefined fields as "no signal"', () => {
      expect(
        applyMigrationHeuristic({
          sfIndustry: null,
          sectors: null,
          therapyAreas: null,
        }),
      ).toEqual(['marketing-services']);
    });
  });
});
