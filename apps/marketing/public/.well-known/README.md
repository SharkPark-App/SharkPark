# Universal-link / App-Links manifests

These two files MUST be served from the apex domain (`https://sharkpark.app`) for
deep linking to work in the iOS and Android apps.

## Files

| File | Required Content-Type | Notes |
|------|----------------------|-------|
| `apple-app-site-association` | `application/json` | **No file extension.** iOS rejects `.json`. Content-Type override is configured in `apps/marketing/public/_headers`. |
| `assetlinks.json` | `application/json` | Auto-detected by extension. |

## Things that MUST be swapped before production deploy

1. **`assetlinks.json` → `sha256_cert_fingerprints[0]`**: replace
   `REPLACE_WITH_RELEASE_KEYSTORE_SHA256_FINGERPRINT` with the SHA-256
   fingerprint of the **release** keystore that Google Play signed the app with.
   Get it from the Play Console → Setup → App integrity → App signing key
   certificate. **Do NOT commit the debug keystore fingerprint.**

## Verifying after deploy

```bash
# Apple AASA — must return JSON, no redirects, Content-Type application/json
curl -sI https://sharkpark.app/.well-known/apple-app-site-association

# Apple's CDN-cached view (use after first publish)
curl -s https://app-site-association.cdn-apple.com/a/v1/sharkpark.app | jq

# Google Statement List
curl -s https://sharkpark.app/.well-known/assetlinks.json | jq
```

Google also provides a hosted validator:
https://developers.google.com/digital-asset-links/tools/generator
