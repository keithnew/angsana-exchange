# Angsana Exchange API

**Slice 6A** — Exchange API Layer & Auth Infrastructure

## Overview

The Exchange API provides programmatic CRUD access to all Exchange Firestore collections through a consistent RESTful interface. It follows the same URL pattern and query conventions established in angsana-platform's Retool API.

## Base URL

```
https://exchange.angsana-uk.com/api/v1/exchange/{env}/api/{collection}
```

Where `{env}` is `prod` or `dev`.

## Authentication

The API supports three authentication methods, checked in order:

### 1. Firebase ID Token (UI callers)

```
Authorization: Bearer {firebase-id-token}
```

Used by the Exchange UI. The token's custom claims provide role, clientId, and tenantId.

### 2. API Key (automation callers)

```
x-api-key: {api-key}
```

Used by Make.com, research team automations, and programmatic callers. Keys are hashed with SHA-256 and validated against the `apiKeys` Firestore collection.

### 3. Client JWT (future)

Not yet implemented. Returns `401 CLIENT_JWT_NOT_IMPLEMENTED`.

## Endpoints

### Collection-Level

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/exchange/{env}/api/{collection}` | List documents with queries |
| `POST` | `/api/v1/exchange/{env}/api/{collection}` | Create a new document |

### Document-Level

| Method   | Path | Description |
|----------|------|-------------|
| `GET`    | `/api/v1/exchange/{env}/api/{collection}/{documentId}` | Get single document |
| `PUT`    | `/api/v1/exchange/{env}/api/{collection}/{documentId}` | Full replace |
| `PATCH`  | `/api/v1/exchange/{env}/api/{collection}/{documentId}` | Partial merge |
| `DELETE` | `/api/v1/exchange/{env}/api/{collection}/{documentId}` | Delete document |

## Available Collections

| Slug | Scope | Firestore Path |
|------|-------|----------------|
| `campaigns` | Client | `clients/{clientId}/campaigns` |
| `checkins` | Client | `clients/{clientId}/checkIns` |
| `actions` | Client | `clients/{clientId}/actions` |
| `wishlists` | Client | `clients/{clientId}/wishlists` |
| `sowhats` | Client | `clients/{clientId}/soWhats` |
| `dnc` | Client | `clients/{clientId}/dnc` |
| `msapsl` | Client | `clients/{clientId}/msaPsl` |
| `users` | Tenant | `users` |
| `clients` | Tenant | `clients` |
| `apikeys` | Tenant | `apiKeys` (internal-admin only) |
| `managedlists` | Tenant | `managedLists/{listType}` (requires `listType` param) |

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Max documents to return (max 1000) |
| `startAfter` | string | — | Pagination cursor from previous response |
| `orderBy` | string | — | Sort field with optional direction (e.g. `createdAt:desc`) |
| `where` | string[] | — | Filter conditions (multiple combined with AND) |
| `clientId` | string | — | Client ID for client-scoped collections |
| `listType` | string | — | Required for `managedlists` collection |

## WHERE Clause Syntax

```
where=status==active                           # Equality
where=createdAt>=2026-01-01T00:00:00.000Z     # Range (URL-encode >= as %3E%3D)
where=config.tier==premium                     # Nested field
where=status:in:new,under-review              # IN list
where=(status==active OR status==draft)        # OR group
where=companyName contains "Acme"             # Contains (client-side filter)
```

Multiple `where` parameters are combined with AND.

## Response Formats

### List Response

```json
{
  "documents": [
    { "id": "doc-id", "data": { ... } }
  ],
  "nextPageToken": "cursor" | null
}
```

### Single Document

```json
{
  "data": { "id": "doc-id", ... }
}
```

### Create Response

```json
{ "id": "generated-doc-id" }
```

### Update / Delete Response

```json
{ "success": true, "updated": "doc-id" }
```

### Error Response

```json
{ "error": "Human-readable message", "code": "ERROR_CODE" }
```

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_COLLECTION` | Unknown collection slug |
| 400 | `INVALID_QUERY` | Malformed WHERE clause |
| 400 | `CLIENT_ID_REQUIRED` | Client-scoped collection without clientId |
| 400 | `CLIENT_ACCESS_DENIED` | User doesn't have access to this client |
| 401 | `UNAUTHORIZED` | No valid credentials |
| 401 | `CLIENT_JWT_NOT_IMPLEMENTED` | Client JWT auth not yet available |
| 401 | `API_KEY_REVOKED` | API key has been revoked |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Document doesn't exist |
| 500 | `INTERNAL_ERROR` | Server error |

## Client Scoping

For client-scoped collections, the clientId is resolved in priority order:

1. **Auth context** — if the caller has a clientId in their auth context (client users, client-scoped API keys), it's used and cannot be overridden
2. **Query parameter** — for internal users, `clientId` query parameter specifies which client's data to access
3. **assignedClients check** — internal-user role must have the requested clientId in their `assignedClients` array

## Example Queries

