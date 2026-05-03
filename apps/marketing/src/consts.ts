/**
 * Site-wide constants. Edit here to update across all pages.
 */

export const SITE = {
  name: 'SharkPark',
  domain: 'sharkpark.app',
  url: 'https://sharkpark.app',
  tagline: 'Live Campus Parking',
  // Kept under ~160 chars so it isn't truncated in Google SERPs.
  description:
    'Live parking lot occupancy and short-term forecasts for the CSULB area. Independent crowdsourced app — not affiliated with CSU Long Beach.',
  // Real mailboxes routed via Cloudflare Email Routing.
  // support@  — general user support (FAQ overflow, bug reports, account help)
  // security@ — security disclosures + privacy/data requests (CCPA, deletion, access)
  // hello@    — press, partnerships, general inbox
  // postmaster@ + abuse@ — RFC-mandated, internal use only, not surfaced on the site
  contactEmail: 'support@sharkpark.app',
  privacyEmail: 'security@sharkpark.app',
  pressEmail: 'hello@sharkpark.app',
  // Update once stores approve the listings.
  appStoreUrl: '#',
  playStoreUrl: '#',
  // Hosted on Better Stack, CNAME'd from status.sharkpark.app.
  statusUrl: 'https://status.sharkpark.app',
  // Authoritative URLs for Organization.sameAs (schema.org). Add accounts as they're created.
  socialLinks: [
    'https://status.sharkpark.app',
    'https://github.com/SharkPark-App',
  ] as string[],
} as const;

export const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const;
