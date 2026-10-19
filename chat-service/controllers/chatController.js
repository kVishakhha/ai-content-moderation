const pool = require('../config/db');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const MODERATION_TIMEOUT_MS = Number(process.env.MODERATION_TIMEOUT_MS) > 0
  ? Number(process.env.MODERATION_TIMEOUT_MS)
  : 30000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_STORAGE_DIR = path.resolve(
  process.env.IMAGE_STORAGE_DIR || path.join(__dirname, '..', 'uploads')
);
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
};
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

async function storeImage(imageBase64, mimeType) {
  const extension = IMAGE_EXTENSIONS[mimeType.toLowerCase()];
  if (!extension) {
    throw new ModerationError(415, 'Unsupported image format');
  }

  const bytes = Buffer.from(imageBase64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new ModerationError(400, 'Image must be between 1 byte and 10 MiB');
  }

  const filename = `${randomUUID()}${extension}`;
  await fs.mkdir(IMAGE_STORAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGE_STORAGE_DIR, filename), bytes, { flag: 'wx' });
  return { filename, imageUrl: `/chat/media/${filename}` };
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
  let storedImagePath;
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

    let result;
    if (hasImage) {
      let imageUrl = null;
      if (decision !== 'block') {
        const stored = await storeImage(imageBase64, mimeType);
        imageUrl = stored.imageUrl;
        storedImagePath = path.join(IMAGE_STORAGE_DIR, stored.filename);
      }
      result = await pool.query(
        `INSERT INTO messages
           (sender_id, receiver_id, content, message_type, image_url, mime_type, decision, confidence_score)
         VALUES ($1, $2, $3, 'image', $4, $5, $6, $7)
         RETURNING *`,
        [senderId, receiverId, hasText ? content.trim() : null, imageUrl, mimeType, decision, score]
      );
    } else {
      result = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content, decision, confidence_score)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [senderId, receiverId, content.trim(), decision, score]
      );
    }
    const saved = result.rows[0];
    storedImagePath = null;

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
    if (storedImagePath) {
      await fs.unlink(storedImagePath).catch((cleanupError) => {
        console.error('Could not remove image after failed message save:', cleanupError);
      });
    }
    console.error('sendMessage error:', err);
    return res.status(500).json({ error: 'Something went wrong sending the message' });
  }
}

async function getImage(req, res) {
  try {
    const userId = req.headers['x-user-id'];
    const { filename } = req.params;
    if (!userId) return res.status(401).json({ error: 'No user id from gateway' });
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|bmp)$/.test(filename)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imageUrl = `/chat/media/${filename}`;
    const result = await pool.query(
      `SELECT mime_type FROM messages
       WHERE image_url = $1
         AND decision <> 'block'
         AND (sender_id = $2 OR receiver_id = $2)
       LIMIT 1`,
      [imageUrl, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Image not found' });

    const imagePath = path.join(IMAGE_STORAGE_DIR, filename);
    const bytes = await fs.readFile(imagePath);
    res.set('Content-Type', result.rows[0].mime_type);
    res.set('Content-Disposition', 'inline');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(bytes);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Image not found' });
    console.error('getImage error:', err);
    return res.status(500).json({ error: 'Could not load image' });
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
          content, message_type, decision, sender_id, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END
            ORDER BY created_at DESC
          ) AS rn
        FROM messages
        WHERE sender_id = $1 OR receiver_id = $1
      )
      SELECT c.other_id, u.username,
             CASE WHEN c.message_type = 'image' THEN '[image]' ELSE c.content END AS last_message,
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
  getImage,
  getConversation,
  getConversationList,
  searchUsers,
};
