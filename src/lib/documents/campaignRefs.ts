// =============================================================================
// Angsana Exchange — Document ↔ Campaign Reference Helper (Slice 8 Patch)
//
// Backward-compatible helper for transitioning from single campaignRef
// to multi-value campaignRefs array.
//
// Usage:
//   import { getCampaignRefs } from '@/lib/documents/campaignRefs';
//   const refs = getCampaignRefs(doc);   // always returns string[]
// =============================================================================

import type { DocumentRegistryEntry } from '@/types';

/**
 * Returns a normalised array of campaign IDs for a document.
 *
 * Reads campaignRefs first (new field). If empty/missing, falls back to
 * legacy campaignRef (single string). Returns [] if neither is set.
 *
 * Guarantees: always returns string[], never null/undefined.
 */
export function getCampaignRefs(
  doc: Pick<DocumentRegistryEntry, 'campaignRefs' | 'campaignRef'>
): string[] {
  // New field takes precedence
  if (Array.isArray(doc.campaignRefs) && doc.campaignRefs.length > 0) {
    return doc.campaignRefs;
  }

  // Legacy fallback
  if (doc.campaignRef && typeof doc.campaignRef === 'string') {
    return [doc.campaignRef];
  }

  return [];
}

/**
 * Builds a Firestore-safe update payload that keeps both campaignRef and
 * campaignRefs in sync during the transition period.
 *
 * Call this when setting campaign references on a document to ensure
 * backward compatibility with code reading the old field.
 */
export function buildCampaignRefsUpdate(campaignIds: string[]): {
  campaignRefs: string[];
  campaignRef: string | null;
} {
  const cleaned = campaignIds.filter((id) => id && typeof id === 'string');
  return {
    campaignRefs: cleaned,
    // Keep legacy field in sync — first value or null
    campaignRef: cleaned.length > 0 ? cleaned[0] : null,
  };
}
