# Infrastructure Setup: angsana-exchange

Record of the GCP project provisioning and Cloud Run deployment for Angsana Exchange. This documents what was set up, when, and the exact commands used — serving as both a reference and a runbook for reproducing or auditing the setup.

---

## Project Details

| Property | Value |
|----------|-------|
| Project ID | `angsana-exchange` |
| Project Number | `33083036927` |
| Organisation | `angsana-uk.com` |
| Region | `europe-west2` (London) |
| Created by | Keith |
| Firebase project | Linked (Firestore + Auth) |

---

## Billing

Linked to the same billing account as dialer-lab, angsana-platform, and angsana-core-prod:

| Billing Account | Name | Shared With |
|----------------|------|-------------|
| `017537-4BDACE-E65B71` | Firebase Payment | dialer-lab, angsana-platform, angsana-core-prod, angsana-exchange |

---

## APIs Enabled

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project=angsana-exchange
```

| API | Purpose |
|-----|---------|
| `firestore.googleapis.com` | Document database (enabled via Firebase) |
| `run.googleapis.com` | Cloud Run hosting |
| `artifactregistry.googleapis.com` | Docker image registry |
| `cloudbuild.googleapis.com` | Building Docker images |
| `secretmanager.googleapis.com` | SA key for local dev |

---

## Firestore Database

Created via Firebase console (auto-provisioned with Firebase project).

| Property | Value |
|----------|-------|
| Location | `europe-west2` (London) |
| Mode | Firestore Native |
| Database | `(default)` |

---

## Artifact Registry

```bash
gcloud artifacts repositories create exchange-images \
  --project=angsana-exchange \
  --repository-format=docker \
  --location=europe-west2 \
  --description="Angsana Exchange Docker images"
```

| Property | Value |
|----------|-------|
| Repository | `exchange-images` |
| Location | `europe-west2` |
| Format | Docker |
| Image path | `europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange` |

### Image Tagging Convention

```
europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest
europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:v1.0.0
europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:<git-sha>
```

---

## Service Accounts

No custom service accounts needed. Exchange talks to its own Firestore in the same project — Application Default Credentials handle auth automatically.

| Account | Email | Purpose |
|---------|-------|---------|
| Default Compute SA | (auto-created) | Cloud Run runtime — ADC for Firestore |
| App Engine Default | `angsana-exchange@appspot.gserviceaccount.com` | Firebase Admin (auto-created with Firebase) |
| Cloud Build SA | (auto-created) | Image building |

---

## Secrets (Secret Manager)

| Secret Name | Purpose | Used By |
|-------------|---------|---------|
| `firebase-admin-sa-key` | Firebase Admin SDK service account key | Local development only |

> On Cloud Run, no SA key is needed — Application Default Credentials are used via the metadata service. The `admin.ts` code handles both paths automatically.

---

## Cloud Run Service

### Build & Push Image

```bash
# From the angsana-exchange repo root:
gcloud builds submit \
  --project=angsana-exchange \
  --region=europe-west2 \
  --tag=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest \
  --build-arg=NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyAZ2V2si0JRo0T7lFZDdS-Gudk0WtgttJo \
  --build-arg=NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=angsana-exchange.firebaseapp.com \
  --build-arg=NEXT_PUBLIC_FIREBASE_PROJECT_ID=angsana-exchange \
  --build-arg=NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=angsana-exchange.firebasestorage.app \
  --build-arg=NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=33083036927 \
  --build-arg=NEXT_PUBLIC_FIREBASE_APP_ID=1:33083036927:web:80d54dd51a99ad1ed8e8ca
```

> **Note:** NEXT_PUBLIC_* values are public by design — they appear in the browser JavaScript. They are Firebase client config, not secrets.

### Deploy to Cloud Run

```bash
gcloud run deploy angsana-exchange \
  --project=angsana-exchange \
  --region=europe-west2 \
  --image=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --timeout=60 \
  --concurrency=80 \
  --startup-cpu-boost \
  --startup-probe-path=/api/health \
  --startup-probe-period=10 \
  --startup-probe-failure-threshold=3 \
  --set-env-vars="FIREBASE_PROJECT_ID=angsana-exchange,GCP_PROJECT_ID=angsana-exchange,GCP_REGION=europe-west2,NODE_ENV=production"
