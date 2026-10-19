import { createContext, useContext, useState } from 'react';

const AuthContext = createContext();

function getUserFromToken(token) {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;

    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (!payload.userId || !['user', 'admin'].includes(payload.role)) return null;
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;

    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken && getUserFromToken(savedToken)) return savedToken;
    localStorage.removeItem('token');
    return null;
  });
  const [user, setUser] = useState(() => (token ? getUserFromToken(token) : null));

  const login = (newToken) => {
    const newUser = getUserFromToken(newToken);
    if (!newUser) throw new Error('Login returned an invalid or expired token');

    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(newUser);
    return newUser;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);