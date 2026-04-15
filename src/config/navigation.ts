import type { NavItem } from '@/types';

/**
 * Navigation configuration for client-scoped pages.
 *
 * These items appear in the sidebar when a client is selected.
 * Routes use {clientId} as a placeholder — the Sidebar component
 * replaces it with the active client ID.
 *
 * Visibility is controlled by:
 *   - roles: which user roles see the item
 *   - module: matched against the user's permittedModules claim
 *
 * If roles is omitted/empty, visible to all authenticated users.
 * If module is omitted, always visible (not gated by permittedModules).
 *
 * Items with `children` render as expandable groups via ExpandableNavGroup.
 */
export const clientNavItems: NavItem[] = [
  {
    label: 'Dashboard',
    route: '/clients/{clientId}/dashboard',
    icon: 'LayoutDashboard',
    module: 'dashboard',
  },
  {
    label: 'Campaigns',
    route: '/clients/{clientId}/campaigns',
    icon: 'Megaphone',
    module: 'campaigns',
  },
  {
    label: 'Prospecting Profile',
    route: '/clients/{clientId}/prospecting-profile',
    icon: 'UserSearch',
    module: 'prospecting-profile',
  },
  // --- Prospecting Rules: expandable group ---
  {
    label: 'Prospecting Rules',
    route: '', // No own route — parent is toggle-only
    icon: 'ShieldAlert',
    children: [
      {
        label: 'Exclusions',
        route: '/clients/{clientId}/exclusions',
      },
      {
        label: 'Conflicts',
        route: '/clients/{clientId}/conflicts',
      },
      {
        label: 'Relationships',
        route: '/clients/{clientId}/relationships',
        placeholder: true,
      },
    ],
  },
  {
    label: 'Check-ins',
    route: '/clients/{clientId}/checkins',
    icon: 'CalendarCheck',
    module: 'checkins',
  },
  {
    label: 'Actions',
    route: '/clients/{clientId}/actions',
    icon: 'ListChecks',
    module: 'actions',
  },
  {
    label: 'Wishlists',
    route: '/clients/{clientId}/wishlists',
    icon: 'Target',
    module: 'wishlists',
  },
  {
    label: 'So Whats',
    route: '/clients/{clientId}/sowhats',
    icon: 'Lightbulb',
    module: 'sowhats',
  },
  {
    label: 'Documents',
    route: '/clients/{clientId}/documents',
    icon: 'FileText',
    module: 'documents',
  },
  {
    label: 'Team',
    route: '/clients/{clientId}/team',
    icon: 'Users',
    roles: ['client-approver', 'client-viewer'],
  },
  {
    label: 'Settings',
    route: '/clients/{clientId}/settings',
    icon: 'Settings2',
    roles: ['internal-admin', 'internal-user'],
  },
  {
    label: 'Approvals',
    route: '/clients/{clientId}/approvals',
    icon: 'ClipboardCheck',
    module: 'approvals',
    roles: ['client-approver'],
  },
];

/**
 * Navigation items for internal-only top-level pages.
 * These appear above the client-scoped items or as standalone pages.
 */
export const internalNavItems: NavItem[] = [
  {
    label: 'Portfolio',
    route: '/portfolio',
    icon: 'BarChart3',
    roles: ['internal-admin'],
  },
  {
    label: 'My Clients',
    route: '/my-clients',
    icon: 'Users',
    roles: ['internal-admin', 'internal-user'],
  },
];

/**
 * Admin navigation items — only visible to internal-admin.
 */
export const adminNavItems: NavItem[] = [
  {
    label: 'Managed Lists',
    route: '/admin/managed-lists',
    icon: 'Settings',
    module: 'admin',
    roles: ['internal-admin'],
  },
  {
    label: 'Users',
    route: '/admin/users',
    icon: 'UserCog',
    module: 'admin',
    roles: ['internal-admin'],
  },
];
