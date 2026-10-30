const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '15mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'API Gateway is running' });
});

// JWT verification middleware
const verifyToken = (req, res, next) => {
  if (
    req.path === '/health' && req.method === 'GET' ||
    req.path === '/auth/login' && req.method === 'POST' ||
    req.path === '/auth/register' && req.method === 'POST'
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ error: 'Authentication is not configured' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.userId || !['user', 'admin'].includes(decoded.role)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
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
  const baseURL = targetURL?.replace(/\/+$/, '');
  if (!baseURL) {
    return res.status(503).json({ error: 'Service URL is not configured' });
  }

  try {
    const url = `${baseURL}${prefix}${req.path}`;
    const isMedia = req.method === 'GET' && req.path.startsWith('/media/');
    const response = await axios({
      method: req.method,
      url,
      responseType: isMedia ? 'arraybuffer' : 'json',
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': req.headers['x-user-id'] || '',
        'x-user-role': req.headers['x-user-role'] || '',
        'authorization': req.headers['authorization'] || '',
      },
      params: req.query,
    });
    if (isMedia) {
      for (const header of ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options']) {
        if (response.headers[header]) res.set(header, response.headers[header]);
      }
      return res.status(response.status).send(Buffer.from(response.data));
    }
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      console.warn(`Upstream request failed: ${req.method} ${req.path} (${err.response.status})`);
      res.status(err.response.status).json(err.response.data);
    } else {
      console.error(`Upstream unavailable: ${req.method} ${req.path} (${err.code || err.name || 'unknown error'})`);
      res.status(503).json({ error: 'Service unavailable' });
    }
  }
};

// Routes
app.use('/auth', forward(process.env.USER_SERVICE_URL, '/auth'));
app.use('/chat', forward(process.env.CHAT_SERVICE_URL, '/chat'));
app.use('/moderation', forward(process.env.MODERATION_SERVICE_URL, ''));
app.use('/analytics', forward(process.env.ANALYTICS_SERVICE_URL, '/analytics'));

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

// Axios handles REST forwarding; Socket.IO requires a WebSocket-capable proxy.
let socketProxy;
if (process.env.CHAT_SERVICE_URL) {
  socketProxy = createProxyMiddleware({
    target: process.env.CHAT_SERVICE_URL,
    changeOrigin: true,
    ws: true,
    pathFilter: '/socket.io',
  });
  app.use(socketProxy);
}
const PORT = process.env.GATEWAY_PORT || 3000;
const server = app.listen(PORT, () => {
  const socketStatus = socketProxy ? '' : '; CHAT_SERVICE_URL is not configured';
  console.log(`API Gateway running on port ${PORT}${socketStatus}`);
});
if (socketProxy) server.on('upgrade', socketProxy.upgrade);
