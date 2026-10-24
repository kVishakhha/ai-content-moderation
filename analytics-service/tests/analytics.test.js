const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const createAnalyticsRouter = require('../routes/analytics');

process.env.JWT_SECRET = 'analytics-test-secret';

async function startServer(pool) {
  const app = express();
  app.use(express.json());
  app.use('/analytics', createAnalyticsRouter(pool));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/analytics`,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

function bearer(role = 'admin') {
  const token = jwt.sign({ userId: 7, role }, process.env.JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

test('summary returns moderation totals, daily counts, and review statuses', async (t) => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FROM messages') && sql.includes('total_messages')) {
        return { rows: [{ total_messages: 12, allowed: 7, warned: 3, blocked: 2, text_messages: 10, image_messages: 2 }] };
      }
      if (sql.includes('GROUP BY created_at::date')) {
        return { rows: [{ date: '2026-10-24', count: 5 }] };
      }
      return { rows: [{ pending: 2, resolved: 1, confirmed: 1, dismissed: 0 }] };
    },
  };
  const server = await startServer(pool);
  t.after(server.close);

  const response = await fetch(`${server.url}/summary`, { headers: bearer() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    totals: { total_messages: 12, allowed: 7, warned: 3, blocked: 2, text_messages: 10, image_messages: 2 },
    daily: [{ date: '2026-10-24', count: 5 }],
    reviews: { pending: 2, resolved: 1, confirmed: 1, dismissed: 0 },
  });
  assert.equal(calls.length, 3);
});

test('review endpoint is admin-only', async (t) => {
  const server = await startServer({ query: async () => ({ rows: [] }) });
  t.after(server.close);

  const response = await fetch(`${server.url}/reviews`, { headers: bearer('user') });
  assert.equal(response.status, 403);
});

test('review resolution records admin and outcome', async (t) => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 3, message_id: 12, status: 'resolved', resolution: 'confirmed', admin_id: 7 }] };
    },
  };
  const server = await startServer(pool);
  t.after(server.close);

  const response = await fetch(`${server.url}/reviews/3`, {
    method: 'PATCH',
    headers: { ...bearer(), 'content-type': 'application/json' },
    body: JSON.stringify({ resolution: 'confirmed' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].values, ['confirmed', 7, '3']);
  assert.equal((await response.json()).review.status, 'resolved');
});

test('invalid review resolution is rejected before querying the database', async (t) => {
  const server = await startServer({
    query: async () => {
      assert.fail('invalid review resolution should not access the database');
    },
  });
  t.after(server.close);

  const response = await fetch(`${server.url}/reviews/3`, {
    method: 'PATCH',
    headers: { ...bearer(), 'content-type': 'application/json' },
    body: JSON.stringify({ resolution: 'delete' }),
  });
  assert.equal(response.status, 400);
});
