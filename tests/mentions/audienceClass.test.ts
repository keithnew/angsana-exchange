// =============================================================================
// audienceClass — Decision #11 mapping + picker filter + §4.1 hand-typed
// chip-vs-plain classifier coverage.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  deriveAudienceClass,
  isCandidateVisible,
  classifyHandTypedMention,
  type DirectoryUser,
} from '../../src/lib/mentions/audienceClass';

describe('deriveAudienceClass', () => {
  it('maps platform-spec internal roles to internal', () => {
    expect(deriveAudienceClass('am')).toBe('internal');
    expect(deriveAudienceClass('ad')).toBe('internal');
    expect(deriveAudienceClass('researcher')).toBe('internal');
    expect(deriveAudienceClass('curator')).toBe('internal');
  });

  it('maps Exchange operational internal roles to internal', () => {
    expect(deriveAudienceClass('internal-admin')).toBe('internal');
    expect(deriveAudienceClass('internal-user')).toBe('internal');
  });

  it('maps client roles to client', () => {
    expect(deriveAudienceClass('client-approver')).toBe('client');
    expect(deriveAudienceClass('client-viewer')).toBe('client');
  });

  it('defaults unknown roles to internal (defensive per §4.1)', () => {
    expect(deriveAudienceClass('unknown-role')).toBe('internal');
    expect(deriveAudienceClass('')).toBe('internal');
    expect(deriveAudienceClass(null)).toBe('internal');
    expect(deriveAudienceClass(undefined)).toBe('internal');
  });
});

describe('isCandidateVisible — picker filter table (Decision #11)', () => {
  it('internal audience hides client-class candidates', () => {
    expect(isCandidateVisible('client', 'internal')).toBe(false);
  });

  it('internal audience shows internal-class candidates', () => {
    expect(isCandidateVisible('internal', 'internal')).toBe(true);
  });

  it('shared audience shows both classes', () => {
    expect(isCandidateVisible('internal', 'shared')).toBe(true);
    expect(isCandidateVisible('client', 'shared')).toBe(true);
  });

  it('client audience shows both classes', () => {
    expect(isCandidateVisible('internal', 'client')).toBe(true);
    expect(isCandidateVisible('client', 'client')).toBe(true);
  });
});

describe('classifyHandTypedMention — §4.1 styled-chip vs plain-text', () => {
  const directory: DirectoryUser[] = [
    { email: 'alice@angsana.com', role: 'internal-user' },
    { email: 'bob@cegid.com', role: 'client-approver' },
    { email: 'carol@angsana.com', role: 'am' },
  ];

  it('returns styled-chip when the email resolves to a directory user matching the audience filter', () => {
    expect(
      classifyHandTypedMention('alice@angsana.com', directory, 'shared')
    ).toBe('styled-chip');
    expect(
      classifyHandTypedMention('bob@cegid.com', directory, 'shared')
    ).toBe('styled-chip');
  });

  it('returns plain-text when the email is unknown to the directory', () => {
    expect(
      classifyHandTypedMention('stranger@nope.com', directory, 'shared')
    ).toBe('plain-text');
  });

  it('returns plain-text when a client-class user is mentioned in an internal comment', () => {
    expect(
      classifyHandTypedMention('bob@cegid.com', directory, 'internal')
    ).toBe('plain-text');
  });

  it('returns styled-chip when an internal user is mentioned in an internal comment', () => {
    expect(
      classifyHandTypedMention('alice@angsana.com', directory, 'internal')
    ).toBe('styled-chip');
  });

  it('treats lookup as case-insensitive on email', () => {
    expect(
      classifyHandTypedMention('ALICE@angsana.com', directory, 'shared')
    ).toBe('styled-chip');
    expect(
      classifyHandTypedMention('alice@ANGSANA.com', directory, 'shared')
    ).toBe('styled-chip');
  });

  it('returns plain-text on empty input', () => {
    expect(classifyHandTypedMention('', directory, 'shared')).toBe('plain-text');
    expect(classifyHandTypedMention('   ', directory, 'shared')).toBe('plain-text');
  });
});
