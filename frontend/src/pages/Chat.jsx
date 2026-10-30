import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import api, { API_BASE_URL } from '../api';
import { useAuth } from '../context/AuthContext';

// REST and Socket.IO both enter through the gateway (it proxies websocket upgrades).
const SOCKET_URL = API_BASE_URL;

// ── Image validation constants ──────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const MAX_IMAGE_SIZE_MB = 10; // must match the backend's 10 MiB raw-image cap
const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// Images are served only to the sender/receiver and need the JWT, so a plain
// <img src> cannot load them. Fetch with the token and show the result as a blob.
function AuthImage({ src, style, alt }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = null;
    let active = true;
    api.get(src, { responseType: 'blob' })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (failed) return <div style={{ fontSize: 12, opacity: 0.7, padding: 8 }}>Image unavailable</div>;
  if (!url) return <div style={{ fontSize: 12, opacity: 0.7, padding: 8 }}>Loading image…</div>;
  return <img src={url} alt={alt} style={style} />;
}

export default function Chat() {
  const { user, token, logout } = useAuth();
  const userId = user?.userId;

  const [conversations, setConversations] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [notice, setNotice] = useState(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]);

  const [theme, setTheme] = useState('dark');
  const [showProfile, setShowProfile] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [menuId, setMenuId] = useState(null);

  // ── Image-specific state ─────────────────────────────────────────────────
  const [imageFile, setImageFile] = useState(null);       // raw File object
  const [imagePreview, setImagePreview] = useState(null); // object URL for preview
  const [imageBase64, setImageBase64] = useState(null);   // base64 string
  const [imageMime, setImageMime] = useState(null);       // MIME type string
  const [imageSending, setImageSending] = useState(false);// prevent double-sends
  const [imageError, setImageError] = useState(null);     // validation / API errors
  const fileInputRef = useRef(null);                      // hidden <input type="file">

  function revealMessage(id) {
    setRevealed((prev) => ({ ...prev, [id]: true }));
  }

  async function deleteMessage(m, scope) {
    setMenuId(null);
    try {
      await api.delete(`/chat/message/${m.id}`, { params: { scope } });
      if (scope === 'everyone') {
        setMessages((prev) => prev.map((x) => (x.id === m.id
          ? { ...x, deleted_for_everyone: true, content: null, image_url: null, message_type: 'text' }
          : x)));
      } else {
        setMessages((prev) => prev.filter((x) => x.id !== m.id));
      }
      loadConversations();
    } catch (err) {
      setNotice(err.response?.data?.error || 'Could not delete the message.');
    }
  }

  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  const S = useMemo(() => makeStyles(theme), [theme]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.get('/chat/conversations');
      setConversations(res.data.conversations || []);
    } catch (err) { console.error(err); }
  }, []);

  // ── socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !token) return;
    // The server identifies us from the JWT in the handshake (no 'register' event).
    const socket = io(SOCKET_URL, { transports: ['websocket'], auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', () =>
      setNotice('Real-time connection unavailable. History and sending still work.'));
    socket.on('presence', (ids) => setOnlineIds(ids.map(String)));
        socket.on('message_deleted', ({ id }) => {
      setMessages((prev) => prev.map((m) => (m.id === id
        ? { ...m, deleted_for_everyone: true, content: null, image_url: null, message_type: 'text' }
        : m)));
      loadConversations();
    });

    socket.on('new_message', (msg) => {
      if (String(msg.sender_id) === String(userId)) {
        loadConversations();
        return;
      }
      setActiveUser((current) => {
        const other = String(msg.sender_id);
        if (current && String(current.id) === other) {
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
        }
        return current;
      });
      loadConversations();
    });

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, token]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  async function openConversation(u) {
    setActiveUser(u);
    setNotice(null);
    setShowSearch(false);
    clearImage();
    try {
      const res = await api.get(`/chat/conversation/${u.id}`);
      setMessages(res.data.messages || []);
    } catch (err) { console.error(err); setMessages([]); }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Moderation outages now fail closed: nothing is delivered, backend answers 503/504.
  function sendErrorText(err, what) {
    const status = err?.response?.status;
    if (status === 503 || status === 504) {
      return `Your ${what} could not be checked by moderation, so it was not sent. Please try again.`;
    }
    return err?.response?.data?.error || `Could not send ${what}. Try again.`;
  }

  // ── text send ─────────────────────────────────────────────────
  async function handleSend() {
    if (!content.trim() || !activeUser) return;
    const text = content.trim();
    setContent('');
    setNotice(null);
    try {
      const res = await api.post('/chat/send', { receiver_id: activeUser.id, content: text });
      const { decision, message } = res.data;
      if (decision === 'block') setNotice('Your message was blocked and not delivered.');
      else if (decision === 'warn') setNotice('Sent — the recipient will see a warning first.');
      setMessages((prev) => [...prev, message]);
      loadConversations();
    } catch (err) { console.error(err); setNotice(sendErrorText(err, 'message')); }
  }

  // ── image selection + validation ──────────────────────────────────────────
  function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';           // reset so same file can be re-selected
    setImageError(null);

    // type validation
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError('Only JPEG, PNG, GIF, WebP and BMP images are supported.');
      return;
    }
    // size validation
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(`Image must be ${MAX_IMAGE_SIZE_MB} MB or smaller.`);
      return;
    }

    // generate object URL for preview
    const preview = URL.createObjectURL(file);

    // convert to base64 via FileReader
    const reader = new FileReader();
    reader.onload = (ev) => {
      // ev.target.result is "data:<mime>;base64,<data>"
      // We store only the raw base64 part (after the comma)
      const full = ev.target.result;
      const base64 = full.split(',')[1];
      setImageFile(file);
      setImagePreview(preview);
      setImageBase64(base64);
      setImageMime(file.type);
    };
    reader.onerror = () => setImageError('Could not read the image file.');
    reader.readAsDataURL(file);
  }

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview); // free memory
    setImageFile(null);
    setImagePreview(null);
    setImageBase64(null);
    setImageMime(null);
    setImageError(null);
  }

  // ── image send ────────────────────────────────────────────────────────────
  // POST /chat/send with JSON { receiver_id, image_base64, mime_type, content? }
  // (same endpoint as text; the chat service moderates, stores, and pushes it).
  async function handleSendImage() {
    if (!imageBase64 || !activeUser || imageSending) return;
    setImageSending(true);
    setNotice(null);
    setImageError(null);

    const payload = {
      receiver_id: activeUser.id,
      image_base64: imageBase64,
      mime_type: imageMime,
    };
    if (content.trim()) payload.content = content.trim(); // optional caption

    try {
      const res = await api.post('/chat/send', payload);
      const { decision, message } = res.data;

      if (decision === 'block') {
        setNotice('Your image was blocked by content moderation and not delivered.');
      } else if (decision === 'warn') {
        setNotice('Image sent — the recipient will see a warning first.');
      }
      if (message) setMessages((prev) => [...prev, message]);

      setContent('');
      clearImage();
      loadConversations();
    } catch (err) {
      console.error('send image error:', err);
      if (err?.response?.status === 413) {
        setImageError('Image is too large for the server. Try a smaller file.');
      } else {
        setImageError(sendErrorText(err, 'image'));
      }
    } finally {
      setImageSending(false);
    }
  }

  async function runSearch(q) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/chat/users/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data.users || []);
    } catch (err) { console.error(err); }
  }

  function initials(name) {
    if (!name) return '?';
    return name.slice(0, 2).toUpperCase();
  }
  function timeOf(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── render a single message bubble ───────────────────────────────────────
  function renderBubble(m) {
    const mine = String(m.sender_id) === String(userId);
    const isImage = m.message_type === 'image';

    
    if (m.deleted_for_everyone) {
      return (
        <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleTheirs), opacity: 0.6, fontStyle: 'italic' }}>
          🚫 This message was deleted
          <div style={S.bubbleMeta}><span>{timeOf(m.created_at)}</span></div>
        </div>
      );
    }

    // ── image message ──
    if (isImage) {
      const gated = m.decision === 'warn' && !mine && !revealed[m.id];

      if (gated) {
        return (
          <div style={{ ...S.bubble, ...S.warnGate }}>
            <div style={S.warnGateTitle}>⚠ This image was flagged as potentially harmful.</div>
            <button style={S.showBtn} onClick={() => revealMessage(m.id)}>Show image</button>
            <div style={S.warnGateTime}>{timeOf(m.created_at)}</div>
          </div>
        );
      }

      // blocked image — no image data to show, show placeholder instead
      if (m.decision === 'block') {
        return (
          <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleTheirs) }}>
            <div style={S.imgBlockedPlaceholder}>
              <span style={{ fontSize: 22 }}>🚫</span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>
                {mine ? 'Image blocked by content moderation' : 'Image not delivered'}
              </span>
            </div>
            <div style={S.bubbleMeta}>
              <span>{timeOf(m.created_at)}</span>
              {mine && <span style={S.blockTag}>blocked</span>}
            </div>
          </div>
        );
      }

      // allowed / warned-but-revealed image (fetched with the JWT; only mounted now,
      // so a warned image is never downloaded before the recipient clicks "Show image")
      return (
        <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleTheirs), padding: 6 }}>
          {m.image_url
            ? <AuthImage src={m.image_url} alt="shared image" style={S.imgBubble} />
            : <div style={S.imgBlockedPlaceholder}><span style={{ fontSize: 12, opacity: 0.7 }}>Image unavailable</span></div>
          }
          {m.content && <div style={{ padding: '6px 8px 0' }}>{m.content}</div>}
          <div style={{ ...S.bubbleMeta, padding: '0 8px 2px' }}>
            <span>{timeOf(m.created_at)}</span>
            {m.decision === 'warn' && <span style={S.warnTag}>⚠ flagged</span>}
          </div>
        </div>
      );
    }

    // ── text message (existing logic, unchanged) ──
    const gated = m.decision === 'warn' && !mine && !revealed[m.id];

    if (gated) {
      return (
        <div style={{ ...S.bubble, ...S.warnGate }}>
          <div style={S.warnGateTitle}>⚠ This message was flagged as potentially harmful.</div>
          <button style={S.showBtn} onClick={() => revealMessage(m.id)}>Show message</button>
          <div style={S.warnGateTime}>{timeOf(m.created_at)}</div>
        </div>
      );
    }

    return (
      <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleTheirs) }}>
        <div>{m.content}</div>
        <div style={S.bubbleMeta}>
          <span>{timeOf(m.created_at)}</span>
          {m.decision === 'warn' && <span style={S.warnTag}>⚠ flagged</span>}
          {m.decision === 'block' && mine && <span style={S.blockTag}>🚫 blocked</span>}
        </div>
      </div>
    );
  }

  function renderMenu(m) {
    const mine = String(m.sender_id) === String(userId);
    const item = { padding: '6px 10px', cursor: 'pointer' };
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuId(menuId === m.id ? null : m.id)}
          title="Delete options"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, opacity: 0.6, color: 'inherit' }}
        >⋯</button>
        {menuId === m.id && (
          <div style={{ position: 'absolute', zIndex: 10, top: '100%', [mine ? 'right' : 'left']: 0,
                        background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 8,
                        padding: 4, whiteSpace: 'nowrap', fontSize: 13 }}>
            <div style={item} onClick={() => deleteMessage(m, 'me')}>Delete for me</div>
            {mine && !m.deleted_for_everyone && (
              <div style={item} onClick={() => deleteMessage(m, 'everyone')}>Unsend for everyone</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={S.app}>
      <style>{CSS_ANIM}</style>

      {/* hidden file input — triggered by the 📎 button */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={handleImageSelect}
      />

      {/* ---------------- Sidebar ---------------- */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.avatarMe} title="View profile" onClick={() => setShowProfile(true)}>
            {initials(user?.username || 'Me')}
          </div>
          <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setShowProfile(true)}>
            <div style={S.meName}>{user?.username || 'You'}</div>
            <div style={S.online}>● online</div>
          </div>
          <button style={S.iconBtn} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  title="Toggle light/dark">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button style={S.newChatBtn} onClick={() => setShowSearch((v) => !v)} title="New chat">+</button>
        </div>

        {showSearch && (
          <div style={S.searchPanel}>
            <input style={S.searchInput} placeholder="Search users by name or email"
                   value={searchQuery} onChange={(e) => runSearch(e.target.value)} autoFocus />
            <div>
              {searchResults.map((u) => (
                <div key={u.id} style={S.searchResult} className="hoverable"
                     onClick={() => openConversation({ id: u.id, username: u.username })}>
                  <div style={S.avatarSm}>{initials(u.username)}</div>
                  <div>
                    <div style={S.convName}>{u.username}</div>
                    <div style={S.convPreview}>{u.email}</div>
                  </div>
                </div>
              ))}
              {searchQuery && searchResults.length === 0 && (
                <div style={S.emptySmall}>No users found.</div>
              )}
            </div>
          </div>
        )}

        <div style={S.convList}>
          {conversations.length === 0 && !showSearch && (
            <div style={S.emptyState}>
              <div style={{ fontSize: 36, opacity: 0.4 }}>💬</div>
              <div style={S.emptySmall}>No conversations yet.<br/>Tap + to start one.</div>
            </div>
          )}
          {conversations.map((c) => {
            const active = activeUser && String(activeUser.id) === String(c.other_id);
            const isOnline = onlineIds.includes(String(c.other_id));
            return (
              <div key={c.other_id} className="hoverable"
                   style={{ ...S.convItem, ...(active ? S.convItemActive : {}) }}
                   onClick={() => openConversation({ id: c.other_id, username: c.username })}>
                <div style={{ position: 'relative' }}>
                  <div style={S.avatarSm}>{initials(c.username)}</div>
                  {isOnline && <span style={S.onlineDot} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.convTop}>
                    <span style={S.convName}>{c.username}</span>
                    <span style={S.convTime}>{timeOf(c.created_at)}</span>
                  </div>
                  <div style={S.convPreview}>
                    {String(c.last_sender) === String(userId) ? 'You: ' : ''}
                    {c.last_decision === 'block'
                      ? '(blocked message)'
                      : (c.last_message_type === 'image' || c.last_message === '[image]')
                        ? '📷 Image'
                        : c.last_message}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ---------------- Chat window ---------------- */}
      <main style={S.chatWindow}>
        {!activeUser ? (
          <div style={S.placeholder}>
            <div style={S.placeholderIcon}>💬</div>
            <p style={S.placeholderText}>Select a conversation or start a new one</p>
          </div>
        ) : (
          <>
            <header style={S.chatHeader}>
              <div style={S.avatarSm}>{initials(activeUser.username)}</div>
              <div>
                <div style={S.headerName}>{activeUser.username}</div>
                <div style={onlineIds.includes(String(activeUser.id)) ? S.headerStatus : S.headerStatusOff}>
                  {onlineIds.includes(String(activeUser.id)) ? 'online' : 'offline'}
                </div>
              </div>
            </header>

            <div style={S.messageArea}>
              {messages.length === 0 && <div style={S.emptyChat}>No messages yet. Say hi 👋</div>}
              {messages.map((m) => {
                const mine = String(m.sender_id) === String(userId);
                return (
                  <div key={m.id} className="msg-in"
                       style={{ ...S.row, justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'center', gap: 4 }}>
                    {mine && renderMenu(m)}
                    {renderBubble(m)}
                    {!mine && renderMenu(m)}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* notices */}
            {notice && <div style={S.notice}>{notice}</div>}
            {imageError && <div style={{ ...S.notice, background: '#3d1a1a', color: '#f87171' }}>{imageError}</div>}

            {/* image preview strip — shown only when an image is selected */}
            {imagePreview && (
              <div style={S.imgPreviewBar}>
                <img src={imagePreview} alt="preview" style={S.imgPreviewThumb} />
                <div style={{ flex: 1, fontSize: 12, color: '#B0B0B0' }}>
                  <div style={{ fontWeight: 600 }}>{imageFile?.name}</div>
                  <div>{(imageFile?.size / 1024).toFixed(1)} KB — ready to send</div>
                </div>
                <button style={S.imgCancelBtn} onClick={clearImage} title="Remove image">✕</button>
              </div>
            )}

            {/* input bar */}
            <div style={S.inputBar}>
              {/* 📎 attachment button */}
              <button
                style={S.attachBtn}
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
                disabled={imageSending}
              >
                📎
              </button>

              <input
                style={S.msgInput}
                placeholder={imagePreview ? 'Add a caption (optional)…' : 'Type a message...'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (imagePreview ? handleSendImage() : handleSend())}
              />

              {/* Send button — switches between text and image send */}
              {imagePreview ? (
                <button
                  style={{ ...S.sendBtn, opacity: imageSending ? 0.6 : 1 }}
                  className="hoverable"
                  onClick={handleSendImage}
                  disabled={imageSending}
                >
                  {imageSending ? '…' : 'Send'}
                </button>
              ) : (
                <button style={S.sendBtn} className="hoverable" onClick={handleSend}>Send</button>
              )}
            </div>
          </>
        )}
      </main>

      {/* ---------------- Profile modal ---------------- */}
      {showProfile && (
        <div style={S.modalOverlay} onClick={() => setShowProfile(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalAvatar}>{initials(user?.username || 'Me')}</div>
            <h3 style={S.modalName}>{user?.username || 'You'}</h3>
            <div style={S.modalStatus}>● online</div>
            <button style={S.logoutBtn} onClick={() => { logout && logout(); }}>Log out</button>
            <button style={S.closeBtn} onClick={() => setShowProfile(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS_ANIM = `
@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.msg-in { animation: fadeUp 0.18s ease-out; }
.hoverable { transition: background 0.15s ease, transform 0.15s ease, filter 0.15s ease; }
.hoverable:hover { filter: brightness(1.12); }
`;

function makeStyles(theme) {
  const dark = {
    bg: '#121212', sidebar: '#1B1B1B', card: '#242424', accent: '#B794F4',
    accentDim: '#3a2f55', text: '#FFFFFF', textDim: '#B0B0B0', border: '#2A2A2A',
    mine: '#6C4FB7', theirs: '#2A2A2A', avatarBg: '#3a3a3a', modalBg: '#1B1B1B',
  };
  const light = {
    bg: '#F5F3F8', sidebar: '#FFFFFF', card: '#F0EDF5', accent: '#7C5CBF',
    accentDim: '#E7DEF7', text: '#1A1A1A', textDim: '#6B6B6B', border: '#E2DDEA',
    mine: '#7C5CBF', theirs: '#FFFFFF', avatarBg: '#D8CCEC', modalBg: '#FFFFFF',
  };
  const C = theme === 'dark' ? dark : light;
  const WARN = '#C05600';

  return {
    app: { display: 'flex', height: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0,
      background: C.bg, color: C.text, fontFamily: 'Inter, system-ui, sans-serif' },

    sidebar: { width: 320, background: C.sidebar, borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column' },
    sidebarHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: 16,
      borderBottom: `1px solid ${C.border}` },
    avatarMe: { width: 42, height: 42, borderRadius: '50%', background: C.accent, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14,
      cursor: 'pointer', flexShrink: 0 },
    meName: { fontWeight: 600, fontSize: 15 },
    online: { fontSize: 12, color: '#4ade80' },
    iconBtn: { width: 34, height: 34, borderRadius: '50%', border: 'none', background: C.card,
      cursor: 'pointer', fontSize: 15 },
    newChatBtn: { width: 36, height: 36, borderRadius: '50%', border: 'none', background: C.accentDim,
      color: C.accent, fontSize: 22, cursor: 'pointer', lineHeight: '34px' },

    searchPanel: { padding: 12, borderBottom: `1px solid ${C.border}` },
    searchInput: { width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`,
      background: C.card, color: C.text, fontSize: 14, boxSizing: 'border-box' },
    searchResult: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px', cursor: 'pointer',
      borderRadius: 10 },

    convList: { flex: 1, overflowY: 'auto' },
    convItem: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' },
    convItemActive: { background: C.accentDim },
    avatarSm: { width: 40, height: 40, borderRadius: '50%', background: C.avatarBg, color: C.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13,
      flexShrink: 0 },
    onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%',
      background: '#4ade80', border: `2px solid ${C.sidebar}` },
    convTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
    convName: { fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    convTime: { fontSize: 11, color: C.textDim, flexShrink: 0, marginLeft: 8 },
    convPreview: { fontSize: 13, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    emptySmall: { padding: 16, fontSize: 13, color: C.textDim, textAlign: 'center' },
    emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 40 },

    chatWindow: { flex: 1, display: 'flex', flexDirection: 'column', background: C.bg },
    placeholder: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', color: C.textDim, gap: 12 },
    placeholderIcon: { fontSize: 48, opacity: 0.5 },
    placeholderText: { fontSize: 15 },

    chatHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: 16,
      borderBottom: `1px solid ${C.border}`, background: C.sidebar },
    headerName: { fontWeight: 600, fontSize: 15 },
    headerStatus: { fontSize: 12, color: '#4ade80' },
    headerStatusOff: { fontSize: 12, color: C.textDim },

    messageArea: { flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 10 },
    emptyChat: { margin: 'auto', color: C.textDim, fontSize: 14 },
    row: { display: 'flex' },
    bubble: { maxWidth: '62%', padding: '10px 14px', borderRadius: 16, fontSize: 14, lineHeight: 1.4,
      wordBreak: 'break-word', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' },
    bubbleMine: { background: C.mine, color: '#fff', borderBottomRightRadius: 4 },
    bubbleTheirs: { background: C.theirs, color: C.text, borderBottomLeftRadius: 4,
      border: theme === 'light' ? `1px solid ${C.border}` : 'none' },
    bubbleMeta: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 10, opacity: 0.7 },
    warnGate: { background: C.theirs, border: `1px dashed ${WARN}`, display: 'flex',
      flexDirection: 'column', gap: 8, alignItems: 'flex-start' },
    warnGateTitle: { fontSize: 12.5, color: theme === 'dark' ? '#fbbf24' : WARN, fontWeight: 500 },
    showBtn: { fontSize: 12, fontWeight: 600, color: '#fff', background: WARN, border: 'none',
      borderRadius: 8, padding: '5px 12px', cursor: 'pointer' },
    warnGateTime: { fontSize: 10, opacity: 0.6 },
    warnTag: { color: '#fbbf24' },
    blockTag: { color: '#f87171' },

    notice: { margin: '0 24px 8px', padding: '8px 12px', background: C.accentDim, color: C.accent,
      borderRadius: 10, fontSize: 13 },

    // ── image-specific styles ──
    imgPreviewBar: { display: 'flex', alignItems: 'center', gap: 12, margin: '0 16px 8px',
      padding: '10px 12px', borderRadius: 10, background: C.card,
      border: `1px solid ${C.border}` },
    imgPreviewThumb: { width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
    imgCancelBtn: { width: 28, height: 28, borderRadius: '50%', border: 'none',
      background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 14,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

    imgBubble: { maxWidth: '100%', maxHeight: 280, borderRadius: 10, display: 'block',
      objectFit: 'contain' },
    imgBlockedPlaceholder: { display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 6, padding: '12px 8px', opacity: 0.7 },

    inputBar: { display: 'flex', gap: 8, padding: 16, borderTop: `1px solid ${C.border}`,
      background: C.sidebar, alignItems: 'center' },
    attachBtn: { width: 38, height: 38, borderRadius: '50%', border: 'none', background: C.card,
      color: C.text, fontSize: 18, cursor: 'pointer', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center' },
    msgInput: { flex: 1, padding: '12px 16px', borderRadius: 24, border: `1px solid ${C.border}`,
      background: C.card, color: C.text, fontSize: 14, outline: 'none' },
    sendBtn: { padding: '12px 24px', borderRadius: 24, border: 'none', background: C.accent,
      color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', flexShrink: 0 },

    // profile modal (unchanged)
    modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 50 },
    modal: { background: C.modalBg, color: C.text, borderRadius: 16, padding: 28, width: 320,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      border: `1px solid ${C.border}`, boxShadow: '0 10px 40px rgba(0,0,0,0.4)' },
    modalAvatar: { width: 72, height: 72, borderRadius: '50%', background: C.accent, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 24 },
    modalName: { margin: '4px 0 2px', fontSize: 20 },
    modalStatus: { fontSize: 13, color: '#4ade80', marginBottom: 8 },
    modalRow: { display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 14,
      padding: '8px 0', borderBottom: `1px solid ${C.border}` },
    modalLabel: { color: C.textDim },
    logoutBtn: { marginTop: 16, width: '100%', padding: 10, borderRadius: 10, border: 'none',
      background: '#ef4444', color: '#fff', fontWeight: 600, cursor: 'pointer' },
    closeBtn: { width: '100%', padding: 10, borderRadius: 10, border: `1px solid ${C.border}`,
      background: 'transparent', color: C.text, cursor: 'pointer' },
  };
}
