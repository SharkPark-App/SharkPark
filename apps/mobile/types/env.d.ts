declare module '@env' {
  export const SHARKPARK_API_URL: string | undefined;
  /**
   * Shared HMAC secret for POST /occupancy-events. Must match the backend
   * DEVICE_EVENT_SECRET. When unset, mobile omits the signature headers and
   * the backend HmacGuard runs in permissive (dev) mode.
   */
  export const DEVICE_EVENT_SECRET: string | undefined;
  export const SENTRY_DSN_MOBILE: string | undefined;
  export const SENTRY_ENVIRONMENT: string | undefined;
  export const WS_CONNECT_SECRET: string | undefined;
}
