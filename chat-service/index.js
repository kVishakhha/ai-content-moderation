const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const pool = require('./config/db');
const chatRoutes = require('./routes/chat');

const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '15mb' }));

// ----- HTTP server + Socket.IO on the same port (3002) -----
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // dev only; lock down in production
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string') {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.userId) return next(new Error('Invalid token'));
    socket.data.userId = String(decoded.userId);
    return next();
  } catch {
    return next(new Error('Invalid or expired token'));
  }
});

// Track which user is connected on which socket.
// Map<userId(string), socketId(string)>
const onlineUsers = new Map();

// Make io + the online map available to controllers via req.app.get(...)
app.set('io', io);
app.set('onlineUsers', onlineUsers);

function broadcastPresence() {
  // send the list of online user-ids to everyone
  io.emit('presence', Array.from(onlineUsers.keys()));
}

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  onlineUsers.set(userId, socket.id);
  console.log(`User ${userId} online (socket ${socket.id})`);
  broadcastPresence();

  socket.on('disconnect', () => {
    for (const [uid, sid] of onlineUsers.entries()) {
      if (sid === socket.id) {
        onlineUsers.delete(uid);
        console.log(`User ${uid} offline`);
        break;
      }
    }
    broadcastPresence();
  });
});

// ----- Routes -----
app.use('/chat', chatRoutes);
app.get('/health', (req, res) => {
  res.json({ status: 'Chat Service is running' });
});

// Return bounded, machine-readable errors for body-parser failures.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, 'body')) {
    return res.status(400).json({ error: 'Request body must be valid JSON' });
  }
  return next(err);
});

const PORT = process.env.CHAT_SERVICE_PORT || 3002;
// NOTE: listen on `server`, not `app`, so Socket.IO works.
server.listen(PORT, () => {
  console.log(`Chat Service running on port ${PORT}`);
});