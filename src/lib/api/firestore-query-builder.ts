// =============================================================================
// Angsana Exchange — Firestore Query Builder
// Extracted from @angsana_consulting/api-core/src/parsers/firestoreQueryBuilder.ts
// Source: angsana-platform/packages/api-core/src/parsers/firestoreQueryBuilder.ts
// Extracted: 2026-04-06
//
// Framework-agnostic — works directly with Firebase Admin SDK Query objects.
// Debug logging stripped; enable via API_DEBUG=true.
// =============================================================================

import { API_DEBUG } from './config';
import {
  WhereCondition,
  WhereGroup,
  isWhereCondition,
  isWhereGroup,
  flattenConditions,
} from './query-parser';

type WhereFilterOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

export interface QueryBuildResult {
  query: FirebaseFirestore.Query;
  requiresClientFilter: boolean;
  clientFilter?: (doc: any) => boolean;
  warning?: string;
}

/**
 * Check if a WHERE tree can be pushed entirely to Firestore.
 */
function canUseFirestoreNatively(node: WhereGroup | WhereCondition): boolean {
  if (isWhereCondition(node)) return !node.isSpecial;
  if (node.type === 'AND') {
    const inequalityFields = new Set<string>();
    for (const cond of flattenConditions(node)) {
      if (cond.isSpecial) return false;
      if (['<', '<=', '>', '>=', '!='].includes(cond.operator)) inequalityFields.add(cond.field);
    }
    return inequalityFields.size <= 1;
  }
  if (node.type === 'OR') {
    if (node.conditions.every(isWhereCondition)) {
      const fields = new Set(node.conditions.map(c => (c as WhereCondition).field));
      const ops = new Set(node.conditions.map(c => (c as WhereCondition).operator));
      return fields.size === 1 && ops.size === 1 && ops.has('==');
    }
    return false;
  }
  return false;
}

/**
 * Apply a native WHERE tree to a Firestore query.
 */
function applyWhereToQuery(query: FirebaseFirestore.Query, node: WhereGroup | WhereCondition): FirebaseFirestore.Query {
  if (isWhereCondition(node)) {
    if (node.operator !== 'contains' && node.operator !== 'startsWith') {
      if (API_DEBUG) console.log('[QueryBuilder] Applying:', node.field, node.operator, node.value);
      return query.where(node.field, node.operator as WhereFilterOp, node.value);
    }
    return query;
  }
  if (node.type === 'AND') {
    for (const cond of node.conditions) query = applyWhereToQuery(query, cond);
    return query;
  }
  if (node.type === 'OR' && node.conditions.every(isWhereCondition)) {
    const conds = node.conditions as WhereCondition[];
    const field = conds[0].field;
    const values = conds.map(c => c.value);
    return query.where(field, 'in', values);
  }
  throw new Error('Cannot apply OR condition to Firestore query');
}

/**
 * Split conditions into Firestore-safe and client-side filters.
 */
function splitConditions(node: WhereGroup | WhereCondition): { firestoreConditions: WhereCondition[] } {
  const firestoreConditions: WhereCondition[] = [];
  if (isWhereCondition(node)) {
    if (!node.isSpecial && node.operator !== 'contains') firestoreConditions.push(node);
  } else if (node.type === 'AND') {
    for (const cond of node.conditions) {
      if (isWhereCondition(cond) && !cond.isSpecial && cond.operator !== 'contains') {
        firestoreConditions.push(cond);
      }
    }
  }
  // Filter for Firestore safety (max 1 inequality field)
  const inequalityFields = new Set<string>();
  const safe: WhereCondition[] = [];
  for (const cond of firestoreConditions) {
    if (['<', '<=', '>', '>=', '!='].includes(cond.operator)) {
      if (inequalityFields.size > 0 && !inequalityFields.has(cond.field)) continue;
      inequalityFields.add(cond.field);
    }
    safe.push(cond);
  }
  return { firestoreConditions: safe };
}

/**
 * Create a client-side filter function for a WHERE tree.
 */
export function createClientFilter(node: WhereGroup | WhereCondition): (doc: any) => boolean {
  return (doc: any) => evaluate(doc, node);
}

function evaluate(doc: any, node: WhereGroup | WhereCondition): boolean {
  if (isWhereCondition(node)) return evaluateSingle(doc, node);
  if (node.type === 'AND') return node.conditions.every(c => evaluate(doc, c));
  if (node.type === 'OR') return node.conditions.some(c => evaluate(doc, c));
  return false;
}

function evaluateSingle(doc: any, cond: WhereCondition): boolean {
  const value = getNestedValue(doc, cond.field);
  const cv = cond.value;
  if (value === null || value === undefined) return cond.operator === '!=' && cv !== null && cv !== undefined;
  if (cond.operator === 'contains' || cond.isSpecial) {
    return String(value).toLowerCase().includes(String(cv).toLowerCase());
  }
  let dv = value;
  let comp = cv;
  if (value && value._seconds !== undefined) dv = new Date(value._seconds * 1000);
  if (cv && cv._seconds !== undefined) comp = new Date(cv._seconds * 1000);

  switch (cond.operator) {
    case '==': return dv === comp;
    case '!=': return dv !== comp;
    case '<': return dv < comp;
    case '<=': return dv <= comp;
    case '>': return dv > comp;
    case '>=': return dv >= comp;
    case 'in': return Array.isArray(comp) && comp.includes(dv);
    case 'array-contains': return Array.isArray(dv) && dv.includes(comp);
    case 'array-contains-any': return Array.isArray(dv) && Array.isArray(comp) && comp.some((v: any) => dv.includes(v));
    default: return false;
  }
}

function getNestedValue(obj: any, path: string): any {
  let value = obj;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return null;
    value = value[key];
  }
  return value;
}

/**
 * Build a Firestore query from a WHERE tree, with fallback to client-side filtering.
 */
export async function buildFirestoreQuery(
  collection: FirebaseFirestore.CollectionReference,
  whereNode: WhereGroup | WhereCondition
): Promise<QueryBuildResult> {
  let query: FirebaseFirestore.Query = collection;
  let requiresClientFilter = false;
  let clientFilter: ((doc: any) => boolean) | undefined;
  let warning: string | undefined;

  if (!canUseFirestoreNatively(whereNode)) {
    requiresClientFilter = true;
    const { firestoreConditions } = splitConditions(whereNode);
    if (firestoreConditions.length > 0) {
      for (const cond of firestoreConditions) {
        query = query.where(cond.field, cond.operator as WhereFilterOp, cond.value);
      }
      warning = 'Complex WHERE clause partially applied. Client-side filtering in use.';
    } else {
      warning = 'WHERE clause too complex for Firestore. All filtering done client-side.';
    }
    clientFilter = createClientFilter(whereNode);
  } else {
    query = applyWhereToQuery(query, whereNode);
  }

  return { query, requiresClientFilter, clientFilter, warning };
}
