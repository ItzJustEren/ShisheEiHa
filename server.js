require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// اتصال به دیتابیس
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// میدل‌ورها
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// تنظیمات آپلود عکس
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ========== توابع کمکی ==========
function calcLevel(msgCount) {
  return Math.floor(msgCount / 10) + 1;
}

// ========== API احراز هویت ==========
app.post('/api/login', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'اسم رو وارد کن' });
  
  // بررسی فرمت یوزرنیم (باید با @ شروع بشه)
  if (!username.startsWith('@')) {
    return res.status(400).json({ error: 'یوزرنیم باید با @ شروع بشه (مثل @AliHastam12)' });
  }
  
  try {
    // بررسی تکراری نبودن
    const exist = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (exist.rows.length > 0) {
      return res.status(400).json({ error: 'این یوزرنیم قبلاً ثبت شده!' });
    }
    
    // ثبت کاربر جدید
    const result = await pool.query(
      `INSERT INTO users (username, msg_count, level, avatar, created_at)
       VALUES ($1, 0, 1, NULL, NOW()) RETURNING *`,
      [username]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== API گروه‌ها ==========
// ایجاد گروه جدید
app.post('/api/create-group', async (req, res) => {
  const { name, creator } = req.body;
  if (!name || !creator) return res.status(400).json({ error: 'نام گروه و سازنده لازمه' });
  
  try {
    const linkId = nanoid(10); // شناسه رندوم ۱۰ کاراکتری
    const result = await pool.query(
      `INSERT INTO groups (name, creator, link_id, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [name, creator, linkId]
    );
    const group = result.rows[0];
    
    // اضافه کردن سازنده به اعضای گروه
    await pool.query(
      `INSERT INTO group_members (group_id, username, joined_at)
       VALUES ($1, $2, NOW())`,
      [group.id, creator]
    );
    
    res.json({ ...group, link: `Rona_Hina://${linkId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// پیوستن به گروه با لینک
app.post('/api/join-group', async (req, res) => {
  const { linkId, username } = req.body;
  if (!linkId || !username) return res.status(400).json({ error: 'لینک و یوزرنیم لازمه' });
  
  try {
    // پیدا کردن گروه با لینک
    const groupRes = await pool.query('SELECT * FROM groups WHERE link_id = $1', [linkId]);
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ error: 'گروه پیدا نشد' });
    }
    const group = groupRes.rows[0];
    
    // بررسی اینکه کاربر عضو نیست
    const memberCheck = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND username = $2',
      [group.id, username]
    );
    if (memberCheck.rows.length > 0) {
      return res.status(400).json({ error: 'شما قبلاً عضو این گروه هستید' });
    }
    
    // اضافه کردن کاربر
    await pool.query(
      `INSERT INTO group_members (group_id, username, joined_at)
       VALUES ($1, $2, NOW())`,
      [group.id, username]
    );
    
    res.json({ success: true, groupName: group.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// دریافت لیست گروه‌های کاربر
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

// دریافت اعضای یک گروه
app.post('/api/group-members', async (req, res) => {
  const { groupId } = req.body;
  try {
    const result = await pool.query(
      `SELECT username, joined_at FROM group_members
       WHERE group_id = $1 ORDER BY joined_at ASC`,
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// آپلود عکس پروفایل
app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
  const { username } = req.body;
  if (!req.file) return res.status(400).json({ error: 'فایلی نیومد' });
  const avatarPath = `/uploads/${req.file.filename}`;
  await pool.query('UPDATE users SET avatar = $1 WHERE username = $2', [avatarPath, username]);
  res.json({ avatar: avatarPath });
});

// ========== Socket.IO ==========
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('user-join', async (username) => {
    currentUser = username;
    socket.username = username;
    
    // گرفتن اطلاعات کاربر
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (user) {
      socket.emit('user-data', user);
    }
    
    // اطلاع به بقیه
    socket.broadcast.emit('user-connected', username);
    
    // ارسال لیست کاربران آنلاین
    const onlineUsers = [...io.sockets.sockets.values()].map(s => s.username).filter(Boolean);
    io.emit('online-users', onlineUsers);
    
    // ارسال لیست گروه‌های کاربر
    const groups = await pool.query(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.username = $1`,
      [username]
    );
    socket.emit('my-groups', groups.rows);
  });

  // پیوستن به گروه (برای دریافت پیام‌های گروه)
  socket.on('join-group-room', (groupId) => {
    socket.join(`group-${groupId}`);
  });

  // ارسال پیام (خصوصی یا گروهی)
  socket.on('send-message', async (data) => {
    const { to, text, type = 'text', fileUrl = null, groupId = null } = data;
    if (!currentUser) return;
    
    try {
      let msg;
      if (groupId) {
        // پیام گروهی
        const result = await pool.query(
          `INSERT INTO messages (sender, group_id, text, type, file_url, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [currentUser, groupId, text, type, fileUrl]
        );
        msg = result.rows[0];
        
        // ارسال به همه اعضای گروه
        io.to(`group-${groupId}`).emit('receive-message', msg);
      } else {
        // پیام خصوصی
        const result = await pool.query(
          `INSERT INTO messages (sender, receiver, text, type, file_url, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [currentUser, to, text, type, fileUrl]
        );
        msg = result.rows[0];
        
        // ارسال به گیرنده
        if (to) {
          io.to(to).emit('receive-message', msg);
          socket.emit('receive-message', msg);
        } else {
          socket.broadcast.emit('receive-message', msg);
          socket.emit('receive-message', msg);
        }
      }
      
      // افزایش شمارش پیام برای فرستنده
      await pool.query('UPDATE users SET msg_count = msg_count + 1 WHERE username = $1', [currentUser]);
      const userRes = await pool.query('SELECT msg_count FROM users WHERE username = $1', [currentUser]);
      const newLevel = calcLevel(userRes.rows[0].msg_count);
      await pool.query('UPDATE users SET level = $1 WHERE username = $2', [newLevel, currentUser]);
      
      // بررسی تغییر سطح
      const levelRes = await pool.query('SELECT level FROM users WHERE username = $1', [currentUser]);
      const level = levelRes.rows[0].level;
      if (level > 1) {
        const msgText = `سلام ${currentUser} شیشه‌هاتو زدی اومدی اینجا؟ 🤣 تو سطح مصرفت شد ${level-1} بیشتر مصرف کن`;
        socket.emit('level-up', { level, msg: msgText });
      }
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  // دریافت تاریخچه پیام‌ها
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

// ========== راه‌اندازی سرور ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 سرور روی پورت ${PORT} روشن شد`);
  
  // ایجاد جدول‌ها
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
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
  console.log('✅ دیتابیس آماده است');
});
