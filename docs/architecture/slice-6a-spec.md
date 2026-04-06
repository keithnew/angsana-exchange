# Angsana Exchange — Slice 6A Specification

**Exchange API Layer & Auth Infrastructure**

Prepared by: Keith & Claude | Date: 6 April 2026 | Status: Implementation Ready

Depends on: Slices 1–5 (complete), angsana-platform shared API components  
Companion: Slice 6B (User & Client Lifecycle, Team Page, Admin Users Page)

---

## 1. Purpose & Scope

This slice delivers the general-purpose API layer for Angsana Exchange providing programmatic access to all Exchange Firestore collections through a consistent RESTful interface, following the URL pattern and query conventions from angsana-platform (Retool API pattern). It also establishes multi-method auth infrastructure serving internal automations, research team, Make.com, and eventually client systems.

**No UI is built in this slice. The API is the deliverable.**

### Deliverables

- General collection API — CRUD + flexible WHERE clause queries against all Exchange Firestore collections
- Multi-method auth middleware — Firebase ID tokens, API keys, client JWT placeholder
- Automatic client data scoping — auth-context-driven Firestore path scoping
- API key management infrastructure — Firestore collection for key metadata
- Firestore users collection — queryable display layer for user records
- Consistent URL pattern — `/api/v1/exchange/{env}/api/{collection}`

### Not Delivered

- No UI pages (Slice 6B)
- No purpose-built lifecycle endpoints (Slice 6B)
- No BQ-backed endpoints (future slice)
- No client JWT issuance/validation (slot exists, implementation deferred)
- No scoped API key permissions enforcement (schema ready, enforcement deferred)

## 2. Architecture

The Exchange API runs as Next.js API routes within the existing Exchange Cloud Run service. No separate deployment. Firebase Admin SDK already initialised.

### Shared Components from angsana-platform

- WHERE clause parser — `@angsana/query-utils` (extracted locally if not published)
- Pagination handler — limit, startAfter cursor, orderBy with direction
- Response formatter — consistent `{ documents, nextPageToken }` envelope

### Request Flow

1. Route matching → 2. Auth resolution → 3. Collection validation → 4. Client scoping → 5. Query execution → 6. Audit logging

## 3. URL Structure

```
/api/v1/exchange/{env}/api/{collection}
/api/v1/exchange/{env}/api/{collection}/{documentId}
```

### HTTP Methods

| Method | Collection Route | Document Route |
|--------|-----------------|----------------|
| GET | List documents | Get single document |
| POST | Create document | — |
| PUT | — | Full replace |
| PATCH | — | Partial merge |
| DELETE | — | Delete document |

### Exposed Collections

| Slug | Firestore Path | Scope |
|------|---------------|-------|
| campaigns | clients/{clientId}/campaigns | Client |
| checkins | clients/{clientId}/checkIns | Client |
| actions | clients/{clientId}/actions | Client |
| wishlists | clients/{clientId}/wishlists | Client |
| sowhats | clients/{clientId}/soWhats | Client |
| dnc | clients/{clientId}/dnc | Client |
| msapsl | clients/{clientId}/msaPsl | Client |
| users | users | Tenant |
| clients | clients | Tenant |
| apikeys | apiKeys | Tenant |
| managedlists | managedLists/{listType} | Tenant |

## 4. Auth Middleware

### ApiAuthContext Interface

```typescript
interface ApiAuthContext {
  method: 'firebase' | 'apiKey' | 'clientJwt';
  tenantId: string;
  role: 'client-viewer' | 'client-approver' | 'internal-user' | 'internal-admin';
  clientId?: string;
  assignedClients?: string[];
  userId?: string;
  keyId?: string;
  permissions: string[];
}
```

### Resolution Order

1. Firebase ID Token (`Authorization: Bearer {token}`) — `verifyIdToken()`
2. API Key (`x-api-key: {key}`) — SHA-256 hash lookup in Firestore
3. Client JWT — NOT IMPLEMENTED, returns `401 CLIENT_JWT_NOT_IMPLEMENTED`

### API Key Storage

Keys stored at `tenants/{tenantId}/apiKeys/{keyId}`. Raw key never stored — only SHA-256 hash. Validation: hash incoming key → query by hash + `status == active` → build auth context.

## 5. Firestore Users Collection

Path: `tenants/{tenantId}/users/{uid}` (document ID = Firebase Auth UID)

### Seed Data

| Email | Role | Client | Status |
|-------|------|--------|--------|
| keith@angsana.com | internal-admin | — (all clients) | active |
| mike@angsana.com | internal-user | assignedClients: [cegid-spain] | active |
| alessandro@cegid.com | client-approver | cegid-spain | active |
| monica@cegid.com | client-viewer | cegid-spain | active |

## 6. Query Parameters

Same as platform Retool API convention: `limit`, `startAfter`, `orderBy`, `where[]`, `clientId`.

## 7. Audit Logging

Every API call logged to `tenants/{tenantId}/apiLogs` — fire-and-forget, 90-day TTL.

## 8. Security

- Client isolation is infrastructure, not policy
- API keys are SHA-256 hashed, never stored in plaintext
- Collections are allowlisted — no wildcard access
- Write operations respect role constraints
- Client JWT slot explicitly rejects with clear error code

## 9. Implementation — Files Created

```
src/lib/api/types.ts                    — Type definitions
src/lib/api/config.ts                   — Configuration constants
src/lib/api/collections.ts              — Collection mapping
src/lib/api/middleware/auth.ts           — Multi-method auth
src/lib/api/middleware/audit.ts          — Audit logging
src/lib/api/query-parser.ts             — WHERE parser (from platform)
src/lib/api/firestore-query-builder.ts  — Query builder (from platform)
src/lib/api/pagination.ts               — Pagination handler
src/lib/api/response.ts                 — Response formatter
src/app/api/v1/exchange/[env]/api/[collection]/route.ts           — Collection CRUD
src/app/api/v1/exchange/[env]/api/[collection]/[documentId]/route.ts — Document CRUD
scripts/create-api-key.ts               — API key CLI tool
scripts/seed.ts                         — Extended with seedUsersCollection()
docs/api/exchange-api.md                — API documentation
```

---

*Source: angsana-exchange-slice-6a.docx*
