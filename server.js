require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { nanoid } = require('nanoid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket']
});

// ===== JWT MIDDLEWARE FOR SOCKET =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.username = decoded.username;
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// ===== DB =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ===== MULTER =====
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ===== HELPERS =====
function calcLevel(msgCount) {
  return Math.floor(msgCount / 10) + 1;
}

const usernameRegex = /^@[a-zA-Z0-9_.]{3,30}$/;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

// ============================================================
// ===================== AGORA SETUP ===========================
// ============================================================

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

function generateAgoraToken(channelName, uid) {
  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
  
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );
  
  return token;
}

// ============================================================
// ===================== AUTH ==================================
// ============================================================

function generateToken(user) {
  return jwt.sign(
    { username: user.username, display_name: user.display_name || user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password, display_name, bio } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'Username must start with @ and contain only letters, numbers, underscore(_) and dot(.)' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const exist = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (exist.rows.length > 0) return res.status(400).json({ error: 'Username already taken' });

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password, display_name, bio, msg_count, level, avatar, created_at)
       VALUES ($1, $2, $3, $4, 0, 1, NULL, NOW()) RETURNING username, display_name, bio, msg_count, level, avatar`,
      [username, hashed, display_name || username, bio || '']
    );
    const user = result.rows[0];
    const token = generateToken(user);
    res.json({ ...user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!usernameRegex.test(username)) return res.status(400).json({ error: 'Invalid username format' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Wrong password' });

    const token = generateToken(user);
    res.json({
      username: user.username,
      display_name: user.display_name || user.username,
      bio: user.bio || '',
      msg_count: user.msg_count,
      level: user.level,
      avatar: user.avatar,
      token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/verify', verifyToken, (req, res) => {
  res.json({ username: req.user.username, display_name: req.user.display_name });
});

// ============================================================
// ===================== PROFILE ===============================
// ============================================================

app.post('/api/profile', verifyToken, async (req, res) => {
  const { username } = req.body;
  try {
    const result = await pool.query(
      'SELECT username, display_name, bio, level, avatar FROM users WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update-profile', verifyToken, async (req, res) => {
  const { username, display_name, bio } = req.body;
  if (req.user.username !== username) return res.status(403).json({ error: 'Unauthorized' });
  try {
    await pool.query(
      'UPDATE users SET display_name = $1, bio = $2 WHERE username = $3',
      [display_name || username, bio || '', username]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ===================== SEARCH ================================
// ============================================================

app.post('/api/search-user', verifyToken, async (req, res) => {
  const { query, groupId } = req.body;
  if (!query || query.length < 2) return res.json([]);
  try {
    let sql = `SELECT username, display_name, avatar FROM users 
               WHERE (username ILIKE $1 OR display_name ILIKE $1)`;
    const params = [`%${query}%`];
    if (groupId) {
      sql = `SELECT u.username, u.display_name, u.avatar FROM users u
             JOIN group_members gm ON u.username = gm.username
             WHERE gm.group_id = $2 AND (u.username ILIKE $1 OR u.display_name ILIKE $1)`;
      params.push(groupId);
    }
    const result = await pool.query(sql + ' LIMIT 10', params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ===================== GROUPS ================================
// ============================================================

app.post('/api/create-group', verifyToken, async (req, res) => {
  const { name, creator } = req.body;
  if (!name || !creator) return res.status(400).json({ error: 'Name and creator required' });
  try {
    const linkId = nanoid(10);
    const result = await pool.query(
      `INSERT INTO groups (name, creator, link_id, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [name, creator, linkId]
    );
    const group = result.rows[0];
    await pool.query(
      `INSERT INTO group_members (group_id, username, joined_at)
       VALUES ($1, $2, NOW())`,
      [group.id, creator]
    );
    res.json({ ...group, link: `Shisheiha://${linkId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/join-group', verifyToken, async (req, res) => {
  const { linkId, username } = req.body;
  try {
    const groupRes = await pool.query('SELECT * FROM groups WHERE link_id = $1', [linkId]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRes.rows[0];
    const memberCheck = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND username = $2',
      [group.id, username]
    );
    if (memberCheck.rows.length > 0) return res.status(400).json({ error: 'Already a member' });
    await pool.query(
      `INSERT INTO group_members (group_id, username, joined_at)
       VALUES ($1, $2, NOW())`,
      [group.id, username]
    );
    res.json({ success: true, groupName: group.name, groupId: group.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/my-groups', verifyToken, async (req, res) => {
  const { username } = req.body;
  try {
    const result = await pool.query(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.username = $1`,
      [username]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/group-members', verifyToken, async (req, res) => {
  const { groupId } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.username, u.display_name, u.avatar FROM users u
       JOIN group_members gm ON u.username = gm.username
       WHERE gm.group_id = $1`,
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ===================== AVATAR ================================
// ============================================================

app.post('/api/upload-avatar', verifyToken, upload.single('avatar'), async (req, res) => {
  const { username } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const avatarPath = `/uploads/${req.file.filename}`;
  await pool.query('UPDATE users SET avatar = $1 WHERE username = $2', [avatarPath, username]);
  res.json({ avatar: avatarPath });
});

// ============================================================
// ===================== AGORA CALL ============================
// ============================================================

app.post('/api/agora-start-call', async (req, res) => {
  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'Group ID required' });
  if (!AGORA_APP_ID) return res.status(500).json({ error: 'AGORA_APP_ID not set' });

  try {
    const channelName = `group-${groupId}`;
    const uid = Math.floor(Math.random() * 1000000);
    const token = generateAgoraToken(channelName, uid);
    
    res.json({
      appId: AGORA_APP_ID,
      channel: channelName,
      token: token,
      uid: uid
    });
  } catch (err) {
    console.error('Agora error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ===================== SOCKET.IO =============================
// ============================================================

io.on('connection', (socket) => {
  const currentUser = socket.username;

  socket.join(`user-${currentUser}`);

  // ===== USER JOIN =====
  socket.on('user-join', async () => {
    const result = await pool.query(
      'SELECT username, display_name, bio, msg_count, level, avatar FROM users WHERE username = $1',
      [currentUser]
    );
    const user = result.rows[0];
    if (user) socket.emit('user-data', user);

    socket.broadcast.emit('user-connected', { username: currentUser, display_name: user.display_name, avatar: user.avatar });

    const onlineUsers = [...io.sockets.sockets.values()].map(s => s.username).filter(Boolean);
    const onlineUsersData = await Promise.all(onlineUsers.map(async (u) => {
      const res = await pool.query('SELECT username, display_name, avatar FROM users WHERE username = $1', [u]);
      return res.rows[0] || { username: u };
    }));
    io.emit('online-users', onlineUsersData);

    const groups = await pool.query(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.username = $1`,
      [currentUser]
    );
    socket.emit('my-groups', groups.rows);
  });

  // ===== ROOMS =====
  socket.on('join-pv-room', ({ withUser }) => {
    const roomName = `pv_${[currentUser, withUser].sort().join('_')}`;
    socket.join(roomName);
  });

  socket.on('join-group-room', (groupId) => {
    socket.join(`group-${groupId}`);
  });

  // ===== GROUP CALL =====
  socket.on('start-group-call', async ({ groupId }) => {
    try {
      if (!AGORA_APP_ID) {
        socket.emit('error', 'AGORA_APP_ID not configured');
        return;
      }
      
      const channelName = `group-${groupId}`;
      const uid = Math.floor(Math.random() * 1000000);
      const token = generateAgoraToken(channelName, uid);
      
      io.to(`group-${groupId}`).emit('group-call-started', {
        appId: AGORA_APP_ID,
        channel: channelName,
        token: token,
        uid: uid,
        startedBy: currentUser
      });
    } catch (err) {
      socket.emit('error', 'Failed to start call: ' + err.message);
    }
  });

  socket.on('end-group-call', ({ groupId }) => {
    io.to(`group-${groupId}`).emit('group-call-ended');
  });

  // ===== SEND MESSAGE (با ریپلای کامل) =====
  socket.on('send-message', async (data) => {
    const { to, text, type = 'text', fileUrl = null, groupId = null, replyTo = null, forwardedFrom = null } = data;
    if (!currentUser) return;

    const senderInfo = await pool.query(
      'SELECT username, display_name, avatar FROM users WHERE username = $1',
      [currentUser]
    );
    const sender = senderInfo.rows[0];

    try {
      let msg;
      let replyData = null;

      // اگر ریپلای وجود داره، اطلاعات پیام اصلی رو بگیر
      if (replyTo) {
        const replyRes = await pool.query(
          `SELECT m.text, m.sender, u.display_name as sender_display
           FROM messages m
           LEFT JOIN users u ON m.sender = u.username
           WHERE m.id = $1`,
          [replyTo]
        );
        if (replyRes.rows.length > 0) {
          replyData = {
            text: replyRes.rows[0].text,
            sender: replyRes.rows[0].sender,
            sender_display: replyRes.rows[0].sender_display
          };
        } else {
          replyData = {
            text: 'Deleted message',
            sender: null,
            sender_display: null
          };
        }
      }

      if (groupId) {
        const result = await pool.query(
          `INSERT INTO messages (sender, group_id, text, type, file_url, reply_to, forwarded_from, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
          [currentUser, groupId, text, type, fileUrl, replyTo, forwardedFrom]
        );
        msg = result.rows[0];
        
        const payload = { 
          ...msg, 
          sender_avatar: sender.avatar, 
          sender_display: sender.display_name,
          reply_text: replyData?.text || null,
          reply_sender: replyData?.sender || null,
          reply_sender_display: replyData?.sender_display || null
        };
        io.to(`group-${groupId}`).emit('receive-message', payload);

        // MENTION DETECTION
        const mentionRegex = /@([a-zA-Z0-9_.]+)/g;
        let match;
        while ((match = mentionRegex.exec(text)) !== null) {
          const username = '@' + match[1];
          const memberCheck = await pool.query(
            'SELECT * FROM group_members WHERE group_id = $1 AND username = $2',
            [groupId, username]
          );
          if (memberCheck.rows.length > 0 && username !== currentUser) {
            io.to(`user-${username}`).emit('mention-notification', {
              from: currentUser,
              from_display: sender.display_name,
              groupId,
              message: text,
              messageId: msg.id
            });
            io.to(`group-${groupId}`).emit('mention-badge', { groupId, username });
          }
        }
      } else if (to) {
        const roomName = `pv_${[currentUser, to].sort().join('_')}`;
        const result = await pool.query(
          `INSERT INTO messages (sender, receiver, text, type, file_url, reply_to, forwarded_from, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
          [currentUser, to, text, type, fileUrl, replyTo, forwardedFrom]
        );
        msg = result.rows[0];
        
        const payload = { 
          ...msg, 
          sender_avatar: sender.avatar, 
          sender_display: sender.display_name,
          reply_text: replyData?.text || null,
          reply_sender: replyData?.sender || null,
          reply_sender_display: replyData?.sender_display || null
        };
        io.to(roomName).emit('receive-message', payload);
      } else {
        const result = await pool.query(
          `INSERT INTO messages (sender, text, type, file_url, reply_to, forwarded_from, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
          [currentUser, text, type, fileUrl, replyTo, forwardedFrom]
        );
        msg = result.rows[0];
        
        const payload = { 
          ...msg, 
          sender_avatar: sender.avatar, 
          sender_display: sender.display_name,
          reply_text: replyData?.text || null,
          reply_sender: replyData?.sender || null,
          reply_sender_display: replyData?.sender_display || null
        };
        socket.broadcast.emit('receive-message', payload);
        socket.emit('receive-message', payload);
      }

      // LEVEL UP
      await pool.query('UPDATE users SET msg_count = msg_count + 1 WHERE username = $1', [currentUser]);
      const userRes = await pool.query('SELECT msg_count FROM users WHERE username = $1', [currentUser]);
      const newLevel = calcLevel(userRes.rows[0].msg_count);
      await pool.query('UPDATE users SET level = $1 WHERE username = $2', [newLevel, currentUser]);
      const levelRes = await pool.query('SELECT level FROM users WHERE username = $1', [currentUser]);
      const level = levelRes.rows[0].level;
      if (level > 1) {
        socket.emit('level-up', { level, msg: `Hey ${currentUser}! You reached level ${level}! 🚀` });
      }
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  // ===== PIN MESSAGE =====
  socket.on('pin-message', async ({ messageId }) => {
    try {
      const check = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
      if (check.rows.length === 0) return socket.emit('error', 'Message not found');
      
      if (check.rows[0].is_pinned) {
        await pool.query('UPDATE messages SET is_pinned = FALSE, pinned_at = NULL WHERE id = $1', [messageId]);
        const msg = check.rows[0];
        if (msg.group_id) io.to(`group-${msg.group_id}`).emit('message-unpinned', { messageId });
        else if (msg.receiver) {
          const roomName = `pv_${[msg.sender, msg.receiver].sort().join('_')}`;
          io.to(roomName).emit('message-unpinned', { messageId });
        } else io.emit('message-unpinned', { messageId });
        return;
      }

      if (check.rows[0].group_id) {
        await pool.query('UPDATE messages SET is_pinned = FALSE, pinned_at = NULL WHERE group_id = $1', [check.rows[0].group_id]);
      } else if (check.rows[0].receiver) {
        const roomName = `pv_${[check.rows[0].sender, check.rows[0].receiver].sort().join('_')}`;
        await pool.query(
          `UPDATE messages SET is_pinned = FALSE, pinned_at = NULL 
           WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1)`,
          [check.rows[0].sender, check.rows[0].receiver]
        );
      } else {
        await pool.query('UPDATE messages SET is_pinned = FALSE, pinned_at = NULL WHERE receiver IS NULL AND group_id IS NULL');
      }

      await pool.query('UPDATE messages SET is_pinned = TRUE, pinned_at = NOW() WHERE id = $1', [messageId]);

      const result = await pool.query(
        `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display
         FROM messages m
         LEFT JOIN users u ON m.sender = u.username
         WHERE m.id = $1`,
        [messageId]
      );
      const msg = result.rows[0];
      if (msg.group_id) io.to(`group-${msg.group_id}`).emit('message-pinned', msg);
      else if (msg.receiver) {
        const roomName = `pv_${[msg.sender, msg.receiver].sort().join('_')}`;
        io.to(roomName).emit('message-pinned', msg);
      } else io.emit('message-pinned', msg);
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  // ===== DELETE MESSAGE =====
  socket.on('delete-message', async ({ messageId }) => {
    try {
      const check = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
      if (check.rows.length === 0) return socket.emit('error', 'Message not found');
      const msg = check.rows[0];
      if (msg.sender !== currentUser) return socket.emit('error', 'You can only delete your own messages');

      await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
      const deletePayload = { messageId, deletedBy: currentUser };
      if (msg.group_id) io.to(`group-${msg.group_id}`).emit('message-deleted', deletePayload);
      else if (msg.receiver) {
        const roomName = `pv_${[msg.sender, msg.receiver].sort().join('_')}`;
        io.to(roomName).emit('message-deleted', deletePayload);
      } else io.emit('message-deleted', deletePayload);
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  // ===== FORWARD MESSAGE =====
  socket.on('forward-message', async ({ messageId, to, groupId }) => {
    try {
      const msgRes = await pool.query(
        `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display
         FROM messages m
         LEFT JOIN users u ON m.sender = u.username
         WHERE m.id = $1`,
        [messageId]
      );
      if (msgRes.rows.length === 0) return socket.emit('error', 'Message not found');
      const originalMsg = msgRes.rows[0];

      const forwardText = `from ${originalMsg.sender}\n${originalMsg.text}`;
      const forwardPayload = {
        text: forwardText,
        type: originalMsg.type,
        fileUrl: originalMsg.file_url,
        forwardedFrom: originalMsg.sender
      };

      if (groupId) forwardPayload.groupId = groupId;
      else if (to) forwardPayload.to = to;
      else return socket.emit('error', 'No target specified');

      socket.emit('send-message', forwardPayload);
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  // ===== EDIT MESSAGE =====
  socket.on('edit-message', async ({ messageId, newText }) => {
    try {
      const check = await pool.query('SELECT sender FROM messages WHERE id = $1', [messageId]);
      if (check.rows.length === 0) return socket.emit('error', 'Message not found');
      if (check.rows[0].sender !== currentUser) return socket.emit('error', 'You can only edit your own messages');

      await pool.query(
        `UPDATE messages SET text = $1, edited_at = NOW(), is_edited = TRUE WHERE id = $2`,
        [newText, messageId]
      );

      const result = await pool.query(
        `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display
         FROM messages m
         LEFT JOIN users u ON m.sender = u.username
         WHERE m.id = $1`,
        [messageId]
      );
      const msg = result.rows[0];
      if (msg.group_id) io.to(`group-${msg.group_id}`).emit('message-edited', msg);
      else if (msg.receiver) {
        const roomName = `pv_${[msg.sender, msg.receiver].sort().join('_')}`;
        io.to(roomName).emit('message-edited', msg);
      } else io.emit('message-edited', msg);
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  // ===== GET HISTORY =====
  socket.on('get-history', async ({ withUser, groupId, limit = 50, offset = 0 }) => {
    try {
      let pinnedMessages = [];
      if (offset === 0) {
        let pinnedQuery = '';
        let pinnedParams = [];
        if (groupId) {
          pinnedQuery = `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display,
                                f.avatar as forward_avatar, f.display_name as forward_display
                         FROM messages m
                         LEFT JOIN users u ON m.sender = u.username
                         LEFT JOIN users f ON m.forwarded_from = f.username
                         WHERE m.group_id = $1 AND m.is_pinned = TRUE
                         ORDER BY m.pinned_at DESC`;
          pinnedParams = [groupId];
        } else if (withUser) {
          pinnedQuery = `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display,
                                f.avatar as forward_avatar, f.display_name as forward_display
                         FROM messages m
                         LEFT JOIN users u ON m.sender = u.username
                         LEFT JOIN users f ON m.forwarded_from = f.username
                         WHERE ((m.sender = $1 AND m.receiver = $2) OR (m.sender = $2 AND m.receiver = $1))
                         AND m.is_pinned = TRUE
                         ORDER BY m.pinned_at DESC`;
          pinnedParams = [currentUser, withUser];
        } else {
          pinnedQuery = `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display,
                                f.avatar as forward_avatar, f.display_name as forward_display
                         FROM messages m
                         LEFT JOIN users u ON m.sender = u.username
                         LEFT JOIN users f ON m.forwarded_from = f.username
                         WHERE m.receiver IS NULL AND m.group_id IS NULL AND m.is_pinned = TRUE
                         ORDER BY m.pinned_at DESC`;
          pinnedParams = [];
        }
        if (pinnedQuery) {
          const pinnedRes = await pool.query(pinnedQuery, pinnedParams);
          pinnedMessages = pinnedRes.rows;
        }
      }

      let query, params;
      if (groupId) {
        query = `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display,
                        r.text as reply_text, r.sender as reply_sender, r.sender_display as reply_sender_display,
                        f.avatar as forward_avatar, f.display_name as forward_display
                 FROM messages m
                 LEFT JOIN users u ON m.sender = u.username
                 LEFT JOIN users f ON m.forwarded_from = f.username
                 LEFT JOIN (
                   SELECT m2.id, m2.text, m2.sender, u2.display_name as sender_display
                   FROM messages m2
                   LEFT JOIN users u2 ON m2.sender = u2.username
                 ) r ON m.reply_to = r.id
                 WHERE m.group_id = $1 AND m.is_pinned = FALSE
                 ORDER BY m.created_at DESC LIMIT $2 OFFSET $3`;
        params = [groupId, limit, offset];
      } else if (withUser) {
        query = `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display,
                        r.text as reply_text, r.sender as reply_sender, r.sender_display as reply_sender_display,
                        f.avatar as forward_avatar, f.display_name as forward_display
                 FROM messages m
                 LEFT JOIN users u ON m.sender = u.username
                 LEFT JOIN users f ON m.forwarded_from = f.username
                 LEFT JOIN (
                   SELECT m2.id, m2.text, m2.sender, u2.display_name as sender_display
                   FROM messages m2
                   LEFT JOIN users u2 ON m2.sender = u2.username
                 ) r ON m.reply_to = r.id
                 WHERE (m.sender = $1 AND m.receiver = $2) OR (m.sender = $2 AND m.receiver = $1)
                 AND m.is_pinned = FALSE
                 ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`;
        params = [currentUser, withUser, limit, offset];
      } else {
        query = `SELECT m.*, u.avatar as sender_avatar, u.display_name as sender_display,
                        r.text as reply_text, r.sender as reply_sender, r.sender_display as reply_sender_display,
                        f.avatar as forward_avatar, f.display_name as forward_display
                 FROM messages m
                 LEFT JOIN users u ON m.sender = u.username
                 LEFT JOIN users f ON m.forwarded_from = f.username
                 LEFT JOIN (
                   SELECT m2.id, m2.text, m2.sender, u2.display_name as sender_display
                   FROM messages m2
                   LEFT JOIN users u2 ON m2.sender = u2.username
                 ) r ON m.reply_to = r.id
                 WHERE m.receiver IS NULL AND m.group_id IS NULL AND m.is_pinned = FALSE
                 ORDER BY m.created_at DESC LIMIT $1 OFFSET $2`;
        params = [limit, offset];
      }

      const res = await pool.query(query, params);
      const allMessages = [...pinnedMessages, ...res.rows.reverse()];
      socket.emit('history', allMessages);
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  socket.on('disconnect', () => {
    io.emit('user-disconnected', currentUser);
  });
});

// ============================================================
// ===================== PING ==================================
// ============================================================

app.get('/ping', (req, res) => res.send('pong'));

// ============================================================
// ===================== START SERVER ==========================
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      display_name TEXT,
      bio TEXT,
      msg_count INT DEFAULT 0,
      level INT DEFAULT 1,
      avatar TEXT,
      created_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      creator TEXT,
      link_id TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INT REFERENCES groups(id) ON DELETE CASCADE,
      username TEXT REFERENCES users(username) ON DELETE CASCADE,
      joined_at TIMESTAMP,
      UNIQUE(group_id, username)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender TEXT,
      receiver TEXT,
      group_id INT REFERENCES groups(id) ON DELETE CASCADE,
      text TEXT,
      type TEXT DEFAULT 'text',
      file_url TEXT,
      reply_to INT REFERENCES messages(id),
      forwarded_from TEXT REFERENCES users(username),
      is_pinned BOOLEAN DEFAULT FALSE,
      pinned_at TIMESTAMP,
      edited_at TIMESTAMP,
      is_edited BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP
    );
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='display_name') THEN
        ALTER TABLE users ADD COLUMN display_name TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='bio') THEN
        ALTER TABLE users ADD COLUMN bio TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='reply_to') THEN
        ALTER TABLE messages ADD COLUMN reply_to INT REFERENCES messages(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='forwarded_from') THEN
        ALTER TABLE messages ADD COLUMN forwarded_from TEXT REFERENCES users(username);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_pinned') THEN
        ALTER TABLE messages ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='pinned_at') THEN
        ALTER TABLE messages ADD COLUMN pinned_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='edited_at') THEN
        ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_edited') THEN
        ALTER TABLE messages ADD COLUMN is_edited BOOLEAN DEFAULT FALSE;
      END IF;
    END $$;
  `);
  console.log('✅ Database ready');
});
