# Slice 7A — Step 1: Google Drive API Connectivity & Browse Endpoint

**Status:** Implemented  
**Date:** 7 April 2026  
**Depends on:** Slices 1–6B (all complete)

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/drive/types.ts` | `DriveItem` type definition |
| `src/lib/drive/client.ts` | Drive API client init (lazy, reuses SA credentials) |
| `src/lib/drive/browse.ts` | `listFolderContents()` + `isWithinClientFolder()` parent-chain walk |
| `src/app/api/clients/[clientId]/documents/browse/route.ts` | GET endpoint for browsing |

## Dependencies Added

- `googleapis@171.4.0` — official Google API client library

## API Endpoint

```
GET /api/clients/{clientId}/documents/browse[?folderId={subfolderId}]
```

### Auth
- Internal roles only (`internal-admin`, `internal-user`)
- Client roles return 403 (opened in Step 6)
- Client access scoping enforced via middleware headers

### Response Shape
```json
{
  "success": true,
  "data": {
    "folderId": "...",
    "items": [{ "id", "name", "mimeType", "isFolder", "size", "modifiedTime", "createdTime", "iconLink" }],
    "count": 2
  }
}
```

### Security
- Parent-chain walk (max 5 levels) prevents lateral folder traversal
- No `webViewLink` exposed — Exchange wraps Drive completely

## Prerequisites (Manual by Keith)

1. Enable Google Drive API on `angsana-exchange` GCP project
2. Share Cegid Spain folder (`1ZlJtt0G2-N2L9n_s36dpY-fyJHbu4Yik`) with SA as Editor
3. Set `driveFolderId` on `tenants/angsana/clients/cegid-spain/config` in Firestore
