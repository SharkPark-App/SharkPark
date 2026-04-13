import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithAzure, logoutFromAzure, loadAuth, saveAuth, AuthResult } from '../auth/AzureAuth';

export const geofenceLotFilterKey = (email: string) => `@geofence_lot_filter/${email}`;

type AuthState = AuthResult;

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthState | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthState | null>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // check for valid token on app launch
  useEffect(() => {
    const initAuth = async () => {
      const savedUser = await loadAuth();
      if (savedUser) {
        setUser(savedUser);
        setIsAuthenticated(true);
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
      setUser(tokens);
      setIsAuthenticated(true);
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
    
    // Clear the per-user geofence lot filter so a subsequent login (same or
    // different account) starts with a clean default.
    if (user?.userId) {
      await AsyncStorage.removeItem(geofenceLotFilterKey(user.userId)).catch(() => {});
    }

    // Clear React state (local storage already cleared in logoutFromAzure)
    setUser(null);
    setIsAuthenticated(false);
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

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, refreshSession, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};