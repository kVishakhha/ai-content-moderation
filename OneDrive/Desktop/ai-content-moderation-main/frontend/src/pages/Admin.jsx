import { useAuth } from '../context/AuthContext';

const Admin = () => {
  const { user, logout } = useAuth();

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Admin Dashboard</h2>
      <p>Welcome, admin {user?.userId}!</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
};

export default Admin;