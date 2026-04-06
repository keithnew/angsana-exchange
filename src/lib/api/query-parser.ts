// =============================================================================
// Angsana Exchange — WHERE Clause Query Parser
// Extracted from @angsana_consulting/api-core/src/parsers/whereParser.ts
// Source: angsana-platform/packages/api-core/src/parsers/whereParser.ts
// Extracted: 2026-04-06
//
// Framework-agnostic — operates on string inputs, returns structured filter objects.
// Debug logging stripped (was console.log hex dumps, token dumps, etc.).
// Enable verbose logging via API_DEBUG=true environment variable.
// =============================================================================

import { API_DEBUG } from './config';

type WhereFilterOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

const TIMESTAMP_FIELD_HINTS = new Set([
  't', 'x', 'timestamp', 'createdat', 'updatedat',
  'issuedat', 'expiresat', 'revokedat', 'disabledat', 'lastloginat', 'lastusedat',
  'duedate', 'startdate', 'enddate',
]);

// ─── Public types ───────────────────────────────────────────────────────────

export interface WhereCondition {
  field: string;
  operator: WhereFilterOp | 'contains' | 'startsWith';
  value: any;
  isSpecial?: boolean;
}

export interface WhereGroup {
  type: 'AND' | 'OR';
  conditions: (WhereCondition | WhereGroup)[];
}

// ─── Type guards ────────────────────────────────────────────────────────────

export function isWhereCondition(node: WhereGroup | WhereCondition): node is WhereCondition {
  return 'field' in node;
}

export function isWhereGroup(node: WhereGroup | WhereCondition): node is WhereGroup {
  return 'type' in node && 'conditions' in node;
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

enum TokenType { FIELD, OPERATOR, VALUE, AND, OR, LPAREN, RPAREN, EOF }

interface Token { type: TokenType; value: string; position: number; }

class WhereTokenizer {
  private input: string;
  private position = 0;
  private tokens: Token[] = [];

  constructor(whereString: string) {
    this.input = whereString;
    if (API_DEBUG) console.log('[QueryParser] Tokenizing:', whereString);
  }

  tokenize(): Token[] {
    while (this.position < this.input.length) {
      this.skipWhitespace();
      if (this.position >= this.input.length) break;

      if (this.input[this.position] === '(') {
        this.tokens.push({ type: TokenType.LPAREN, value: '(', position: this.position });
        this.position++;
        continue;
      }
      if (this.input[this.position] === ')') {
        this.tokens.push({ type: TokenType.RPAREN, value: ')', position: this.position });
        this.position++;
        continue;
      }
      if (this.checkKeyword('AND')) {
        this.tokens.push({ type: TokenType.AND, value: 'AND', position: this.position });
        this.position += 3;
        continue;
      }
      if (this.checkKeyword('OR')) {
        this.tokens.push({ type: TokenType.OR, value: 'OR', position: this.position });
        this.position += 2;
        continue;
      }
      if (!this.parseCondition()) {
        throw new Error(`Unexpected character at position ${this.position}: "${this.input[this.position]}"`);
      }
    }
    this.tokens.push({ type: TokenType.EOF, value: '', position: this.position });
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.input[this.position])) this.position++;
  }

  private checkKeyword(keyword: string): boolean {
    const upper = this.input.substr(this.position).toUpperCase();
    if (!upper.startsWith(keyword)) return false;
    const nextPos = this.position + keyword.length;
    if (nextPos >= this.input.length) return true;
    return /[\s()]/.test(this.input[nextPos]);
  }

  private parseCondition(): boolean {
    const startPos = this.position;

    // Match field name
    const fieldMatch = this.input.substr(this.position).match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
    if (!fieldMatch) return false;
    const field = fieldMatch[0];
    this.position += field.length;
    this.skipWhitespace();

    // Match operator — support both standard and colon-separated `:in:` syntax
    let operator: string;
    const colonInMatch = this.input.substr(this.position).match(/^:in:/i);
    if (colonInMatch) {
      operator = 'in';
      this.position += colonInMatch[0].length;
    } else {
      const opMatch = this.input.substr(this.position).match(
        /^(>=|<=|==|!=|<|>|array-contains-any|array-contains|in|startsWith|contains)/
      );
      if (!opMatch) { this.position = startPos; return false; }
      operator = opMatch[0];
      this.position += operator.length;
    }
    this.skipWhitespace();

    // Match value
    let value = '';
    let inQuotes = false;
    let quoteChar = '';
    let bracketDepth = 0;

    while (this.position < this.input.length) {
      const char = this.input[this.position];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true; quoteChar = char; value += char; this.position++; continue;
      }
      if (char === quoteChar && inQuotes) {
        inQuotes = false; value += char; this.position++; continue;
      }
      if (char === '[' && !inQuotes) { bracketDepth++; value += char; this.position++; continue; }
      if (char === ']' && !inQuotes) {
        bracketDepth--; value += char; this.position++;
        if (bracketDepth === 0 && (operator === 'in' || operator === 'array-contains-any')) break;
        continue;
      }

      if (!inQuotes && bracketDepth === 0) {
        const ahead = this.input.substr(this.position);
        if (ahead.match(/^(\s+AND\s+|AND\s+|AND$)/i)) break;
        if (ahead.match(/^(\s+OR\s+|OR\s+|OR$)/i)) break;
        if (char === ')') break;
      }
      value += char;
      this.position++;
    }

    value = value.trim();
    if (!value) { this.position = startPos; return false; }

    this.tokens.push({ type: TokenType.FIELD, value: field, position: startPos });
    this.tokens.push({ type: TokenType.OPERATOR, value: operator, position: startPos + field.length });
    this.tokens.push({ type: TokenType.VALUE, value, position: startPos + field.length + operator.length });
    return true;
  }
}

