// =============================================================================
// Angsana Exchange — Retry Utility
// Infrastructure Slice: Platform Utilities, Settings & Structured Logging
//
// Simple retry wrapper for external HTTP API calls (Drive API, future
// Salesforce sync, Looker embed, BigQuery). Does NOT wrap Firestore Admin
// SDK operations — those have built-in retry at the gRPC transport layer.
//
// Follows the same pattern as @angsana_consulting/utils retry but without
// circuit breakers or dead letter queues — Exchange's call volume doesn't
// warrant that complexity.
// =============================================================================

import { logger, SVC_RETRY } from '@/lib/logging';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in ms before first retry. Default: 1000 */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff. Default: 2 */
  backoffMultiplier?: number;
  /** Maximum delay in ms (caps exponential growth). Default: 10000 */
  maxDelayMs?: number;
  /** Custom error classifier. Return true if error is retryable. */
  retryableErrors?: (error: Error) => boolean;
  /** Service name for logging. Default: 'unknown' */
  service?: string;
  /** Operation name for logging. Default: 'unknown' */
  operation?: string;
}

// ─── Default Error Classifier ───────────────────────────────────────────────

interface HttpError extends Error {
  code?: string | number;
  status?: number;
  response?: { status: number };
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE', 'ECONNABORTED',
]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 409, 422]);

/** Default classifier for common HTTP/API error patterns. */
export function isRetryableHttpError(error: Error): boolean {
  const httpErr = error as HttpError;
  const status = httpErr.status || httpErr.response?.status;
  const code = String(httpErr.code || '');

  if (status && NON_RETRYABLE_STATUS_CODES.has(status)) return false;
  if (status && RETRYABLE_STATUS_CODES.has(status)) return true;
  if (RETRYABLE_ERROR_CODES.has(code)) return true;

  return false;
}

/** Classifier for Drive API propagation errors (404/403 immediately after creating). */
export function isDrivePropagationError(error: Error): boolean {
  const httpErr = error as HttpError;
  const code = httpErr.code || httpErr.status;
  if (code === 404 || code === 403) return true;
  const msg = error.message || '';
  if (msg.includes('File not found') || msg.includes('notFound')) return true;
  return false;
}

// ─── withRetry ──────────────────────────────────────────────────────────────

const DEFAULTS: Required<Omit<RetryOptions, 'retryableErrors'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
  service: 'unknown',
  operation: 'unknown',
};

/**
 * Execute an async operation with retry.
 *
 * @param fn - The async operation to execute
 * @param options - Retry configuration
 * @returns The result of the operation
 * @throws The last error if all attempts are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  const classify = opts.retryableErrors ?? isRetryableHttpError;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();

      // Log successful retry (only if we retried at least once)
      if (attempt > 1) {
        logger.info(SVC_RETRY, 'retrySuccess', `Succeeded on attempt ${attempt}`, {
          service: opts.service,
          operation: opts.operation,
          attempt,
        });
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable = classify(lastError);
      const willRetry = isRetryable && attempt < opts.maxAttempts;

      if (willRetry) {
        const delay = Math.min(
          opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs
        );

        logger.warn(SVC_RETRY, 'retryAttempt',
          `Attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${Math.round(delay)}ms`, {
            service: opts.service,
            operation: opts.operation,
            attempt,
            maxAttempts: opts.maxAttempts,
            nextDelayMs: Math.round(delay),
            errorMessage: lastError.message,
          });

        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (!isRetryable) {
        // Non-retryable — fail immediately
        logger.error(SVC_RETRY, 'nonRetryableError',
          `Non-retryable error on attempt ${attempt}`, {
            service: opts.service,
            operation: opts.operation,
            attempt,
            errorMessage: lastError.message,
          });
        throw lastError;
      } else {
        // Max attempts exhausted
        logger.error(SVC_RETRY, 'retryExhausted',
          `All ${opts.maxAttempts} attempts failed`, {
            service: opts.service,
            operation: opts.operation,
            totalAttempts: opts.maxAttempts,
            errorMessage: lastError.message,
          });
      }
    }
  }

  throw lastError!;
}
