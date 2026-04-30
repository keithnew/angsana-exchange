# Angsana Event Publisher Pattern

**v0.1 — Platform pattern document**

| Field        | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Status       | Draft for review                                                                            |
| Audience     | Cline (immediate implementation reference for Exchange R2 PVS slices); future agents implementing event emission anywhere on the platform; LGaaS architecture review |
| Date         | April 2026                                                                                  |
| Supersedes   | Nothing — first formal pattern document on this topic                                        |
| Related      | Capabilities and API Surface Note v0.2 §4.2 (events-first principle); Core Multi-Tenancy Spec; Refinery Lead Record and Identity Binding Architecture v0.1; Exchange R2 Prospecting Validation Surfaces v0.1 |

> This is the in-tree mirror of the platform pattern document. It is committed
> alongside the slice spec it governs so that the implementation reference is
> grounded in the repo. The authoritative copy lives at LGaaS level.

---

## 1. What this document is

A pattern document. It specifies the shape of event emission across Angsana platform components — the envelope structure, the type vocabulary, the local-publisher pattern that pre-figures the platform event bus, and the migration story when the platform bus ships. It exists because four-plus consumers are about to emit events in quick succession (the four R2 Prospecting Validation Surfaces in Exchange, then Refinery canonicalisation, then platform reference data mutations) and a settled pattern saves multiple iterations of judgement calls.

The pattern is not the implementation of the platform event bus. The platform bus is part of Phase 1 (BSP-01-13 onward, the Platform API v1 surface). Until that lands, components emit events through a local "publisher-lite" module that conforms to the same envelope and uses the same vocabulary. When the platform bus ships, the publisher-lite's body re-points; call sites do not change. This is the same architectural discipline used by the curatorial sub-module's reference-data reader (single re-point site) and applied here at the event-emission boundary.

### 1.1 Why the pattern is settled now

Cline's review of the Exchange Wishlists slice (R2 PVS first deliverable) surfaced that Exchange has no existing event publisher; the apiLogs middleware that was thought to fill the role is audit-shaped, not event-shaped. The instinct to invent a publisher locally for the Wishlists slice was sound, but applying that invention four times across the four PVS surfaces (and again for Refinery) would produce four small variations that future agents would have to reconcile. Settling the pattern now means each subsequent component picks up the same shape rather than re-inventing it.

The platform-level commitments this pattern depends on — the Capabilities and API Surface Note v0.2 §4.2 events-first principle, the tenant boundary discipline from the Core Multi-Tenancy Spec — are settled. The pattern is the application of those commitments at the emission point.

## 2. The publisher-lite pattern

### 2.1 The single function

Every Angsana component that emits events does so through a single local module that exposes one function:

```ts
publishEvent({ eventType, payload, tenantId, clientId, actorUid, occurredAt }): Promise<void>
```

The function signature is the contract. Implementations vary by component (Exchange writes to Cloud Logging; Refinery, when built, will do the same and additionally subscribe to platform events; Hub does the same again). The signature does not.

The function is the single re-point site for that component. Today, its body writes to Cloud Logging using a structured JSON entry that conforms to the platform event envelope (section 4 below). When the Platform API v1 event bus ships, the body re-points to the platform client. Call sites — every place in the component that wants to emit an event — do not change.

### 2.2 What the publisher does

The publisher's responsibilities are deliberately narrow. It validates the inputs (`tenantId` required, `eventType` conforms to the vocabulary, `occurredAt` is a valid ISO 8601 timestamp), enriches the envelope with the publisher-supplied fields (`eventId`, `eventVersion`, `source`), serialises to the canonical envelope shape, and writes to the transport. It does not interpret payloads, route to consumers, or guarantee delivery beyond the transport's own guarantees.

Specifically, the publisher does not implement retry. Cloud Logging's own delivery semantics are sufficient at this stage; when the platform bus ships and stronger delivery guarantees apply, the publisher's body absorbs them transparently. Components writing to publisher-lite today should not build their own retry on top.

### 2.3 What the publisher does not do

The publisher is not an audit log. The apiLogs middleware that audits API mutations remains its own thing: it records who-did-what for compliance, with its own retention and query model. Events are domain-meaningful state-change signals for downstream consumers; the two have overlapping shape but different lifecycles, and conflating them was the conflation that produced the Wishlists-slice confusion in the first place.

The publisher is also not a notification system. Events do not notify users; they notify systems. The R2 attention cascade (per the R2 Phase Boundary doc) reads events to compute counters and surface attention items, but the cascade is the consumer; the publisher does not push notifications.

## 3. Default transport: Cloud Logging only

For all current and near-term components, the publisher-lite's default body writes a structured Cloud Logging entry and nothing else. No Firestore writes, no in-app event collection, no separate pub/sub subscription. The reasoning:

