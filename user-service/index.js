const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import database connection
const pool = require('./config/db');

// Import routes
const authRoutes = require('./routes/auth');

const app = express();

// Middleware - these run on every request
app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'User Service is running' });
});

// Start the server
const PORT = process.env.USER_SERVICE_PORT || 3001;
app.listen(PORT, () => {
  console.log(`User Service running on port ${PORT}`);
});