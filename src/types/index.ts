// =============================================================================
// Angsana Exchange — Shared Type Definitions
// =============================================================================

/**
 * User roles — determines navigation, permissions, and available actions.
 */
export type UserRole =
  | 'internal-admin'
  | 'internal-user'
  | 'client-approver'
  | 'client-viewer';

/**
 * Custom claims embedded in Firebase Auth JWT tokens.
 * Issued by seed script (Slice 1) or Cloud Function (later slices).
 */
export interface AuthClaims {
  /** Tenant identifier — scopes all Firestore reads to tenants/{tenantId}/... */
  tenantId: string;
  /** User role — determines navigation, permissions, and available actions */
  role: UserRole;
  /** For client users: their single client ID. For internal users: null. */
  clientId: string | null;
  /** For internal users: array of client IDs they can access. ["*"] for admin. */
  assignedClients: string[] | null;
  /** Which modules appear in navigation */
  permittedModules: string[];
}

/**
 * Serialisable user context — passed from server to client components.
 * This is the shape stored in AuthContext and read by the UI.
 */
export interface UserContext {
  /** Firebase Auth UID */
  uid: string;
  /** User's email address */
  email: string;
  /** Display name (from Firebase Auth profile) */
  displayName: string;
  /** All custom claims */
  claims: AuthClaims;
}

/**
 * Navigation menu item consumed by the Sidebar component.
 */
export interface NavItem {
  /** Display label */
  label: string;
  /** Route path — can include {clientId} placeholder. Omit for expandable parents with no own route. */
  route: string;
  /** Lucide icon name */
  icon: string;
  /** Which roles can see this item (empty array = visible to all authenticated users) */
  roles?: UserRole[];
  /** Module key — matched against permittedModules claim */
  module?: string;
  /** Child items — renders as an expandable group when present */
  children?: NavChildItem[];
}

/**
 * A child item within an expandable nav group.
 */
export interface NavChildItem {
  /** Display label */
  label: string;
  /** Route path — can include {clientId} placeholder */
  route: string;
  /** If true, item is greyed out and shows "soon" label */
  placeholder?: boolean;
}

/**
 * Theme configuration for brand identity.
 * Applied via CSS variables by the ThemeProvider.
 */
export interface ThemeConfig {
  /** Display name */
  name: string;
  /** Path to primary logo (horizontal lock-up) */
  logoPath: string;
  /** Path to compact mark (icon only) */
  markPath: string;
  /** Path to reversed/white logo for dark backgrounds */
  logoReversedPath: string;
  /** Colour palette — values are CSS colour strings (hex, hsl, etc.) */
  colours: {
    primary: string;
    secondary: string;
    muted: string;
    accentGold: string;
    accentCyan: string;
    accentGreen: string;
    accentMagenta: string;
    backgroundDark: string;
    background: string;
    foreground: string;
  };
}

/**
 * Client config document from Firestore (tenants/{tenantId}/clients/{clientId}).
 */
export interface ClientConfig {
  /** Document ID (slug) */
  id: string;
  /** Display name */
  name: string;
  /** URL-safe slug */
  slug: string;
  /** Service tier */
  tier: 'premium' | 'standard' | 'trial';
  /** Capabilities array — each string unlocks conditional UI and config */
  capabilities: string[];
  /** Competitors list */
  competitors: string[];
  /** Path to client logo (optional) */
  logoPath: string | null;
  /** Active therapy areas for this client (when therapyAreas capability enabled) */
  therapyAreas: string[];
  /** Conflicted therapy areas (blocked areas, when therapyAreas capability enabled) */
  conflictedTherapyAreas: string[];
  /** Last updated timestamp */
  updatedAt?: string;
  /** Who last updated */
  updatedBy?: string;
}

/**
 * Known capability strings.
 */
export type ClientCapability = 'therapyAreas';

// =============================================================================
// User Status (Slice 6B)
// =============================================================================

/**
 * User lifecycle status values.
 */
export type UserStatus = 'invited' | 'active' | 'disabled';

/**
 * User status display configuration — follows portfolio dashboard pattern.
 */
export const USER_STATUS_CONFIG: Record<
  UserStatus,
  { label: string; colour: string; bgColour: string }
> = {
  active: { label: 'Active', colour: '#059669', bgColour: '#ECFDF5' },
  invited: { label: 'Pending', colour: '#D97706', bgColour: '#FFFBEB' },
  disabled: { label: 'Disabled', colour: '#6B7280', bgColour: '#F3F4F6' },
};

/**
 * Role display configuration — colour-coded badges per spec.
 */
export const USER_ROLE_CONFIG: Record<
  UserRole,
  { label: string; colour: string; bgColour: string }
> = {
  'internal-admin': { label: 'Internal Admin', colour: '#004156', bgColour: '#E0F2F7' },
  'internal-user': { label: 'Internal User', colour: '#3B7584', bgColour: '#E8F4F8' },
  'client-approver': { label: 'Client Approver', colour: '#92400E', bgColour: '#FEF3C7' },
  'client-viewer': { label: 'Client Viewer', colour: '#6B21A8', bgColour: '#F3E8FF' },
};

/**
 * Client status values (Slice 6B).
 */
export type ClientStatus = 'active' | 'lapsed';

// =============================================================================
// Status History
// =============================================================================

/**
 * A single entry in a campaign's status history timeline.
 */