- Cloud Logging is durable, queryable for analysis, and aligned with the apiLogs pattern that has held up well in production. It is cheap and does not create per-tenant Firestore collections that would need their own retention reasoning.
- No in-app consumer of these events exists in the current slice scope. The R2 attention cascade will read them eventually, but that work is downstream and will read from whatever the canonical event store is when it lands — which is the platform event bus, not a local Firestore collection. Adding a Firestore append now would create a temporary store that needs its own migration when the platform bus ships, for no current benefit.

The publisher's interface accepts an optional second argument — `{ mirrorToFirestore: boolean }` — that turns on a Firestore append for components that genuinely need a local event log surface. **Default is false.** When the option is turned on, events append to `tenants/{tenantId}/events/{autoId}` with a TTL of 30 days. This option exists for forward compatibility; it is off by default and should remain off unless a specific component's requirements turn it on deliberately.

## 4. The platform event envelope

Every event, regardless of which component emits it, conforms to a single envelope. The envelope is the contract that lets a future event consumer (the platform bus, an analytics pipeline, the attention cascade) read events from any component without per-component knowledge.

| Field          | Type                | Description |
| -------------- | ------------------- | ----------- |
| `eventId`      | string (UUID v4)    | Unique identifier for this event instance. Generated by the publisher at emit time. |
| `eventType`    | string              | Canonical event type, formatted as `<entity>.<verb>`. See section 5 for the verb vocabulary. |
| `eventVersion` | string (semver)     | Version of the payload schema for this event type. Starts at `1.0`; increments on payload schema changes. |
| `tenantId`     | string              | The tenant the event belongs to. Required on all events; cross-tenant events are not a concept this envelope supports. |
| `clientId`     | string \| null      | Where the event scopes to a specific client within a tenant; null for tenant-level events. |
| `occurredAt`   | ISO 8601 timestamp  | When the underlying state change happened. Distinct from the publisher's emit time, which is recorded by the transport. |
| `actorUid`     | string \| null      | UID of the user or service account responsible for the change. Null where the change is system-originated with no clear actor. |
| `payload`      | object              | Event-type-specific payload. Schema is governed by the `eventType` + `eventVersion` combination. |
| `source`       | object              | Origin metadata: `{ component: string, environment: string }`. Component identifies the emitter (e.g. `"exchange-app"`, `"refinery-canonicaliser"`); environment identifies the deployment. |

The envelope is versioned implicitly through the `eventVersion` field on each event type. The envelope itself does not version — its fields are stable. New optional fields may be added in future revisions of this pattern; existing fields will not change semantics.

### 4.1 Cloud Logging serialisation

When written to Cloud Logging (the default transport), the envelope is serialised as a single JSON object under a top-level key `angsanaEvent`. The Cloud Logging entry's severity is `INFO` by default; events that represent error conditions (e.g. migration failures) use `ERROR`. The entry's `textPayload` is left empty; consumers parse the structured `jsonPayload`.

```json
{ "angsanaEvent": { "eventId": "...", "eventType": "...", "eventVersion": "1.0", "tenantId": "...", "clientId": null, "occurredAt": "...", "actorUid": "...", "payload": {}, "source": { "component": "exchange-app", "environment": "production" } } }
```

### 4.2 Platform bus serialisation (future)

When the Platform API v1 event bus ships, the same envelope is the payload of the bus message, with the bus adding its own delivery metadata (message ID, partition key, delivery attempt counter). The publisher-lite's migration to the bus is therefore a transport change, not an envelope change.

## 5. The event type vocabulary

Event types follow the format `<entity>.<verb>` for entity-level events, or `<domain>.<entity>.<verb>` where the entity name might collide across domains. Examples: `wishlist.added`, `exclusion.scopeChanged`, `refinery.lead.canonicalised`, `migration.completed`.

The verb vocabulary is canonical. Components must use these verbs and not synonyms; downstream consumers reason about events partly by verb pattern matching, and synonym drift produces false negatives.

| Canonical verb    | Use for | Do not use |
| ----------------- | ------- | ---------- |
| `added`           | A new entity instance has come into existence in the system. | `created` — reserved for the platform's own creation events; `inserted` — too SQL-shaped. |
| `removed`         | An entity has been soft-deleted or made inactive. The record may persist for audit; the entity is no longer in active use. | `deleted` — implies hard deletion; `archived` — distinct verb (see below). |
| `archived`        | An entity has been moved to an archived state distinct from removal — typically a deliberate user action signalling "no longer relevant but preserve history." | `removed` when the action is archive-shaped. |
| `modified`        | A material change to entity fields that does not fit a more specific verb. | `updated` — too generic; reserve `modified` for catch-all changes and use specific verbs below where they apply. |
| `statusChanged`   | A change to the entity's status field specifically. Payload includes from and to values. | `modified` when the change is purely a status transition. |
| `scopeChanged`    | A change to the entity's scope (where applicable — Exclusions, Conflicts, Relationships). | `modified` when the change is purely scope-related. |

