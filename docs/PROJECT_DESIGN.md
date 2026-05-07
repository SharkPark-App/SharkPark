# SharkPark — Project Design (Senior Project Expo Edition)

This document explains how SharkPark is built, in plain language, so that
team members can answer judges' questions and so that a developer reading
this for the first time can understand the system end to end.

The project has three layers that work together:

1. **The mobile app** — what students hold in their hands.
2. **The backend** — the server that stores everything and enforces the rules.
3. **The forecasting system** — the part that learns from past data and predicts the future.

There is also a fourth supporting category: **outside data sources** that feed
the system (weather, the campus class schedule, the campus athletics calendar,
and the maps the phone uses).

A short glossary is at the bottom. Any term that might be unfamiliar is
explained the first time it appears.

---

## 1. The 30-second pitch

SharkPark tells students how full each parking lot at California State
University, Long Beach is **right now**, and predicts how full it will be
**later today and over the next seven days**, so they can decide where to
park before they leave home.

Students help each other by letting the app detect (in the background, with
their permission) when they park and when they leave. The app turns that
into a count of parked cars per lot, scales it up to estimate the true
crowd, and feeds that history into a forecasting model that learns the
patterns of every lot.

---

## 2. The big picture in one diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          STUDENT'S PHONE (Mobile App)                     │
│                                                                           │
│  Map of campus    Lot details      Favorites &        Background          │
│  with all lots →  with live %  →   notifications  →   location detector   │
│                                                       (parked / left)     │
└─────────────────┬────────────────────────────────┬───────────────────────┘
                  │ asks for occupancy & forecasts │ sends "I parked"
                  │ over the internet              │ "I left" events
                  ▼                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Server)                               │
│                                                                           │
│  Public web routes  →  Stores parking events  →  Counts cars per lot      │
│         │                                                │                │
│         │              Scales count up to a true         │                │
│         │              crowd estimate (penetration rate) │                │
│         │                                                │                │
│         │              Confidence score (0–100) on       │                │
│         │              every lot reading                 │                │
│         │                                                ▼                │
│         │              Stores everything in a Postgres database           │
│         │              (lots, events, snapshots, predictions, weather)    │
│         │                                                ▲                │
│         │              Scheduled jobs run on a clock (29 of them):        │
│         │              snapshots every 15 minutes, weather every 30 min,  │
│         │              clean up old data, backups every night, etc.       │
│         ▼                                                │                │
│  Sends back live numbers + predictions                   │                │
└─────────────────┬────────────────────────────────────────┼───────────────┘
                  │ asks for predictions                   │ writes new
                  ▼                                        │ predictions
┌──────────────────────────────────────────────────────────────────────────┐
│                    FORECASTING SYSTEM (Machine Learning)                  │
│                                                                           │
│  Reads parking history + weather + class schedule + day/hour              │
│         │                                                                 │
│         ▼                                                                 │
│  Trains a forecasting model for each campus                               │
│  (a "gradient-boosted tree" model — think of it as a stack of             │
│  yes/no questions that together produce a number)                         │
│         │                                                                 │
│         ▼                                                                 │
│  Produces three numbers per future hour: a low estimate, a most-likely    │
│  estimate, and a high estimate. The gap between low and high is the       │
│  "I'm not very sure" range that the app shows as a shaded band.           │
└──────────────────────────────────────────────────────────────────────────┘
                  ▲
                  │
┌──────────────────────────────────────────────────────────────────────────┐
│                       OUTSIDE DATA SOURCES                                │
│                                                                           │
│  • National Weather Service — current weather + 7-day hourly forecast    │
│  • CSULB Schedule of Classes — when buildings are in use                 │
│  • CSULB Athletics — game days that fill stadium-area lots               │
│  • Campus Labs Events — concerts, lectures, large gatherings             │
│  • Apple/Google Maps — for showing the map and giving directions         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Mobile App

### 3.1 What the mobile app is responsible for

The mobile app is the only thing students see. It must:

- Show a map of campus with every parking lot drawn on it.
- Show, for each lot, how full it is right now and how full it is expected
  to be later.
- Let students tap a lot to see details: capacity, current count, hourly
  forecast for today, and a 7-day outlook.
- Let students mark lots as favorites and get notifications when a favorite
  lot is filling up or starting to clear out.
- Let students send a quick report ("lot is closed", "lot is full",
  "construction") that other students immediately benefit from.
- Detect, with the student's permission, when they park and when they
  leave, and quietly send those two events to the server. Students never
  have to push a button.