export interface StatusHistoryEntry {
  /** Previous status (null for initial creation) */
  from: Campaign['status'] | null;
  /** New status */
  to: Campaign['status'];
  /** ISO timestamp of the transition */
  timestamp: string;
  /** User ID or email who made the change */
  changedBy: string;
  /** Reason for the transition (required for pause) */
  reason?: string;
}

// =============================================================================
// Campaign
// =============================================================================

/**
 * Campaign document from Firestore.
 * Extended in Slice 2 with targeting, messaging, and status history.
 */
export interface Campaign {
  /** Document ID */
  id: string;
  /** Campaign display name */
  campaignName: string;
  /** Current status */
  status: 'draft' | 'active' | 'paused' | 'completed';
  /** Service type label */
  serviceType: string;
  /** Service type ID (references managed list) */
  serviceTypeId: string;
  /** Proposition IDs from client's propositions sub-collection (Slice 8) */
  propositionRefs?: string[];
  /** Campaign owner name */
  owner: string;
  /** Campaign start date (ISO string for client-side use) */
  startDate: string;
  /** One-line campaign summary (max 280 chars) */
  campaignSummary: string;

  // --- Targeting ---
  /** Target geography IDs (from managedLists/geographies) */
  targetGeographies: string[];
  /** Target sector IDs (from managedLists/sectors) */
  targetSectors: string[];
  /** Target title band IDs (from managedLists/titleBands) */
  targetTitles: string[];
  /** Target company size ID (from managedLists/companySizes) */
  companySize: string;
  /** Target therapy area IDs (from client config, when therapyAreas capability enabled) */
  targetTherapyAreas?: string[];

  // --- Messaging ---
  /** Value proposition text (max 200 chars) */
  valueProposition: string;
  /** Array of pain point strings (each max 150 chars, max 8 items) */
  painPoints: string[];
  /** Selected So What IDs (placeholder for future slice) */
  selectedSoWhats: string[];

  // --- Lifecycle ---
  /** Status transition history */
  statusHistory: StatusHistoryEntry[];
  /** Reason for pausing (when status is paused) */
  pauseReason: string;
  /** Who created the campaign */
  createdBy: string;
  /** Created timestamp (ISO string) */
  createdAt: string;
  /** Last updated timestamp (ISO string) */
  updatedAt: string;
}

/**
 * Campaign status with display metadata.
 */
export const CAMPAIGN_STATUS_CONFIG: Record<
  Campaign['status'],
  { label: string; colour: string; bgColour: string }
> = {
  draft: { label: 'Draft', colour: '#6B7280', bgColour: '#F3F4F6' },
  active: { label: 'Active', colour: '#059669', bgColour: '#ECFDF5' },
  paused: { label: 'Paused', colour: '#D97706', bgColour: '#FFFBEB' },
  completed: { label: 'Completed', colour: '#4B5563', bgColour: '#F9FAFB' },
};

// =============================================================================
// Exclusions (Prospecting Rules — Step 1)
// =============================================================================

/**
 * Exclusion scope — determines the breadth of the exclusion.
 */
export type ExclusionScope = 'company-wide' | 'company-scoped' | 'contact-only';

/**
 * Exclusion status — active or soft-deleted.
 */
export type ExclusionStatus = 'active' | 'removed';

/**
 * Exclusion entry from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/exclusions/{exclusionId}
 */
export interface ExclusionEntry {
  /** Firestore document ID (auto-generated) */
  id?: string;
  /** Scope: company-wide, company-scoped, or contact-only */
  scope: ExclusionScope;
  /** The company being excluded. Max 200 chars. */
  companyName: string;
  /** Required when scope is contact-only. Optional otherwise. Max 150 chars. */
  contactName?: string;
  /** Job title of excluded contact. Max 150 chars. */
  contactTitle?: string;
  /** Reference to exclusionReasons managed list value. Optional. */
  reason?: string;
  /** Brand/division excluded. Relevant when company-scoped. Max 200 chars. */
  brandOrDivision?: string;
  /** Service area excluded. Relevant when company-scoped. Max 200 chars. */
  service?: string;
  /** Geography excluded. Relevant when company-scoped. Max 200 chars. */
  geography?: string;
  /** Free-text context. Max 280 chars. */
  notes?: string;
  /** Status: active or removed. Default: active. */
  status: ExclusionStatus;
  /** Firebase UID of creator. */
  addedBy: string;
  /** Display name of creator. */
  addedByName: string;
  /** Creation timestamp. */
  addedAt: string; // ISO string on client side
  /** Firebase UID of remover. Null when active. */
  removedBy?: string;
  /** Display name of remover. */
  removedByName?: string;
  /** Removal timestamp. Null when active. */
  removedAt?: string;
}

/**
 * Exclusion scope display configuration — colour-coded badges.
 */
export const EXCLUSION_SCOPE_CONFIG: Record<
  ExclusionScope,
  { label: string; colour: string; bgColour: string }
> = {
  'company-wide': { label: 'Company-wide', colour: '#FFFFFF', bgColour: '#3B7584' },
  'company-scoped': { label: 'Company-scoped', colour: '#FFFFFF', bgColour: '#FCB242' },
  'contact-only': { label: 'Contact only', colour: '#FFFFFF', bgColour: '#827786' },
};

// =============================================================================
// Conflicts (Prospecting Rules — Step 2)
// =============================================================================

