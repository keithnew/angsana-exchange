// =============================================================================
// audienceClass — compute-on-read derivation from a user's `role`.
//
// S3-pre-code Decision #11 ("Cross-tenant mention case — audienceClass
// derivation + picker filter contract") + Notification Pattern v0.1
// §4.1 amendment.
//
// Mapping:
//   audienceClass: 'internal' ← role ∈ {am, ad, researcher, curator,
//                                       internal-admin, internal-user}
//   audienceClass: 'client'   ← role ∈ {client-approver, client-viewer}
//   default ('internal')      ← any unrecognised role (defensive — the
//                                Spec §4.1 amendment is explicit that
//                                defensive default is `internal` so that
//                                an unknown internal-tenant role does
//                                not become a client by accident).
//
// Note on role-name drift:
//   Decision #11 names the mapping in terms of the platform user roles
//   (`am`, `ad`, `researcher`, `curator`). Today's Exchange tenant
//   directory carries the operational role values (`internal-admin`,
//   `internal-user`, `client-approver`, `client-viewer`) — see
//   `src/types/index.ts:UserRole` and the `tenants/{tenantId}/users/{uid}`
//   provisioning paths in `app/api/v1/exchange/.../provision`. Until S5's
//   user-directory normalisation lands (banked refinement #18), this
//   helper accepts BOTH role-name spaces. The picker uses the
//   operational names; the test suite covers both for parity with
//   Decision #11 wording.
//
// Banked refinement (Decision #11):
//   Materialise `audienceClass` as a stored field if S5 bell-pane
//   scaling needs precomputed values for realtime-listener efficiency.
//   Today the picker reads ~10–20 users at a time; the compute is
//   one-line and dominated by network round-trip. Today's path stays
//   compute-on-read.
// =============================================================================

export type AudienceClass = 'internal' | 'client';

const INTERNAL_ROLES: ReadonlySet<string> = new Set([
  // Platform-spec names per Decision #11
  'am',
  'ad',
  'researcher',
  'curator',
  // Operational names used in Exchange tenant directory today
  'internal-admin',
  'internal-user',
]);

const CLIENT_ROLES: ReadonlySet<string> = new Set([
  'client-approver',
  'client-viewer',
]);

/**
 * Derive an audienceClass from a user's `role` field.
 *
 * - Internal-tenant roles → `'internal'`.
 * - Client-tenant roles → `'client'`.
 * - Anything else → `'internal'` (defensive default per §4.1 amendment).
 *
 * Pure; no side-effects. The caller (typically the MentionPicker, or a
 * server-component user-directory loader) calls this on each user read.
 */
export function deriveAudienceClass(role: string | undefined | null): AudienceClass {
  if (!role) return 'internal';
  if (CLIENT_ROLES.has(role)) return 'client';
  if (INTERNAL_ROLES.has(role)) return 'internal';
  // Unknown roles: default to internal. Decision #11 calls this out
  // explicitly — an unrecognised internal-tenant role should not
  // become a client by accident.
  return 'internal';
}

// ─── Picker filter rules (Decision #11 + §"The picker contract") ──────────

/**
 * The audience the comment will be posted with.
 */
export type CommentAudience = 'internal' | 'shared' | 'client';

/**
 * Picker filter rule per the §"The picker contract" table:
 *
 *   internal    → only internal candidates surface
 *   shared      → both classes surface
 *   client      → both classes surface
 *
 * Reasoning (verbatim from pre-code §"Picker filter rules per comment
 * audience"):
 *   - Internal-only comments do not surface to clients; picker enforces
 *     by construction.
 *   - Shared comments cross the audience boundary by design.
 *   - Client-audience comments may originate from either side.
 */
export function isCandidateVisible(
  candidateClass: AudienceClass,
  commentAudience: CommentAudience
): boolean {
  if (commentAudience === 'internal') {
    return candidateClass === 'internal';
  }
  // 'shared' and 'client' both expose the union.
  return true;
}

// ─── Hand-typed @<email> mismatch detection ────────────────────────────────

/**
 * Detect the §4.1 amendment "hand-typed @<email>" mismatch case.
 *
 * Inputs:
 *   - `email`            — the email portion the user typed, e.g.
 *                          `bob@cegid.com`. Lower-cased and trimmed by
 *                          the caller (or this helper does it).
 *   - `directory`        — the same user-directory the picker reads from,
 *                          mapping email → role (case-insensitive lookup
 *                          handled inside).
 *   - `commentAudience`  — the audience that will be applied to the
 *                          enclosing comment.
 *
 * Output:
 *   - `'styled-chip'`  — the email resolves to a known user whose
 *                        audienceClass matches the comment audience filter.
 *                        Render as a styled mention chip.
 *   - `'plain-text'`   — the email is unknown OR resolves to a user
 *                        whose audienceClass would NOT pass the picker's
 *                        filter for this comment audience. Render as
 *                        plain text — that's the user-facing signal that
 *                        the mention did not take. (§4.1 amendment.)
 *
 * Rendering layer is responsible for actually styling the chip vs the
 * plain text; this helper just decides which path applies.
 */
export type MentionRenderKind = 'styled-chip' | 'plain-text';

export interface DirectoryUser {
  email: string;
  role: string;
}

export function classifyHandTypedMention(
  email: string,
  directory: ReadonlyArray<DirectoryUser>,
  commentAudience: CommentAudience
): MentionRenderKind {
  const needle = email.trim().toLowerCase();
  if (!needle) return 'plain-text';
  const match = directory.find(
    (u) => (u.email ?? '').trim().toLowerCase() === needle
  );
  if (!match) return 'plain-text';
  const cls = deriveAudienceClass(match.role);
  return isCandidateVisible(cls, commentAudience) ? 'styled-chip' : 'plain-text';
}
