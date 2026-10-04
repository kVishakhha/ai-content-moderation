const pool = require('../config/db');
const axios = require('axios');

const MODERATION_TIMEOUT_MS = Number(process.env.MODERATION_TIMEOUT_MS) > 0
  ? Number(process.env.MODERATION_TIMEOUT_MS)
  : 30000;
const VALID_DECISIONS = new Set(['allow', 'warn', 'block']);
const DECISION_RANK = { allow: 0, warn: 1, block: 2 };

class ModerationError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getIO(req) {
  return req.app.get('io');
}
function getOnlineUsers(req) {
  return req.app.get('onlineUsers');
}

function validScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validPart(result) {
  return result && typeof result === 'object' &&
    VALID_DECISIONS.has(result.decision) && validScore(result.score);
}

function validateModerationResponse(data, expectsText, expectsImage) {
  if (!validPart(data)) return false;
  const parts = [];
  if (expectsText) {
    if (!validPart(data.text)) return false;
    parts.push(data.text);
  }
  if (expectsImage) {
    const image = data.image;
    const categories = image && image.categories;
    const weapons = categories && categories.weapons;
    if (!validPart(image) || !categories ||
        !validScore(categories.normal) || !validScore(categories.nsfw) ||
        !weapons || typeof weapons.detected !== 'boolean' || !Array.isArray(weapons.detections)) {
      return false;
    }
    if (!weapons.detections.every((detection) => detection &&
        typeof detection.label === 'string' && validScore(detection.confidence))) return false;
    parts.push(image);
  }
  if (parts.length === 0) return false;
  const expectedDecision = parts.reduce((highest, part) =>
    DECISION_RANK[part.decision] > DECISION_RANK[highest] ? part.decision : highest,
  'allow');
  const expectedScore = Math.max(...parts.map((part) => part.score));
  return data.decision === expectedDecision && Math.abs(data.score - expectedScore) <= 0.0001;
}

async function moderate(content, imageBase64, mimeType) {
  const serviceUrl = process.env.MODERATION_SERVICE_URL;
  if (typeof serviceUrl !== 'string' || !serviceUrl.trim()) {
    throw new ModerationError(503, 'Moderation service is not configured');
  }

  const payload = {};
  const expectsText = typeof content === 'string' && content.length > 0;
  const expectsImage = typeof imageBase64 === 'string' && imageBase64.length > 0;
  if (expectsText) payload.text = content;
  if (expectsImage) {
    payload.image_base64 = imageBase64;
    payload.mime_type = mimeType;
  }

  const startedAt = Date.now();
  try {
    const response = await axios.post(
      `${serviceUrl.replace(/\/+$/, '')}/moderate-content`,
      payload,
      { timeout: MODERATION_TIMEOUT_MS }
    );
    if (!validateModerationResponse(response.data, expectsText, expectsImage)) {
      throw new ModerationError(503, 'Moderation service returned an invalid response');
    }
    return { result: response.data, latencyMs: Date.now() - startedAt };
  } catch (err) {
    if (err instanceof ModerationError) throw err;
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new ModerationError(504, 'Moderation service timed out');
    }
    if (err.response) {
      const status = err.response.status;
      if (status === 400 || status === 413 || status === 415 || status === 422) {
        const mappedStatus = status === 422 ? 400 : status;
        const message = status === 415 ? 'Unsupported image format' :
          status === 413 ? 'Image is too large' : 'Invalid moderation input';
        throw new ModerationError(mappedStatus, message);
      }
      throw new ModerationError(503, 'Moderation service is unavailable');
    }
    throw new ModerationError(503, 'Moderation service is unavailable');
  }
}

// POST /chat/send
async function sendMessage(req, res) {
  try {
    const senderId = req.headers['x-user-id'];
    const { receiver_id: receiverId, content, image_base64: imageBase64, mime_type: mimeType } = req.body || {};
    const hasText = typeof content === 'string' && content.trim().length > 0;
    const hasImage = typeof imageBase64 === 'string' && imageBase64.length > 0;

    if (!senderId) return res.status(401).json({ error: 'No user id from gateway' });
    if (!receiverId) return res.status(400).json({ error: 'receiver_id is required' });
    if (content !== undefined && content !== null && typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    if (imageBase64 !== undefined && imageBase64 !== null && typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'image_base64 must be a base64 string' });
    }
    if ((imageBase64 !== undefined || mimeType !== undefined) && (!hasImage || typeof mimeType !== 'string' || !mimeType)) {
      return res.status(400).json({ error: 'image_base64 and mime_type must be provided together' });
    }
    if (!hasText && !hasImage) {
      return res.status(400).json({ error: 'content or image_base64 is required' });
    }

    let moderation;
    let latencyMs;
    try {
      const result = await moderate(hasText ? content : null, hasImage ? imageBase64 : null, mimeType);
      moderation = result.result;
      latencyMs = result.latencyMs;
    } catch (err) {
      if (err instanceof ModerationError) {
        console.warn(`moderation failed (${err.statusCode}): ${err.message}`);
        return res.status(err.statusCode).json({ error: err.message, moderated: false, delivered: false });
      }
      throw err;
    }

    const { score, decision } = moderation;
    console.log(`[latency] moderation=${latencyMs}ms decision=${decision}`);

    // The current message table and socket contract store/display text only.
    // Never claim an image was saved or delivered until image storage is supported.
    if (hasImage) {
      if (decision === 'block') {
        const auditContent = hasText ? content : '[blocked image message]';
        const audit = await pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, decision, confidence_score)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [senderId, receiverId, auditContent, decision, score]
        );
        return res.status(201).json({
          message: audit.rows[0],
          decision,
          score,
          delivered: false,
          latencyMs,
          moderation,
          blocked: true,
        });
      }
      return res.status(501).json({
        error: 'Image moderation completed, but image message storage and delivery are not implemented',
        decision,
        score,
        delivered: false,
        latencyMs,
        moderation,
      });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, decision, confidence_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [senderId, receiverId, content, decision, score]
    );
    const saved = result.rows[0];

    // Warn remains stored and delivered as flagged; block remains auditable but is not pushed.
    if (decision !== 'block') {
      const io = getIO(req);
      const online = getOnlineUsers(req);
      if (io && online) {
        const receiverSocket = online.get(String(receiverId));
        if (receiverSocket) io.to(receiverSocket).emit('new_message', saved);
      }
    }

    return res.status(201).json({
      message: saved,
      decision,
      score,
      delivered: decision !== 'block',
      latencyMs,
      moderated: true,
      fallback: false,
      moderation,
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
