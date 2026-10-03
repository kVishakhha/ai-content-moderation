const pool = require('../config/db');
const { mockModerate } = require('../config/mockModeration');
const axios = require('axios');

function getIO(req) {
  return req.app.get('io');
}
function getOnlineUsers(req) {
  return req.app.get('onlineUsers');
}

// ============================================================
// Moderation call with:
//   1. a TIMEOUT so a slow/down moderation service never freezes chat
//   2. a FAIL-SAFE fallback decision if moderation is unavailable
//   3. LATENCY measurement (ms) returned alongside the result
//
// Fail policy: if moderation is unreachable we FAIL SAFE by treating
// the message as "warn" (delivered but flagged) rather than silently
// allowing it. This is a deliberate, defensible choice — discuss it
// in the report: fail-open (allow) vs fail-closed (block) vs this
// middle ground (deliver-but-flag).
// ============================================================
const MODERATION_TIMEOUT_MS = 800; // tune as needed

async function moderate(text) {
  const start = Date.now();

  try {
    // ---- REAL model (Meetali's service on port 3003) ----
    const res = await axios.post(
      `${process.env.MODERATION_SERVICE_URL}/moderate`,
      { text },
      { timeout: MODERATION_TIMEOUT_MS }
    );
    const latencyMs = Date.now() - start;
    return {
      score: res.data.score,
      decision: res.data.decision,
      latencyMs,
      moderated: true,        // real model answered
      fallback: false,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    // Timeout, connection refused, or any moderation failure lands here.
    const reason = err.code === 'ECONNABORTED' ? 'timeout' : (err.code || 'error');
    console.warn(`moderation unavailable (${reason}) after ${latencyMs}ms — failing safe to 'warn'`);

    // FAIL SAFE: deliver but flag, so nothing is silently let through,
    // and a human can review it via the queue.
    return {
      score: null,
      decision: 'warn',
      latencyMs,
      moderated: false,       // real model did NOT answer
      fallback: true,
    };
  }
}

// POST /chat/send
async function sendMessage(req, res) {
  try {
    const senderId = req.headers['x-user-id'];
    const { receiver_id, content } = req.body;

    if (!senderId) return res.status(401).json({ error: 'No user id from gateway' });
    if (!receiver_id || !content) {
      return res.status(400).json({ error: 'receiver_id and content are required' });
    }

    // moderate (with timeout + fallback + latency)
    const { score, decision, latencyMs, moderated, fallback } = await moderate(content);

    // Log the latency so we have real numbers for the report.
    console.log(
      `[latency] moderation=${latencyMs}ms decision=${decision} ` +
      `moderated=${moderated}${fallback ? ' (FALLBACK)' : ''}`
    );

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, decision, confidence_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [senderId, receiver_id, content, decision, score]
    );
    const saved = result.rows[0];

    // real-time push if not blocked
    if (decision !== 'block') {
      const io = getIO(req);
      const online = getOnlineUsers(req);
      if (io && online) {
        const receiverSocket = online.get(String(receiver_id));
        if (receiverSocket) io.to(receiverSocket).emit('new_message', saved);
      }
    }

    return res.status(201).json({
      message: saved,
      decision,
      score,
      delivered: decision !== 'block',
      latencyMs,        // sent back so the UI/report can use it
      fallback,         // true if moderation was unavailable
    });
  } catch (err) {
    console.error('sendMessage error:', err);
    return res.status(500).json({ error: 'Something went wrong sending the message' });
  }
}

// GET /chat/conversation/:otherUserId
async function getConversation(req, res) {
  try {
    const userId = req.headers['x-user-id'];
    const otherUserId = req.params.otherUserId;
    if (!userId) return res.status(401).json({ error: 'No user id from gateway' });

    const result = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [userId, otherUserId]
    );

    const visible = result.rows.filter((m) => {
      if (m.decision !== 'block') return true;
      return String(m.sender_id) === String(userId);
    });

    return res.json({ messages: visible });
  } catch (err) {
    console.error('getConversation error:', err);
    return res.status(500).json({ error: 'Something went wrong loading the conversation' });
  }
}

// GET /chat/conversations
async function getConversationList(req, res) {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'No user id from gateway' });

    const result = await pool.query(
      `
      WITH convo AS (
        SELECT
          CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_id,
          content, decision, sender_id, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END
            ORDER BY created_at DESC
          ) AS rn
        FROM messages
        WHERE sender_id = $1 OR receiver_id = $1
      )
      SELECT c.other_id, u.username, c.content AS last_message,
             c.decision AS last_decision, c.sender_id AS last_sender, c.created_at
      FROM convo c
      JOIN users u ON u.id = c.other_id
      WHERE c.rn = 1
      ORDER BY c.created_at DESC
      `,
      [userId]
    );

    return res.json({ conversations: result.rows });
  } catch (err) {
    console.error('getConversationList error:', err);
    return res.status(500).json({ error: 'Could not load conversations' });
  }
}

// GET /chat/users/search?q=...
async function searchUsers(req, res) {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'No user id from gateway' });

    const q = (req.query.q || '').trim();
    if (!q) return res.json({ users: [] });

    const result = await pool.query(
      `SELECT id, username, email FROM users
       WHERE (username ILIKE $1 OR email ILIKE $1)
         AND id <> $2
       ORDER BY username ASC
       LIMIT 20`,
      [`%${q}%`, userId]
    );

    return res.json({ users: result.rows });
  } catch (err) {
    console.error('searchUsers error:', err);
    return res.status(500).json({ error: 'Could not search users' });
  }
}

module.exports = {
  sendMessage,
  getConversation,
  getConversationList,
  searchUsers,
};