/**
 * Conflict domain type — what kind of domain the conflict covers.
 */
export type ConflictDomainType = 'therapy-area' | 'product-category' | 'industry-segment';

/**
 * Conflict scope — how broadly the conflict applies.
 */
export type ConflictScope = 'industry-wide' | 'company-specific';

/**
 * Conflict status — active or soft-deleted.
 */
export type ConflictStatus = 'active' | 'removed';

/**
 * Conflict entry from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/conflicts/{conflictId}
 */
export interface ConflictEntry {
  /** Firestore document ID (auto-generated) */
  id?: string;
  /** What the conflict is about. Free text or managed list value. Max 200 chars. */
  conflictDomain: string;
  /** Domain type: therapy-area, product-category, or industry-segment */
  domainType: ConflictDomainType;
  /** Scope: industry-wide or company-specific */
  scope: ConflictScope;
  /** Required when scope is company-specific. Max 200 chars. */
  companyName?: string;
  /** Clarifies the boundary of the conflict. Max 280 chars. */
  scopeDetail?: string;
  /** Additional context. Max 280 chars. */
  notes?: string;
  /** Status: active or removed. Default: active. */
  status: ConflictStatus;
  /** Firebase UID of creator. */
  addedBy: string;
  /** Display name of creator. */
  addedByName: string;
  /** Creation timestamp. */
  addedAt: string; // ISO string on client side
  /** Firebase UID of remover. Null when active. */
  removedBy?: string;
  /** Display name of remover. */
  removedByName?: string;
  /** Removal timestamp. Null when active. */
  removedAt?: string;
}

/**
 * Conflict domain type display configuration — colour-coded badges.
 */
export const CONFLICT_DOMAIN_TYPE_CONFIG: Record<
  ConflictDomainType,
  { label: string; colour: string; bgColour: string }
> = {
  'therapy-area': { label: 'Therapy area', colour: '#FFFFFF', bgColour: '#3B7584' },
  'product-category': { label: 'Product category', colour: '#FFFFFF', bgColour: '#FCB242' },
  'industry-segment': { label: 'Industry segment', colour: '#FFFFFF', bgColour: '#827786' },
};

/**
 * Conflict scope display configuration — colour-coded badges.
 */
export const CONFLICT_SCOPE_CONFIG: Record<
  ConflictScope,
  { label: string; colour: string; bgColour: string }
> = {
  'industry-wide': { label: 'Industry-wide', colour: '#FFFFFF', bgColour: '#3B7584' },
  'company-specific': { label: 'Company-specific', colour: '#FFFFFF', bgColour: '#FCB242' },
};

// =============================================================================
// Relationships (Prospecting Rules — Step 3)
// =============================================================================

/**
 * Relationship type — what kind of commercial relationship exists.
 */
export type RelationshipType = 'active-client' | 'lapsed-client' | 'prospect' | 'partner';

/**
 * Relationship status — active or archived.
 * Note: Relationships use "archived" rather than "removed" (as used by Exclusions/Conflicts)
 * because a lapsed or historical relationship is context that may still be useful.
 * Archived entries are hidden by default but retrievable.
 */
export type RelationshipStatus = 'active' | 'archived';

/**
 * Agreement type — the kind of formal agreement in place.
 */
export type AgreementType = 'msa' | 'psl' | 'framework' | 'other';

/**
 * Agreement status — lifecycle state of a formal agreement.
 */
export type AgreementStatus = 'active' | 'expiring' | 'expired' | 'pending';

/**
 * Relationship entry from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/relationships/{relationshipId}
 */
export interface RelationshipEntry {
  /** Firestore document ID (auto-generated) */
  id?: string;
  /** The company in the relationship. Max 200 chars. */
  companyName: string;
  /** Relationship type: active-client, lapsed-client, prospect, or partner */
  relationshipType: RelationshipType;
  /** Which part of the company the relationship covers. Max 200 chars. */
  brandOrDivision?: string;
  /** What service or engagement type. Max 200 chars. */
  service?: string;
  /** Geographic scope. Max 200 chars. */
  geography?: string;
  /** Names for name-dropping. Free text. Max 280 chars. */
  keyContacts?: string;
  /** How long the relationship has existed. E.g. "2 years", "Since 2019." Max 100 chars. */
  tenure?: string;
  /** Additional context. Max 280 chars. */
  notes?: string;
  /** Status: active or archived. Default: active. */
  status: RelationshipStatus;
  /** Firebase UID of creator. */
  addedBy: string;
  /** Display name of creator. */
  addedByName: string;
  /** Creation timestamp (ISO string on client side). */
  addedAt: string;
  /** Firebase UID. Null when active. */
  archivedBy?: string;
  /** Display name. Null when active. */
  archivedByName?: string;
  /** Archive timestamp (ISO string). Null when active. */
  archivedAt?: string;
  // --- MSA-PSL detail (optional) ---
  /** Flag indicating MSA-PSL detail is present. Default: false. */
  hasAgreement?: boolean;
  /** Agreement type: msa, psl, framework, or other */
  agreementType?: AgreementType;
  /** One-line description of what the agreement covers. Max 280 chars. */
  agreementScope?: string;
  /** Agreement start date (ISO string). */
  startDate?: string;
  /** Agreement end date (ISO string). Null for open-ended. */
  endDate?: string;
  /** Agreement lifecycle status. */
  agreementStatus?: AgreementStatus;
  /** Active engagements under this agreement. Max 10 entries, each max 200 chars. */
  whereWorking?: string[];
  /** Whitespace — areas in scope with no current activity. Max 10 entries, each max 200 chars. */
  whereCould?: string[];
}

