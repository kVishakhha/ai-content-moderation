import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import api from '../api';
import { useAuth } from '../context/AuthContext';

// REST and Socket.IO both enter through the gateway; it proxies websocket upgrades.
const SOCKET_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

export default function Chat() {
  const { user, token, logout } = useAuth();
  const userId = user?.userId;     // useAuth() returns { user: { userId, role } }

  const [conversations, setConversations] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]);

  // NEW: theme + profile
  const [theme, setTheme] = useState('dark');     // 'dark' | 'light'
  const [showProfile, setShowProfile] = useState(false);
  const [revealed, setRevealed] = useState({});   // { [messageId]: true } — warned msgs the recipient chose to view

  function revealMessage(id) {
    setRevealed((prev) => ({ ...prev, [id]: true }));
  }

  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const imageInputRef = useRef(null);

  // styles rebuild when theme changes
  const S = useMemo(() => makeStyles(theme), [theme]);

  const fetchConversations = useCallback(async () => {
    const res = await api.get('/chat/conversations');
    return res.data.conversations || [];
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await fetchConversations());
    } catch (err) { console.error(err); }
  }, [fetchConversations]);

  // ---------- socket ----------
  useEffect(() => {
    if (!userId || !token) return;
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('presence', (ids) => setOnlineIds(ids.map(String)));
    socket.on('connect_error', () => setNotice('Real-time connection unavailable. Chat history and sending still work.'));

    socket.on('new_message', (msg) => {
      // Ignore our OWN messages coming back over the socket —
      // we already added them locally when we sent them.
      if (String(msg.sender_id) === String(userId)) {
        loadConversations();
        return;
      }
      setActiveUser((current) => {
        const other = String(msg.sender_id);
        if (current && String(current.id) === other) {
          // Dedupe: only add if this message id isn't already shown.
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
        }
        return current;
      });
      loadConversations();
    });

    return () => socket.disconnect();
  }, [userId, token, loadConversations]);

  useEffect(() => {
    let active = true;
    fetchConversations()
      .then((items) => {
        if (active) setConversations(items);
      })
      .catch((err) => console.error(err));
    return () => { active = false; };
  }, [fetchConversations]);

  async function openConversation(u) {
    setActiveUser(u);
    setNotice(null);
    setShowSearch(false);
    try {
      const res = await api.get(`/chat/conversation/${u.id}`);
      setMessages(res.data.messages || []);
    } catch (err) { console.error(err); setMessages([]); }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleImageSelect(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setNotice('Choose a JPEG, PNG, WebP, GIF, or BMP image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setNotice('Images must be 10 MiB or smaller.');
      return;
    }
    setNotice(null);
    setSelectedImage(file);
  }

  async function handleSend() {
    const text = content.trim();
    if ((!text && !selectedImage) || !activeUser || sending) return;
    setNotice(null);
    setSending(true);
    try {
      const payload = { receiver_id: activeUser.id };
      if (text) payload.content = text;
      if (selectedImage) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the selected image'));
          reader.readAsDataURL(selectedImage);
        });
        payload.image_base64 = dataUrl.split(',')[1];
        payload.mime_type = selectedImage.type;
      }

      const res = await api.post('/chat/send', payload);
      const { decision, message } = res.data;
      if (decision === 'block') setNotice('Your message was blocked and not delivered.');
      else if (decision === 'warn') setNotice('Sent — flagged for review.');
      setMessages((prev) => [...prev, message]);
      setContent('');
      setSelectedImage(null);
      loadConversations();
    } catch (err) {
      console.error(err);
      setNotice(err.response?.data?.error || 'Could not send. Try again.');
    } finally {
      setSending(false);
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

  return (
    <div style={S.app}>
      {/* keyframes for fade-in + hover (injected once) */}
      <style>{CSS_ANIM}</style>

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
                    {c.last_decision === 'block' ? '(blocked message)' : c.last_message}
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
                // A warned message is hidden from the RECIPIENT until they choose
                // to view it. The sender always sees their own message.
                const gated = m.decision === 'warn' && !mine && !revealed[m.id];

                return (
                  <div key={m.id} className="msg-in"
                       style={{ ...S.row, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    {gated ? (
                      <div style={{ ...S.bubble, ...S.warnGate }}>
                        <div style={S.warnGateTitle}>⚠ This message was flagged as potentially harmful.</div>
                        <button style={S.showBtn} onClick={() => revealMessage(m.id)}>Show message</button>
                        <div style={S.warnGateTime}>{timeOf(m.created_at)}</div>
                      </div>
                    ) : (
                      <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleTheirs) }}>
                        {m.image_url && <AuthenticatedImage imageUrl={m.image_url} />}
                        {m.content && <div>{m.content}</div>}
                        <div style={S.bubbleMeta}>
                          <span>{timeOf(m.created_at)}</span>
                          {m.decision === 'warn' && <span style={S.warnTag}>⚠ flagged</span>}
                          {m.decision === 'block' && mine && <span style={S.blockTag}>🚫 blocked</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {notice && <div style={S.notice}>{notice}</div>}

            <div style={S.inputBar}>
              <input
                ref={imageInputRef}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
              <button
                style={S.attachBtn}
                className="hoverable"
                onClick={() => imageInputRef.current?.click()}
                disabled={sending}
                title="Attach an image"
              >Image</button>
              <input style={S.msgInput} placeholder="Type a message..." value={content}
                     onChange={(e) => setContent(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
              {selectedImage && (
                <span style={S.selectedImage} title={selectedImage.name}>
                  {selectedImage.name}
                  <button style={S.removeImageBtn} onClick={() => setSelectedImage(null)} aria-label="Remove image">×</button>
                </span>
              )}
              <button style={S.sendBtn} className="hoverable" onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : 'Send'}
              </button>
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

function AuthenticatedImage({ imageUrl }) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl;
    api.get(imageUrl, { responseType: 'blob' })
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  if (failed) return <div role="img" aria-label="Image unavailable">Image unavailable</div>;
  if (!source) return <div>Loading image...</div>;
  return <img src={source} alt="Moderated chat attachment" style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 10 }} />;
}

const CSS_ANIM = `
@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.msg-in { animation: fadeUp 0.18s ease-out; }
.hoverable { transition: background 0.15s ease, transform 0.15s ease, filter 0.15s ease; }
.hoverable:hover { filter: brightness(1.12); }
`;

// ---------------- theme-aware styles ----------------
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
  const WARN = '#C05600'; // amber for warning gate

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

    inputBar: { display: 'flex', gap: 10, padding: 16, borderTop: `1px solid ${C.border}`, background: C.sidebar },
    msgInput: { flex: 1, padding: '12px 16px', borderRadius: 24, border: `1px solid ${C.border}`,
      background: C.card, color: C.text, fontSize: 14, outline: 'none' },
    attachBtn: { padding: '10px 14px', borderRadius: 20, border: `1px solid ${C.border}`,
      background: C.card, color: C.text, fontWeight: 600, cursor: 'pointer' },
    selectedImage: { maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      fontSize: 12, color: C.textDim },
    removeImageBtn: { marginLeft: 5, border: 'none', background: 'transparent', color: C.text, cursor: 'pointer' },
    sendBtn: { padding: '12px 24px', borderRadius: 24, border: 'none', background: C.accent,
      color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },

    // profile modal
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