New verbs may be added to the vocabulary as new patterns emerge; this requires an amendment to this document. Components proposing a new verb should first check whether an existing verb fits — most cases that feel like new verbs are actually instances of `modified` or one of the specific verbs above with a richer payload.

### 5.1 Entity naming

Entity names in event types are singular, lowercase, and use the canonical name from the relevant spec. `wishlist.added` not `wishlists.added` or `Wishlist.added`. The plural form is reserved for collection-level events that genuinely operate on a set (none defined yet; flagged as a future concern if needed).

### 5.2 Domain prefixing

Domain prefixing (`refinery.lead.canonicalised` rather than `lead.canonicalised`) is used where entity names might collide across domains, or where the domain itself is a meaningful subscription axis. The conservative default is to omit the prefix and add it only when collision or subscription clarity demands. Refinery, Hub curatorial workflows, and migration-emitted events are the current candidates for prefixing.

## 6. The migration to the platform event bus

When Phase 1 lands and the Platform API v1 event bus is available, each component's publisher-lite body re-points from Cloud Logging to the platform bus client. The function signature does not change. Call sites do not change. The envelope does not change.

The migration is a per-component change with a known shape: replace the Cloud Logging write with the platform bus client write. Per component, this is a short pull request — single file change, with a feature-flag option during rollout to write to both transports for a brief overlap window, then to bus only.

### 6.1 What downstream consumers should not depend on

Components reading events should read them from whatever the canonical event store is at the time of reading. In the publisher-lite era, that is Cloud Logging (or, where `mirrorToFirestore` is on, the local events collection). In the platform bus era, that is the bus. Components should not encode the transport into their consumer logic; the envelope shape is what they read against.

### 6.2 Historical events

Cloud Logging retention is the durable record of pre-bus events. When the platform bus ships, historical events are not back-filled into the bus by default — they remain queryable in Cloud Logging using the `angsanaEvent` key. Where a specific consumer needs historical events in the bus form (likely none in current scope), a one-shot back-fill job can replay Cloud Logging entries to the bus; this is a per-consumer concern, not a platform-level commitment.

## 7. What is deliberately deferred

- **Schema registry for event payloads.** The `eventType` + `eventVersion` combination identifies a payload schema, but the schemas themselves are not centrally registered in this version. Each emitting component documents the schemas it produces in its own spec; consumers reason about them per-component. A platform-level schema registry is a future concern when consumer count grows.
- **Delivery guarantees beyond transport defaults.** Cloud Logging's default delivery is sufficient for current consumers. The platform bus will add stronger guarantees when it ships; the publisher-lite era operates without them.
- **Replay and time-travel.** Cloud Logging supports historical query but not replay-to-current-consumers. The platform bus will support replay; the publisher-lite era does not.
- **Cross-tenant subscription patterns.** Per the envelope, every event has a `tenantId`. Cross-tenant subscription (a single consumer reading events across tenants — e.g. for analytics) is not a current scope and is left to the platform bus design.
- **The `mirrorToFirestore` option's consumer model.** The option exists in the publisher-lite interface but no current component turns it on. When a component does, the consumer model for reading from the local events collection (security rules, query patterns, retention beyond TTL) is settled at that point.

## 8. Adoption and review

### 8.1 First adopters

The Exchange R2 Wishlists slice is the first adopter. Its event emissions (`wishlist.added`, `wishlist.statusChanged`, `wishlist.removed`) are the exemplar implementation of this pattern. Subsequent slices in the R2 PVS sequence (Conflicts, Exclusions, Relationships) adopt the same pattern with their own entity-level events.

Beyond Exchange, the next adopters are Refinery (when built) for canonicalisation events, and the migration script pattern (per the Angsana Migration Pattern v0.1) for migration lifecycle events.

### 8.2 Review triggers for v0.2

A v0.2 of this document is triggered by any of: a new verb pattern emerging that does not fit the existing vocabulary; a downstream consumer requirement that the envelope cannot accommodate; the platform event bus shipping (at which point migration semantics become operationally testable rather than designed); or a third adopter component surfacing a structural gap.

None of these is expected before the four R2 PVS slices ship. v0.1 is the working frame for that span.

## 9. Document control

- **Author:** Drafted in conversation with Keith. Reviewed against the Wishlists slice spec's event-emission requirements, the apiLogs middleware in `angsana-exchange`, and the events-first principle in Capabilities and API Surface Note v0.2 §4.2.
- **Review:** Internal Angsana team. Particular value in: Cline's eye on the publisher-lite implementation as it lands across the R2 PVS slices; Jerome's eye on the future Refinery emission pattern.
- **Sign-off:** Keith — pattern sign-off ahead of Wishlists slice second-pass and Conflicts slice initiation.
