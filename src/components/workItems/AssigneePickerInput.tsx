'use client';

// =============================================================================
// AssigneePickerInput — S3-code-P4 §4 (Assignee picker)
//
// Wraps an `<Input>` with the §4.1 picker plumbing reused from the
// CommentBox composer:
//
//   - Reads `tenants/{tenantId}/users` via `/api/tenant/users` (the same
//     directory cache the MentionPicker uses).
//   - Filters by audience-class compatibility with the supplied
//     `audience` prop (typically `'shared'` for check-in
//     decisions / next-steps — Decision #6 + sign-off question 4).
//   - Picks → flips the input value to `@<email>` shape.
//   - Free-text fallback preserved (whitespace in input → no picker
//     opens; "Mike Code" stays free-text — same posture as P3 smoke
//     "Mike Code" record).
//
// Pattern A from the P4 plan: reuses the existing MentionPicker as the
// overlay primitive instead of forking. The P3 component is already a
// clean controlled-overlay shape; this component is the second caller.
// Avoids the duplicate-and-drift footgun.
// =============================================================================

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  MentionPicker,
  type MentionCandidate,
} from './MentionPicker';
import {
  deriveQueryFromValue,
  formatPickedEmail,
  shouldOpenPickerForQuery,
} from '@/lib/mentions/assigneePickerInput';
import type { CommentAudience } from '@/lib/mentions/audienceClass';

export interface AssigneePickerInputProps {
  /** Current value (free text or `@<email>` form). */
  value: string;
  /** Called on every change — value can be free-text or picker-flipped. */
  onChange: (next: string) => void;
  /** Placeholder shown when value is empty. */
  placeholder?: string;
  /**
   * Audience class to filter the candidate pool against. For check-in
   * Assignee + Owner inputs the right default is `'shared'` (decisions
   * and next-steps land on either internal or client side).
   */
  audience: CommentAudience;
  /** Pass-through to the underlying Input's className. */
  className?: string;
}

export function AssigneePickerInput({
  value,
  onChange,
  placeholder,
  audience,
  className,
}: AssigneePickerInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function handleChange(next: string) {
    onChange(next);
    setPickerOpen(shouldOpenPickerForQuery(next));
  }

  function handleFocus() {
    if (shouldOpenPickerForQuery(value)) {
      setPickerOpen(true);
    }
  }

  function handlePick(candidate: MentionCandidate) {
    const next = formatPickedEmail(candidate.email);
    onChange(next);
    setPickerOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={className}
      />
      <MentionPicker
        open={pickerOpen}
        query={deriveQueryFromValue(value)}
        commentAudience={audience}
        // Anchor below the input. Top-offset of ~30px aligns with the
        // h-7 / h-8 input variants used in CheckInForm DecisionsEditor.
        anchor={{ top: 32, left: 0 }}
        onPick={handlePick}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