/**
 * Relationship type display configuration — colour-coded badges per spec.
 */
export const RELATIONSHIP_TYPE_CONFIG: Record<
  RelationshipType,
  { label: string; colour: string; bgColour: string }
> = {
  'active-client': { label: 'Active client', colour: '#FFFFFF', bgColour: '#30BAA0' },
  'lapsed-client': { label: 'Lapsed client', colour: '#FFFFFF', bgColour: '#FCB242' },
  prospect: { label: 'Prospect', colour: '#FFFFFF', bgColour: '#00A6CE' },
  partner: { label: 'Partner', colour: '#FFFFFF', bgColour: '#827786' },
};

/**
 * Agreement status display configuration — colour-coded badges.
 */
export const AGREEMENT_STATUS_CONFIG: Record<
  AgreementStatus,
  { label: string; colour: string; bgColour: string }
> = {
  active: { label: 'Active', colour: '#059669', bgColour: '#ECFDF5' },
  expiring: { label: 'Expiring', colour: '#D97706', bgColour: '#FFFBEB' },
  expired: { label: 'Expired', colour: '#DC2626', bgColour: '#FEF2F2' },
  pending: { label: 'Pending', colour: '#6B7280', bgColour: '#F3F4F6' },
};

/**
 * Agreement type display labels.
 */
export const AGREEMENT_TYPE_CONFIG: Record<
  AgreementType,
  { label: string }
> = {
  msa: { label: 'MSA' },
  psl: { label: 'PSL' },
  framework: { label: 'Framework' },
  other: { label: 'Agreement' },
};

// =============================================================================
// Managed Lists
// =============================================================================

/**
 * Known managed list names.
 */
export type ManagedListName =
  | 'serviceTypes'
  | 'sectors'
  | 'geographies'
  | 'titleBands'
  | 'companySizes'
  | 'therapyAreas'
  | 'documentFolders'
  | 'propositionCategories'
  | 'messagingTypes'
  | 'buyingProcessTypes'
  | 'exclusionReasons';

/**
 * A single item within a managed list.
 */
export interface ManagedListItem {
  /** Unique slug ID (immutable once created) */
  id: string;
  /** Display label */
  label: string;
  /** Whether this item is active (inactive items are hidden from dropdowns) */
  active: boolean;
  /** For titleBands: orientation tag */
  orientation?: 'internal' | 'external' | 'mixed';
}

/**
 * A managed list document from Firestore.
 * Stored at tenants/{tenantId}/managedLists/{listName}
 */
export interface ManagedListDoc {
  /** The items in this list */
  items: ManagedListItem[];
  /** Last updated timestamp (ISO string) */
  updatedAt: string;
  /** Who last updated the list */
  updatedBy?: string;
}

// =============================================================================
// Check-in
// =============================================================================

/**
 * Check-in type — constrains how a meeting is categorised.
 */
export type CheckInType = 'kick-off' | 'regular' | 'ad-hoc';

/**
 * Duration options for check-ins (in minutes).
 */
export type CheckInDuration = 15 | 30 | 60 | 90;

/**
 * A structured decision recorded during a check-in.
 */
export interface CheckInDecision {
  /** Decision text (max 200 chars) */
  text: string;
  /** Person responsible (free text for Slice 3) */
  assignee?: string;
  /** When this needs to be done */
  dueDate?: string;
  /** Whether an action was created from this decision */
  createAction: boolean;
}

/**
 * A next step recorded during a check-in.
 */
export interface CheckInNextStep {
  /** Next step text (max 200 chars) */
  text: string;
  /** Person responsible (free text for Slice 3) */
  owner?: string;
  /** Target completion date */
  targetDate?: string;
  /** Whether an action was created from this next step */
  createAction: boolean;
}

/**
 * Check-in document from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/checkIns/{checkInId}
 */
export interface CheckIn {
  /** Document ID */
  id: string;
  /** Meeting date (ISO string) */
  date: string;
  /** Type of meeting */
  type: CheckInType;
  /** Names of attendees */
  attendees: string[];
  /** Duration in minutes */
  duration: CheckInDuration;
  /** Related campaign IDs */
  relatedCampaigns: string[];
  /** Key points — 1-5 items, each max 150 chars */
  keyPoints: string[];
  /** Structured decisions from the meeting */
  decisions: CheckInDecision[];
  /** Follow-up next steps */
  nextSteps: CheckInNextStep[];
  /** Optional next check-in date (ISO string) */
  nextCheckInDate?: string;
  /**
   * IDs of action-lite Work Items generated from this check-in.
   *
   * S3-code-P3 — renamed from `generatedActionIds` (P3-time decision per
   * the P3 handover audit-2). Pre-P3 check-in docs may still carry the
   * old key with stale (deleted-collection) IDs; the route handlers
   * read from both keys on PUT and rewrite to the new key, dropping
   * the legacy field via `FieldValue.delete()` in the same write.
   */
  generatedWorkItemIds: string[];
  /** Who recorded the check-in */
  createdBy: string;
  /** When it was recorded (ISO string) */
  createdAt: string;
  /** Last updated (ISO string) */
  updatedAt: string;
}

/**
 * Check-in type display configuration.
 */
