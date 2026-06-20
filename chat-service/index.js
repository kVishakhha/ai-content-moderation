const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const pool = require('./config/db');
const chatRoutes = require('./routes/chat');

const app = express();
app.use(cors());
app.use(express.json());

// ----- HTTP server + Socket.IO on the same port (3002) -----
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // dev only; lock down in production
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
  // The frontend tells us who it is right after connecting.
  socket.on('register', (userId) => {
    if (userId == null) return;
    onlineUsers.set(String(userId), socket.id);
    console.log(`User ${userId} online (socket ${socket.id})`);
    broadcastPresence();
  });

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

const PORT = process.env.CHAT_SERVICE_PORT || 3002;
// NOTE: listen on `server`, not `app`, so Socket.IO works.
server.listen(PORT, () => {
  console.log(`Chat Service running on port ${PORT}`);
});