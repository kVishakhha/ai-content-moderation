import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import api from '../api';
import { useAuth } from '../context/AuthContext';

// The chat service runs on 3002. The socket connects DIRECTLY to it
// (sockets don't go through the gateway here). REST still goes via api (gateway).
const SOCKET_URL = 'http://localhost:3002';

export default function Chat() {
  const { user } = useAuth();
  const userId = user?.userId;   // useAuth() returns { user: { userId, role } }

  const [conversations, setConversations] = useState([]); // sidebar list
  const [activeUser, setActiveUser] = useState(null);      // { id, username }
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [notice, setNotice] = useState(null);

  // user search ("new chat")
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]); // real presence from server

  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  // ---------- socket setup ----------
  useEffect(() => {
    if (!userId) return;
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('register', userId));

    socket.on('presence', (ids) => {
      setOnlineIds(ids.map(String));
    });

    socket.on('new_message', (msg) => {
      // if the message belongs to the open conversation, show it live
      setActiveUser((current) => {
        const other = String(msg.sender_id) === String(userId)
          ? String(msg.receiver_id)
          : String(msg.sender_id);
        if (current && String(current.id) === other) {
          setMessages((prev) => [...prev, msg]);
        }
        return current;
      });
      // refresh the sidebar so last-message/preview updates
      loadConversations();
    });

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ---------- load sidebar conversations ----------
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.get('/chat/conversations');
      setConversations(res.data.conversations || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ---------- load a conversation's messages ----------
  async function openConversation(user) {
    setActiveUser(user);
    setNotice(null);
    setShowSearch(false);
    try {
      const res = await api.get(`/chat/conversation/${user.id}`);
      setMessages(res.data.messages || []);
    } catch (err) {
      console.error(err);
      setMessages([]);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------- send ----------
  async function handleSend() {
    if (!content.trim() || !activeUser) return;
    const text = content.trim();
    setContent('');
    setNotice(null);
    try {
      const res = await api.post('/chat/send', {
        receiver_id: activeUser.id,
        content: text,
      });
      const { decision, message } = res.data;

      if (decision === 'block') {
        setNotice('Your message was blocked and not delivered.');
      } else if (decision === 'warn') {
        setNotice('Sent — flagged for review.');
      }
      // show our own message immediately
      setMessages((prev) => [...prev, message]);
      loadConversations();
    } catch (err) {
      console.error(err);
      setNotice('Could not send. Try again.');
    }
  }

  // ---------- user search ----------
  async function runSearch(q) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/chat/users/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data.users || []);
    } catch (err) {
      console.error(err);
    }
  }

  function initials(name) {
    if (!name) return '?';
    return name.slice(0, 2).toUpperCase();
  }

  function timeOf(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={S.app}>
      {/* ---------------- Sidebar ---------------- */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.avatarMe}>{initials('Me')}</div>
          <div style={{ flex: 1 }}>
            <div style={S.meName}>You</div>
            <div style={S.online}>● online</div>
          </div>
          <button style={S.newChatBtn} onClick={() => setShowSearch((v) => !v)} title="New chat">+</button>
        </div>

        {showSearch && (
          <div style={S.searchPanel}>
            <input
              style={S.searchInput}
              placeholder="Search users by name or email"
              value={searchQuery}
              onChange={(e) => runSearch(e.target.value)}
              autoFocus
            />
            <div>
              {searchResults.map((u) => (
                <div key={u.id} style={S.searchResult}
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
            <div style={S.emptySmall}>No conversations yet. Tap + to start one.</div>
          )}
          {conversations.map((c) => {
            const active = activeUser && String(activeUser.id) === String(c.other_id);
            return (
              <div key={c.other_id}
                   style={{ ...S.convItem, ...(active ? S.convItemActive : {}) }}
                   onClick={() => openConversation({ id: c.other_id, username: c.username })}>
                <div style={S.avatarSm}>{initials(c.username)}</div>
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
              {messages.length === 0 && (
                <div style={S.emptyChat}>No messages yet. Say hi 👋</div>
              )}
              {messages.map((m) => {
                const mine = String(m.sender_id) === String(userId);
                return (
                  <div key={m.id} style={{ ...S.row, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : S.bubbleTheirs) }}>
                      <div>{m.content}</div>
                      <div style={S.bubbleMeta}>
                        <span>{timeOf(m.created_at)}</span>
                        {m.decision === 'warn' && <span style={S.warnTag}>⚠ flagged</span>}
                        {m.decision === 'block' && mine && <span style={S.blockTag}>🚫 blocked</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {notice && <div style={S.notice}>{notice}</div>}

            <div style={S.inputBar}>
              <input
                style={S.msgInput}
                placeholder="Type a message..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button style={S.sendBtn} onClick={handleSend}>Send</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------- styles (dark + lavender) ----------------
const C = {
  bg: '#121212',
  sidebar: '#1B1B1B',
  card: '#242424',
  cardHover: '#2C2C2C',
  accent: '#B794F4',
  accentDim: '#3a2f55',
  text: '#FFFFFF',
  textDim: '#B0B0B0',
  border: '#2A2A2A',
  mine: '#6C4FB7',
  theirs: '#2A2A2A',
};

const S = {
  app: { display: 'flex', height: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0,
    background: C.bg, color: C.text, fontFamily: 'Inter, system-ui, sans-serif' },

  sidebar: { width: 320, background: C.sidebar, borderRight: `1px solid ${C.border}`,
    display: 'flex', flexDirection: 'column' },
  sidebarHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: 16,
    borderBottom: `1px solid ${C.border}` },
  avatarMe: { width: 42, height: 42, borderRadius: '50%', background: C.accent, color: '#1B1B1B',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14 },
  meName: { fontWeight: 600, fontSize: 15 },
  online: { fontSize: 12, color: '#4ade80' },
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
  avatarSm: { width: 40, height: 40, borderRadius: '50%', background: '#3a3a3a', color: C.text,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13,
    flexShrink: 0 },
  convTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  convName: { fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  convTime: { fontSize: 11, color: C.textDim, flexShrink: 0, marginLeft: 8 },
  convPreview: { fontSize: 13, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden',
    textOverflow: 'ellipsis' },
  emptySmall: { padding: 16, fontSize: 13, color: C.textDim, textAlign: 'center' },

  chatWindow: { flex: 1, display: 'flex', flexDirection: 'column', background: C.bg },
  placeholder: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', color: C.textDim, gap: 12 },
  placeholderIcon: { fontSize: 48, opacity: 0.5 },
  placeholderText: { fontSize: 15 },

  chatHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: 16,
    borderBottom: `1px solid ${C.border}`, background: C.sidebar },
  headerName: { fontWeight: 600, fontSize: 15 },
  headerStatus: { fontSize: 12, color: '#4ade80' },
  headerStatusOff: { fontSize: 12, color: '#777' },

  messageArea: { flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column',
    gap: 10 },
  emptyChat: { margin: 'auto', color: C.textDim, fontSize: 14 },
  row: { display: 'flex' },
  bubble: { maxWidth: '62%', padding: '10px 14px', borderRadius: 16, fontSize: 14, lineHeight: 1.4,
    wordBreak: 'break-word' },
  bubbleMine: { background: C.mine, color: '#fff', borderBottomRightRadius: 4 },
  bubbleTheirs: { background: C.theirs, color: C.text, borderBottomLeftRadius: 4 },
  bubbleMeta: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 10,
    opacity: 0.7 },
  warnTag: { color: '#fbbf24' },
  blockTag: { color: '#f87171' },

  notice: { margin: '0 24px 8px', padding: '8px 12px', background: C.accentDim, color: C.accent,
    borderRadius: 10, fontSize: 13 },

  inputBar: { display: 'flex', gap: 10, padding: 16, borderTop: `1px solid ${C.border}`,
    background: C.sidebar },
  msgInput: { flex: 1, padding: '12px 16px', borderRadius: 24, border: `1px solid ${C.border}`,
    background: C.card, color: C.text, fontSize: 14, outline: 'none' },
  sendBtn: { padding: '12px 24px', borderRadius: 24, border: 'none', background: C.accent,
    color: '#1B1B1B', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
};