export const CHECKIN_TYPE_CONFIG: Record<
  CheckInType,
  { label: string; colour: string; bgColour: string }
> = {
  'kick-off': { label: 'Kick-off', colour: '#0D9488', bgColour: '#CCFBF1' },
  regular: { label: 'Regular', colour: '#6B7280', bgColour: '#F3F4F6' },
  'ad-hoc': { label: 'Ad-hoc', colour: '#7C3AED', bgColour: '#EDE9FE' },
};

/**
 * Check-in duration display labels.
 */
export const CHECKIN_DURATION_OPTIONS: { value: CheckInDuration; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
];

// =============================================================================
// Action — RETIRED in S3-code-P4
// =============================================================================
//
// The legacy `Action` type + its `ActionStatus` / `ActionPriority` /
// `ActionSource` siblings + `ACTION_STATUS_CONFIG` / `ACTION_PRIORITY_CONFIG`
// were retired in S3-code-P4 alongside the `/api/clients/[clientId]/actions`
// route tree. Action surfaces now consume the action-lite Work Item
// primitives in `@/lib/workItems/actionLite`:
//
//   - `ActionLiteWire` (replaces `Action`)
//   - `ActionLiteState` (replaces `ActionStatus`)
//   - `ActionLitePriority` (replaces `ActionPriority`)
//   - `ACTION_LITE_STATE_CONFIG` (replaces `ACTION_STATUS_CONFIG`)
//   - `ACTION_LITE_PRIORITY_CONFIG` (replaces `ACTION_PRIORITY_CONFIG`)
//
// The `source` shape of action-lite Work Items follows Spec §2.1 directly
// (Pattern: `{type, ref}`); no Exchange-side `ActionSource` interface
// needed. See the P4 handover for the full retirement-deletes inventory.

// =============================================================================
// Wishlist
// =============================================================================

/**
 * Wishlist item status values.
 */
export type WishlistStatus = 'new' | 'under-review' | 'added-to-target-list' | 'rejected';

/**
 * Wishlist item priority values.
 */
export type WishlistPriority = 'high' | 'medium' | 'low';

/**
 * Wishlist item document from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/wishlists/{wishlistId}
 */
export interface WishlistItem {
  /** Document ID */
  id: string;
  /** Target company name */
  companyName: string;
  /** Sector reference (from managedLists/sectors) */
  sector: string;
  /** Geography reference (from managedLists/geographies) */
  geography: string;
  /** Priority level */
  priority: WishlistPriority;
  /** Notes — why this company, specific contacts, context (max 280 chars) */
  notes: string;
  /** Current status */
  status: WishlistStatus;
  /** Campaign reference — which campaign this company is allocated to */
  campaignRef: string;
  /** Email of user who added the entry */
  addedBy: string;
  /** When the entry was created (ISO string) */
  addedDate: string;
  /** Last updated (ISO string) */
  updatedAt: string;
}

/**
 * Wishlist status display configuration.
 */
export const WISHLIST_STATUS_CONFIG: Record<
  WishlistStatus,
  { label: string; colour: string; bgColour: string }
> = {
  new: { label: 'New', colour: '#2563EB', bgColour: '#EFF6FF' },
  'under-review': { label: 'Under Review', colour: '#D97706', bgColour: '#FFFBEB' },
  'added-to-target-list': { label: 'Added to Target List', colour: '#059669', bgColour: '#ECFDF5' },
  rejected: { label: 'Rejected', colour: '#DC2626', bgColour: '#FEF2F2' },
};

/**
 * Wishlist priority display configuration (reuses action priority colours).
 */
export const WISHLIST_PRIORITY_CONFIG: Record<
  WishlistPriority,
  { label: string; colour: string; bgColour: string }
> = {
  high: { label: 'High', colour: '#DC2626', bgColour: '#FEF2F2' },
  medium: { label: 'Medium', colour: '#D97706', bgColour: '#FFFBEB' },
  low: { label: 'Low', colour: '#6B7280', bgColour: '#F3F4F6' },
};

// =============================================================================
// So What
// =============================================================================

/**
 * So What status values.
 */
export type SoWhatStatus = 'draft' | 'approved' | 'retired';

/**
 * So What orientation tag values.
 */
export type SoWhatOrientation = 'internal-facing' | 'external-facing' | 'both';

/**
 * So What document from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/soWhats/{soWhatId}
 */
export interface SoWhat {
  /** Document ID */
  id: string;
  /** The sayable version. What a caller says on the phone. Max 80 chars. */
  headline: string;
  /** The copy/paste version for outbound emails. Max 200 chars. */
  emailVersion: string;
  /** The proof point — a stat, case study result, named outcome. Max 300 chars. */
  supportingEvidence: string;
  /** Which personas this resonates with. Multi-select from tenant titleBands. */
  audienceTags: string[];
  /** Internal-facing / external-facing / both. Controls AI selection. */
  orientationTags: SoWhatOrientation[];
  /** Provenance — white paper, case study, or briefing. Max 200 chars. Optional. */
  sourceRef: string;
  /** Current status: draft / approved / retired. */
  status: SoWhatStatus;
  /** UID of creator. Auto-populated. */
  createdBy: string;
  /** Created timestamp (ISO string). */
  createdDate: string;
  /** UID of last editor. Auto-populated. */
  updatedBy: string;
  /** Last updated timestamp (ISO string). */
  updatedDate: string;
}

