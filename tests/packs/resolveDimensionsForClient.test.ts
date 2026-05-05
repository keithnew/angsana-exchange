/**
 * Unit tests for the Dimension Packs §5.4 dimension-resolution helper.
 *
 * Covers the rule:
 *   "the dimensions that apply to a Client are the universal core plus
 *    the union of dimensions bound to the Client's active packs"
 *  (Packs §3.1).
 *
 * The helper is the only Pack-aware code in the consuming application
 * (Packs §7); its correctness gates every adopting surface, so the
 * helper has its own pure-logic test set.
 */

import { describe, expect, it } from 'vitest';

import { resolveDimensionsForClient } from '@/lib/packs/resolveDimensionsForClient';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const universalDimensions = [
  { id: 'geography' },
  { id: 'service-type' },
  { id: 'sector' },
];

const healthcareDimensions = [
  { id: 'therapy-area', packs: ['healthcare'] },
  { id: 'drug-development-phase', packs: ['healthcare'] },
];

const techB2BDimensions = [
  { id: 'product-module', packs: ['tech-b2b'] },
  { id: 'vertical-sold-into', packs: ['tech-b2b'] },
];

/** Catalogue order is preserved by the helper; tests pin that. */
const fullCatalogue = [
  ...universalDimensions,
  ...healthcareDimensions,
  ...techB2BDimensions,
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('resolveDimensionsForClient', () => {
  it('returns only the universal core for a Client with no packs', () => {
    const result = resolveDimensionsForClient({ packs: [] }, fullCatalogue);
    expect(result.map((d) => d.id)).toEqual(['geography', 'service-type', 'sector']);
  });

  it('adds healthcare dimensions when the healthcare pack is active', () => {
    const result = resolveDimensionsForClient({ packs: ['healthcare'] }, fullCatalogue);
    expect(result.map((d) => d.id)).toEqual([
      'geography',
      'service-type',
      'sector',
      'therapy-area',
      'drug-development-phase',
    ]);
  });

  it('adds tech-b2b dimensions when the tech-b2b pack is active', () => {
    const result = resolveDimensionsForClient({ packs: ['tech-b2b'] }, fullCatalogue);
    expect(result.map((d) => d.id)).toEqual([
      'geography',
      'service-type',
      'sector',
      'product-module',
      'vertical-sold-into',
    ]);
  });

  it('unions multiple packs (Packs §2.2: a Client can carry both)', () => {
    const result = resolveDimensionsForClient(
      { packs: ['healthcare', 'tech-b2b'] },
      fullCatalogue,
    );
    expect(result.map((d) => d.id)).toEqual([
      'geography',
      'service-type',
      'sector',
      'therapy-area',
      'drug-development-phase',
      'product-module',
      'vertical-sold-into',
    ]);
  });

  it('treats marketing-services as empty in v0.1 (Packs §4 reserved pack)', () => {
    // The marketing-services pack is reserved-but-empty; no dimensions
    // bind to it. The helper output should be identical to a Client with
    // no packs.
    const result = resolveDimensionsForClient(
      { packs: ['marketing-services'] },
      fullCatalogue,
    );
    expect(result.map((d) => d.id)).toEqual(['geography', 'service-type', 'sector']);
  });

  it('treats absent packs field on a dimension as universal core', () => {
    // The packs field is optional per Packs §5.3; absent → universal core.
    const catalogue = [{ id: 'no-packs-field' }, { id: 'empty-packs', packs: [] }];
    const result = resolveDimensionsForClient({ packs: ['healthcare'] }, catalogue);
    expect(result.map((d) => d.id)).toEqual(['no-packs-field', 'empty-packs']);
  });

  it('preserves catalogue order in the result', () => {
    // Order matters for deterministic UX; the helper is a filter, so
    // it should preserve the catalogue's order rather than re-grouping.
    const reordered = [
      { id: 'therapy-area', packs: ['healthcare'] },
      { id: 'geography' },
      { id: 'product-module', packs: ['tech-b2b'] },
      { id: 'sector' },
    ];
    const result = resolveDimensionsForClient(
      { packs: ['healthcare', 'tech-b2b'] },
      reordered,
    );
    expect(result.map((d) => d.id)).toEqual([
      'therapy-area',
      'geography',
      'product-module',
      'sector',
    ]);
  });

  it('ignores pack toggles that do not match any dimension', () => {
    // Forward-compatibility: a Client may carry a pack ID that no
    // dimension currently binds to (the marketing-services case, or a
    // future tenant-defined pack). Helper returns universal core only.
    const result = resolveDimensionsForClient(
      { packs: ['some-future-pack'] },
      fullCatalogue,
    );
    expect(result.map((d) => d.id)).toEqual(['geography', 'service-type', 'sector']);
  });

  it('returns an empty list for an empty catalogue', () => {
    expect(resolveDimensionsForClient({ packs: ['healthcare'] }, [])).toEqual([]);
  });
});