```

### Cloud Run Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Memory | 512Mi | Adequate for Next.js SSR |
| CPU | 1 | Single CPU sufficient for current load |
| Min instances | 0 | Scale to zero when idle (cost saving) |
| Max instances | 5 | Prevents runaway scaling from bot traffic |
| Timeout | 60s | Prevents slow-loris style attacks |
| Concurrency | 80 | Default, appropriate for Next.js |
| Port | 8080 | Standard Cloud Run port |
| Auth | `--allow-unauthenticated` | Web app — browsers must reach it. Auth at Layer 2 (JWT middleware) |

### Runtime Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `FIREBASE_PROJECT_ID` | `angsana-exchange` | Firebase Admin SDK project |
| `GCP_PROJECT_ID` | `angsana-exchange` | GCP project for service discovery |
| `GCP_REGION` | `europe-west2` | Region for resource location |
| `NODE_ENV` | `production` | Next.js production mode |

### What Is NOT Needed on Cloud Run

- **GOOGLE_APPLICATION_CREDENTIALS** — Cloud Run uses ADC via the metadata service
- **firebase-admin-sa-key** — only for local development
- **Firestore database URL** — auto-discovered in the same project

---

## Custom Domain

### Domain Mapping

```bash
gcloud run domain-mappings create \
  --service=angsana-exchange \
  --domain=exchange.angsana-uk.com \
  --project=angsana-exchange \
  --region=europe-west2
```

After running, add the output DNS records (CNAME or A records) at the domain registrar for `exchange.angsana-uk.com`.

| Property | Value |
|----------|-------|
| Domain | `exchange.angsana-uk.com` |
| TLS | Auto-provisioned by Cloud Run |
| DNS records | `TODO: Record after domain mapping creation` |

### Firebase Auth Authorised Domains

**Critical:** Add `exchange.angsana-uk.com` to the Firebase Auth authorised domains list in the Firebase console (Authentication → Settings → Authorised domains). Without this, Firebase Auth sign-in will fail on the production domain.

Also add the raw Cloud Run URL (`angsana-exchange-HASH-nw.a.run.app`) for break-glass scenarios.

---

## Security Model

### Three-Layer Auth

| Layer | Mechanism | What It Does |
|-------|-----------|--------------|
| Layer 1: Network | Cloud Run (`--allow-unauthenticated`) | Allows browsers to reach the service |
| Layer 2: Application | Next.js middleware (`middleware.ts`) | Validates Firebase Auth JWT on every request |
| Layer 3: Data | Firestore security rules | Enforces clientId scoping at database layer |

### Hardening

| Measure | Status | Notes |
|---------|--------|-------|
| Firebase Auth brute-force protection | `TODO: Verify` | Account lockout after repeated failures (on by default) |
| Firebase Auth rate limiting | `TODO: Verify` | Rate limiting on sign-in endpoint |
| Email enumeration protection | `TODO: Enable` | Prevents discovery of registered email addresses |
| Cloud Run max instances | Configured (5) | Prevents runaway scaling |
| Cloud Run timeout | Configured (60s) | Prevents slow-loris attacks |

---

## Monitoring Alerts

Configure in Cloud Monitoring console:

| Alert | Condition | Action |
|-------|-----------|--------|
| High request volume | >1000 requests/minute on Exchange Cloud Run | Email keith |
| Elevated auth failures | High rate of 401/403 responses | Email keith |
| Instance count near max | Cloud Run instances approaching 5 | Email keith |

`TODO: Record alert policy IDs after creation`

---

## Health Check

| Endpoint | Path | Auth |
|----------|------|------|
| Health check | `/api/health` | Public (excluded from JWT middleware) |

```bash
# Test health check
curl -s https://exchange.angsana-uk.com/api/health | jq .
# Expected: {"status":"healthy","service":"angsana-exchange","timestamp":"...","version":"..."}
```

---

## Platform Router Integration

Exchange is registered in the platform router (`routes.json`) for future service-to-service API calls:

| Route | URL Pattern | Auth |
|-------|-------------|------|
| Health | `/api/v1/exchange/prod/health` | public |

The backend URL in routes.json is set to `PLACEHOLDER-CLOUD-RUN-URL` — update with the actual Cloud Run URL after first deployment.

---

## Raw Cloud Run URL (Break-Glass)

```
TODO: Record after first deployment
Format: angsana-exchange-HASH-nw.a.run.app
```

This URL does not change unless the Cloud Run service is deleted and recreated. Keep it documented for emergency DNS bypass. See [break-glass.md](./break-glass.md).

---

## Local Code Structure

```
angsana-exchange/
├── Dockerfile                 # Multi-stage build with NEXT_PUBLIC_* build args
├── .dockerignore              # Excludes node_modules, .next, .env, SA keys
├── next.config.ts             # output: 'standalone' for Docker builds
├── firebase.json              # Firebase config (Firestore rules, indexes)
├── firestore.rules            # Firestore security rules (clientId scoping)
├── firestore.indexes.json     # Composite indexes
├── src/
│   ├── middleware.ts           # JWT validation — the real security boundary
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/route.ts         # Health check (public)
│   │   │   ├── auth/session/route.ts   # Session cookie management
│   │   │   └── clients/[clientId]/     # Client-scoped API routes
│   │   ├── (auth)/login/               # Login page
│   │   └── (dashboard)/               # Authenticated pages
│   ├── lib/
│   │   └── firebase/
│   │       ├── admin.ts        # Firebase Admin SDK (ADC on Cloud Run)
│   │       └── client.ts       # Firebase Client SDK (browser)
│   └── components/             # UI components
├── docs/
│   ├── architecture/           # Architecture docs
│   └── operations/             # Runbooks (this file, break-glass)
└── scripts/
    └── seed.ts                 # Development data seeding
