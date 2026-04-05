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
