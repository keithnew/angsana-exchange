/**
 * Unit tests for the Targeting Hints Picker §10.2 resolveSelections helper.
 *
 * The helper is the read-time bridge between the sparse-tree storage
 * (Selection[]) and concrete value sets. Surfaces consuming Selections
 * (Refinery queries, Conflict checks, etc.) depend on its rules being
 * exactly the §6 model — empty-means-all, except-list narrowing,
 * future-additions semantics. These tests pin every example from the
 * spec's §6.4 table plus the polarity-split contract from §10.2.
 */

import { describe, expect, it } from 'vitest';

import {
  resolveSelections,
  type CatalogueDimension,
} from '@/components/targetingHints/resolveSelections';
import type { Selection } from '@/components/targetingHints/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/**
 * The Picker §6.4 fixture catalogue: a clustered "Technology" dimension
 * with two clusters (LLM, AI) and a flat "Functions" dimension with
 * sales-operations among its values.
 */
const technology: CatalogueDimension = {
  id: 'sector-technology',
  clusters: [
    { id: 'llm', valueIds: ['gpt-4', 'claude', 'gemini', 'llama'] },
    { id: 'ai', valueIds: ['vector-db', 'mlops', 'fine-tuning'] },
  ],
  values: [
    { id: 'gpt-4' },
    { id: 'claude' },
    { id: 'gemini' },
    { id: 'llama' },
    { id: 'vector-db' },
    { id: 'mlops' },
    { id: 'fine-tuning' },
  ],
};

const functions: CatalogueDimension = {
  id: 'sector-functions',
  values: [
    { id: 'sales-operations' },
    { id: 'finance' },
    { id: 'people' },
  ],
};

