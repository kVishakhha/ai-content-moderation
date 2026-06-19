import { useAuth } from '../context/AuthContext';

const Chat = () => {
  const { user, logout } = useAuth();

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Chat Page</h2>
      <p>Welcome, user {user?.userId}!</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
};

export default Chat;