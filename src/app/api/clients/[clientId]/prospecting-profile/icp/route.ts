// =============================================================================
// DEPRECATED — ICP now lives on individual propositions (Slice 8 Patch)
//
// This route is kept as a stub to avoid 404 errors from old client code.
// New code should use: PATCH /api/clients/{clientId}/propositions/{id}/icp
// =============================================================================

import { NextResponse } from 'next/server';

/**
 * GET /api/clients/[clientId]/prospecting-profile/icp
 * @deprecated ICP is now per-proposition. Returns empty object.
 */
export async function GET() {
  return NextResponse.json(
    {
      deprecated: true,
      message: 'ICP has moved to individual propositions. Use GET /api/clients/{clientId}/propositions to retrieve ICP data.',
      icp: null,
    },
    { status: 200 }
  );
}

/**
 * PATCH /api/clients/[clientId]/prospecting-profile/icp
 * @deprecated ICP is now per-proposition. Returns 410 Gone.
 */
export async function PATCH() {
  return NextResponse.json(
    {
      deprecated: true,
      message: 'ICP has moved to individual propositions. Use PATCH /api/clients/{clientId}/propositions/{id}/icp instead.',
    },
    { status: 410 }
  );
}
