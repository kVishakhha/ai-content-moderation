const VALID_RESOLUTIONS = new Set(['confirmed', 'dismissed']);
const VALID_REVIEW_FILTERS = new Set(['pending', 'resolved', 'all']);

function createAnalyticsController(pool) {
  async function getSummary(_req, res, next) {
    try {
      const [totals, daily, reviews] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS total_messages,
            COUNT(*) FILTER (WHERE decision = 'allow')::int AS allowed,
            COUNT(*) FILTER (WHERE decision = 'warn')::int AS warned,
            COUNT(*) FILTER (WHERE decision = 'block')::int AS blocked,
            COUNT(*) FILTER (WHERE message_type = 'text')::int AS text_messages,
            COUNT(*) FILTER (WHERE message_type = 'image')::int AS image_messages
          FROM messages
        `),
        pool.query(`
          SELECT created_at::date AS date, COUNT(*)::int AS count
          FROM messages
          WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY created_at::date
          ORDER BY date
        `),
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
            COUNT(*) FILTER (WHERE resolution = 'confirmed')::int AS confirmed,
            COUNT(*) FILTER (WHERE resolution = 'dismissed')::int AS dismissed
          FROM review_queue
        `),
      ]);

      return res.json({
        totals: totals.rows[0],
        daily: daily.rows,
        reviews: reviews.rows[0],
      });
    } catch (err) {
      return next(err);
    }
  }

  async function getReviews(req, res, next) {
    const status = req.query.status || 'pending';
    if (!VALID_REVIEW_FILTERS.has(status)) {
      return res.status(400).json({ error: 'status must be pending, resolved, or all' });
    }

    try {
      const result = await pool.query(
        `SELECT r.id, r.message_id, r.ai_score, r.status, r.resolution,
                r.admin_id, r.resolved_at,
                m.sender_id, sender.username AS sender_username,
                m.receiver_id, receiver.username AS receiver_username,
                m.content, m.message_type, m.image_url, m.mime_type,
                m.decision, m.created_at
         FROM review_queue r
         JOIN messages m ON m.id = r.message_id
         LEFT JOIN users sender ON sender.id = m.sender_id
         LEFT JOIN users receiver ON receiver.id = m.receiver_id
         WHERE ($1 = 'all' OR r.status = $1)
         ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
                  m.created_at DESC
         LIMIT 100`,
        [status]
      );
      return res.json({ reviews: result.rows });
    } catch (err) {
      return next(err);
    }
  }

  async function resolveReview(req, res, next) {
    const resolution = req.body && req.body.resolution;
    if (!VALID_RESOLUTIONS.has(resolution)) {
      return res.status(400).json({ error: 'resolution must be confirmed or dismissed' });
    }

    try {
      const result = await pool.query(
        `UPDATE review_queue
         SET status = 'resolved', resolution = $1, admin_id = $2, resolved_at = NOW()
         WHERE id = $3 AND status = 'pending'
         RETURNING id, message_id, status, resolution, admin_id, resolved_at`,
        [resolution, req.user.userId, req.params.reviewId]
      );
      if (result.rows.length === 0) {
        const existing = await pool.query(
          'SELECT id FROM review_queue WHERE id = $1',
          [req.params.reviewId]
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ error: 'Review item not found' });
        }
        return res.status(409).json({ error: 'Review item is already resolved' });
      }
      return res.json({ review: result.rows[0] });
    } catch (err) {
      return next(err);
    }
  }

  return { getSummary, getReviews, resolveReview };
}

module.exports = createAnalyticsController;
