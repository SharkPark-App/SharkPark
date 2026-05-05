# Privacy Data Inventory

**Last updated:** 2026-05-03\
**Purpose:** For filling out the App Store privacy labels questionnaire and Play Store data safety form

This doc is derived from the live schema, cron scripts, and SDK configs. Update it whenever a new data type is added or a retention window changes.

---

## Data inventory

Each row is one logical data type. "Linked to user" means it can be traced back to a specific person without additional computation; "pseudonymous" means it requires reversing a one-way hash (not feasible with our salt).

| Data type | What exactly | How collected | Where stored | Retention | Third parties | Linked to user |
|---|---|---|---|---|---|---|
| **Name** | `first_name`, `last_name` | Azure AD SSO at sign-in | `users` table (Neon) | Until account deletion | Microsoft (source only) | Yes |
| **Email address** | School email (`@csulb.edu`) | Azure AD SSO at sign-in | `users` table (Neon) | Until account deletion | Microsoft (source only) | Yes |
| **User type** | `STUDENT` or `EMPLOYEE` | Derived from email subdomain at sign-in | `users` table (Neon) | Until account deletion | None | Yes |
| **Notification preferences** | Boolean flags (filling, clearing, surge, events) | In-app toggle | `users.notification_preferences` (Neon) | Until account deletion | None | Yes |
| **Favorited lots** | Human-readable lot ID + timestamp added | In-app action | `user_favorites` table (Neon) | Until account deletion | None | Yes |
| **User-submitted reports** | Report type, optional free-text message (≤500 chars, profanity-censored at write), lot, timestamp | In-app form | `reports` table (Neon) | Row retained indefinitely (aggregate signal); `message` column **redacted to NULL after 90 days** (`prune-old-report-messages` cron, Sundays 04:45 PT) | None | Yes |
| **Push notification token** | FCM / APNs device token, platform string | Registered when user opts in to notifications | `push_tokens` table (Neon) | Until account deletion or token invalidated by OS | Apple (APNs delivery), Google (FCM delivery) | Yes |
| **Notification delivery log** | Notification type, lot or event reference, timestamp | Written on each send | `notification_logs` table (Neon) | **90 days** (`prune-notification-logs` cron, daily 04:15 PT) | None | Yes (via user_id FK) |
| **Geofence event — hashed** | Lot ID, ENTER/EXIT, timestamp, SHA-256(salt:device\_id) | Mobile SDK detects lot boundary crossing | `occupancy_events` table (Neon) | **30 days** (`prune-old-data` cron, daily 04:00 PT) | None | Pseudonymous |
| **Device state** | Most recent ENTER/EXIT per (device\_hash, lot) | Updated on each geofence event | `device_states` table (Neon) | Stale ENTER records purged after **18 hours** (`cleanup-device-states` cron) | None | Pseudonymous |
| **Contributor ping** | First/last seen timestamps, optional grant timestamp — keyed by device\_hash | Updated on each geofence POST | `contributor_pings` table (Neon) | **180 days** of inactivity (`prune-contributor-pings` cron, Mondays 05:30 PT — both `last_seen_at` and `granted_at` must be stale) | None | Pseudonymous |
| **Audit events** | Event type (`USER_DELETED`, `USER_DATA_EXPORTED`), SHA-256(salt:email), non-PII metadata | Written on account deletion and data export | `audit_events` table (Neon) | Indefinite (compliance / right-to-erasure proof) | None | Pseudonymous |
| **Raw GPS / location path** | Actual coordinates, speed, travel history | ❌ **Never collected.** Transistor SDK runs with `persistMode: None` and no upstream sync URL. Only ENTER/EXIT events leave the device. | — | — | — | — |
| **Crash & error reports** | Stack trace, device model, OS version, app version | Sentry SDK (backend only; `sendDefaultPii: false`) | Sentry cloud (US region) | **90 days** (Sentry default) | Sentry (Functional Software Inc.) | No |

---

## Infrastructure processors

These vendors process data by hosting or transiting it. None receive user data for their own purposes.

| Vendor | Role | Data they see |
|---|---|---|
| **Microsoft Azure AD** | SSO / authentication | Name, email, Microsoft user ID at login |
| **Neon, Inc.** | Managed PostgreSQL | All database rows (encrypted at rest) |
| **Fly.io** | Backend app hosting | All in-flight requests and env vars |
| **Cloudflare** | DNS, CDN, R2 object storage | HTTP traffic (TLS-terminated); R2 holds ML model artifacts — no user PII |
| **Apple (APNs)** | Push notification delivery | Push token + notification payload |
| **Google (FCM)** | Push notification delivery | Push token + notification payload |
| **Sentry** | Backend crash / perf diagnostics | Stack traces, device/OS metadata — no PII (`sendDefaultPii: false`) |

---

## App Store privacy labels (iOS)

For the fields in App Store Connect → App Privacy

### Data used to track you
**None.** No data is used for advertising, cross-app tracking, or shared with data brokers.

### Data linked to you

| Label category | Field | Purpose |
|---|---|---|
| Contact Info → Name | `first_name`, `last_name` | App functionality (account) |
| Contact Info → Email Address | `email` | App functionality (account, auth) |
| User Content → Other User Content | Report text | App functionality (moderation) |
| Usage Data → Other Usage Data | Favorites, notification prefs | App functionality (personalization) |
| Identifiers → User ID | Email used as user identifier | App functionality |

### Data not linked to you

| Label category | What |
|---|---|
| Diagnostics → Crash Data | Sentry crash reports (backend; no PII field) |
| Identifiers → Device ID | SHA-256 device hash — not reversible, not tied to account |

### Not collected
Location, financial info, health & fitness, contacts, browsing history, search history, sensitive info, photos/video, audio, messages, purchases.

> **Location note for reviewers:** The app requires Always-On location permission but does **not** transmit or store GPS coordinates. Only lot-boundary crossing events (ENTER/EXIT) are sent — the raw coordinates that trigger them never leave the device. Declare location as "Not Collected" in the privacy label; the permission rationale in the app explains the discrepancy.

---

## Play Store data safety form (Android)

### Data collected

| Data type | Collected? | Shared? | Required / optional | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Optional (sign-in) | App functionality |
| Email address | Yes | No | Optional (sign-in) | App functionality, Account management |
| User IDs | Yes (email as ID) | No | Optional (sign-in) | App functionality |
| App interactions | Yes (favorites, reports, notif. prefs) | No | Optional | App functionality |
| Device or other IDs | Yes (SHA-256 hash, not raw) | No | Required for occupancy | App functionality, Analytics |
| Crash logs | Yes | Yes → Sentry | Required | App functionality |
| Location (precise or coarse) | **No** — coordinates processed on-device only | — | — | — |

### Security practices
- Data is encrypted in transit (TLS 1.2+).
- Users can request data deletion (in-app: Settings → Account → Delete Account; also `DELETE /api/v1/users/me`).
- Data export available (`GET /api/v1/users/me/data`) — GDPR Art. 20 compliant.
- Committed to not selling data or using it for advertising.
