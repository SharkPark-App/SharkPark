import { authorize, refresh, logout, AuthConfiguration } from 'react-native-app-auth';

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

// login initiator
export const loginWithAzure = async () => {
  try {
    const result = await authorize(azureConfig);

    // TODO: remove logs such as these before submitting PR
    console.log('Access Token:', result.accessToken);
    console.log('ID Token (User Info):', result.idToken);

    return result;

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
    console.log('Azure session cleared');
  } catch (error) {
    console.error('Logout failed:', error);
    throw error;
  }
};

// token refresh
// TODO: automatically invoke upon token expiration
export const refreshAzureToken = async (refreshToken: string) => {
  try {
    const result = await refresh(azureConfig, {
      refreshToken: refreshToken,
    });
    return result;
  } catch (error) {
    console.error('Token Refresh Failed:', error);
    throw error;
  }
};