/**
 * So What status display configuration.
 */
export const SOWHAT_STATUS_CONFIG: Record<
  SoWhatStatus,
  { label: string; colour: string; bgColour: string }
> = {
  draft: { label: 'Draft', colour: '#D97706', bgColour: '#FFFBEB' },
  approved: { label: 'Approved', colour: '#059669', bgColour: '#ECFDF5' },
  retired: { label: 'Retired', colour: '#6B7280', bgColour: '#F3F4F6' },
};

/**
 * So What orientation display configuration.
 */
export const SOWHAT_ORIENTATION_CONFIG: Record<
  SoWhatOrientation,
  { label: string; colour: string; bgColour: string }
> = {
  'internal-facing': { label: 'Internal', colour: '#7C3AED', bgColour: '#EDE9FE' },
  'external-facing': { label: 'External', colour: '#2563EB', bgColour: '#EFF6FF' },
  both: { label: 'Both', colour: '#D97706', bgColour: '#FFFBEB' },
};

// =============================================================================
// Managed Lists
// =============================================================================

/**
 * Display configuration for managed list types in the admin UI.
 */
export const MANAGED_LIST_CONFIG: Record<
  ManagedListName,
  { label: string; description: string; hasOrientation: boolean }
> = {
  serviceTypes: {
    label: 'Service Types',
    description: 'What Angsana does — e.g. Lead Gen, ABM, Event Follow-Up',
    hasOrientation: false,
  },
  sectors: {
    label: 'Sectors',
    description: 'Industry verticals — e.g. Technology, Financial Services',
    hasOrientation: false,
  },
  geographies: {
    label: 'Geographies',
    description: 'Target regions — e.g. UK, DACH, Nordics',
    hasOrientation: false,
  },
  titleBands: {
    label: 'Title Bands',
    description: 'Job title categories with internal/external orientation',
    hasOrientation: true,
  },
  companySizes: {
    label: 'Company Sizes',
    description: 'Revenue/employee bands — e.g. Enterprise, Mid-Market',
    hasOrientation: false,
  },
  therapyAreas: {
    label: 'Therapy Areas',
    description: 'For healthcare & life sciences clients',
    hasOrientation: false,
  },
  documentFolders: {
    label: 'Document Folders',
    description: 'Canonical folder structure for client Drive folders — defines visibility',
    hasOrientation: false,
  },
  propositionCategories: {
    label: 'Proposition Categories',
    description: 'Categories for client propositions — e.g. Healthcare, Technology',
    hasOrientation: false,
  },
  messagingTypes: {
    label: 'Messaging Types',
    description: 'Types for Market Messaging Library entries — e.g. Elevator Pitch, Case Study',
    hasOrientation: false,
  },
  buyingProcessTypes: {
    label: 'Buying Process Types',
    description: 'How buying decisions are made — e.g. Single Decision-Maker, Committee',
    hasOrientation: false,
  },
  exclusionReasons: {
    label: 'Exclusion Reasons',
    description: 'Why a company or contact is excluded from prospecting — e.g. Active client, Contractual',
    hasOrientation: false,
  },
};

// =============================================================================
// Document Folders (Slice 7A Step 4)
// =============================================================================

/**
 * Folder visibility — determines whether files in this folder are visible
 * to client users or internal-only.
 */
export type FolderVisibility = 'client-visible' | 'internal-only';

/**
 * A single entry in the Document Folders managed list.
 * Stored at tenants/{tenantId}/managedLists/documentFolders as an items array.
 *
 * This is a different schema from the generic ManagedListItem — it has
 * folder-specific fields (visibility, parentCategory, isContainer, sortOrder).
 */
export interface DocumentFolderItem {
  /** Stable unique key. Immutable after creation. E.g. "targeting", "working". */
  folderCategory: string;
  /** Display name of the folder as created in Drive. E.g. "Targeting", "Working". */
  name: string;
  /** "client-visible" or "internal-only". Locked once files exist in this category. */
  visibility: FolderVisibility;
  /** Null for root-level folders. Set to the folderCategory of the parent for nested folders. */
  parentCategory: string | null;
  /** Display ordering in UI and provisioning. Lower numbers first. */
  sortOrder: number;
  /** Soft-delete flag. Inactive folders are hidden from new provisioning. */
  active: boolean;
  /** If true, this folder is a structural container only. Files cannot be placed in it. */
  isContainer: boolean;
}

// =============================================================================
// Document Registry (Slice 7A Step 4)
// =============================================================================

/**
 * How a document registry entry was created.
 */
export type DocumentRegistrySource = 'exchange_upload' | 'manual_import' | 'drive_backfill' | 'make_automation';

/**
 * Document registry entry status.
 */
export type DocumentStatus = 'active' | 'deleted';

/**
 * A registered document in Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/documents/{documentId}
 */
