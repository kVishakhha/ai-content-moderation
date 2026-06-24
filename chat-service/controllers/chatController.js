const pool = require('../config/db');
const axios = require('axios');

// We grab the live Socket.IO instance + the online-user map from index.js.
// (set in index.js via app.set(...) — see that file.)
function getIO(req) {
  return req.app.get('io');
}
function getOnlineUsers(req) {
  return req.app.get('onlineUsers'); // Map<userId, socketId>
}

// ============================================================
// Helper: get a moderation result for a piece of text.
// RIGHT NOW: uses the mock. LATER: swap to the axios block.
// ============================================================
async function moderate(text) {
  try {
    const res = await axios.post(
      `${process.env.MODERATION_SERVICE_URL}/moderate`,
      { text }
    );

    return {
      score: res.data.score,
      decision: res.data.decision,
    };
  } catch (error) {
    console.error('Moderation service error:', error.message);

    // fail-safe
    return {
      score: 0,
      decision: 'allow',
    };
  }
}

// POST /chat/send   body: { receiver_id, content }
async function sendMessage(req, res) {
  try {
    const senderId = req.headers['x-user-id'];
    const { receiver_id, content } = req.body;

    if (!senderId) return res.status(401).json({ error: 'No user id from gateway' });
    if (!receiver_id || !content) {
      return res.status(400).json({ error: 'receiver_id and content are required' });
    }

    // 1. moderate
    const { score, decision } = await moderate(content);

    // 2. store with decision + score
    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, decision, confidence_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [senderId, receiver_id, content, decision, score]
    );
    const saved = result.rows[0];

    // 3. REAL-TIME: if not blocked, push the message live to the receiver
    //    via Socket.IO.
    if (decision !== 'block') {
      const io = getIO(req);
      const online = getOnlineUsers(req);
      if (io && online) {
        const receiverSocket = online.get(String(receiver_id));
        if (receiverSocket) {
          io.to(receiverSocket).emit('new_message', saved);
        }
      }
    }

    // 4. respond to the sender
    return res.status(201).json({
      message: saved,
      decision,
      score,
      delivered: decision !== 'block',
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

// GET /chat/conversations  -> sidebar conversation list
async function getConversationList(req, res) {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'No user id from gateway' });

    const result = await pool.query(
      `
      WITH convo AS (
        SELECT
          CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_id,
          content,
          decision,
          sender_id,
          created_at,
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

// GET /chat/users/search?q=...  -> find users to start a new chat
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