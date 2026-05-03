import { authorize, refresh, logout, AuthorizeResult, RefreshResult } from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';
import API_CONFIG from '../services/api/config';
import { jwtDecode } from 'jwt-decode';
import { Platform } from 'react-native';

// =============================================================================
// Azure AD Configuration Constants
// =============================================================================

const AZURE_CONFIG = {
  CLIENT_ID: '9aea0ab1-4502-4868-a31b-0a8f333cec9c',
  TENANT_ID: 'd175679b-acd3-4644-be82-af041982977a', // CSULB tenant
} as const;

// Platform-specific redirect URIs (trailing slash required for proper callback handling)
const REDIRECT_URL = Platform.select({
  ios: 'msauth.app.sharkpark.mobile://auth/',
  android: 'msauth://app.sharkpark.mobile/pCBsiXaNNNC6c0uvCpHWkdYi2Mk%3D',
}) as string;

// Token refresh buffer (5 minutes before expiration)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Backend sync timeout
const BACKEND_SYNC_TIMEOUT_MS = 10_000;

// Development-only logging helper
const log = (message: string, ...args: unknown[]) => {
  if (__DEV__) {
    console.log(message, ...args);
  }
};

// =============================================================================
// react-native-app-auth Configuration
// =============================================================================

const config = {
  issuer: `https://login.microsoftonline.com/${AZURE_CONFIG.TENANT_ID}/v2.0`,
  clientId: AZURE_CONFIG.CLIENT_ID,
  redirectUrl: REDIRECT_URL,
  scopes: [
    'openid',
    'profile',
    'email',
    'offline_access',
    `api://${AZURE_CONFIG.CLIENT_ID}/access_as_user`
  ],
  serviceConfiguration: {
    authorizationEndpoint: `https://login.microsoftonline.com/${AZURE_CONFIG.TENANT_ID}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${AZURE_CONFIG.TENANT_ID}/oauth2/v2.0/token`,
    endSessionEndpoint: `https://login.microsoftonline.com/${AZURE_CONFIG.TENANT_ID}/oauth2/v2.0/logout`,
  },
  additionalParameters: {
    prompt: 'select_account' as const,
  },
  usePKCE: true,     // Required: PKCE for security (RFC 7636)
  useNonce: true,    // Required: Prevents replay attacks
  iosPrefersEphemeralSession: false, // Allow SSO and password saving
};

// =============================================================================
// Types
// =============================================================================

interface AzureTokenPayload {
  readonly preferred_username?: string;
  readonly email?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly exp: number;
}

