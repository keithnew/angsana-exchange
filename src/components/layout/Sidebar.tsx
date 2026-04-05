'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Megaphone,
  CalendarCheck,
  ListChecks,
  Lightbulb,
  Target,
  ShieldBan,
  FileText,
  ClipboardCheck,
  BarChart3,
  Users,
  Settings,
  Settings2,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { clientNavItems, internalNavItems, adminNavItems } from '@/config/navigation';
import { defaultTheme } from '@/config/theme';
import { cn } from '@/lib/utils';
import type { NavItem, UserRole } from '@/types';

/**
 * Icon lookup — maps string names from nav config to Lucide components.
 */
const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  Megaphone,
  CalendarCheck,
  ListChecks,
  Lightbulb,
  Target,
  ShieldBan,
  FileText,
  ClipboardCheck,
  BarChart3,
  Users,
  Settings,
  Settings2,
  UserCog,
};

/**
 * Filter navigation items based on user role and permitted modules.
 */
function filterNavItems(
  items: NavItem[],
  role: UserRole,
  permittedModules: string[]
): NavItem[] {
  return items.filter((item) => {
    // Role check: if roles specified, user must have one of them
    if (item.roles && item.roles.length > 0 && !item.roles.includes(role)) {
      return false;
    }
    // Module check: if module specified, user must have it in permittedModules
    if (item.module && !permittedModules.includes(item.module)) {
      return false;
    }
    return true;
  });
}

/**
 * Extract the active clientId from the current URL pathname.
 * Returns null if not on a client-scoped page.
 */
function getClientIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)/);
  return match ? match[1] : null;
}

function NavSection({
  items,
  clientId,
  pathname,
}: {
  items: NavItem[];
  clientId: string | null;
  pathname: string;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const href = clientId
          ? item.route.replace('{clientId}', clientId)
          : item.route;
        const Icon = iconMap[item.icon];
        const isActive = pathname === href || pathname.startsWith(href + '/');

        return (
          <li key={item.route}>
            <Link
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              )}
            >
              {Icon && <Icon className="h-5 w-5 shrink-0" />}
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { claims } = useAuth();
  const { role, permittedModules, clientId: userClientId } = claims;

  const isInternal = role === 'internal-admin' || role === 'internal-user';

  // Determine active client: from URL for internal users, from claims for client users
  const urlClientId = getClientIdFromPath(pathname);
  const activeClientId = isInternal ? urlClientId : userClientId;

  // Filter nav items based on role and permissions
  const visibleClientItems = filterNavItems(clientNavItems, role, permittedModules);
  const visibleInternalItems = isInternal
    ? filterNavItems(internalNavItems, role, permittedModules)
    : [];
  const visibleAdminItems = filterNavItems(adminNavItems, role, permittedModules);

  return (
    <aside className="flex h-screen w-64 flex-col bg-[var(--primary)] text-white">
      {/* Logo */}
      <div className="flex h-16 items-center px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={defaultTheme.logoReversedPath}
          alt={defaultTheme.name}
          className="h-8 w-auto"
        />
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex-1 overflow-y-auto px-3">
        {/* Internal top-level pages (Portfolio, My Clients) */}
        {visibleInternalItems.length > 0 && (
          <div className="mb-4">
            <NavSection
              items={visibleInternalItems}
              clientId={null}
              pathname={pathname}
            />
          </div>
        )}

        {/* Client-scoped pages — only show when a client is active */}
        {activeClientId && (
          <div className="mb-4">
            {isInternal && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-white/40">
                Client
              </p>
            )}
            <NavSection
              items={visibleClientItems}
              clientId={activeClientId}
              pathname={pathname}
            />
          </div>
        )}

        {/* Admin section */}
        {visibleAdminItems.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Admin
            </p>
            <NavSection
              items={visibleAdminItems}
              clientId={null}
              pathname={pathname}
            />
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-6 py-4">
        <p className="text-xs text-white/50">{defaultTheme.name} Exchange</p>
      </div>
    </aside>
  );
}
