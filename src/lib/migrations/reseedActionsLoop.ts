// =============================================================================
// Reseed-loop driver — orchestrates the per-document idempotency check,
// mapping, and write/delete for the action-lite reseed.
//
// Factored out of `scripts/reseed-actions-to-work-items-v0_1.ts` so the
// test suite at `tests/migrations/reseedActions.test.ts` can drive the
// loop against in-memory fakes. The script wires this module to real
// Firestore admin-SDK references; the tests wire it to fakes that
// exercise the same surface.
//
// The interfaces below name the minimal Firestore-shaped surface the loop
// uses. The fakes implement these exactly; the real Firestore SDK
// already satisfies them via duck-typing.
// =============================================================================

import {
  mapActionToWorkItem,
  type SourceAction,
  type MappedWorkItem,
} from './actionToWorkItem';

// ─── Minimal Firestore-shaped surface ───────────────────────────────────────

export interface FakeDocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FakeQuerySnap {
  size: number;
  empty: boolean;
  docs: FakeDocSnap[];
}

export interface FakeQuery {
  where(field: string, op: '==', value: unknown): FakeQuery;
  limit(n: number): FakeQuery;
  get(): Promise<FakeQuerySnap>;
}

export interface FakeDocRef {
  id: string;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

export interface FakeCollectionRef extends FakeQuery {
  doc(id?: string): FakeDocRef;
  get(): Promise<FakeQuerySnap>;
}

// ─── Outcome shapes (mirror the script's log) ──────────────────────────────

export type ReseedOutcomeKind =
  | 'reseeded'
  | 'skipped-already-reseeded'
  | 'errored'
  | 'would-reseed';

export interface ReseedOutcome {
  sourceId: string;
  outcome: ReseedOutcomeKind;
  workItemId?: string;
  errorMessage?: string;
}

export type DeleteOutcomeKind = 'deleted' | 'verified-only' | 'errored';

export interface DeleteOutcome {
  sourceId: string;
  outcome: DeleteOutcomeKind;
  errorMessage?: string;
}

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface ReseedLoopInput {
  sourceActions: FakeCollectionRef;
  /** A reference whose `.where(...).limit(...).get()` queries
   *  by `migrationSource.sourceId` against the target Work Items collection. */
  targetWorkItems: FakeCollectionRef;
  tenantId: string;
  clientId: string;
  reseedRun: string;
  operatorId: string;
  /**
   * Mode: 'execute' writes; 'dry-run' walks the same logic without
   * writes. The delete-old loop has its own function below.
   */
  mode: 'execute' | 'dry-run';
  /**
   * Injectable workItemId minter. Real SDK uses crypto.randomUUID; tests
   * pass a deterministic counter so assertions are stable.
   */
  mintWorkItemId: () => string;
  /**
   * Injectable "now" for deterministic tests. Returns whatever shape the
   * write callback wants on `createdAt` / `updatedAt`. We keep this
   * untyped because Firestore Timestamp has its own class identity that
   * fakes won't reproduce; the loop just passes the value through.
   */
  now: () => unknown;
}

export interface DeleteLoopInput {
  sourceActions: FakeCollectionRef;
  targetWorkItems: FakeCollectionRef;
}

// ─── Reseed loop ────────────────────────────────────────────────────────────

export interface ReseedLoopResult {
  read: number;
  reseeded: number;
  skippedAlreadyReseeded: number;
  errored: number;
  outcomes: ReseedOutcome[];
}

export async function runReseedLoop(
  input: ReseedLoopInput
): Promise<ReseedLoopResult> {
  const {
    sourceActions,
    targetWorkItems,
    tenantId,
    clientId,
    reseedRun,
    operatorId,
    mode,
    mintWorkItemId,
    now,
  } = input;

  const result: ReseedLoopResult = {
    read: 0,
    reseeded: 0,
    skippedAlreadyReseeded: 0,
    errored: 0,
    outcomes: [],
  };

  const snap = await sourceActions.get();
  result.read = snap.size;

  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const action: SourceAction = {
      id: doc.id,
      ...(data as Omit<SourceAction, 'id'>),
    };

    try {
      // Idempotency check.
      const existingSnap = await targetWorkItems
        .where('migrationSource.sourceId', '==', action.id)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        result.skippedAlreadyReseeded += 1;
        result.outcomes.push({
          sourceId: action.id,
          outcome: 'skipped-already-reseeded',
          workItemId: existingSnap.docs[0].id,
        });
        continue;
      }

      const mapped: MappedWorkItem = mapActionToWorkItem({
        action,
        tenantId,
        clientId,
        reseedRun,
      });

      if (mode === 'dry-run') {
        result.outcomes.push({ sourceId: action.id, outcome: 'would-reseed' });
        continue;
      }

      const workItemId = mintWorkItemId();
      const t = now();
      const docToWrite: Record<string, unknown> = {
        ...(mapped as unknown as Record<string, unknown>),
        workItemId,
        createdAt: t,
        createdBy: { userId: `script:reseed:${operatorId}`, tenantId },
        updatedAt: t,
        schemaVersion: 'r3-action-lite-v1',
        activityLog: [],
      };
      await targetWorkItems.doc(workItemId).set(docToWrite);
      result.reseeded += 1;
      result.outcomes.push({
        sourceId: action.id,
        outcome: 'reseeded',
        workItemId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errored += 1;
      result.outcomes.push({
        sourceId: action.id,
        outcome: 'errored',
        errorMessage: message,
      });
    }
  }

  return result;
}

// ─── Delete-old loop ────────────────────────────────────────────────────────

export interface DeleteLoopResult {
  read: number;
  deleted: number;
  heldBack: number;
  errored: number;
  outcomes: DeleteOutcome[];
}

export async function runDeleteOldLoop(
  input: DeleteLoopInput
): Promise<DeleteLoopResult> {
  const { sourceActions, targetWorkItems } = input;

  const result: DeleteLoopResult = {
    read: 0,
    deleted: 0,
    heldBack: 0,
    errored: 0,
    outcomes: [],
  };

  const snap = await sourceActions.get();
  result.read = snap.size;

  for (const doc of snap.docs) {
    const sourceId = doc.id;
    try {
      const existingSnap = await targetWorkItems
        .where('migrationSource.sourceId', '==', sourceId)
        .limit(1)
        .get();

      if (existingSnap.empty) {
        result.heldBack += 1;
        result.outcomes.push({
          sourceId,
          outcome: 'verified-only',
          errorMessage:
            'No reseeded Work Item found for this sourceId; refusing to delete.',
        });
        continue;
      }

      await sourceActions.doc(sourceId).delete();
      result.deleted += 1;
      result.outcomes.push({ sourceId, outcome: 'deleted' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errored += 1;
      result.outcomes.push({
        sourceId,
        outcome: 'errored',
        errorMessage: message,
      });
    }
  }

  return result;
}
