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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

function calcLevel(msgCount) {
  return Math.floor(msgCount / 10) + 1;
}

// ========== VALIDATION ==========
const usernameRegex = /^@[a-zA-Z0-9_.]{3,30}$/;

// ========== AUTH ==========
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ 
      error: 'Username must start with @ and contain only letters, numbers, underscore(_) and dot(.)' 
    });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const exist = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (exist.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password, msg_count, level, avatar, created_at)
       VALUES ($1, $2, 0, 1, NULL, NOW()) RETURNING username, msg_count, level, avatar`,
      [username, hashed]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: 'Wrong password' });
    }

    res.json({ 
      username: user.username, 
      msg_count: user.msg_count, 
      level: user.level, 
      avatar: user.avatar 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== USER SEARCH ==========
app.post('/api/search-user', async (req, res) => {
  const { query } = req.body;
  if (!query || query.length < 2) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT username, avatar FROM users WHERE username ILIKE $1 LIMIT 10`,
      [`%${query}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== GROUPS ==========
app.post('/api/create-group', async (req, res) => {
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

app.post('/api/join-group', async (req, res) => {
  const { linkId, username } = req.body;
  if (!linkId || !username) return res.status(400).json({ error: 'Link and username required' });

  try {
    const groupRes = await pool.query('SELECT * FROM groups WHERE link_id = $1', [linkId]);
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const group = groupRes.rows[0];

    const memberCheck = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND username = $2',
      [group.id, username]
    );
    if (memberCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member' });
    }

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

app.post('/api/my-groups', async (req, res) => {
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

// ========== AVATAR ==========
app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
  const { username } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const avatarPath = `/uploads/${req.file.filename}`;
  await pool.query('UPDATE users SET avatar = $1 WHERE username = $2', [avatarPath, username]);
  res.json({ avatar: avatarPath });
});

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('user-join', async (username) => {
    currentUser = username;
    socket.username = username;

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (user) socket.emit('user-data', user);

    socket.broadcast.emit('user-connected', username);

    const onlineUsers = [...io.sockets.sockets.values()].map(s => s.username).filter(Boolean);
    io.emit('online-users', onlineUsers);

    const groups = await pool.query(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.username = $1`,
      [username]
    );
    socket.emit('my-groups', groups.rows);
  });

  socket.on('join-group-room', (groupId) => {
    socket.join(`group-${groupId}`);
  });

  socket.on('send-message', async (data) => {
    const { to, text, type = 'text', fileUrl = null, groupId = null } = data;
    if (!currentUser) return;

    try {
      let msg;
      if (groupId) {
        const result = await pool.query(
          `INSERT INTO messages (sender, group_id, text, type, file_url, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [currentUser, groupId, text, type, fileUrl]
        );
        msg = result.rows[0];
        io.to(`group-${groupId}`).emit('receive-message', msg);
      } else {
        const result = await pool.query(
          `INSERT INTO messages (sender, receiver, text, type, file_url, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [currentUser, to, text, type, fileUrl]
        );
        msg = result.rows[0];
        if (to) {
          io.to(to).emit('receive-message', msg);
          socket.emit('receive-message', msg);
        } else {
          socket.broadcast.emit('receive-message', msg);
          socket.emit('receive-message', msg);
        }
      }

      await pool.query('UPDATE users SET msg_count = msg_count + 1 WHERE username = $1', [currentUser]);
      const userRes = await pool.query('SELECT msg_count FROM users WHERE username = $1', [currentUser]);
      const newLevel = calcLevel(userRes.rows[0].msg_count);
      await pool.query('UPDATE users SET level = $1 WHERE username = $2', [newLevel, currentUser]);

      const levelRes = await pool.query('SELECT level FROM users WHERE username = $1', [currentUser]);
      const level = levelRes.rows[0].level;
      if (level > 1) {
        const msgText = `Hey ${currentUser}! You reached level ${level}! Keep going! 🚀`;
        socket.emit('level-up', { level, msg: msgText });
      }
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  socket.on('get-history', async ({ withUser, groupId }) => {
    try {
      let query, params;
      if (groupId) {
        query = 'SELECT * FROM messages WHERE group_id = $1 ORDER BY created_at ASC';
        params = [groupId];
      } else if (withUser) {
        query = `SELECT * FROM messages 
                 WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1) 
                 ORDER BY created_at ASC`;
        params = [currentUser, withUser];
      } else {
        query = 'SELECT * FROM messages WHERE receiver IS NULL ORDER BY created_at ASC';
        params = [];
      }
      const res = await pool.query(query, params);
      socket.emit('history', res.rows);
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      io.emit('user-disconnected', currentUser);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
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
      created_at TIMESTAMP
    );
  `);
  console.log('✅ Database ready');
});
