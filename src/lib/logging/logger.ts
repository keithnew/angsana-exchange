// =============================================================================
// Angsana Exchange — Structured Logger
// Infrastructure Slice: Platform Utilities, Settings & Structured Logging
//
// Exchange-native logger following the same external contract as the platform
// @angsana_consulting/utils logger:
//   - Same Firestore collection names: SystemLogs, ErrorLogs, UsageLogs
//   - Same document schema (fields, types, naming conventions)
//   - Same logging levels: debug(1), info(2), warn(3), error(4)
//   - Same level comparison: log if message level >= configured threshold
//
// Built Exchange-native because the platform package has a hard dependency
// on @angsana_consulting/config which calls admin.firestore() at module load
// time — incompatible with Next.js server-side initialisation order.
//
// Two output channels:
//   1. Firestore (queryable, TTL-managed via expiresAt)
//   2. Console structured JSON (Cloud Logging on Cloud Run)
//
// All Firestore writes are fire-and-forget. A failed log write must never
// fail the operation being logged.
// =============================================================================

import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_TENANT_ID } from '@/lib/api/config';
import {
  getSettings,
  calculateExpiresAt,
  LOG_LEVEL_VALUES,
  type LogLevel,
} from '@/lib/settings';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LogContext {
  [key: string]: unknown;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Strip sensitive fields and truncate oversized context objects. */
function sanitizeContext(context: LogContext, maxSize: number): LogContext {
  if (!context) return {};

  const SENSITIVE_KEYS = new Set([
    'password', 'token', 'apiKey', 'secret', 'authToken',
    'idToken', 'refreshToken', 'privateKey', 'private_key',
  ]);

  const sanitized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null && !SENSITIVE_KEYS.has(key)) {
      sanitized[key] = value;
    }
  }

  const jsonStr = JSON.stringify(sanitized);
  if (jsonStr.length > maxSize) {
    // Keep the most important fields, discard the rest
    const important: LogContext = { _truncated: true, _originalSize: jsonStr.length };
    if (sanitized.userId) important.userId = sanitized.userId;
    if (sanitized.clientId) important.clientId = sanitized.clientId;
    if (sanitized.requestId) important.requestId = sanitized.requestId;
    return important;
  }

  return sanitized;
}

/** Remove undefined values from an object (Firestore rejects undefined). */
function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/** Determine the effective log level for a given service. */
function getEffectiveLevel(
  globalLevel: LogLevel,
  services: Record<string, LogLevel>,
  service: string
): number {
  const serviceOverride = services[service];
  const effectiveLevel = serviceOverride || globalLevel;
  return LOG_LEVEL_VALUES[effectiveLevel] ?? LOG_LEVEL_VALUES.info;
}

// ─── Firestore Writers ──────────────────────────────────────────────────────

function getCollection(tenantId: string, collectionName: string) {
  return adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection(collectionName);
}

// ─── Logger Singleton ───────────────────────────────────────────────────────

class ExchangeLogger {
  private static instance: ExchangeLogger;

  private constructor() {}

  static getInstance(): ExchangeLogger {
    if (!ExchangeLogger.instance) {
      ExchangeLogger.instance = new ExchangeLogger();
    }
    return ExchangeLogger.instance;
  }

  // ── Core log method ─────────────────────────────────────────────────────

