// =============================================================================
// Angsana Exchange — API Audit Logger
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Two-tier audit logging:
//   1. Cloud Logging (all requests) — structured JSON via console.log
//   2. Firestore mutation log (POST/PUT/PATCH/DELETE only) — durable audit trail
//
// Reads are NOT written to Firestore to avoid cost scaling from high-frequency
// Make.com automations. All reads are still captured in Cloud Logging.
// =============================================================================

import { adminDb } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AUDIT_LOG_TTL_DAYS } from '../config';
import type { ApiAuthContext, ApiAuthMethod } from '../types';

interface AuditLogParams {
  method: string;
  collection: string;
  documentId?: string;
  env: string;
  authContext: ApiAuthContext;
  clientId?: string;
  statusCode: number;
  errorCode?: string;
  responseTimeMs: number;
}

/**
 * Log an API request. Always writes to Cloud Logging.
 * Additionally writes to Firestore for mutation operations (POST/PUT/PATCH/DELETE).
 */
export function logApiRequest(params: AuditLogParams): void {
  const {
    method,
    collection,
    documentId,
    env,
    authContext,
    clientId,
    statusCode,
    errorCode,
    responseTimeMs,
  } = params;

  const callerId = authContext.userId || authContext.keyId || 'unknown';

  // ─── Tier 1: Cloud Logging (all requests) ─────────────────────────────
  // Structured JSON — queryable in Logs Explorer, exportable to BigQuery
  const logEntry = {
    severity: statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARNING' : 'INFO',
    message: `API ${method} /${collection}${documentId ? '/' + documentId : ''} → ${statusCode}`,
    exchangeApi: {
      timestamp: new Date().toISOString(),
      httpMethod: method,
      collection,
      documentId: documentId || null,
      env,
      authMethod: authContext.method,
      callerId,
      callerRole: authContext.role,
      clientId: clientId || null,
      statusCode,
      errorCode: errorCode || null,
      responseTimeMs,
    },
  };

  // Use console.log for structured logging — Cloud Run captures this
  // as structured JSON when the payload is a JSON object
  console.log(JSON.stringify(logEntry));

  // ─── Tier 2: Firestore mutation log (writes only) ─────────────────────
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (isMutation) {
    writeFirestoreAuditLog(params, callerId).catch((err) => {
      // Fire-and-forget — a failed log write must not fail the API request
      console.error('Failed to write Firestore audit log:', err.message);
    });
  }
}

/**
 * Write a mutation audit log to Firestore.
 * Fire-and-forget — called after the response is sent.
 */
async function writeFirestoreAuditLog(
  params: AuditLogParams,
  callerId: string
): Promise<void> {
  const ttlMs = AUDIT_LOG_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = Timestamp.fromMillis(Date.now() + ttlMs);

  await adminDb
    .collection('tenants')
    .doc(params.authContext.tenantId)
    .collection('apiLogs')
    .add({
      timestamp: FieldValue.serverTimestamp(),
      method: params.method,
      collection: params.collection,
      documentId: params.documentId || null,
      authMethod: params.authContext.method,
      callerId,
      callerRole: params.authContext.role,
      clientId: params.clientId || null,
      statusCode: params.statusCode,
      errorCode: params.errorCode || null,
      expiresAt,
    });
}
