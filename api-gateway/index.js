const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// JWT verification middleware
const verifyToken = (req, res, next) => {
  if (req.path.startsWith('/auth/login') || req.path.startsWith('/auth/register')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.headers['x-user-id'] = String(decoded.userId);
    req.headers['x-user-role'] = decoded.role;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

app.use(verifyToken);

// Forward request helper
const forward = (targetURL, prefix) => async (req, res) => {
  try {
    const url = `${targetURL}${prefix}${req.path}`;
    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': req.headers['x-user-id'] || '',
        'x-user-role': req.headers['x-user-role'] || '',
        'authorization': req.headers['authorization'] || '',
      },
      params: req.query,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      res.status(err.response.status).json(err.response.data);
    } else {
      res.status(503).json({ error: 'Service unavailable' });
    }
  }
};

// Routes
app.use('/auth', forward(process.env.USER_SERVICE_URL, '/auth'));
app.use('/chat', forward(process.env.CHAT_SERVICE_URL, '/chat'));
app.use('/analytics', forward(process.env.ANALYTICS_SERVICE_URL, '/analytics'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'API Gateway is running' });
});

const PORT = process.env.GATEWAY_PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});