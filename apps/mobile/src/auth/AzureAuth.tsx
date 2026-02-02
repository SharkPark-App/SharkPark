import {
  authorize,
  refresh,
  logout,
  AuthConfiguration,
  AuthorizeResult,
  RefreshResult
} from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';
import API_CONFIG from '../services/api/config';
import { jwtDecode } from 'jwt-decode';

const CLIENT_ID = '9aea0ab1-4502-4868-a31b-0a8f333cec9c';
const TENANT_ID = 'd175679b-acd3-4644-be82-af041982977a'; // specific to CSULB
const PACKAGE_NAME = 'com.sharkpark.mobile';
const SIGNATURE_HASH = 'pCBsiXaNNNC6c0uvCpHWkdYi2Mk='; // generated as ID for Azure registration

// configuration
const azureConfig: AuthConfiguration = {
  issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
  clientId: CLIENT_ID,
  redirectUrl: `msauth://${PACKAGE_NAME}/${SIGNATURE_HASH}`,
  scopes: [
    'openid',
    'profile',
    'email',
    'offline_access' // required to get a refresh token
  ],
  additionalParameters: {
    prompt: 'select_account', // explicitly direct to the account selection screen
  },
};

interface AzureToken {
  preferred_username?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  exp: number;
}

// login initiator
export const loginWithAzure = async () => {
  try {
    const tokens = await authorize(azureConfig);

    const decoded = jwtDecode<AzureToken>(tokens.idToken);
    const userEmail = decoded.preferred_username || decoded.email;

    if (!userEmail) {
      throw new Error('No email found in token');
    }

    // triggers azure.strategy for backend and thus findOrCreateUser()
    const response = await fetch(`${API_CONFIG.BASE_URL}/users/${userEmail}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokens.idToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Error sending credentials to backend');
    }

    return tokens;
  } catch (error) {
    console.error('Azure Login Failed:', error);
    throw error;
  }
};

// logout initiator
export const logoutFromAzure = async (idToken: string) => {
  try {
    await logout(azureConfig, {

      idToken: idToken, // needed to end the corresponding session via Azure
      postLogoutRedirectUrl: `msauth://${PACKAGE_NAME}/${SIGNATURE_HASH}`,

    });
  } catch (error) {
    // 'User cancelled flow' always triggers due to user closing browser window afterwards
    const errorMessage = (error as Error).message || 'Unknown login error';

    if(!errorMessage.includes('User cancelled flow')) {
      console.error('Azure logout failed', error);
      throw error;
    }
  }
};

export const saveAuth = async (authState: AuthorizeResult | RefreshResult) => {
  // stringify and store token as a password
  await Keychain.setGenericPassword('user', JSON.stringify(authState));
};

export const clearAuth = async () => {
  await Keychain.resetGenericPassword();
};

export const loadAuth = async () => {
  try {
    const credentials = await Keychain.getGenericPassword();

    if (credentials) {
      const authState = JSON.parse(credentials.password);

      // check if token is expired
      const expirationDate = new Date(authState.accessTokenExpirationDate);
      const now = new Date();

      // attempt refresh if expired
      if (now >= expirationDate) {
        const newAuthState = await refresh(azureConfig, {
          refreshToken: authState.refreshToken,
        });

        // save refreshed token
        await saveAuth(newAuthState);
        return newAuthState;
      }

      // token is valid
      return authState;
    }
  } catch (error) {
    console.error('Auto-login failed:', error);
    return null; // re-try login
  }
  return null;
};