export interface DocumentRegistryEntry {
  /** Firestore document ID (auto-generated) */
  documentId: string;
  /** Google Drive file ID. Immutable after creation. */
  driveFileId: string;
  /** Display name of the file. Updated on rename. */
  name: string;
  /** MIME type of the file as reported by Drive. */
  mimeType: string;
  /** File size in bytes at upload time. */
  size: number;
  /** Stable key from canonical folder template (e.g. "targeting", "working"). */
  folderCategory: string;
  /** Drive folder ID where the file resides. */
  folderId: string;
  /** Resolved visibility: "client-visible" or "internal-only". */
  visibility: FolderVisibility;
  /** "active" or "deleted". */
  status: DocumentStatus;
  /** Optional campaign ID (legacy single). Use campaignRefs for new code. */
  campaignRef?: string | null;
  /** Campaign IDs. Default: []. Replaces campaignRef. */
  campaignRefs?: string[];
  /** Proposition IDs. Default: []. */
  propositionRefs?: string[];
  /** How this entry was created. */
  registrySource: DocumentRegistrySource;
  /** UID of the user who uploaded the file. */
  uploadedBy: string;
  /** Timestamp when the file was uploaded (ISO string). */
  uploadedAt: string;
  /** Updated on rename or metadata edit (ISO string). */
  lastModifiedAt: string;
  /** UID of the user who last modified the entry. */
  lastModifiedBy: string;
  /** Set when status changes to "deleted" (ISO string). Null while active. */
  deletedAt: string | null;
  /** UID of user who deleted the file. Null while active. */
  deletedBy: string | null;
  /** Always "gdrive" for now. Future-proofs for storage abstraction. */
  storageBackend: 'gdrive';
}

// =============================================================================
// Folder Map (Slice 7A Step 4)
// =============================================================================

/**
 * A single entry in a client's folderMap — maps a Drive folder ID to its
 * canonical folder category and display name.
 */
export interface FolderMapEntry {
  /** The canonical folder category key (e.g. "targeting", "working") */
  folderCategory: string;
  /** Display name of the folder in Drive */
  name: string;
}

/**
 * The folderMap stored on a client's config document.
 * Maps Drive folder IDs to their canonical folder category and name.
 * Written at provisioning time, read by upload/browse/register operations.
 */
export type FolderMap = Record<string, FolderMapEntry>;

// =============================================================================
// Proposition (Slice 8 — CPP)
// =============================================================================

/**
 * Proposition status values.
 */
export type PropositionStatus = 'draft' | 'active' | 'inactive';

/**
 * ICP readiness status — indicates whether the ICP has been reviewed.
 * draft = needs attention, active = reviewed and ready.
 * Not a gate for campaign creation (escape hatch principle).
 */
export type ICPStatus = 'draft' | 'active';

/**
 * Proposition document from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/propositions/{propositionId}
 */
export interface Proposition {
  /** Document ID */
  id: string;
  /** Short label. Max 80 characters. */
  name: string;
  /** Reference to a propositionCategories managed list item. */
  category: string;
  /** Additional context. Max 280 characters. */
  description: string;
  /** draft / active / inactive. Draft = client-suggested. Inactive hidden from pickers. */
  status: PropositionStatus;
  /** Display ordering within the category group. Default: 0. */
  sortOrder: number;
  /** ICP for this proposition. Same schema as original Slice 8 Section 3.2. Optional. */
  icp?: ICP;
  /** ICP readiness status: draft (needs attention) or active (reviewed). Default: draft. */
  icpStatus?: ICPStatus;
  /** Free-text category suggestion from client-approver. Cleared on promotion. */
  suggestedCategory?: string;
  /** UID of creator. */
  createdBy: string;
  /** Creation timestamp (ISO string). */
  createdAt: string;
  /** UID of last editor. */
  lastUpdatedBy: string;
  /** Last modification timestamp (ISO string). */
  lastUpdatedAt: string;
}

/**
 * Proposition status display configuration.
 */
export const PROPOSITION_STATUS_CONFIG: Record<
  PropositionStatus,
  { label: string; colour: string; bgColour: string }
> = {
  draft: { label: 'Draft', colour: '#D97706', bgColour: '#FFFBEB' },
  active: { label: 'Active', colour: '#059669', bgColour: '#ECFDF5' },
  inactive: { label: 'Inactive', colour: '#6B7280', bgColour: '#F3F4F6' },
};

// =============================================================================
// Prospecting Profile — ICP (Slice 8)
// =============================================================================

/**
 * ICP industries object.
 */
export interface ICPIndustries {
  /** Managed list item IDs from sectors. */
  managedListRefs: string[];
  /** Free text specifics. Max 500 chars. */
  specifics: string;
}

/**
 * Company sizing entry type.
 */
export type CompanySizingType = 'revenue' | 'headcount' | 'tier' | 'custom';

/**
 * A single company sizing criterion.
 */
export interface CompanySizingEntry {
  /** Type of sizing criterion. */
  type: CompanySizingType;
  /** Display label. Max 80 chars. */
  label: string;
  /** Array of value strings. */
  values: string[];
}

/**
 * ICP managed list + specifics object (used for titles, seniority, geographies).
 */
export interface ICPManagedListField {
  /** Managed list item IDs. */
  managedListRefs: string[];
  /** Free text specifics. Max 500 chars. */
  specifics: string;
}

/**
 * Buying process type.
 */
export type BuyingProcessType =
  | 'single-decision-maker'
  | 'committee'
  | 'procurement-led'
  | 'consensus';

/**
 * Buying process object.
 */
export interface ICPBuyingProcess {
  /** Buying process type — managed list reference (string). */
  type: string;
  /** Free text notes. Max 500 chars. */
  notes: string;
}

/**
 * ICP exclusion entry.
 */
export interface ICPExclusion {
  /** Category label. Max 80 chars. */
  category: string;
  /** Description. Max 280 chars. */
  description: string;
}