const catalogue: Record<string, CatalogueDimension> = {
  [technology.id]: technology,
  [functions.id]: functions,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('resolveSelections', () => {
  it('resolves a whole-dimension selection to all of its values (Picker §6.4 row 1)', () => {
    const sel: Selection[] = [{ dimensionId: 'sector-technology' }];
    const r = resolveSelections(sel, catalogue);
    expect(r.include['sector-technology']).toEqual([
      'gpt-4',
      'claude',
      'gemini',
      'llama',
      'vector-db',
      'mlops',
      'fine-tuning',
    ]);
    expect(r.exclude).toEqual({});
  });

  it('resolves a cluster selection to the clusters\' member values (§6.4 row 2)', () => {
    const sel: Selection[] = [
      { dimensionId: 'sector-technology', clusterIds: ['llm', 'ai'] },
    ];
    const r = resolveSelections(sel, catalogue);
    expect(r.include['sector-technology']).toEqual([
      'gpt-4',
      'claude',
      'gemini',
      'llama',
      'vector-db',
      'mlops',
      'fine-tuning',
    ]);
  });

  it('resolves a cluster + except-list to the cluster minus the excluded values (§6.4 row 3)', () => {
    const sel: Selection[] = [
      {
        dimensionId: 'sector-technology',
        clusterIds: ['llm'],
        excludeValueIds: ['gpt-4'],
      },
    ];
    const r = resolveSelections(sel, catalogue);
    expect(r.include['sector-technology']).toEqual(['claude', 'gemini', 'llama']);
  });

  it('resolves an enumerated value list to exactly those values (§6.4 row 4)', () => {
    const sel: Selection[] = [
      {
        dimensionId: 'sector-technology',
        valueIds: ['claude', 'gemini', 'llama'],
      },
    ];
    const r = resolveSelections(sel, catalogue);
    expect(r.include['sector-technology']).toEqual(['claude', 'gemini', 'llama']);
  });

  it('splits dual-polarity selections into include/exclude buckets (§6.4 row 5)', () => {
    const sel: Selection[] = [
      { dimensionId: 'sector-technology', intent: 'include' },
      {
        dimensionId: 'sector-functions',
        valueIds: ['sales-operations'],
        intent: 'exclude',
      },
    ];
    const r = resolveSelections(sel, catalogue);
    // Include side: all of Technology.
    expect(r.include['sector-technology']).toEqual([
      'gpt-4',
      'claude',
      'gemini',
      'llama',
      'vector-db',
      'mlops',
      'fine-tuning',
    ]);
    // Exclude side: just sales-operations.
    expect(r.exclude['sector-functions']).toEqual(['sales-operations']);
    // Picker §10.2 — caller decides how to combine them. Helper does
    // not pre-merge the sets.
    expect(r.include['sector-functions']).toBeUndefined();
    expect(r.exclude['sector-technology']).toBeUndefined();
  });

  it('honours future-additions semantics (Picker §6.2): a new value joins a cluster pick automatically', () => {
    // Catalogue snapshot t0: cluster has 4 values.
    const t0: Record<string, CatalogueDimension> = {
      [technology.id]: technology,
    };
    // Catalogue snapshot t1: a new value 'mistral' has been added to
    // the LLM cluster by curatorial work.
    const t1: Record<string, CatalogueDimension> = {
      [technology.id]: {
        ...technology,
        clusters: [
          { id: 'llm', valueIds: ['gpt-4', 'claude', 'gemini', 'llama', 'mistral'] },
          technology.clusters![1],
        ],
        values: [...technology.values, { id: 'mistral' }],
      },
    };
    const sel: Selection[] = [{ dimensionId: 'sector-technology', clusterIds: ['llm'] }];
    expect(resolveSelections(sel, t0).include['sector-technology']).not.toContain('mistral');
    // Same selection against the new snapshot picks up the new value
    // — this is the §6.2 "the user wanted this part of the world, the
    // curatorial team improved the map" guarantee.
    expect(resolveSelections(sel, t1).include['sector-technology']).toContain('mistral');
  });

  it('except-list survives future-additions (Picker §6.3)', () => {
    // mistral has been added to the LLM cluster; the user previously
    // selected "LLM except gpt-4". mistral should join the resolved set
    // because it isn't on the except-list.
    const t1: Record<string, CatalogueDimension> = {
      [technology.id]: {
        ...technology,
        clusters: [
          { id: 'llm', valueIds: ['gpt-4', 'claude', 'gemini', 'llama', 'mistral'] },
          technology.clusters![1],
        ],
        values: [...technology.values, { id: 'mistral' }],
      },
    };
    const sel: Selection[] = [
      {
        dimensionId: 'sector-technology',
        clusterIds: ['llm'],
        excludeValueIds: ['gpt-4'],
      },
    ];
    expect(resolveSelections(sel, t1).include['sector-technology']).toEqual([
      'claude',
      'gemini',
      'llama',
      'mistral',
    ]);
  });

  it('resolves to an empty set when the dimension is no longer in the catalogue', () => {
    // Defensive contract — selections may briefly outlive a retired
    // dimension between snapshots (Capabilities Note §4.6).
    const sel: Selection[] = [{ dimensionId: 'retired-dim' }];
    const r = resolveSelections(sel, catalogue);
    expect(r.include).toEqual({});
    expect(r.exclude).toEqual({});
  });

  it('is idempotent: same inputs → same outputs', () => {
    const sel: Selection[] = [
      { dimensionId: 'sector-technology', clusterIds: ['ai'] },
      {
        dimensionId: 'sector-functions',
        valueIds: ['finance'],
        intent: 'exclude',
      },
    ];
    const a = resolveSelections(sel, catalogue);
    const b = resolveSelections(sel, catalogue);
    expect(a).toEqual(b);
  });

  it('unions multiple selections targeting the same dimension under the same polarity', () => {
    const sel: Selection[] = [
      { dimensionId: 'sector-technology', clusterIds: ['llm'] },
      { dimensionId: 'sector-technology', clusterIds: ['ai'] },
    ];
    const r = resolveSelections(sel, catalogue);
    expect(r.include['sector-technology']).toEqual([
      'gpt-4',
      'claude',
      'gemini',
      'llama',
      'vector-db',
      'mlops',
      'fine-tuning',
    ]);
  });

  it('treats an unclustered dimension by skipping the cluster level (Picker §6.1)', () => {
    const sel: Selection[] = [
      { dimensionId: 'sector-functions', valueIds: ['finance'] },
    ];
    const r = resolveSelections(sel, catalogue);
    expect(r.include['sector-functions']).toEqual(['finance']);
  });

  it('positive-polarity selections never populate the exclude bucket', () => {
    // Wishlists / Conflicts / Exclusions / Relationships all run in
    // positive polarity (Picker §5); their picks omit `intent`.
    const sel: Selection[] = [
      { dimensionId: 'sector-technology' },
      { dimensionId: 'sector-functions', valueIds: ['people'] },
    ];
    const r = resolveSelections(sel, catalogue);
    expect(Object.keys(r.exclude)).toEqual([]);
    expect(r.include['sector-technology']).toBeDefined();
    expect(r.include['sector-functions']).toEqual(['people']);
  });
});
