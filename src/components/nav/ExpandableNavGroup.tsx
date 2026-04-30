'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavChildItem } from '@/types';

interface ExpandableNavGroupProps {
  /** Display label for the parent item */
  label: string;
  /** Lucide icon component for the parent item */
  icon: LucideIcon;
  /** Child navigation items */
  childItems: (NavChildItem & { href: string })[];
  /** Current pathname for active state detection */
  currentPath: string;
}

/**
 * Generic expandable nav group for the sidebar.
 *
 * Renders a parent item with a chevron toggle. When expanded, shows
 * indented child items. Placeholder children are greyed out with a "soon" label.
 *
 * State persists during the session (React state). Defaults to expanded
 * if the current URL matches any child route.
 */
export function ExpandableNavGroup({
  label,
  icon: Icon,
  childItems,
  currentPath,
}: ExpandableNavGroupProps) {
  // Auto-expand if any child route matches the current path
  const hasActiveChild = childItems.some(
    (child) =>
      !child.placeholder &&
      (currentPath === child.href || currentPath.startsWith(child.href + '/'))
  );

  const [expanded, setExpanded] = useState(hasActiveChild);

  // If user navigates to a child route while collapsed, auto-expand
  useEffect(() => {
    if (hasActiveChild && !expanded) {
      setExpanded(true);
    }
    // Only react to route changes, not expanded state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveChild]);

  return (
    <li>
      {/* Parent toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          hasActiveChild
            ? 'text-white'
            : 'text-white/70 hover:bg-white/10 hover:text-white'
        )}
      >
        {Icon && <Icon className="h-5 w-5 shrink-0" />}
        <span className="flex-1 text-left">{label}</span>
        <span
          className={cn(
            'transition-transform duration-150',
            expanded ? 'rotate-90' : 'rotate-0'
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Child items */}
      {expanded && (
        <ul className="mt-0.5 space-y-0.5">
          {childItems.map((child) => {
            const isActive =
              !child.placeholder &&
              (currentPath === child.href ||
                currentPath.startsWith(child.href + '/'));

            if (child.placeholder) {
              return (
                <li key={child.route}>
                  <span className="flex items-center gap-2 rounded-md py-1.5 pl-11 pr-3 text-[13px] text-white/30 cursor-default select-none">
                    <span>{child.label}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/20">
                      soon
                    </span>
                  </span>
                </li>
              );
            }

            return (
              <li key={child.route}>
                <Link
                  href={child.href}
                  className={cn(
                    'flex items-center rounded-md py-1.5 pl-11 pr-3 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'border-l-[3px] border-[#3B7584] bg-white/15 text-white pl-[41px]'
                      : 'text-white/60 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
