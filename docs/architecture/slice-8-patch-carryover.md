# Slice 8 Patch — Handover to Final Conversation

**Date:** 10 April 2026  
**Spec:** `angsana-exchange/docs/architecture/slice-8-patch-spec.md`  
**Build status:** `tsc --noEmit` passes cleanly (zero errors)

---

## How to start

Read these two files first:
1. `angsana-exchange/docs/architecture/slice-8-patch-spec.md` — the full spec (source of truth). Focus on **Change 7** (line ~159).
2. This file — tells you what's done and what remains.

Then read only the 4 files you need to modify (listed below). **Do NOT read** `ProspectingProfileClient.tsx` or `types/index.ts` — they are large and not relevant to the remaining work.

---

## Summary: what the spec describes (7 changes)

| Change | Description | Status |
|--------|-------------|--------|
| 1 | Move ICP into per-proposition sub-docs | ✅ DONE |
| 2 | Resolve UIDs to display names on cards | ✅ DONE |
| 3 | Client-approver can suggest propositions (API + UI) | ✅ DONE |
| 4 | Buying process types as managed list (backend + admin tab) | ✅ DONE |
| 5 | Recommendation card metadata (UID resolution) | ✅ DONE |
| 6 | Proposition → campaign cross-links | ✅ DONE |
| 7 | Documents `campaignRef` → `campaignRefs` migration | ⚠️ PARTIAL — see below |

---

## What's DONE for Change 7 (foundation only)

These pieces were built in conversation 1:
- `campaignRefs?: string[]` field added to `Campaign` type in `src/types/index.ts`
- **Normalisation helper** at `src/lib/documents/campaignRefs.ts`:
  - `normaliseCampaignRefs(doc)` — reads old `campaignRef` (string) or new `campaignRefs` (array), returns `string[]`
  - `getCampaignRefsForWrite(refs)` — returns `{ campaignRefs: [...], campaignRef: FieldValue.delete() }` for Firestore writes
- **Firestore index** in `firestore.indexes.json`: `documents(campaignRefs ARRAY_CONTAINS, folderCategory ASC)`

---

## What STILL NEEDS DOING for Change 7

Per the spec (section "Change 7: Documents campaignRef → campaignRefs"), there are 4 files to update:

### 1. API: `src/app/api/clients/[clientId]/documents/[documentId]/campaign/route.ts`
**Current:** Accepts `{ campaignRef: string | null }`, writes `campaignRef` field.  
**Change to:** Accept `{ campaignRefs: string[] }`. Empty array clears all. Use `getCampaignRefsForWrite()` helper. Always write `campaignRefs` array and delete old `campaignRef` field.

### 2. API: `src/app/api/clients/[clientId]/documents/browse/route.ts`
**Current:** `?campaign=` filter uses `where('campaignRef', '==', value)`.  
**Change to:** Use `where('campaignRefs', 'array-contains', value)`.  
**Backward compat:** The normalisation helper on read handles old docs that only have `campaignRef`.

### 3. Component: `src/components/documents/CampaignDocumentsCard.tsx`
**Current:** Queries documents with `where('campaignRef', '==', campaignId)`.  
**Change to:** Use `where('campaignRefs', 'array-contains', campaignId)`.  
**Display:** Show multiple teal campaign pills on file rows (not just one).

### 4. UI: `src/app/(dashboard)/clients/[clientId]/documents/DocumentsClient.tsx`
**Current:** "Link to campaign" action in three-dot menu is single-select.  
**Change to:** Multi-select checkbox list for campaign tagging. File row should show multiple teal campaign tag pills.  
**Campaign filter dropdown:** Unchanged (single select, but query becomes `array-contains`).

### 5. Polish (after Change 7)
- Verify seed script runs cleanly: `npx ts-node scripts/seed.ts`
- Run `tsc --noEmit` to confirm zero errors
- End-to-end manual test of CPP page with both `internal-admin` and `client-approver` roles
- Verify campaign picker excludes draft propositions

---

## Key spec rules for Change 7 (from slice-8-patch-spec.md)

- **Reading:** if doc has `campaignRef` (string) but no `campaignRefs` (array), treat as `campaignRefs: [campaignRef]`
- **Writing:** always write `campaignRefs` (array). Delete old `campaignRef` field using `FieldValue.delete()`
- **The normalisation helper already handles this** — import from `src/lib/documents/campaignRefs.ts`
- **Index already exists** in `firestore.indexes.json`

---

## Files to read for this conversation

| File | Lines | What to do |
|------|-------|-----------|
| `src/lib/documents/campaignRefs.ts` | ~55 | Read — helper to import |
| `src/app/api/clients/[clientId]/documents/[documentId]/campaign/route.ts` | ~160 | Modify — accept `campaignRefs[]`, use helper |
| `src/app/api/clients/[clientId]/documents/browse/route.ts` | ~367 | Modify — change `==` to `array-contains` |
| `src/components/documents/CampaignDocumentsCard.tsx` | ~210 | Modify — change query + multi-pill display |
| `src/app/(dashboard)/clients/[clientId]/documents/DocumentsClient.tsx` | ~1160 | Modify — multi-select campaign tagging UI |

**Do NOT read** these (too large, not needed):
- `ProspectingProfileClient.tsx` (~1170 lines) — Changes 1–6 are complete
- `types/index.ts` (~1100 lines) — types already correct
- `ManagedListsClient.tsx` (~694 lines) — Change 4 admin tab is complete

---

## Done after this conversation

Once Change 7 is implemented and the polish checks pass, the entire Slice 8 Patch spec is complete. No further conversations needed.