```

---

## Verification Commands

```bash
# Check Artifact Registry
gcloud artifacts repositories describe exchange-images \
  --project=angsana-exchange \
  --location=europe-west2

# List images
gcloud artifacts docker images list \
  europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange \
  --project=angsana-exchange

# Check Cloud Run service
gcloud run services describe angsana-exchange \
  --project=angsana-exchange \
  --region=europe-west2

# Check domain mapping
gcloud run domain-mappings describe \
  --domain=exchange.angsana-uk.com \
  --project=angsana-exchange \
  --region=europe-west2

# Check enabled APIs
gcloud services list --project=angsana-exchange --enabled

# Test health check
curl -s https://exchange.angsana-uk.com/api/health | jq .

# Test via platform router
curl -s https://api.angsana-uk.com/api/v1/exchange/prod/health | jq .
```

---

## Deployment Checklist (Manual — No CI/CD Yet)

For each deployment:

1. Build and push:
   ```bash
   gcloud builds submit \
     --project=angsana-exchange \
     --region=europe-west2 \
     --tag=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest \
     --build-arg=NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyAZ2V2si0JRo0T7lFZDdS-Gudk0WtgttJo \
     --build-arg=NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=angsana-exchange.firebaseapp.com \
     --build-arg=NEXT_PUBLIC_FIREBASE_PROJECT_ID=angsana-exchange \
     --build-arg=NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=angsana-exchange.firebasestorage.app \
     --build-arg=NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=33083036927 \
     --build-arg=NEXT_PUBLIC_FIREBASE_APP_ID=1:33083036927:web:80d54dd51a99ad1ed8e8ca
   ```

2. Deploy:
   ```bash
   gcloud run deploy angsana-exchange \
     --project=angsana-exchange \
     --region=europe-west2 \
     --image=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest \
     --platform=managed \
     --allow-unauthenticated \
     --port=8080 \
     --memory=512Mi \
     --cpu=1 \
     --min-instances=0 \
     --max-instances=5 \
     --timeout=60 \
     --concurrency=80 \
     --startup-cpu-boost \
     --startup-probe-path=/api/health \
     --startup-probe-period=10 \
     --startup-probe-failure-threshold=3 \
     --set-env-vars="FIREBASE_PROJECT_ID=angsana-exchange,GCP_PROJECT_ID=angsana-exchange,GCP_REGION=europe-west2,NODE_ENV=production"
   ```

3. Verify:
   ```bash
   curl -s https://exchange.angsana-uk.com/api/health | jq .
   ```

4. Smoke test: log in with keith@angsana.com, verify campaigns load.

---

## What's Not Included (Future)

| Item | Status | Notes |
|------|--------|-------|
| CI/CD automation | Deferred | No Cloud Build triggers or GitHub Actions yet |
| Staging environment | Deferred | Single production deployment for now |
| Cloud Armor (WAF) | Deferred | Add if traffic patterns warrant it |
| User provisioning automation | Deferred | Users created manually via Firebase console |
| Custom error pages | Deferred | Next.js default error handling for now |
