import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Chat from './pages/Chat';
import Admin from './pages/Admin';

const RoleRoute = ({ children, role }) => {
  const { token, user } = useAuth();
  if (!token || !user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/chat'} replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { token, user } = useAuth();
  if (token && user) return <Navigate to={user.role === 'admin' ? '/admin' : '/chat'} replace />;
  return children;
};

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/chat" element={
            <RoleRoute role="user"><Chat /></RoleRoute>
          } />
          <Route path="/admin" element={
            <RoleRoute role="admin"><Admin /></RoleRoute>
          } />
          <Route path="/" element={<HomeRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

const HomeRedirect = () => {
  const { token, user } = useAuth();
  if (!token || !user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/chat'} replace />;
};

export default App;