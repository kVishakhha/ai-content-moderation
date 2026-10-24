import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

function ReviewImage({ imageUrl, mimeType }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl;
    let active = true;
    api.get(imageUrl, { responseType: 'blob' })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        if (active) setSrc(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setError('Could not load this image for review.');
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  if (error) return <p role="alert">{error}</p>;
  if (!src) return <p>Loading image…</p>;
  return <img src={src} alt={`Flagged ${mimeType} message`} style={styles.image} />;
}

const Admin = () => {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(() => Promise.all([
    api.get('/analytics/summary'),
    api.get('/analytics/reviews', { params: { status: 'pending' } }),
  ]), []);

  const loadDashboard = useCallback(async () => {
    setError('');
    try {
      const [summaryResponse, reviewResponse] = await fetchDashboard();
      setSummary(summaryResponse.data);
      setReviews(reviewResponse.data.reviews);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the admin dashboard.');
    }
  }, [fetchDashboard]);

  useEffect(() => {
    let active = true;
    fetchDashboard()
      .then(([summaryResponse, reviewResponse]) => {
        if (!active) return;
        setSummary(summaryResponse.data);
        setReviews(reviewResponse.data.reviews);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.error || 'Could not load the admin dashboard.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [fetchDashboard]);

  const resolveReview = async (reviewId, resolution) => {
    setBusyId(reviewId);
    setError('');
    try {
      await api.patch(`/analytics/reviews/${reviewId}`, { resolution });
      await loadDashboard();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the review outcome.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>AI CONTENT MODERATION</p>
          <h1 style={styles.title}>Admin dashboard</h1>
          <p>Signed in as admin {user?.userId}</p>
        </div>
        <button type="button" onClick={logout} style={styles.secondaryButton}>Log out</button>
      </header>

      {error && <p role="alert" style={styles.error}>{error}</p>}
      {loading ? <p>Loading moderation analytics…</p> : (
        <>
          <section aria-label="Moderation summary" style={styles.cards}>
            <Metric label="Total messages" value={summary?.totals.total_messages} />
            <Metric label="Allowed" value={summary?.totals.allowed} />
            <Metric label="Warned" value={summary?.totals.warned} />
            <Metric label="Blocked" value={summary?.totals.blocked} />
            <Metric label="Text messages" value={summary?.totals.text_messages} />
            <Metric label="Image messages" value={summary?.totals.image_messages} />
            <Metric label="Reviews pending" value={summary?.reviews.pending} />
            <Metric label="Reviews resolved" value={summary?.reviews.resolved} />
          </section>

          <section style={styles.panel}>
            <h2>Messages over the last seven days</h2>
            {summary?.daily.length ? (
              <ul style={styles.dailyList}>
                {summary.daily.map((day) => (
                  <li key={day.date}>
                    <time dateTime={day.date}>{new Date(day.date).toLocaleDateString()}</time>
                    <strong>{day.count}</strong>
                  </li>
                ))}
              </ul>
            ) : <p>No messages recorded in the last seven days.</p>}
          </section>

          <section style={styles.panel}>
            <div style={styles.sectionHeading}>
              <div>
                <h2>Warning review queue</h2>
                <p>Warning messages are already delivered. Record whether each alert is confirmed or dismissed.</p>
              </div>
              <button type="button" onClick={loadDashboard} style={styles.secondaryButton}>Refresh</button>
            </div>
            {reviews.length === 0 ? <p>No pending warning reviews.</p> : (
              <ul style={styles.reviewList}>
                {reviews.map((review) => (
                  <li key={review.id} style={styles.review}>
                    <div style={styles.reviewHeader}>
                      <strong>Message #{review.message_id}</strong>
                      <span>Score: {Number(review.ai_score).toFixed(3)}</span>
                      <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleString()}</time>
                    </div>
                    <p><strong>From:</strong> {review.sender_username || `User ${review.sender_id}`} → {review.receiver_username || `User ${review.receiver_id}`}</p>
                    {review.content && <blockquote style={styles.quote}>{review.content}</blockquote>}
                    {review.message_type === 'image' && review.image_url && (
                      <ReviewImage imageUrl={review.image_url} mimeType={review.mime_type} />
                    )}
                    <div style={styles.actions}>
                      <button
                        type="button"
                        disabled={busyId === review.id}
                        onClick={() => resolveReview(review.id, 'confirmed')}
                        style={styles.primaryButton}
                      >
                        Confirm warning
                      </button>
                      <button
                        type="button"
                        disabled={busyId === review.id}
                        onClick={() => resolveReview(review.id, 'dismissed')}
                        style={styles.secondaryButton}
                      >
                        Dismiss warning
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
};

function Metric({ label, value }) {
  return (
    <article style={styles.metric}>
      <p>{label}</p>
      <strong>{value ?? '—'}</strong>
    </article>
  );
}

const styles = {
  page: { maxWidth: 1080, margin: '0 auto', padding: '32px 20px', textAlign: 'left' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 28 },
  eyebrow: { color: '#4f46e5', fontSize: 12, fontWeight: 700, letterSpacing: 1.2 },
  title: { margin: '4px 0 8px', fontSize: 32 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 },
  metric: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 },
  panel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 20 },
  dailyList: { listStyle: 'none', padding: 0, display: 'grid', gap: 8 },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 },
  reviewList: { listStyle: 'none', padding: 0, display: 'grid', gap: 12 },
  review: { border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 },
  reviewHeader: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  quote: { borderLeft: '3px solid #f59e0b', margin: '12px 0', padding: '6px 12px', whiteSpace: 'pre-wrap' },
  image: { display: 'block', maxWidth: '100%', maxHeight: 360, objectFit: 'contain', marginTop: 12, borderRadius: 8 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  primaryButton: { border: 0, borderRadius: 6, background: '#4f46e5', color: '#fff', padding: '9px 14px', cursor: 'pointer' },
  secondaryButton: { border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', padding: '9px 14px', cursor: 'pointer' },
  error: { color: '#b91c1c', background: '#fee2e2', padding: 12, borderRadius: 6, marginBottom: 16 },
};

export default Admin;
