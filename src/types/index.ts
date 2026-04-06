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
  /** Route path — can include {clientId} placeholder */
  route: string;
  /** Lucide icon name */
  icon: string;
  /** Which roles can see this item (empty array = visible to all authenticated users) */
  roles?: UserRole[];
  /** Module key — matched against permittedModules claim */
  module?: string;
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
  | 'therapyAreas';

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
  /** IDs of actions generated from this check-in */
  generatedActionIds: string[];
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
// Action
// =============================================================================

/**
 * Action status values.
 */
export type ActionStatus = 'open' | 'in-progress' | 'done' | 'blocked';

/**
 * Action priority values.
 */
export type ActionPriority = 'high' | 'medium' | 'low';

/**
 * Source of an action — either from a check-in or manually created.
 */
export interface ActionSource {
  type: 'checkin' | 'manual';
  ref?: string; // checkInId when type is 'checkin'
}

/**
 * Action document from Firestore.
 * Stored at tenants/{tenantId}/clients/{clientId}/actions/{actionId}
 */
export interface Action {
  /** Document ID */
  id: string;
  /** Task title (max 150 chars) */
  title: string;
  /** Additional context (max 280 chars) */
  description: string;
  /** Person responsible */
  assignedTo: string;
  /** Due date (ISO string) */
  dueDate: string;
  /** Current status */
  status: ActionStatus;
  /** Priority level */
  priority: ActionPriority;
  /** Where this action came from */
  source: ActionSource;
  /** Optional related campaign ID */
  relatedCampaign: string;
  /** Who created the action */
  createdBy: string;
  /** When it was created (ISO string) */
  createdAt: string;
  /** Last updated (ISO string) */
  updatedAt: string;
}

/**
 * Action status display configuration.
 */
export const ACTION_STATUS_CONFIG: Record<
  ActionStatus,
  { label: string; colour: string; bgColour: string }
> = {
  open: { label: 'Open', colour: '#2563EB', bgColour: '#EFF6FF' },
  'in-progress': { label: 'In Progress', colour: '#D97706', bgColour: '#FFFBEB' },
  done: { label: 'Done', colour: '#059669', bgColour: '#ECFDF5' },
  blocked: { label: 'Blocked', colour: '#DC2626', bgColour: '#FEF2F2' },
};

/**
 * Action priority display configuration.
 */
export const ACTION_PRIORITY_CONFIG: Record<
  ActionPriority,
  { label: string; colour: string; bgColour: string }
> = {
  high: { label: 'High', colour: '#DC2626', bgColour: '#FEF2F2' },
  medium: { label: 'Medium', colour: '#D97706', bgColour: '#FFFBEB' },
  low: { label: 'Low', colour: '#6B7280', bgColour: '#F3F4F6' },
};

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
};