export interface AuthResult {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  accessTokenExpirationDate: string;
  tokenType: string;
  userId: string;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** Convert react-native-app-auth result to our AuthResult format (exempts email from latter) */
const toAuthResult = (result: AuthorizeResult | RefreshResult, userEmail: string): AuthResult => ({
  accessToken: result.accessToken,
  idToken: result.idToken,
  refreshToken: result.refreshToken ?? undefined,
  accessTokenExpirationDate: result.accessTokenExpirationDate,
  tokenType: result.tokenType,
  userId: userEmail
});

// =============================================================================
// Exported Auth Functions
// =============================================================================

/**
 * Initiates Azure AD login using react-native-app-auth
 * Uses ASWebAuthenticationSession on iOS (RFC 8252 compliant)
 */
export const loginWithAzure = async (): Promise<AuthResult> => {
  try {
    log('[AzureAuth] Starting authorize with react-native-app-auth...');
    log('[AzureAuth] Redirect URL:', REDIRECT_URL);
    log('[AzureAuth] Config:', JSON.stringify(config, null, 2));

    // Perform OAuth authorization - this opens system browser
    const result = await authorize(config);

    log('[AzureAuth] Authorization successful');
    log('[AzureAuth] Access token exists:', !!result.accessToken);
    log('[AzureAuth] ID token exists:', !!result.idToken);
    log('[AzureAuth] Refresh token exists:', !!result.refreshToken);

    if (!result.idToken) {
      throw new Error('No ID token received from Azure AD');
    }

    // Decode token to get user email for backend sync
    const decoded = jwtDecode<AzureTokenPayload>(result.idToken);
    const userEmail = decoded.preferred_username ?? decoded.email;
    log('[AzureAuth] User email:', userEmail);

    if (!userEmail) {
      throw new Error('No email found in ID token');
    }

    // Sync user with backend (triggers findOrCreateUser)
    await syncUserWithBackend(result.idToken, userEmail);

    return toAuthResult(result, userEmail);
  } catch (error) {
    if (__DEV__) {
      console.error('[AzureAuth] Login failed:', error);
      console.error('[AzureAuth] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    }
    throw error;
  }
};

/**
 * Sync user with backend after successful authentication
 */
const syncUserWithBackend = async (idToken: string, userEmail: string): Promise<void> => {
  const url = `${API_CONFIG.BASE_URL}/users/${encodeURIComponent(userEmail)}`;
  log('[AzureAuth] Syncing user with backend:', url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_SYNC_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    log('[AzureAuth] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      if (__DEV__) {
        console.error('[AzureAuth] Backend error:', errorText);
      }
      // Don't throw - we have valid tokens, backend sync can retry later
      log('[AzureAuth] Backend sync failed but continuing with valid tokens');
    }
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (__DEV__) {
      console.error('[AzureAuth] Backend sync error:', fetchError);
    }
    // Continue anyway - we have valid tokens
    log('[AzureAuth] Continuing without backend sync');
  }
};

/**
 * Logout from Azure AD
 * Clears the Azure session and ends SSO
 * Falls back to local-only logout if Azure logout fails
 */
export const logoutFromAzure = async (idToken?: string): Promise<void> => {
  let userCancelled = false;

  // If we have an idToken, try to do a proper Azure AD logout
  if (idToken) {
    try {
      // Create logout-specific config with only required fields for end session
      // Note: We use serviceConfiguration ONLY (no issuer) to avoid discovery conflicts
      // See: https://github.com/FormidableLabs/react-native-app-auth/blob/main/docs/docs/providers/microsoft.md
      const logoutConfig = {
        clientId: config.clientId,
        serviceConfiguration: config.serviceConfiguration,
        iosPrefersEphemeralSession: config.iosPrefersEphemeralSession,
      };
      
      log('[AzureAuth] Logout config:', JSON.stringify(logoutConfig, null, 2));
      
      await logout(logoutConfig, {
        idToken,
        postLogoutRedirectUrl: REDIRECT_URL,
      });
      log('[AzureAuth] Azure AD logout successful');
    } catch (logoutError) {
      const errorMessage = (logoutError as Error).message || '';
      
      // Check if user explicitly cancelled the logout
      if (errorMessage.includes('User cancelled') || errorMessage.includes('cancel')) {
        log('[AzureAuth] User cancelled logout');
        userCancelled = true;
      } else if (errorMessage.includes('error -3') || errorMessage.includes('org.openid.appauth.general')) {
        // AppAuth error -3 (OIDErrorCodeUserCanceledAuthorizationFlow) is expected with Azure AD
        // on iOS. The logout endpoint clears the session but doesn't redirect back properly.
        log('[AzureAuth] Azure AD session cleared (browser dismissed - this is expected)');
      } else if (Platform.OS === 'android') {
        // Android Chrome Custom Tabs may throw on end-session; the server-side
        // session is still invalidated — continue to clear local state.
        log('[AzureAuth] Android logout error (continuing with local cleanup):', errorMessage);
      } else {
        if (__DEV__) {
          console.warn('[AzureAuth] Azure AD logout encountered an issue, clearing local state:', logoutError);
        }
      }
    }
  } else {
    log('[AzureAuth] No idToken available, performing local logout only');
  }

  // If the user explicitly cancelled, do NOT clear local state
  if (userCancelled) {
    throw new Error('User cancelled');
  }

  // Always clear local auth state — wrapped in try/catch so a Keychain
  // error on Android never prevents the React state from being reset.
  try {
    await clearAuth();
    log('[AzureAuth] Local auth state cleared');
  } catch (clearError) {
    if (__DEV__) {
      console.error('[AzureAuth] Failed to clear Keychain, forcing reset:', clearError);
    }
    // Best-effort: try once more with a slight delay (Android Keystore race)
    try { await clearAuth(); } catch { /* ignored */ }
  }
};

/**
 * Save authentication state to secure storage (Keychain/Keystore)
 */
export const saveAuth = async (authState: AuthResult): Promise<void> => {
  await Keychain.setGenericPassword('azure_auth', JSON.stringify(authState));
};

/**
 * Clear authentication state from secure storage
 */
export const clearAuth = async (): Promise<void> => {
  await Keychain.resetGenericPassword();
};

/**
 * Load authentication state from secure storage
 * Automatically refreshes expired tokens if refresh token is available
 */
export const loadAuth = async (): Promise<AuthResult | null> => {
  try {
    const credentials = await Keychain.getGenericPassword();

    if (!credentials) {
      return null;
    }

    const authState: AuthResult = JSON.parse(credentials.password);
    const expirationDate = new Date(authState.accessTokenExpirationDate);
    const userEmail: string = authState.userId;
    const now = new Date();

    log('[AzureAuth] Logging in as user:', userEmail);

    // Token is still valid (with buffer for proactive refresh)
    if (now.getTime() < expirationDate.getTime() - TOKEN_REFRESH_BUFFER_MS) {
      log('[AzureAuth] Token still valid, expires:', expirationDate.toISOString());
      return authState;
    }

    // Token expired or expiring soon - try to refresh
    if (authState.refreshToken) {
      log('[AzureAuth] Token expired, attempting refresh...');
      
      try {
        const refreshResult = await refresh(config, {
          refreshToken: authState.refreshToken,
        });

        log('[AzureAuth] Token refresh successful');

        const newAuthState = toAuthResult(refreshResult, userEmail);
        await saveAuth(newAuthState);
        return newAuthState;

      } catch (refreshError) {
        if (__DEV__) {
          console.error('[AzureAuth] Token refresh failed:', refreshError);
        }
        // Clear auth and require re-login
        await clearAuth();
        return null;
      }
    }

    // No refresh token available
    log('[AzureAuth] No refresh token, requiring re-login');
    await clearAuth();
    return null;

  } catch (error) {
    if (__DEV__) {
      console.error('[AzureAuth] Load auth failed:', error);
    }
    return null;
  }
};