- Give walking or driving directions to the lot they pick.

### 3.2 The screens, plainly

- **Map screen** — the home page. Pinch to zoom, tap a lot to open it.
- **Lot detail screen** — capacity, current count, how confident we are in
  that number, today's hour-by-hour forecast as a chart, and a 7-day
  forecast.
- **Long-term forecast screen** — a separate longer view, so a student
  planning a Monday morning class on Friday can see what to expect.
- **Favorites screen** — quick access to the lots a student usually parks
  in.
- **Reports screen** — submit a quick observation about a lot.
- **Settings & permissions screen** — turn background location on or off,
  turn notifications on or off, sign in with the campus account.

### 3.3 How geolocation and geofencing work

A **geofence** is an invisible circle drawn around a parking lot. The
phone's operating system itself watches whether the phone has crossed
into or out of the circle, even when the app is closed.

When the student grants the "Always" location permission:

1. The app registers a geofence around every CSULB lot at startup.
2. When the phone's location enters a lot's circle and stays parked for
   long enough to look like real parking (rather than driving past), the
   operating system wakes the app up just long enough to send an "I
   parked" event.
3. When the phone leaves the circle, the same thing happens with an "I
   left" event.

The student does not have to open the app for any of this. It is
designed to use very little battery: the operating system, not the app,
does the watching.

### 3.4 What the phone sends, and what it does NOT send

The phone sends to the backend:

- A one-way scrambled identifier for the device (so we can tell that two
  events came from the same phone, but cannot reverse it back to a
  person).
- Which lot was entered or exited.
- The time the event happened.
- A short signature that proves the event came from a real SharkPark
  app (so people cannot send fake events from a script).

The phone does **not** send:

- The student's name, email, or campus ID.
- The student's latitude/longitude path.
- Any contact list, photos, or unrelated app data.

The phone receives from the backend:

- The list of lots and where each one is on the map.
- The current estimated fullness of each lot, with a confidence number.
- The hourly forecast for today and the daily forecast for the next week.
- Any active reports about a lot ("closed for event", "full").

### 3.5 Permissions, and what happens when they are denied

The app uses three permissions:

- **Location, "While Using"** — required to show the student where they
  are on the map. If denied, the map still works, but it does not show a
  "you are here" dot.
- **Location, "Always"** — required for the geofencing parking detection.
  If denied, the app can still show forecasts and live numbers; the
  student just does not contribute their own parking data, and they
  cannot get certain personalized notifications.
- **Notifications** — required to push the "your favorite is filling up"
  alerts. If denied, the app silently skips notifications and everything
  else still works.

The app is designed so that **every feature degrades gracefully**: if a
permission is denied, the related feature simply turns off and the rest
of the app keeps working.

### 3.6 How live and forecasted numbers are displayed

For each lot, the app shows a single, simple decision label:

- **Open** (green) — plenty of space.
- **Filling** (yellow) — half to mostly full.
- **Nearly full** (orange) — only a few spots left.
- **Full** (red) — likely no spaces.

The decision label is computed from the predicted fullness percentage
and from the confidence number. When confidence is low, the app widens
the "I'm not sure" range and rounds the label conservatively (it will
say "Filling" rather than "Nearly full" when it is uncertain), so
students are not misled by guesses.

### 3.7 Why the mobile app is designed this way

- **Usability** — one map, one tap, one decision per lot. Students do not
  need to read numbers or charts unless they want to.
- **Privacy** — the phone sends the minimum necessary, scrambled before
  it leaves the device, and never the student's identity.
- **Reliability** — the app keeps working even when permissions are
  refused, when the network is slow (it caches the last good answer for
  half an hour), and when the backend is briefly unreachable.

---

## 4. The Backend (the server)

### 4.1 What the backend is responsible for

The backend is the brain of the system. It:

- Accepts every request from every phone.
- Verifies that each request is real and not tampered with.
- Stores every parking event, every snapshot, every prediction, every
  weather observation, every user report.
- Counts parked cars per lot every 15 minutes.
- Scales those counts up to a real crowd estimate.
- Talks to the forecasting system to refresh predictions.
- Pulls in outside data (weather, class schedule, athletics calendar,
  events).
- Runs scheduled cleanup, backup, and maintenance jobs around the clock.
- Sends the final answers back to the mobile app.

### 4.2 How the backend receives and validates phone requests

