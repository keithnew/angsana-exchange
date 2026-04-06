# Break-Glass Runbook: Angsana Exchange

Emergency procedures for Angsana Exchange service failures.

**Last updated:** April 2026
**Service:** `angsana-exchange` Cloud Run (europe-west2)
**Public domain:** `exchange.angsana-uk.com`
**Raw Cloud Run URL:** `TODO: Record after first deployment (format: angsana-exchange-HASH-nw.a.run.app)`

---

## Quick Reference

| What | Where |
|------|-------|
| Cloud Run console | [Console](https://console.cloud.google.com/run/detail/europe-west2/angsana-exchange/metrics?project=angsana-exchange) |
| Cloud Run logs | [Logs Explorer](https://console.cloud.google.com/logs?project=angsana-exchange) |
| Firebase Auth console | [Firebase Console](https://console.firebase.google.com/project/angsana-exchange/authentication) |
| Firestore console | [Firebase Console](https://console.firebase.google.com/project/angsana-exchange/firestore) |
| GCP status page | [status.cloud.google.com](https://status.cloud.google.com) |
| Domain registrar | Check DNS records for `exchange.angsana-uk.com` |

---

## Failure Modes

### 1. Custom Domain DNS Failure

**Symptom:** `exchange.angsana-uk.com` returns DNS errors, but the raw Cloud Run URL loads correctly.

**Impact:** Users cannot access Exchange via the production URL.

**Severity:** Medium — service is running, only the DNS path is broken.

**Recovery:**
1. Verify the raw Cloud Run URL still works — open it in a browser and confirm the login page loads.
2. **Communicate:** Email affected clients the temporary direct URL.
3. **Investigate:**
   - Check DNS records at the domain registrar — confirm CNAME/A records for `exchange.angsana-uk.com` are correct.
   - Check Cloud Run domain mapping status:
     ```bash
     gcloud run domain-mappings describe \
       --domain=exchange.angsana-uk.com \
       --project=angsana-exchange \
       --region=europe-west2
     ```
4. **Restore:** Once DNS propagates, confirm `exchange.angsana-uk.com` resolves and test login.

> **Note:** Firebase Auth may reject sign-in on the raw Cloud Run URL if it's not in the authorised domains list. If so, add it temporarily in the Firebase console under Authentication → Settings → Authorised domains.

---

### 2. Cloud Run Service Down

**Symptom:** App unreachable on both the custom domain and the raw Cloud Run URL. Health check returns errors.

**Impact:** Complete outage — no users can access Exchange.

**Severity:** High.

**Recovery:**
1. **Check health:**
   ```bash
   curl -s https://CLOUD-RUN-URL/api/health | jq .
   ```
2. **Check logs:**
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=angsana-exchange" \
     --project=angsana-exchange \
     --limit=50 \
     --format="table(timestamp, severity, textPayload)"
   ```
3. **Check Cloud Run status:**
   ```bash
   gcloud run services describe angsana-exchange \
     --project=angsana-exchange \
     --region=europe-west2
   ```
4. **Redeploy from last known good image:**
   ```bash
   # List available images
   gcloud artifacts docker images list \
     europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange \
     --project=angsana-exchange

   # Redeploy specific tag
   gcloud run deploy angsana-exchange \
     --project=angsana-exchange \
     --region=europe-west2 \
     --image=europe-west2-docker.pkg.dev/angsana-exchange/exchange-images/exchange:<known-good-tag>
   ```
5. If persistent, check [GCP Status Page](https://status.cloud.google.com).

---

### 3. Firebase Auth Outage

**Symptom:** Login page loads, but sign-in attempts fail. Firebase Auth SDK returns errors. This is a Google-wide issue.

**Impact:** Users cannot log in. Existing sessions continue working until their JWT expires (typically 1 hour).

**Severity:** High, but no local action possible.

**Recovery:**
1. **Confirm it's a Firebase issue:** Check [GCP Status Page](https://status.cloud.google.com) and [Firebase Status](https://status.firebase.google.com).
2. **Do not redeploy** — this is not a code issue.
3. **Communicate to clients:** Explain the situation, note that already-logged-in users can continue working until their session expires.
4. **Wait for Google to recover.**

> Existing sessions work because the JWT is validated locally by the Firebase Admin SDK against Google's public keys (cached). The Auth service outage only affects new sign-ins.

---

### 4. Firestore Outage

**Symptom:** App loads and login works, but data pages show errors or empty states. API calls return 500 errors.

**Impact:** App is functional for navigation but data is unavailable.

**Severity:** High, but no local action possible.

**Recovery:**
1. **Confirm it's a Firestore issue:** Check [GCP Status Page](https://status.cloud.google.com).
2. **Check Firestore status:**
   ```bash
   gcloud firestore databases describe --project=angsana-exchange
   ```
3. **Wait for recovery** — Firestore is a Google-managed service.
4. **Communicate to clients** if the outage persists beyond 15 minutes.

---

### 5. TLS Certificate Failure

**Symptom:** Browser shows certificate warning or ERR_CERT_AUTHORITY_INVALID for `exchange.angsana-uk.com`.

**Impact:** Users see security warnings, some browsers may refuse to connect.

**Severity:** Medium.

**Recovery:**
1. Cloud Run auto-provisions and auto-renews TLS certificates. If the cert has expired, check the domain mapping:
   ```bash
   gcloud run domain-mappings describe \
     --domain=exchange.angsana-uk.com \
     --project=angsana-exchange \
     --region=europe-west2
   ```
2. If the certificate is in a failed state, delete and recreate the domain mapping:
   ```bash
   gcloud run domain-mappings delete \
     --domain=exchange.angsana-uk.com \
     --project=angsana-exchange \
     --region=europe-west2

   gcloud run domain-mappings create \
     --service=angsana-exchange \
     --domain=exchange.angsana-uk.com \
     --project=angsana-exchange \
     --region=europe-west2
   ```
3. Wait for TLS provisioning (can take up to 15 minutes).
4. In the meantime, direct users to the raw Cloud Run URL.

---

## Emergency Contacts

| Role | Contact |
|------|---------|
| Platform owner | keith@angsana.com |

---

## Post-Incident

After any incident:
1. Update this runbook if a new failure mode was discovered.
2. Record the incident timeline and resolution in a brief post-mortem.
3. Consider whether monitoring alerts need adjustment.
