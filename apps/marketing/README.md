# @sharkpark/marketing

Marketing + legal site for SharkPark, served at <https://sharkpark.app>.

Built with [Astro](https://astro.build) (static output) and Tailwind CSS v4.
Deployed to Cloudflare Pages.

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

1. **Release-keystore SHA-256 fingerprint** in
   [`public/.well-known/assetlinks.json`](public/.well-known/assetlinks.json)
   — replace the `REPLACE_WITH_...` placeholder.
2. **App Store and Play Store URLs** in [`src/consts.ts`](src/consts.ts) — set
   `appStoreUrl` and `playStoreUrl` once the listings go live. Until then both
   buttons render as inert anchors (`#`).
3. **Mailing address** in `privacy.astro` — required by some store reviewers
   for a fully compliant privacy policy.
4. **Status page URL** in `src/consts.ts` — point at the real Better Stack /
   status page when it's ready.

## Deploying

Production deploys happen automatically from `main` via the GitHub Actions
workflow at [`.github/workflows/deploy-marketing.yml`](../../.github/workflows/deploy-marketing.yml).

Pull-request preview deploys are handled directly by the Cloudflare Pages
GitHub integration (no workflow needed).

### Required GitHub Actions secrets

| Secret | Where to get it |
|--------|----------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens. Use the **Cloudflare Pages: Edit** template. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar. |

### One-time Cloudflare Pages setup

1. Cloudflare dashboard → **Workers & Pages** → **Create application** →
   **Pages** → **Connect to Git**.
2. Pick this repo. Set:
   - **Project name:** `sharkpark-marketing`
   - **Production branch:** `main`
   - **Build command:** _leave blank_ (we use the GH Action).
   - **Build output directory:** `apps/marketing/dist`
3. After the first deploy, go to the project's **Custom domains** tab and add
   `sharkpark.app` and `www.sharkpark.app`. Cloudflare auto-issues the certs
   and (for the apex) configures CNAME flattening.
4. Update DNS for the apex if it isn't already pointed: a CNAME from
   `sharkpark.app` → `sharkpark-marketing.pages.dev` (CF flattens).

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
