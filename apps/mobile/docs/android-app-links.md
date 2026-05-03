# Android App Links — assetlinks.json Setup

**Why this matters:** `AndroidManifest.xml` sets `android:autoVerify="true"` on the HTTPS
intent filter for `https://sharkpark.app`. Without a valid `assetlinks.json` served at
`https://sharkpark.app/.well-known/assetlinks.json`, Android's Domain Verification Service
silently fails and the OS falls back to showing the disambiguation dialog ("Open with…")
instead of routing directly to the app.

---

## 1. File location in this repo

```
apps/mobile/docs/assetlinks.json
```

This file must be deployed to:

```
https://sharkpark.app/.well-known/assetlinks.json
```

Served with `Content-Type: application/json` and **no redirect** on the path (the verifier
follows zero redirects).

---

## 2. Debug fingerprint — local only, never deployed

> ⚠️ **The debug keystore fingerprint must never appear in the deployed `assetlinks.json`.**

`android/app/debug.keystore` is intentionally checked into the repo so all developers share
the same debug build identity. Because the keystore is public, anyone who clones the repo can
build an APK that matches its fingerprint. Shipping that fingerprint in the deployed
`assetlinks.json` would let a malicious APK intercept every `https://sharkpark.app/*` deep-link
tap on a user's device.

**Rule:** debug fingerprint = local development only. The deployed file contains only the
production signing key fingerprint obtained from Play Console (see §3 below).

---

## 3. Get the production fingerprint (Play App Signing)

**This app is enrolled in Google Play App Signing.** This means:

- You upload a signed APK/AAB with your **upload key**.
- Google re-signs it with their own **deployment signing key** before distributing to devices.
- The fingerprint that must go in `assetlinks.json` is **Google's deployment signing key**, not
  your upload key. Using the upload key fingerprint will cause verification to fail on all
  production installs.

Get the correct fingerprint from:

> **Google Play Console → Release → Setup → App signing →
> App signing key certificate → SHA-256 certificate fingerprint**

Then replace `REPLACE_WITH_PLAY_CONSOLE_SIGNING_KEY_SHA256` in `assetlinks.json` with that
value (colon-separated uppercase hex, e.g. `AB:CD:EF:…`).

> **Note:** do not add the upload-key fingerprint to the array. It is never used for
> distribution builds and would be a no-op at best, misleading at worst.

---

## 4. Pre-deploy validation

The placeholder string `REPLACE_WITH_PLAY_CONSOLE_SIGNING_KEY_SHA256` is deliberately
non-hex so that a CI regex check fails loudly if the file is deployed before being filled in.
Add these checks to your deploy pipeline:

```bash
# 1. Fail if the placeholder is still present
grep -q "REPLACE_WITH_PLAY_CONSOLE_SIGNING_KEY_SHA256" apps/mobile/docs/assetlinks.json \
  && echo "ERROR: assetlinks.json placeholder not replaced" && exit 1

# 2. Validate every fingerprint entry matches the required format:
#    32 colon-separated uppercase hex pairs (^[0-9A-F]{2}(:[0-9A-F]{2}){31}$)
python3 - <<'EOF'
import json, re, sys
data = json.load(open("apps/mobile/docs/assetlinks.json"))
pattern = re.compile(r'^[0-9A-F]{2}(:[0-9A-F]{2}){31}$')
for stmt in data:
    for fp in stmt["target"].get("sha256_cert_fingerprints", []):
        if not pattern.match(fp):
            print(f"ERROR: invalid SHA-256 fingerprint: {fp}")
            sys.exit(1)
print("All fingerprints valid.")
EOF

# 3. Validate JSON syntax
python3 -m json.tool apps/mobile/docs/assetlinks.json > /dev/null \
  && echo "JSON valid" || echo "ERROR: invalid JSON"
```

Same pattern applies to `apple-app-site-association.json` — check for the `TEAMID` placeholder
before deploying that file.

---

## 5. Coordinate with Charles (marketing site)

The file needs to be hosted as a static asset. Ping Charles to:

1. Add a route or static file for `/.well-known/assetlinks.json`
2. Ensure the server does **not** redirect on the `/.well-known/` path (the Android verifier
   follows zero redirects)
3. Set `Content-Type: application/json` (not `text/plain`)

---

## 6. Fingerprints currently in the file

| Build type | Fingerprint | Source |
|---|---|---|
| Debug | **Not included** — local-only, see §2 | `android/app/debug.keystore` |
| Production | `REPLACE_WITH_PLAY_CONSOLE_SIGNING_KEY_SHA256` | Play Console → App signing → SHA-256 (see §3) |

---

## 7. Test on-device after deploy

```bash
# Validate the live URL
curl -s "https://sharkpark.app/.well-known/assetlinks.json" | python3 -m json.tool

# Use Google's Statement List validator
# https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://sharkpark.app&relation=delegate_permission/common.handle_all_urls

# Force re-verification on a device (requires ADB)
adb shell pm set-app-links --package com.sharkpark.mobile 0 all
adb shell pm verify-app-links --re-verify com.sharkpark.mobile

# Check verification state (should show "verified" for sharkpark.app)
adb shell pm get-app-links com.sharkpark.mobile
```

After re-verification, tapping `https://sharkpark.app/map` should open the app directly with
no disambiguation dialog.

---

## 8. Follow-up: path-prefix filter

The current intent filter matches the entire `sharkpark.app` apex, so paths like `/privacy`
and `/support` will also route into the app once verified. Consider adding a
`android:pathPrefix` filter scoped to the deep-link paths the app actually handles:

```xml
<data android:pathPrefix="/map" />
<data android:pathPrefix="/forecast" />
<data android:pathPrefix="/profile" />
```

This is a follow-up to avoid hijacking marketing/support pages unintentionally.