```bash
# Get all active campaigns for a client
curl -H "x-api-key: {key}" \
  "https://exchange.angsana-uk.com/api/v1/exchange/prod/api/campaigns?clientId=cegid-spain&where=status==active"

# Get wishlist items not yet allocated
curl -H "x-api-key: {key}" \
  "https://exchange.angsana-uk.com/api/v1/exchange/prod/api/wishlists?clientId=cegid-spain&where=status:in:new,under-review"

# Get all users who haven't logged in
curl -H "x-api-key: {key}" \
  "https://exchange.angsana-uk.com/api/v1/exchange/prod/api/users?where=status==invited"

# Get managed list items
curl -H "x-api-key: {key}" \
  "https://exchange.angsana-uk.com/api/v1/exchange/prod/api/managedlists?listType=serviceTypes"

# Create a new action
curl -X POST -H "x-api-key: {key}" -H "Content-Type: application/json" \
  -d '{"title":"Review target list","assignedTo":"Mike Cole","status":"open","priority":"medium"}' \
  "https://exchange.angsana-uk.com/api/v1/exchange/prod/api/actions?clientId=cegid-spain"
```

## Audit Logging

Every API call is logged to `tenants/{tenantId}/apiLogs` with:
- Timestamp, HTTP method, collection, document ID
- Auth method, caller identity, caller role
- Client scope, status code, error code (if any)
- Logs have a 90-day TTL

## API Key Management

### Creating Keys

```bash
npx tsx scripts/create-api-key.ts \
  --name "Make.com Production" \
  --role internal-admin \
  --tenant angsana
```

The raw key is displayed once and never stored. Store it in a password manager.

### Key Properties

- **role** — determines what the key can access (same roles as users)
- **clientId** — if set, key is scoped to one client only
- **status** — `active` or `revoked`

### List All Keys

See all keys for a tenant, their status, role, and last usage:

```bash
cd angsana-exchange
npx tsx scripts/list-api-keys.ts
npx tsx scripts/list-api-keys.ts --tenant angsana
npx tsx scripts/list-api-keys.ts --status active       # only active keys
```

This shows key IDs, names, roles, client scope, creation date, and last-used timestamp. Raw key values are **never** shown (they're not stored — only the SHA-256 hash is kept).

### Revoke a Key

To immediately disable a key so it can no longer authenticate:

```bash
cd angsana-exchange
npx tsx scripts/revoke-api-key.ts --keyId <KEY_ID>
npx tsx scripts/revoke-api-key.ts --keyId DnOSS7FrITXpmRNrt1BV --tenant angsana
```

**What happens on revocation:**
- The key's `status` is set to `revoked` in Firestore
- The `revokedAt` timestamp and `revokedBy` fields are set
- **Effect is immediate** — next API call using that key gets `401 API_KEY_REVOKED`
- The key hash remains in Firestore for audit purposes (it is never deleted)
- The raw key value was never stored, so there is nothing to clean up

**To find the key ID:** Run `npx tsx scripts/list-api-keys.ts` first.

### Replace a Compromised Key (Rotate)

There is no "rotate" command. The process is:

1. **Create a new key** with the same name/role/scope
2. **Update all callers** (Make.com, research scripts, etc.) to use the new key
3. **Revoke the old key** once all callers are migrated

```bash
# Step 1: Create replacement
npx tsx scripts/create-api-key.ts --name "Make.com Production" --role internal-admin --tenant angsana
# → Copy the raw key shown. Store in password manager.

# Step 2: Update callers with the new key

# Step 3: Revoke old key
npx tsx scripts/revoke-api-key.ts --keyId <OLD_KEY_ID>
```

### Security Model

- Raw keys are **shown once at creation** and **never stored**. Only the SHA-256 hash is kept in Firestore.
- Lost keys **cannot be recovered**. Revoke and create a new one.
- Revoked keys remain in Firestore (for audit trail) but are rejected immediately.
- All API key usage is logged in the `apiLogs` collection (caller, collection, operation, timestamp).
- Keys are scoped by `role` (same permission model as users) and optionally by `clientId`.

### Typical Key Inventory

| Key Name | Role | Scope | Used By |
|----------|------|-------|---------|
| Internal Operations | internal-admin | All clients | Cline, ad-hoc queries |
| Make.com Production | internal-admin | All clients | Make.com automations |
| Research Team | internal-user | Assigned clients | Research team scripts |
| Client System (future) | client-viewer | Single client | Client's own integrations |

## File Structure

```
src/lib/api/
├── types.ts                    # ApiAuthContext and related types
├── config.ts                   # Tenant ID, debug flag
├── collections.ts              # Collection slug → Firestore path mapping
├── query-parser.ts             # WHERE clause parser (from platform)
├── firestore-query-builder.ts  # Firestore query construction
├── pagination.ts               # Pagination handler
├── response.ts                 # Response envelope formatter
└── middleware/
    ├── auth.ts                 # Multi-method auth middleware
    └── audit.ts                # Audit logging

src/app/api/v1/exchange/[env]/api/
├── [collection]/
│   └── route.ts                # GET (list) + POST (create)
└── [collection]/[documentId]/
    └── route.ts                # GET, PUT, PATCH, DELETE

scripts/
├── create-api-key.ts           # Create a new API key
├── revoke-api-key.ts           # Revoke an existing key (immediate)
├── list-api-keys.ts            # List all keys with status and metadata
└── seed.ts                     # Extended with seedUsersCollection()
```

## Shared Components

The query parser and Firestore query builder are extracted from `@angsana_consulting/api-core`. Source paths documented in file headers. When the platform packages are published as standalone npm packages, these local copies should be replaced with proper imports.
