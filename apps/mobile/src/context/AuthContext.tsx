import React, { createContext, useState, useContext, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import { loginWithAzure, logoutFromAzure, loadAuth, saveAuth, AuthResult } from '../auth/AzureAuth';
import { initPushNotifications, unregisterCurrentPushToken } from '../services/pushNotifications';

const GUEST_MODE_KEY = '@SharkPark:isGuest';
const GUEST_FLAG = 'true';

export const geofenceLotFilterKey = (email: string) => `@geofence_lot_filter/${email}`;

type AuthState = AuthResult;

interface AuthContextType {
  isAuthenticated: boolean;
  isGuest: boolean;
  user: AuthState | null;
  /** Email decoded from the active idToken — null for guests/unauthenticated. */
  userEmail: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthState | null>;
  continueAsGuest: () => Promise<void>;
  exitGuestMode: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [user, setUser] = useState<AuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Holds the unsubscribe function returned by initPushNotifications so we
  // can clean up the token-refresh listener on sign-out.
  const pushUnsubscribeRef = useRef<(() => void) | null>(null);

  // Derive email from the idToken whenever `user` changes.
  const userEmail = React.useMemo<string | null>(() => {
    if (!user?.idToken) return null;
    try {
      const decoded = jwtDecode<{ preferred_username?: string; email?: string }>(user.idToken);
      return decoded.preferred_username ?? decoded.email ?? null;
    } catch {
      return null;
    }
  }, [user]);

  // Helper: start push flow and store the cleanup handle.
  const startPushNotifications = async () => {
    const unsub = await initPushNotifications();
    pushUnsubscribeRef.current = unsub;
  };

  // Helper: tear down push listener on sign-out.
  const stopPushNotifications = () => {
    pushUnsubscribeRef.current?.();
    pushUnsubscribeRef.current = null;
  };

  // check for valid token on app launch
  useEffect(() => {
    const initAuth = async () => {
      const [savedUser, guestFlag] = await Promise.all([
        loadAuth(),
        AsyncStorage.getItem(GUEST_MODE_KEY).catch(() => null),
      ]);
      if (savedUser) {
        setUser(savedUser);
        setIsAuthenticated(true);
        // Re-register push token for returning authenticated users so that
        // a reinstall or token rotation after a cold start is handled.
        startPushNotifications().catch(() => {});
        // Opportunistically clear a stale guest flag that may have been left
        // from a previous session before the user signed in.
        if (guestFlag !== null) {
          AsyncStorage.removeItem(GUEST_MODE_KEY).catch((e) => {
            if (__DEV__) console.warn('[AuthContext] Failed to clear stale guest flag:', e);
          });
        }
      } else if (guestFlag === GUEST_FLAG) {
        setIsGuest(true);
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  // handle Login
  const login = async () => {
    if (__DEV__) console.log('[AuthContext] Login started');
    setIsLoading(true);
    try {
      // ID & access tokens
      if (__DEV__) console.log('[AuthContext] Calling loginWithAzure...');
      const tokens = await loginWithAzure();
      if (__DEV__) console.log('[AuthContext] Got tokens, saving...');

      await saveAuth(tokens);
      if (__DEV__) console.log('[AuthContext] Tokens saved, setting authenticated');
      await AsyncStorage.removeItem(GUEST_MODE_KEY).catch((e) => {
        if (__DEV__) console.warn('[AuthContext] Failed to clear guest flag on login:', e);
      });
      setIsGuest(false);
      setUser(tokens);
      setIsAuthenticated(true);
      // Register the device push token now that we have a valid session.
      startPushNotifications().catch(() => {});
      if (__DEV__) console.log('[AuthContext] Login complete, isAuthenticated=true');

    } catch (error) {
      console.error('[AuthContext] Login canceled or failed:', error);
      throw error;
    } finally {
      if (__DEV__) console.log('[AuthContext] Setting isLoading=false');
      setIsLoading(false);
    }
  };

  // Handle Logout
  const logout = async () => {
    // Unregister this device's FCM token on the backend BEFORE clearing
    // local auth — the request needs the access token to authenticate, and
    // logoutFromAzure wipes saved credentials. Best-effort; never blocks
    // logout (errors are swallowed inside unregisterCurrentPushToken).
    await unregisterCurrentPushToken();

    try {
      // Invoke Azure logout to clear browser cookie/session
      // logoutFromAzure handles clearing local auth state internally
      await logoutFromAzure(user?.idToken);
    } catch (error) {
      const errorMessage = (error as Error).message ?? '';
      
      // User cancellation is not an error - don't clear state
      if (errorMessage.includes('User cancelled') || errorMessage.includes('cancel')) {
        if (__DEV__) console.log('[AuthContext] User cancelled logout');
        return; // Exit without clearing state
      }
      
      // Log unexpected errors but still clear local state
      if (__DEV__) console.error('[AuthContext] Azure logout error:', error);
    }

    // Clear React state (local storage already cleared in logoutFromAzure)
    setUser(null);
    setIsAuthenticated(false);
    // Tear down the push token-refresh listener — the token belongs to
    // this user's session and should not be re-registered after sign-out.
    stopPushNotifications();
    // Defensively clear the guest flag in case it was set in a prior session
    AsyncStorage.removeItem(GUEST_MODE_KEY).catch((e) => {
      if (__DEV__) console.warn('[AuthContext] Failed to clear guest flag on logout:', e);
    });
    setIsGuest(false);
  };

  // Handle Session Refresh
  const refreshSession = async (): Promise<AuthState | null> => {
    const savedUser = await loadAuth();
    if (!savedUser) {
      if (__DEV__) console.log('[AuthContext] Refresh failed, logging user out...');
      setUser(null);
      setIsAuthenticated(false);
    } else {
      if (__DEV__) console.log('[AuthContext] Refresh succeeded, returning new credentials...');
      setUser(savedUser);
    }
    return savedUser;
  };

  const continueAsGuest = async () => {
    await AsyncStorage.setItem(GUEST_MODE_KEY, GUEST_FLAG).catch((e) => {
      if (__DEV__) console.warn('[AuthContext] Failed to persist guest flag:', e);
    });
    setIsGuest(true);
  };

  const exitGuestMode = async () => {
    await AsyncStorage.removeItem(GUEST_MODE_KEY).catch((e) => {
      if (__DEV__) console.warn('[AuthContext] Failed to clear guest flag:', e);
    });
    setIsGuest(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isGuest, user, userEmail, login, logout, refreshSession, continueAsGuest, exitGuestMode, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};