Every request from the app goes over an encrypted internet connection
(the same kind that protects online banking). For requests that submit a
parking event, the app also attaches a short cryptographic signature
made from a shared secret key built into the app. The backend recomputes
that signature from the request body and rejects anything that does not
match. This stops fake events from being injected from outside the app.

For requests that read personal data (favorites, settings), the student
must be signed in with their campus account through Microsoft Entra ID
(the campus single sign-on).

### 4.3 What gets stored, and where

Everything lives in a managed PostgreSQL database (a widely used,
reliable database engine). The most important tables are:

- **Lots** — the static information about each parking lot: name,
  capacity, the polygon that draws it on the map, which school it
  belongs to.
- **Buildings** — campus building footprints, used to figure out which
  events are happening near which lots.
- **Occupancy events** — every "I parked" / "I left" event, kept for 30
  days then deleted.
- **Occupancy snapshots** — one row per lot every 15 minutes, with the
  car count, the scaled-up crowd estimate, and the confidence score.
  These are kept permanently and are the basis for forecasting.
- **Consensus observations** — short 5-minute aggregations used as
  ground-truth for tuning the scale-up factor; pruned after 180 days.
- **Penetration rate estimates** — the per-lot, per-day-and-hour scale-up
  factors learned over time.
- **Predictions** — the model's forecasts for the next 14 hours and the
  next 7 days.
- **Weather** — current observations and 7-day hourly forecast.
- **Campus events** — scraped event listings and athletic schedules.
- **Reports** — student-submitted observations about lots.

### 4.4 How live occupancy is calculated

Every 15 minutes a scheduled job runs:

1. Looks at all the active "parked" events for each lot in the last
   window.
2. Counts the number of unique scrambled device identifiers — that is
   the **observed count**.
3. Multiplies the observed count by the **penetration rate** for that
   lot at that hour to get the **estimated crowd**. Penetration rate is
   our best guess at "for every 1 phone running SharkPark, how many cars
   are actually in the lot?" — at launch this is a rule based on lot
   size and campus activity; once enough ground truth comes in, the
   system blends that rule with a learned, lot-specific number.
4. Computes a **confidence score** from six factors: how trusted the
   penetration rate is, how recent the data is, how often we see new
   events, the raw sample size, the lot's history, and whether students
   have submitted recent reports.
5. Saves a new snapshot row.

### 4.5 How penetration rate adjustments work

Two estimates are computed for each lot at each hour:

- A **rule-based** estimate that uses lot size and a time-of-day
  multiplier, capped so it cannot grow unrealistically when sample sizes
  are tiny.
- A **learned** estimate that comes from comparing past app counts
  against ground-truth signals (consensus observations and class
  schedule activity).

If the learned estimate has at least 30 samples and is no older than 14
days, the system uses 70% learned and 30% rule. Otherwise it leans on
the rule. This blending guarantees we never depend on a stale or
under-sampled learned number.

### 4.6 How the backend talks to the forecasting system

The forecasting system is a separate Python program. The backend never
runs the math itself. Instead:

- A scheduled job inside the backend launches the prediction script as a
  short-lived subprocess.
- The script reads features straight from the database, downloads the
  current "production" model from a model registry (MLflow, backed by
  Cloudflare R2 object storage), produces the predictions, and writes
  them back to the database.
- The backend then serves those predictions to the app via the same
  read endpoints as everything else.