/**
 * Ideal Client Profile structure.
 */
export interface ICP {
  /** Target industries. */
  industries: ICPIndustries;
  /** Flexible company sizing criteria. */
  companySizing: CompanySizingEntry[];
  /** Target titles. */
  titles: ICPManagedListField;
  /** Target seniority. */
  seniority: ICPManagedListField;
  /** Buying process. */
  buyingProcess: ICPBuyingProcess;
  /** Target geographies. */
  geographies: ICPManagedListField;
  /** Categorical exclusions. */
  exclusions: ICPExclusion[];
  /** UID of last editor of ICP section. */
  lastUpdatedBy: string;
  /** Last modification of ICP section (ISO string). */
  lastUpdatedAt: string;
}

/**
 * Buying process display configuration.
 */
export const BUYING_PROCESS_CONFIG: Record<
  BuyingProcessType,
  { label: string }
> = {
  'single-decision-maker': { label: 'Single Decision Maker' },
  committee: { label: 'Committee' },
  'procurement-led': { label: 'Procurement-Led' },
  consensus: { label: 'Consensus' },
};

// =============================================================================
// Prospecting Profile — Market Messaging (Slice 8)
// =============================================================================

/**
 * Market messaging entry.
 */
export interface MarketMessagingEntry {
  /** Generated UUID for each entry. */
  id: string;
  /** Short label. Max 120 characters. */
  title: string;
  /** From messagingTypes managed list. */
  type: string;
  /** Actual text for short items. Max 500 characters. */
  content: string;
  /** Firestore document ID from documents registry. */
  documentRef: string;
  /** URL for web-based resources. */
  externalUrl: string;
  /** Internal annotation. Max 280 characters. Internal users only. */
  notes: string;
  /** Proposition IDs this material relates to. */
  propositionRefs: string[];
  /** UID of creator. */
  createdBy: string;
  /** Creation timestamp (ISO string). */
  createdAt: string;
}

// =============================================================================
// Prospecting Profile — Recommendations (Slice 8)
// =============================================================================

/**
 * Recommendation status values.
 */
export type RecommendationStatus = 'proposed' | 'accepted' | 'superseded';

/**
 * Recommendation entry.
 */
export interface Recommendation {
  /** Generated UUID. */
  id: string;
  /** Specific, actionable statement. Max 280 characters. */
  recommendation: string;
  /** Why Angsana believes this. Max 500 characters. */
  rationale: string;
  /** Which propositions this recommendation relates to. */
  propositionRefs: string[];
  /** proposed / accepted / superseded. */
  status: RecommendationStatus;
  /** UID of creator. */
  createdBy: string;
  /** Creation timestamp (ISO string). */
  createdAt: string;
  /** UID of last editor. */
  lastUpdatedBy: string;
  /** Last modification timestamp (ISO string). */
  lastUpdatedAt: string;
}

/**
 * Recommendation status display configuration.
 */
export const RECOMMENDATION_STATUS_CONFIG: Record<
  RecommendationStatus,
  { label: string; colour: string; bgColour: string }
> = {
  proposed: { label: 'Proposed', colour: '#D97706', bgColour: '#FFFBEB' },
  accepted: { label: 'Accepted', colour: '#059669', bgColour: '#ECFDF5' },
  superseded: { label: 'Superseded', colour: '#6B7280', bgColour: '#F3F4F6' },
};

// =============================================================================
// Prospecting Profile — AI Review (Slice 8)
// =============================================================================

/**
 * AI review status values.
 */
export type AIReviewStatus = 'not-requested' | 'pending' | 'complete';

/**
 * AI Review section.
 */
export interface AIReview {
  /** Last review timestamp (ISO string) or null. */
  lastReviewDate: string | null;
  /** Review status. */
  status: AIReviewStatus;
  /** Findings (empty for now). */
  findings: string[];
}

// =============================================================================
// Prospecting Profile — Full Document (Slice 8)
// =============================================================================

/**
 * Full prospecting profile document.
 * Stored at tenants/{tenantId}/clients/{clientId}/prospectingProfile (single doc)
 */
export interface ProspectingProfile {
  /** Market messaging library entries. */
  marketMessaging: MarketMessagingEntry[];
  /** Angsana recommendations (internal only). */
  recommendations: Recommendation[];
  /** AI review placeholder. */
  aiReview: AIReview;
  /** UID of last editor across all sections. */
  lastUpdatedBy: string;
  /** Last modification across all sections (ISO string). */
  lastUpdatedAt: string;
}

// =============================================================================
// Managed Lists — Extended (Slice 8)
// =============================================================================

/**
 * Known managed list names — extended with Slice 8 lists.
 */
export type ManagedListNameExtended =
  | ManagedListName
  | 'propositionCategories'
  | 'messagingTypes';

/**
 * Display configuration for Slice 8 managed lists.
 */
export const MANAGED_LIST_CONFIG_EXTENDED: Record<
  'propositionCategories' | 'messagingTypes',
  { label: string; description: string; hasOrientation: boolean }
> = {
  propositionCategories: {
    label: 'Proposition Categories',
    description: 'Categories for client propositions — e.g. Healthcare, Technology',
    hasOrientation: false,
  },
  messagingTypes: {
    label: 'Messaging Types',
    description: 'Types of market messaging material — e.g. Elevator Pitch, Case Study',
    hasOrientation: false,
  },
};
