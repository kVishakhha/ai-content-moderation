const pool = require('../config/db');
const axios = require('axios');

function getIO(req) {
  return req.app.get('io');
}
function getOnlineUsers(req) {
  return req.app.get('onlineUsers');
}

const MODERATION_TIMEOUT_MS = 800;
const VALID_DECISIONS = new Set(['allow', 'warn', 'block']);
const MAX_MESSAGE_LENGTH = 5000;

// Calls the real FastAPI moderation service. If it is unavailable or returns
// an invalid response, keep the message visible as "warn" and mark fallback=true
// so the UI/review workflow can distinguish this from a model decision.
async function moderate(text) {
  const start = Date.now();

  try {
    const serviceUrl = process.env.MODERATION_SERVICE_URL;
    if (!serviceUrl) throw new Error('MODERATION_SERVICE_URL is not configured');

    const res = await axios.post(
      `${serviceUrl.replace(/\/$/, '')}/moderate`,
      { text },
      { timeout: MODERATION_TIMEOUT_MS }
    );

    const { score, decision } = res.data || {};
    if (!VALID_DECISIONS.has(decision)) {
      throw new Error('Moderation service returned an invalid decision');
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error('Moderation service returned an invalid score');
    }

    return {
      score,
      decision,
      latencyMs: Date.now() - start,
      moderated: true,
      fallback: false,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const reason = err.code === 'ECONNABORTED' ? 'timeout' : (err.code || err.message || 'error');
    console.warn(`moderation unavailable (${reason}) after ${latencyMs}ms — using fallback warn decision`);

    // Deliberate middle-ground policy: deliver but flag for review. This is
    // NOT fail-closed; a strict safety deployment should block on this path.
    return {
      score: null,
      decision: 'warn',
      latencyMs,
      moderated: false,
      fallback: true,
    };
  }
}

// POST /chat/send
async function sendMessage(req, res) {
  try {
    const senderId = req.headers['x-user-id'];
    const { receiver_id, content } = req.body || {};

    if (!senderId) return res.status(401).json({ error: 'No user id from gateway' });
    if (!receiver_id || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'receiver_id and non-empty content are required' });
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `content must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const { score, decision, latencyMs, fallback } = await moderate(content);

    console.log(
      `[latency] moderation=${latencyMs}ms decision=${decision}` +
      `${fallback ? ' (FALLBACK)' : ''}`
    );

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, decision, confidence_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [senderId, receiver_id, content, decision, score]
    );
    const saved = result.rows[0];

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
      latencyMs,
      fallback,
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