// ─── Recursive descent parser ───────────────────────────────────────────────

class WhereParser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  parse(): WhereGroup | WhereCondition {
    if (this.tokens.length === 1 && this.tokens[0].type === TokenType.EOF) {
      return { type: 'AND', conditions: [] };
    }
    const result = this.parseOr();
    if (this.currentToken().type !== TokenType.EOF) {
      throw new Error(`Unexpected token: ${this.currentToken().value}`);
    }
    return result;
  }

  private parseOr(): WhereGroup | WhereCondition {
    let left = this.parseAnd();
    while (this.currentToken().type === TokenType.OR) {
      this.consume(TokenType.OR);
      const right = this.parseAnd();
      if ('type' in left && left.type === 'OR') { (left as WhereGroup).conditions.push(right); }
      else { left = { type: 'OR', conditions: [left, right] }; }
    }
    return left;
  }

  private parseAnd(): WhereGroup | WhereCondition {
    let left = this.parsePrimary();
    while (this.currentToken().type === TokenType.AND) {
      this.consume(TokenType.AND);
      const right = this.parsePrimary();
      if ('type' in left && left.type === 'AND') { (left as WhereGroup).conditions.push(right); }
      else { left = { type: 'AND', conditions: [left, right] }; }
    }
    return left;
  }

  private parsePrimary(): WhereGroup | WhereCondition {
    if (this.currentToken().type === TokenType.LPAREN) {
      this.consume(TokenType.LPAREN);
      const group = this.parseOr();
      this.consume(TokenType.RPAREN);
      return group;
    }
    if (this.currentToken().type === TokenType.FIELD) {
      const field = this.consume(TokenType.FIELD).value;
      const operator = this.consume(TokenType.OPERATOR).value;
      const valueStr = this.consume(TokenType.VALUE).value;
      const value = this.parseValue(field, operator, valueStr);

      if (operator === 'startsWith') {
        return { type: 'AND', conditions: [
          { field, operator: '>=', value },
          { field, operator: '<', value: value + '\uf8ff' },
        ]};
      }
      if (operator === 'contains') {
        return { field, operator: 'contains', value, isSpecial: true } as WhereCondition;
      }
      return { field, operator: operator as WhereFilterOp, value } as WhereCondition;
    }
    throw new Error(`Expected condition or '(' at position ${this.current}`);
  }

  private parseValue(field: string, operator: string, valueStr: string): any {
    // Remove quotes
    if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
      valueStr = valueStr.slice(1, -1);
    }

    const lowerField = field.toLowerCase();
    const bareField = field.split('.').pop() || field;
    const lowerBareField = bareField.toLowerCase();

    // Literal values
    if (valueStr === 'true') return true;
    if (valueStr === 'false') return false;
    if (valueStr === 'null') return null;

    // Timestamp detection
    const isTimestampField =
      TIMESTAMP_FIELD_HINTS.has(lowerBareField) ||
      lowerBareField.endsWith('at') || lowerBareField.endsWith('time') ||
      lowerBareField.startsWith('date') || lowerBareField.includes('date');

    if (isTimestampField && /^\d{4}-\d{2}-\d{2}/.test(valueStr)) {
      let norm = valueStr;
      if (!norm.includes('T')) norm = `${norm}T00:00:00.000Z`;
      else if (!/[zZ]$/.test(norm) && !/[+-]\d{2}:\d{2}$/.test(norm)) norm = `${norm}Z`;
      const parsed = new Date(norm);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // Handle arrays for 'in' and 'array-contains-any' operators
    // Supports both bracket syntax [a,b,c] and bare comma-separated a,b,c
    if (operator === 'in' || operator === 'array-contains-any') {
      let items: string;
      if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
        items = valueStr.slice(1, -1);
      } else {
        // Bare comma-separated list (from :in: syntax)
        items = valueStr;
      }
      return items.split(',').map(v => {
        let trimmed = v.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          trimmed = trimmed.slice(1, -1);
        }
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === 'null') return null;
        if (!isNaN(Number(trimmed)) && trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
          return Number(trimmed);
        }
        return trimmed;
      });
    }

    // Number conversion (conservative)
    if (!isNaN(Number(valueStr)) && valueStr !== '' && /^-?\d+(\.\d+)?$/.test(valueStr)) {
      return Number(valueStr);
    }

    return valueStr;
  }

  private currentToken(): Token {
    return this.tokens[this.current] || { type: TokenType.EOF, value: '', position: -1 };
  }

  private consume(expected: TokenType): Token {
    const token = this.currentToken();
    if (token.type !== expected) throw new Error(`Expected ${TokenType[expected]} but found ${TokenType[token.type]}`);
    this.current++;
    return token;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a single WHERE clause string into a structured filter tree.
 */
export function parseWhereClause(whereString: string): WhereGroup | WhereCondition {
  if (!whereString || whereString.trim() === '') {
    return { type: 'AND', conditions: [] };
  }
  const tokenizer = new WhereTokenizer(whereString);
  const tokens = tokenizer.tokenize();
  if (API_DEBUG) console.log('[QueryParser] Tokens:', JSON.stringify(tokens));
  return new WhereParser(tokens).parse();
}

/**
 * Parse multiple WHERE parameters (combined with AND).
 */
export function parseMultipleWhereClauses(whereClauses: string[]): WhereGroup | WhereCondition {
  if (whereClauses.length === 0) return { type: 'AND', conditions: [] };
  if (whereClauses.length === 1) return parseWhereClause(whereClauses[0]);
  const conditions = whereClauses.map(c => parseWhereClause(c));
  return { type: 'AND', conditions };
}

/**
 * Flatten a condition tree into an array of leaf conditions.
 */
export function flattenConditions(node: WhereGroup | WhereCondition): WhereCondition[] {
  if (isWhereCondition(node)) return [node];
  const conditions: WhereCondition[] = [];
  for (const child of node.conditions) conditions.push(...flattenConditions(child));
  return conditions;
}
