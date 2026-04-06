import { NextResponse } from 'next/server';

/**
 * Health check endpoint — used by Cloud Run startup/liveness probes
 * and for quick deployment verification.
 *
 * This route is excluded from JWT middleware auth (see middleware.ts publicRoutes).
 * Must return 200 without authentication.
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'angsana-exchange',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || 'unknown',
  });
}
