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
  --tag=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest
```

> **Note:** No `--build-arg` flags are needed. The `NEXT_PUBLIC_*` values are read automatically by Next.js from `.env.production` in the project root, which is copied into the Docker image during the build stage. These values are public by design — they appear in the browser JavaScript. They are Firebase client config, not secrets.

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
  --cpu-boost \
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

### Approach: Firebase Hosting as Reverse Proxy

Cloud Run domain mappings are not supported in `europe-west2`. Instead, we use Firebase Hosting as a reverse proxy — the same pattern used for `api.angsana-uk.com` on the platform router.

**How it works:** Firebase Hosting receives requests on `exchange.angsana-uk.com`, then proxies all traffic to the Cloud Run service via the rewrite rule in `firebase.json`:

```json
{
  "hosting": {
    "public": "public",
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "angsana-exchange",
          "region": "europe-west2"
        }
      }
    ]
  }
}
```

### Deploy Firebase Hosting

```bash
firebase deploy --only hosting --project angsana-exchange
```

### Connect Custom Domain

Add the custom domain via the Firebase console:
1. Go to Firebase console → Hosting → Custom domains
2. Add `exchange.angsana-uk.com`
3. Firebase will provide DNS records (A records) to add at GoDaddy
4. Add the DNS records at GoDaddy for `exchange.angsana-uk.com`
5. Wait for DNS propagation and TLS auto-provisioning

| Property | Value |
|----------|-------|
| Domain | `exchange.angsana-uk.com` |
| Routing | Firebase Hosting → Cloud Run (rewrite) |
| TLS | Auto-provisioned by Firebase Hosting |
| DNS records | `TODO: Record after domain setup` |

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
├── Dockerfile                 # Multi-stage build (NEXT_PUBLIC_* read from .env.production)
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

# Check Firebase Hosting
firebase hosting:sites:list --project angsana-exchange

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
     --tag=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:latest
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
     --cpu-boost \
     --set-env-vars="FIREBASE_PROJECT_ID=angsana-exchange,GCP_PROJECT_ID=angsana-exchange,GCP_REGION=europe-west2,NODE_ENV=production"
   ```

3. Verify:
   ```bash
   curl -s https://exchange.angsana-uk.com/api/health | jq .
   ```

4. Smoke test: log in with keith@angsana.com, verify campaigns load.

---

## Firebase Auth Email (Custom SMTP)

Firebase Auth emails (password reset invitations, email verification) are sent via Google Workspace SMTP relay using a custom sender address.

### Firebase Console SMTP Settings

Configured in **Firebase Console → Authentication → Templates → SMTP settings**:

| Setting | Value |
|---------|-------|
| Sender address | `noreply@angsana-uk.com` |
| SMTP server host | `smtp-relay.gmail.com` |
| SMTP server port | `587` |
| SMTP account username | Ryan Bronstein's Google Workspace email |
| SMTP account password | App Password (generated via Google Account → App Passwords) |
| SMTP security mode | `STARTTLS` |

### Google Workspace SMTP Relay

Configured in **Google Workspace Admin → Apps → Google Workspace → Gmail → Routing → SMTP relay service**:

| Rule | Description | Auth Method |
|------|-------------|-------------|
| Firebase Auth emails | For Firebase password reset/invite emails | SMTP Authentication + Require TLS |

### Prerequisites

- Ryan's Google Workspace account must have **2-Step Verification enabled** (enabled in Google Workspace Admin → Security → Authentication → 2-step verification)
- An **App Password** must be generated from Ryan's account at `https://myaccount.google.com/apppasswords`
- The `noreply@angsana-uk.com` group alias must exist in Google Workspace

### How It Works

1. User is invited via Exchange UI → API creates Firebase Auth user → calls `sendOobCode` REST API
2. Firebase Auth sends password reset email using the custom SMTP settings
3. Email goes through `smtp-relay.gmail.com` authenticated with Ryan's App Password
4. Email arrives from `noreply@angsana-uk.com` (not the default Firebase sender)

### Code Reference

The invitation email is triggered by `src/lib/firebase/send-password-reset.ts` which calls the Firebase Identity Toolkit REST API (`sendOobCode`) rather than the Admin SDK's `generatePasswordResetLink`. This approach lets Firebase handle SMTP delivery using the custom SMTP configuration above.

### If App Password Expires or Needs Rotation

1. Sign in as Ryan → `https://myaccount.google.com/apppasswords`
2. Revoke old password and create a new one
3. Update the password in **Firebase Console → Authentication → Templates → SMTP settings**

---

## What's Not Included (Future)

| Item | Status | Notes |
|------|--------|-------|
| CI/CD automation | Deferred | No Cloud Build triggers or GitHub Actions yet |
| Staging environment | Deferred | Single production deployment for now |
| Cloud Armor (WAF) | Deferred | Add if traffic patterns warrant it |
| User provisioning automation | Deferred | Users created manually via Firebase console |
| Custom error pages | Deferred | Next.js default error handling for now |