  private async writeLog(
    level: LogLevel,
    service: string,
    operation: string,
    message: string,
    context?: LogContext,
    error?: Error | string
  ): Promise<void> {
    try {
      const settings = await getSettings();
      const { logging, retention } = settings;
      const levelValue = LOG_LEVEL_VALUES[level];
      const threshold = getEffectiveLevel(logging.level, logging.services, service);
      const safeContext = sanitizeContext(context || {}, logging.maxContextSize);

      // ── Console output (always, for Cloud Logging) ────────────────────
      if (logging.enableConsole) {
        const consoleEntry = {
          severity: level.toUpperCase(),
          message: `[${level.toUpperCase()}] ${service}.${operation}: ${message}`,
          service,
          operation,
          context: safeContext,
          ...(error ? { error: typeof error === 'string' ? error : error.message } : {}),
        };

        switch (level) {
          case 'error':
            console.error(JSON.stringify(consoleEntry));
            break;
          case 'warn':
            console.warn(JSON.stringify(consoleEntry));
            break;
          default:
            console.log(JSON.stringify(consoleEntry));
        }
      }

      // ── Firestore output ──────────────────────────────────────────────
      if (!logging.enableFirestore) return;

      if (level === 'error') {
        // Errors ALWAYS go to ErrorLogs regardless of level threshold
        const errorObj = typeof error === 'string' ? new Error(error) : error;
        const errorEntry = cleanUndefined({
          timestamp: FieldValue.serverTimestamp(),
          expiresAt: calculateExpiresAt(retention.ErrorLogs),
          level: 'error',
          service,
          operation,
          errorMessage: errorObj?.message || message,
          errorStack: errorObj?.stack?.substring(0, 2000),
          context: safeContext,
        });

        getCollection(DEFAULT_TENANT_ID, 'ErrorLogs')
          .add(errorEntry)
          .catch(() => {}); // fire-and-forget

      } else if (levelValue >= threshold) {
        // debug/info/warn go to SystemLogs if level >= threshold
        const systemEntry = cleanUndefined({
          timestamp: FieldValue.serverTimestamp(),
          expiresAt: calculateExpiresAt(retention.SystemLogs),
          level,
          levelValue,
          service,
          operation,
          message,
          context: safeContext,
        });

        getCollection(DEFAULT_TENANT_ID, 'SystemLogs')
          .add(systemEntry)
          .catch(() => {}); // fire-and-forget
      }
    } catch {
      // Logger must never throw
    }
  }

  // ── Convenience methods ─────────────────────────────────────────────────

  debug(service: string, operation: string, message: string, context?: LogContext): void {
    this.writeLog('debug', service, operation, message, context).catch(() => {});
  }

  info(service: string, operation: string, message: string, context?: LogContext): void {
    this.writeLog('info', service, operation, message, context).catch(() => {});
  }

  warn(service: string, operation: string, message: string, context?: LogContext): void {
    this.writeLog('warn', service, operation, message, context).catch(() => {});
  }

  error(
    service: string,
    operation: string,
    errorOrMessage: Error | string,
    context?: LogContext
  ): void {
    const message = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : errorOrMessage.message;
    this.writeLog('error', service, operation, message, context, errorOrMessage).catch(() => {});
  }

  /**
   * Write a usage log entry. Not gated by logging level — always written.
   * Use for significant completed operations: provisioning, deprovision,
   * user lifecycle, bulk operations.
   */
  usage(
    action: string,
    service: string,
    duration: number,
    userId: string,
    clientId?: string,
    metadata?: LogContext
  ): void {
    this.writeUsageLog(action, service, duration, userId, clientId, metadata).catch(() => {});
  }

  private async writeUsageLog(
    action: string,
    service: string,
    duration: number,
    userId: string,
    clientId?: string,
    metadata?: LogContext
  ): Promise<void> {
    try {
      const settings = await getSettings();
      if (!settings.logging.enableFirestore) return;

      const safeMetadata = sanitizeContext(metadata || {}, settings.logging.maxContextSize);

      const usageEntry = cleanUndefined({
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: calculateExpiresAt(settings.retention.UsageLogs),
        action,
        service,
        duration,
        userId,
        clientId: clientId || null,
        metadata: safeMetadata,
      });

      // Console output for Cloud Logging
      if (settings.logging.enableConsole) {
        console.log(JSON.stringify({
          severity: 'INFO',
          message: `[USAGE] ${service}.${action}: ${duration}ms`,
          ...usageEntry,
          timestamp: new Date().toISOString(),
        }));
      }

      getCollection(DEFAULT_TENANT_ID, 'UsageLogs')
        .add(usageEntry)
        .catch(() => {}); // fire-and-forget
    } catch {
      // Logger must never throw
    }
  }
}

// ─── Export singleton ───────────────────────────────────────────────────────

export const logger = ExchangeLogger.getInstance();
