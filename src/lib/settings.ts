// =============================================================================
// Angsana Exchange — Settings Singleton
// Infrastructure Slice: Platform Utilities, Settings & Structured Logging
//
// Reads operational configuration from Firestore:
//   tenants/{tenantId}/settings/global
//
// Cached in memory with a 5-minute TTL. Falls back to sensible defaults
// if the document doesn't exist or Firestore is unreachable.
//
// Settings schema follows the platform pattern (nested logging + retention)
// for future compatibility with @angsana_consulting/utils.
//
// NOT used for build-time constants (pagination limits, tenant ID) —
// those remain in lib/api/config.ts.
// =============================================================================

import { adminDb } from '@/lib/firebase/admin';
import { DEFAULT_TENANT_ID } from '@/lib/api/config';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggingConfig {
  /** Minimum level for SystemLogs writes. debug=1, info=2, warn=3, error=4. */
  level: LogLevel;
  /** Emit structured JSON to console (Cloud Logging). Default: true. */
  enableConsole: boolean;
  /** Write to Firestore log collections. Default: true. */
  enableFirestore: boolean;
  /** Max characters for context objects before truncation. Default: 2000. */
  maxContextSize: number;
  /** Per-service level overrides, e.g. { driveProvisioning: 'debug' }. */
  services: Record<string, LogLevel>;
}

export interface RetentionConfig {
  /** { value, unit } per collection. Unit: 'days' | 'hours' | 'weeks' etc. */
  SystemLogs: { value: number; unit: string };
  ErrorLogs: { value: number; unit: string };
  UsageLogs: { value: number; unit: string };
  apiLogs: { value: number; unit: string };
}

export interface ExchangeSettings {
  logging: LoggingConfig;
  retention: RetentionConfig;
  updatedAt?: FirebaseFirestore.Timestamp;
  updatedBy?: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: ExchangeSettings = {
  logging: {
    level: 'info',
    enableConsole: true,
    enableFirestore: true,
    maxContextSize: 2000,
    services: {},
  },
  retention: {
    SystemLogs: { value: 14, unit: 'days' },
    ErrorLogs: { value: 30, unit: 'days' },
    UsageLogs: { value: 30, unit: 'days' },
    apiLogs: { value: 90, unit: 'days' },
  },
};

// ─── Level Mapping ──────────────────────────────────────────────────────────

export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const VALID_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cached: ExchangeSettings | null = null;
let _cachedAt = 0;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the cached settings. On first call (or after TTL expiry),
 * reads from Firestore. Falls back to defaults on any failure.
 */
export async function getSettings(): Promise<ExchangeSettings> {
  const now = Date.now();
  if (_cached && now - _cachedAt < CACHE_TTL_MS) {
    return _cached;
  }

  try {
    const snap = await adminDb
      .collection('tenants')
      .doc(DEFAULT_TENANT_ID)
      .collection('settings')
      .doc('global')
      .get();

    if (!snap.exists) {
      console.warn('[settings] tenants/angsana/settings/global not found — using defaults');
      _cached = DEFAULT_SETTINGS;
      _cachedAt = now;
      return _cached;
    }

    const data = snap.data() ?? {};
    const loggingRaw = data.logging ?? {};
    const retentionRaw = data.retention ?? {};

    const settings: ExchangeSettings = {
      logging: {
        level: VALID_LOG_LEVELS.includes(loggingRaw.level)
          ? loggingRaw.level
          : DEFAULT_SETTINGS.logging.level,
        enableConsole: loggingRaw.enableConsole !== false,
        enableFirestore: loggingRaw.enableFirestore !== false,
        maxContextSize:
          typeof loggingRaw.maxContextSize === 'number' && loggingRaw.maxContextSize > 0
            ? loggingRaw.maxContextSize
            : DEFAULT_SETTINGS.logging.maxContextSize,
        services:
          loggingRaw.services && typeof loggingRaw.services === 'object'
            ? loggingRaw.services
            : {},
      },
      retention: {
        SystemLogs: isValidRetention(retentionRaw.SystemLogs)
          ? retentionRaw.SystemLogs
          : DEFAULT_SETTINGS.retention.SystemLogs,
        ErrorLogs: isValidRetention(retentionRaw.ErrorLogs)
          ? retentionRaw.ErrorLogs
          : DEFAULT_SETTINGS.retention.ErrorLogs,
        UsageLogs: isValidRetention(retentionRaw.UsageLogs)
          ? retentionRaw.UsageLogs
          : DEFAULT_SETTINGS.retention.UsageLogs,
        apiLogs: isValidRetention(retentionRaw.apiLogs)
          ? retentionRaw.apiLogs
          : DEFAULT_SETTINGS.retention.apiLogs,
      },
      updatedAt: data.updatedAt,
      updatedBy: data.updatedBy,
    };

    _cached = settings;
    _cachedAt = now;
    return settings;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[settings] Failed to load settings:', message);
    // Return stale cache if available, else defaults
    return _cached ?? DEFAULT_SETTINGS;
  }
}

/**
 * Force re-read from Firestore on next getSettings() call.
 * Call after an admin updates the settings document.
 */
export function refreshSettings(): void {
  _cached = null;
  _cachedAt = 0;
}

/**
 * Returns the default settings (useful for seed scripts).
 */
export function getDefaultSettings(): ExchangeSettings {
  return { ...DEFAULT_SETTINGS };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidRetention(config: unknown): config is { value: number; unit: string } {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return typeof c.value === 'number' && c.value > 0 && typeof c.unit === 'string';
}

/**
 * Calculate an expiresAt Date from a { value, unit } retention config.
 * Matches the platform calculateTTL() contract.
 */
export function calculateExpiresAt(retention: { value: number; unit: string }): Date {
  const now = new Date();
  const { value, unit } = retention;

  let multiplierMs: number;
  switch (unit.toLowerCase()) {
    case 'second':
    case 'seconds':
      multiplierMs = 1000;
      break;
    case 'minute':
    case 'minutes':
      multiplierMs = 60 * 1000;
      break;
    case 'hour':
    case 'hours':
      multiplierMs = 60 * 60 * 1000;
      break;
    case 'day':
    case 'days':
      multiplierMs = 24 * 60 * 60 * 1000;
      break;
    case 'week':
    case 'weeks':
      multiplierMs = 7 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
    case 'months':
      multiplierMs = 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      multiplierMs = 24 * 60 * 60 * 1000; // default to days
  }

  return new Date(now.getTime() + value * multiplierMs);
}