Training the model is even more separate: it runs on GitHub Actions
(GitHub's hosted job runners) on a daily schedule, not on our server.
The backend only ever **reads** the most recently approved model.

### 4.7 How scraping works

Scraping means reading public information from a website and turning it
into structured data we can store. The backend has scrapers for:

- **CSULB Athletics** events and live game finals (so a packed stadium
  lot is reflected in our predictions).
- **Campus Labs** general campus events (large lectures, concerts).
- **National Weather Service** for current weather and the 7-day
  forecast.
- **CSULB Schedule of Classes** and **Lecture Room Allocation** to know
  which buildings are in use at which hours, so we can simulate a busy
  campus when we have not collected enough real data yet.

All scrapers go through one shared helper that:

- Identifies itself politely with a User-Agent header, as required by
  these public services.
- Times out after 20 seconds so a stuck request cannot block a job.
- Retries up to three times with backoff if the remote site is briefly
  down or rate-limits us.

### 4.8 How scheduled jobs keep the system fresh

The backend runs **29 scheduled jobs** on a clock. Some examples:

- Every 15 minutes: compute a fresh snapshot for every lot.
- Every 30 minutes: pull current weather; refresh live game scores.
- Every 6 hours: pull the full 7-day weather forecast.
- Daily at 2:00 AM Pacific: back up the entire database to encrypted
  cloud storage; the next day, a separate job verifies the backup is
  readable.
- Daily at 2:30 AM: recompute the learned penetration rate from
  yesterday's ground truth.
- Daily: run short-term predictions; weekly: run long-term predictions.
- Daily at 5:15 AM: compare yesterday's predictions to what actually
  happened and report the average error to our monitoring system. If
  the error climbs above an alert threshold, we know the model has
  drifted and needs attention.
- Weekly: prune old data that we no longer need.

Every job reports a heartbeat to Sentry (an industry-standard
monitoring service) so we are paged automatically if any job fails to
run on schedule.

### 4.9 How the backend protects data and prevents bad input

- All writes are validated against a strict schema. Fields with the
  wrong type, missing required values, or out-of-range numbers are
  rejected before they ever touch the database.
- Parking events are signed; unsigned or wrong-signed events are
  rejected.
- Repeated identical events are detected and ignored — one student
  cannot inflate the count by spamming.
- The backend uses **prepared statements** (parameterized queries) for
  every database call, which makes injection attacks impossible.
- Rate limiting protects against brute-force or denial-of-service
  attempts.
- Errors that the user caused (bad input, expired session) return a
  clean 4xx response; errors on our side (database temporarily down)
  return a clean 5xx response and are automatically reported to our
  error-monitoring service so we hear about them in real time.

### 4.10 Why a backend is necessary at all

The phone could, in principle, talk to the database directly. We chose
not to do that for several reasons:

- **Trust.** The mobile app runs on devices we do not control. Anyone
  could repackage the app and try to send fake data. The backend is the
  only place that can decide what counts as a real event.
- **Coordination.** Hundreds of phones will be sending events every
  minute. Only a central server can fairly merge those into a single
  picture.
- **Heavy work.** Counting, scaling, scoring, scraping, backing up, and
  running forecasts are all things a phone cannot do well. The backend
  does them all in one place.
- **Privacy.** All sensitive scrambling and aggregation happens on our
  side, where it can be audited.

---

## 5. The Forecasting System

### 5.1 What the forecasting system is responsible for

The forecasting system answers two questions for every lot:

1. **Short term**: What will the fullness be every hour for the next
   ~14 hours?
2. **Long term**: What will the fullness be every hour for the next 7
   days?

It returns three numbers per hour: a low estimate, a most-likely
estimate, and a high estimate, so the app can show both a value and a
confidence band.

### 5.2 What data is used for training

The system trains on every snapshot the backend has ever stored — that
is, the time series of "lot X was estimated at Y% full at time T". It
also incorporates:

- The current and historical weather for that day and hour.
- Whether that hour fell inside a regular semester, summer session,
  winter session, or an academic break.
- The day of the week.
- The campus class schedule (when buildings near the lot have classes
  in session).
- Athletic events near the lot.
- For lots where we do not yet have much real data, **synthetic data**
  — simulated parking patterns generated from the public class
  schedule.

### 5.3 The features the model looks at

A "feature" is any input the model considers. The most important ones
are:

- The fullness one, two, three, and four hours ago (so the model can
  notice a lot that is climbing fast).
- The hour of the day.
- The day of the week.
- The week of the semester.
- A label for what kind of period we are in ("regular semester",
  "finals week", "summer", "winter session", "break", "holiday").
- A label for the weather severity ("clear", "rain", "heavy rain",
  "heat advisory").
- The lot's unique identifier so the model can learn lot-specific
  habits.

### 5.4 How the model is trained

We use **gradient-boosted decision trees**. The simplest way to picture
this: a single decision tree is a flowchart of yes/no questions ("is it
after 9 AM? — is the lot near a busy classroom right now? — was it
already 60% full an hour ago?") that ends in a number. Gradient
boosting builds many such trees in sequence, where each new tree
focuses on correcting the previous trees' mistakes. The final
prediction is the sum of all the trees' answers.

We train **three models** for each horizon: one that aims for the 10th
percentile (the low estimate), one for the 50th (the most likely), and
one for the 90th (the high estimate). This is how we get a confidence
band rather than a single guess.

Training happens automatically on GitHub Actions:

- **Short-term model**: re-trained every day.
- **Long-term model**: re-trained every Sunday.

Each new model is automatically compared to the current production
model. It is only promoted to production if it passes four checks:

1. Its average error meets a minimum quality bar.
2. It improves over the previous model by at least 1%.
3. Its 80% confidence band actually contains the true answer about 80%
   of the time (calibration).
4. It does not regress on any individual lot by more than a small margin.

If the new model fails the checks, the old one stays in production.
This **promotion guard** prevents a bad model from ever reaching users.

### 5.5 How forecasts are generated and served

A scheduled job (inside the backend, but launching the Python program)
runs frequently:

1. Downloads the current production model from the model registry.
2. Reads the latest snapshots and weather as inputs.
3. Asks the model for the three quantile predictions for each lot at
   each future hour.
4. Adjusts the predictions for things the model alone might not catch:
   reduces them during weather warnings, lowers them during summer and
   winter sessions and academic breaks.
5. Writes the predictions to the database.

When the mobile app asks for a forecast, the backend simply reads from
that table. The app is never waiting on the model to compute live.

### 5.6 How the system handles low-data scenarios (cold start)

A brand new lot has no history at all. A lot that has only been live
for two weeks has very little. To handle this:

- The system blends **real data with synthetic data**. Synthetic data
  is generated from the public class schedule plus realistic arrival
  and departure curves. The synthetic share automatically shrinks as
  more real data comes in (a lot with 0 real samples uses mostly
  synthetic; a lot with thousands uses almost entirely real).
- Synthetic samples carry a lower training weight so they cannot
  drown out real evidence.
- For new lots, the rule-based penetration estimate is used until at
  least 30 days of real samples accumulate.

### 5.7 How the model adjusts for academic breaks and unusual periods

A separate post-processing step caps predictions during periods we know
will be quiet:

- **Winter session**: cap at 10% of normal.
- **Summer session**: cap at 30% of normal.
- **Academic break / holiday**: cap at 5% of normal.

These rules are kept in code (mirrored in two places, one for the
backend and one for the forecasting system, with tests that keep them
in sync) so we can update them without retraining.

### 5.8 How the forecasting system connects with penetration rate logic

The model is trained on the **scaled-up crowd estimates** — that is,
the snapshots that the backend has already adjusted by the penetration
rate. So the model learns to predict the crowd, not the raw app
signal. This means predictions stay sensible even as the app's
adoption grows.

### 5.9 How the model improves over time

- Every new "I parked / I left" event becomes a snapshot.
- Every snapshot is training data for the next training run.
- The drift-monitoring job (the daily prediction-vs-actual comparison)
  tells us when error starts to climb so we can investigate.
- The promotion guard ensures only better models are deployed.

The system was deliberately built so that **doing nothing** still
results in a steadily improving forecast as more data accumulates.

---

## 6. End-to-end flow: a single user's day

1. **Morning**: A student opens the app on the bus. The app asks the
   backend, "what's the live state of every lot, and what's the
   forecast for today?" The backend answers in less than half a
   second using the predictions already saved in the database.
2. **Choosing**: The student looks at their three favorite lots. Lot
   G2 is shown as orange with a wide confidence band; Lot A is green
   with a narrow band. They pick Lot A and tap "Directions".
3. **Driving**: They drive to campus. The app does nothing in the
   foreground but the operating system is watching the geofences.
4. **Parking**: The student pulls into Lot A. A few seconds after
   parking, the operating system wakes the app. The app builds a
   small "I parked at Lot A" message, signs it, and sends it. The
   student never sees this happen.
5. **Backend processing**: The backend verifies the signature,
   scrambles the device identifier, and records the event.
6. **Counting**: At the next 15-minute tick, the snapshot job counts
   all the parked-state devices in Lot A, scales it by the
   penetration rate, computes a confidence score, and writes a new
   snapshot. The next student to ask sees a fresher number.
7. **Evening**: Around 5:00 PM the student leaves. Their phone fires
   the "I left Lot A" event. The next snapshot reflects the
   departure.
8. **Overnight**: The drift job compares the day's predictions to
   what actually happened and reports the error. The training
   workflow re-trains the short-term model. The promotion guard
   checks it. If it is better, tomorrow's predictions come from the
   new model. The backup job dumps the database to encrypted
   storage. Old events are pruned at the 30-day mark.
9. **Tomorrow**: The student opens the app again. Predictions are
   slightly more accurate than yesterday because the model now also
   knows about yesterday's pattern.

---

## 7. Architecture diagram (component map)

```
┌────────────────────────────── MOBILE LAYER ──────────────────────────────┐
│                                                                           │
│   Map screen          Lot detail screen         Long-term forecast        │
│   Favorites           Reports                   Settings & permissions    │
│                                                                           │
│   Background geofencing parking detector                                  │
│   Local cache (last good answers, 30-min freshness)                       │
│   Signed application interface client (talks to the backend)              │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ HTTPS (encrypted), signed write requests
                           ▼
┌──────────────────────────── BACKEND LAYER ───────────────────────────────┐
│                                                                           │
│   Public web routes (controllers)                                         │
│      • Lot listing and details                                            │
│      • Live occupancy and forecasts                                       │
│      • Submit parking event / submit report                               │
│      • Favorites and notifications                                        │
│                                                                           │
│   Authentication (campus single sign-on through Microsoft Entra ID)       │
│   Request signature verification (rejects forged events)                  │
│                                                                           │
│   Domain services                                                         │
│      • Occupancy event processor                                          │
│      • Snapshot computer (every 15 minutes)                               │
│      • Penetration rate estimator (rule + learned, blended)               │
│      • Confidence-score calculator (six factors)                          │
│      • Reports service                                                    │
│      • Notifications service                                              │
│                                                                           │
│   Scrapers                                                                │
│      • Weather (National Weather Service)                                 │
│      • Athletics + game finals                                            │
│      • Campus events                                                      │
│      • Class schedule + room capacities                                   │
│                                                                           │
│   Scheduled jobs (29 in total) with heartbeat monitoring                  │
│                                                                           │
│   Database (Postgres) — single source of truth                            │
│   Error tracking + crash reporting (Sentry)                               │
│   Daily encrypted backups to cloud storage                                │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ launches subprocess + reads/writes database
                           ▼
┌────────────────────────── FORECASTING LAYER ─────────────────────────────┐
│                                                                           │
│   Data preparation (real + synthetic samples, weighted)                   │
│   Feature engineering (lags, time, calendar, weather)                     │
│   Model training (gradient-boosted trees, three quantiles)                │
│   Evaluation + automatic promotion guard                                  │
│   Forecast generation and post-processing                                 │
│   Forecast storage (back into the same Postgres database)                 │
│   Model registry (MLflow on Cloudflare R2 object storage)                 │
└──────────────────────────────────────────────────────────────────────────┘

┌────────────────────── OUTSIDE DATA SOURCES ──────────────────────────────┐
│   National Weather Service     Apple Maps / Google Maps                  │
│   CSULB Schedule of Classes    CSULB Athletics                           │
│   Campus Labs Events                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Why the system is split into three layers

- **Separation of concerns.** Each layer does one thing well. The
  phone is a friendly window into the data; the backend is the rule
  enforcer and coordinator; the forecasting system is the math
  specialist.
- **Different rates of change.** We can ship a new mobile build
  without touching the backend. We can deploy a new backend without
  touching the model. We can train a smarter model without touching
  the backend code.
- **Different runtime needs.** The phone must be tiny and fast. The
  backend must be always-on and reliable. Training the model needs
  occasional bursts of compute and is best done off-server, on
  scheduled cloud workers.
- **Different security postures.** The phone is in untrusted hands;
  the backend lives in a controlled environment; the model registry
  is even more locked down.

---

## 9. Glossary

- **Backend** — the server program that stores everything and answers
  the phone.
- **Cold start** — the period where a new lot does not yet have enough
  data, handled with synthetic data + rule-based estimates.
- **Confidence score** — a 0–100 number that says how much we trust a
  given live reading.
- **Cron / scheduled job** — a piece of code that runs automatically on
  a clock (e.g. every 15 minutes, every night at 2 AM).
- **Forecast / prediction** — a model-generated estimate of what
  fullness will be at a future time.
- **Geofence** — an invisible circle around a place; the phone's
  operating system fires an event when crossed.
- **Gradient-boosted tree** — the family of forecasting model we use; a
  series of yes/no flowcharts that together produce a number.
- **Ground truth** — a value we believe is correct, used to grade our
  estimates.
- **Penetration rate** — for every one phone with SharkPark in a lot,
  how many cars are actually there. Our scale-up factor.
- **Promotion guard** — the four checks a new model must pass before it
  is allowed to replace the old one.
- **Snapshot** — one record of a lot's estimated fullness at a single
  moment in time.
- **Synthetic data** — simulated parking patterns we generate from the
  public class schedule, used to give brand-new lots something to
  learn from.
