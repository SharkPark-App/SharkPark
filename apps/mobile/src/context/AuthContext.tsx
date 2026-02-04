import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import * as Keychain from 'react-native-keychain';
import { logoutFromAzure, loadAuth, saveAuth } from '../auth/AzureAuth';
import { AuthorizeResult, RefreshResult } from 'react-native-app-auth';

type AuthState = AuthorizeResult | RefreshResult;

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthState | null;
  login: (authResult: AuthState) => Promise<void>;
  logout: () => Promise<void>;
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
  const login = async (authResult: AuthState) => {
    await saveAuth(authResult); // save to keychain
    setUser(authResult);
    setIsAuthenticated(true);
  };

  // handle Logout
  const logout = async () => {
    try {
      // invoke azure logout to clear browser cookie
      if (user && 'idToken' in user) {
        await logoutFromAzure(user.idToken);
      }
    } catch (error) {
      // 'User cancelled flow' always triggers due to user closing browser window afterwards
      const errorMessage = (error as Error).message || 'Unknown login error';

      if(!errorMessage.includes('User cancelled flow')) {
        console.error('Azure logout failed', error);
        throw error;
      }
    } finally {
      // clear local storage & state
      await Keychain.resetGenericPassword();
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};