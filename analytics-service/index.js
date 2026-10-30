const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const createAnalyticsRouter = require('./routes/analytics');

dotenv.config();

const pool = new Pool({
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'Analytics Service is running' }));
app.use('/analytics', createAnalyticsRouter(pool));

app.use((err, _req, res, _next) => {
  console.error('Analytics request failed:', err);
  res.status(500).json({ error: 'Analytics request failed' });
});

const port = process.env.ANALYTICS_SERVICE_PORT || 3004;
app.listen(port, () => console.log(`Analytics Service running on port ${port}`));
