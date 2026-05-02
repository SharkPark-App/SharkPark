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

## 2. Get the release keystore SHA-256 fingerprint

The `assetlinks.json` currently contains the **debug** fingerprint. Before production deploy,
add the **release** fingerprint.

```bash
keytool -list -v \
  -keystore <path-to-release.keystore> \
  -alias <RELEASE_KEY_ALIAS> \
  -storepass <RELEASE_KEYSTORE_PASSWORD> \
  -keypass <RELEASE_KEY_PASSWORD> \
  | grep "SHA256:"
```

Copy the `SHA256:` value (colon-separated uppercase hex) and replace
`RELEASE_SHA256_FINGERPRINT_REPLACE_BEFORE_DEPLOY` in `assetlinks.json`.

### Play App Signing (if enrolled)

If the app is enrolled in Google Play App Signing, Google re-signs the APK with their own key.
In that case the fingerprint you need is **Google's deployment signing key**, not your upload key.
Get it from:

> **Google Play Console → Release → Setup → App signing → App signing key certificate → SHA-256 certificate fingerprint**

Both fingerprints (your upload key + Google's signing key) can coexist in the
`sha256_cert_fingerprints` array, which is why the array format is used.

---

## 3. Verify locally before deploy

```bash
# Validate JSON syntax
cat apps/mobile/docs/assetlinks.json | python3 -m json.tool

# Test the statement list URL after deploy
curl -s "https://sharkpark.app/.well-known/assetlinks.json" | python3 -m json.tool

# Use Google's Statement List validator
# https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://sharkpark.app&relation=delegate_permission/common.handle_all_urls
```

---

## 4. Coordinate with Charles (marketing site)

The file needs to be hosted as a static asset. Ping Charles to:

1. Add a route or static file for `/.well-known/assetlinks.json`
2. Ensure the server does **not** redirect `http://` → `https://` on `/.well-known/` (Android
   verifier uses HTTPS only but the no-redirect requirement still applies)
3. Set `Content-Type: application/json` (no `text/plain`)

---

## 5. Fingerprints currently in the file

| Build type | Fingerprint | Source |
|---|---|---|
| Debug | `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` | `android/app/debug.keystore` (`androiddebugkey`) |
| Release | `RELEASE_SHA256_FINGERPRINT_REPLACE_BEFORE_DEPLOY` | Replace with output of `keytool` against `release.keystore` or Play Console signing key |

---

## 6. Test on-device after deploy

```bash
# Force re-verification (requires ADB + device/emulator)
adb shell pm set-app-links --package com.sharkpark.mobile 0 all
adb shell pm verify-app-links --re-verify com.sharkpark.mobile

# Check verification state (should show "verified" for sharkpark.app)
adb shell pm get-app-links com.sharkpark.mobile
```

After re-verification, tapping `https://sharkpark.app/map` should open the app directly with
no disambiguation dialog.
