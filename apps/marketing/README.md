# @sharkpark/marketing

Marketing + legal site for SharkPark, served at <https://sharkpark.app>.

Built with [Astro](https://astro.build) (static output) and Tailwind CSS v4.
Deployed to **Cloudflare Workers** using the [Static Assets](https://developers.cloudflare.com/workers/static-assets/) pattern (Worker name `sharkpark-marketing`, configured in [`wrangler.jsonc`](wrangler.jsonc)).

## Why this exists

The Apple App Store and Google Play store both reject app submissions that
don't have publicly accessible **Privacy Policy** and **Support** URLs. This
site provides those URLs, plus the universal-link / app-links manifests that
make `sharkpark://` deep links work from emails and the web.

## What lives here

| Route | Purpose | Required by |
|-------|---------|-------------|
| `/` | Marketing landing page | — |
| `/privacy` | Privacy Policy | App Store, Play Store |
| `/terms` | Terms of Service | Play Store (App Store recommended) |
| `/support` | Support contact + FAQ | App Store |
| `/delete-account` | Web-accessible account deletion instructions | Play Store (2024 requirement) |
| `/.well-known/apple-app-site-association` | iOS Universal Links | iOS app deep linking |
| `/.well-known/assetlinks.json` | Android App Links | Android app deep linking |

## Local development

```bash
# From the repo root
pnpm install
pnpm --filter @sharkpark/marketing dev
```

The dev server starts at <http://localhost:4321>.

```bash
# Production build
pnpm --filter @sharkpark/marketing build

# Preview the production build
pnpm --filter @sharkpark/marketing preview
```

## Editing content

- **Site-wide constants** (name, tagline, contact emails, store URLs) live in
  [`src/consts.ts`](src/consts.ts). Update there once and every page picks it up.
- **Legal copy** (Privacy, Terms, Support, Delete Account) lives in `.astro`
  files under [`src/pages/`](src/pages/). Plain HTML inside; no MDX runtime
  required for v1.
- **Landing page sections** (features, steps, hero copy) are arrays/strings in
  [`src/pages/index.astro`](src/pages/index.astro).
- **`Last updated` dates** on legal pages — update by hand when you change the
  policy. Apple/Google reviewers look at this.

## Things you MUST update before going to production

1. **App Store and Play Store URLs** in [`src/consts.ts`](src/consts.ts) — set
   `appStoreUrl` and `playStoreUrl` once the listings go live. Until then both
   buttons render as inert anchors (`#`).
2. **Mailing address** in `privacy.astro` — required by some store reviewers
   for a fully compliant privacy policy.
3. **Release-keystore SHA-256 fingerprint** in
   [`public/.well-known/assetlinks.json`](public/.well-known/assetlinks.json)
   — already populated for the current release keystore. If the keystore is
   rotated, regenerate via `keytool -list -v -keystore release.keystore` and
   replace the value in `sha256_cert_fingerprints`.

## Deploying

Production deploys happen automatically from `main` via the GitHub Actions
workflow at [`.github/workflows/deploy-marketing.yml`](../../.github/workflows/deploy-marketing.yml),
which builds with Astro and ships to Cloudflare via `wrangler deploy`.

To deploy manually from a local checkout (requires `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in your shell environment):

```bash
pnpm --filter @sharkpark/marketing build
cd apps/marketing && pnpm exec wrangler deploy
```

There is no separate preview-deploy pipeline today — PR previews can be tested
locally with `pnpm --filter @sharkpark/marketing preview`.

### Required GitHub Actions secrets

| Secret | Where to get it |
|--------|----------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens. Use the **Edit Cloudflare Workers** template (needs `Workers Scripts: Edit` and `Account: Read`). |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar. |

### One-time Cloudflare Workers setup

The Worker is created on the first successful `wrangler deploy` — no
click-ops in the Cloudflare dashboard is required. After the first deploy:

1. Cloudflare dashboard → **Workers & Pages** → `sharkpark-marketing` →
   **Settings** → **Domains & Routes**.
2. Add custom domains `sharkpark.app` and `www.sharkpark.app`. Cloudflare
   auto-issues the certs and wires the route.
3. Confirm `wrangler.jsonc`'s `assets.not_found_handling = "404-page"` is
   serving the Astro-built `dist/404.html`.

### Verifying the well-known files after first production deploy

```bash
# AASA — must be 200, JSON, no extension, no redirects
curl -sI https://sharkpark.app/.well-known/apple-app-site-association
curl -s  https://sharkpark.app/.well-known/apple-app-site-association | jq

# Android assetlinks
curl -s  https://sharkpark.app/.well-known/assetlinks.json | jq
```

## Stack rationale

- **Astro static** — zero JS by default, perfect for legal/marketing copy,
  `.astro` components give us layout reuse across pages.
- **Tailwind v4 (Vite plugin)** — utility classes inline, no `tailwind.config.js`
  needed, ships with `@theme` for design tokens.
- **No client-side JS framework.** Nothing on this site needs interactivity
  beyond browser-native links and form submits. Adding React/Vue here would
  cost performance for zero user value.
