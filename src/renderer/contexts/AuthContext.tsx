import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { UserRole, Permissions, UserInfo } from '../types/person';
import { getPermissions } from '../types/person';
import { api } from '../api/bridge';

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

interface AuthContextType {
  user: AuthUser | null;
  permissions: Permissions;
  setUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const defaultPermissions: Permissions = {
  canEdit: false,
  canDelete: false,
  canManageUsers: false,
  canManageData: false,
  canManageSettings: false,
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  permissions: defaultPermissions,
  setUser: () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<AuthUser | null>(null);

  const permissions = user ? getPermissions(user.role) : defaultPermissions;

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // ignore
    }
    setUserState(null);
    // 导航到登录页
    window.location.hash = '#/';
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.auth.me();
      if (me) {
        setUserState({
          id: me.id,
          username: me.username,
          displayName: me.displayName,
          role: me.role,
        });
      }
    } catch {
      // 未登录
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, permissions, setUser, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
