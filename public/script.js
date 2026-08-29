const socket = io();
let currentUser = '';
let currentChat = null; // می‌تونه یوزرنیم یا groupId باشه
let currentChatType = null; // 'pv' یا 'group'
let currentGroupId = null;

// ===== DOM references =====
const loginPage = document.getElementById('login');
const loadingPage = document.getElementById('loading');
const appPage = document.getElementById('app');
const usernameInput = document.getElementById('username');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const progressBar = document.getElementById('progressBar');
const displayName = document.getElementById('displayName');
const levelBadge = document.getElementById('levelBadge');
const avatarImg = document.getElementById('avatarImg');
const avatarUpload = document.getElementById('avatarUpload');
const userList = document.getElementById('userList');
const groupList = document.getElementById('groupList');
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById('fileInput');
const chatTitle = document.getElementById('chatTitle');
const groupLinkDisplay = document.getElementById('groupLinkDisplay');
const createGroupBtn = document.getElementById('createGroupBtn');
const groupModal = document.getElementById('groupModal');
const groupNameInput = document.getElementById('groupNameInput');
const confirmCreateGroup = document.getElementById('confirmCreateGroup');

// ===== نوتیف گلاسفوریسم =====
function showGlassNotification(text) {
  const notif = document.getElementById('glassNotification');
  const textSpan = document.getElementById('notifText');
  textSpan.textContent = text;
  notif.style.display = 'block';
  notif.style.animation = 'none';
  setTimeout(() => {
    notif.style.animation = 'slideDown 0.4s ease-out, fadeOut 0.5s 3.5s forwards';
  }, 10);
  setTimeout(() => {
    notif.style.display = 'none';
  }, 4000);
}

// ===== ورود =====
loginBtn.onclick = async () => {
  const username = usernameInput.value.trim();
  if (!username) {
    loginError.textContent = 'لطفاً یوزرنیمت رو وارد کن!';
    loginError.style.display = 'block';
    return;
  }
  
  if (!username.startsWith('@')) {
    loginError.textContent = 'یوزرنیم باید با @ شروع بشه!';
    loginError.style.display = 'block';
    return;
  }
  
  loginError.style.display = 'none';
  
  // نمایش لودینگ
  loginPage.style.display = 'none';
  loadingPage.style.display = 'flex';
  
  // انیمیشن نوار پیشرفت
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 15;
    if (progress >= 100) {
      progress = 100;
      clearInterval(interval);
    }
    progressBar.style.width = progress + '%';
  }, 100);
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    
    if (data.error) {
      clearInterval(interval);
      loginError.textContent = data.error;
      loginError.style.display = 'block';
      loadingPage.style.display = 'none';
      loginPage.style.display = 'block';
      return;
    }
    
    // تکمیل لودینگ
    setTimeout(() => {
      clearInterval(interval);
      progressBar.style.width = '100%';
      setTimeout(() => {
        loadingPage.style.display = 'none';
        appPage.style.display = 'flex';
        currentUser = username;
        displayName.textContent = username;
        levelBadge.textContent = `شیشه‌ای ${data.level}`;
        if (data.avatar) avatarImg.src = data.avatar;
        socket.emit('user-join', username);
      }, 400);
    }, 300);
    
  } catch (err) {
    clearInterval(interval);
    loginError.textContent = 'خطا در اتصال به سرور';
    loginError.style.display = 'block';
    loadingPage.style.display = 'none';
    loginPage.style.display = 'block';
  }
};

// ===== آپلود آواتار =====
avatarUpload.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('avatar', file);
  form.append('username', currentUser);
  const res = await fetch('/api/upload-avatar', { method: 'POST', body: form });
  const data = await res.json();
  if (data.avatar) avatarImg.src = data.avatar;
};

// ===== ساخت گروه =====
createGroupBtn.onclick = () => {
  groupModal.style.display = 'flex';
};

confirmCreateGroup.onclick = async () => {
  const name = groupNameInput.value.trim();
  if (!name) return alert('اسم گروه رو بنویس');
  
  const res = await fetch('/api/create-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, creator: currentUser })
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  
  showGlassNotification(`✅ گروه "${name}" ساخته شد! لینک: ${data.link}`);
  groupModal.style.display = 'none';
  groupNameInput.value = '';
  
  // اضافه کردن به لیست گروه‌ها
  const div = document.createElement('div');
  div.textContent = `👥 ${name}`;
  div.dataset.groupId = data.id;
  div.dataset.link = data.link;
  div.onclick = () => openGroup(data.id, name, data.link);
  groupList.appendChild(div);
};

// ===== باز کردن گروه =====
function openGroup(groupId, groupName, link) {
  currentChat = groupId;
  currentChatType = 'group';
  currentGroupId = groupId;
  chatTitle.textContent = `👥 ${groupName}`;
  groupLinkDisplay.textContent = `🔗 ${link || 'بدون لینک'}`;
  messagesDiv.innerHTML = '';
  socket.emit('join-group-room', groupId);
  socket.emit('get-history', { groupId });
  
  // هایلایت کردن
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#groupList div[data-group-id="${groupId}"]`)?.classList.add('active');
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
}

// ===== باز کردن پی‌وی =====
function openPV(user) {
  if (user === currentUser) return;
  currentChat = user;
  currentChatType = 'pv';
  currentGroupId = null;
  chatTitle.textContent = `💬 ${user}`;
  groupLinkDisplay.textContent = '';
  messagesDiv.innerHTML = '';
  socket.emit('get-history', { withUser: user });
  
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#userList div[data-user="${user}"]`)?.classList.add('active');
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
}

// ===== ارسال پیام =====
sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !currentChat) return;
  
  const payload = {
    text,
    type: 'text'
  };
  
  if (currentChatType === 'pv') {
    payload.to = currentChat;
  } else if (currentChatType === 'group') {
    payload.groupId = currentChat;
  }
  
  socket.emit('send-message', payload);
  msgInput.value = '';
}

// ===== ارسال عکس =====
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const payload = {
      text: '📷 عکس',
      type: 'image',
      fileUrl: reader.result
    };
    if (currentChatType === 'pv') {
      payload.to = currentChat;
    } else if (currentChatType === 'group') {
      payload.groupId = currentChat;
    }
    socket.emit('send-message', payload);
  };
  reader.readAsDataURL(file);
};

// ===== نمایش پیام در صفحه =====
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg';
  
  if (msg.sender === currentUser) {
    div.classList.add('sent');
  } else {
    div.classList.add('received');
  }
  
  // نمایش فرستنده (برای گروه)
  if (msg.group_id && msg.sender !== currentUser) {
    const senderSpan = document.createElement('div');
    senderSpan.className = 'sender';
    senderSpan.textContent = msg.sender;
    div.appendChild(senderSpan);
  }
  
  const textSpan = document.createElement('span');
  textSpan.textContent = msg.text;
  div.appendChild(textSpan);
  
  if (msg.type === 'image' && msg.file_url) {
    const img = document.createElement('img');
    img.src = msg.file_url;
    div.appendChild(img);
  }
  
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ===== رویدادهای Socket =====
socket.on('user-data', (user) => {
  levelBadge.textContent = `شیشه‌ای ${user.level}`;
  if (user.avatar) avatarImg.src = user.avatar;
});

socket.on('online-users', (users) => {
  userList.innerHTML = '';
  users.filter(u => u !== currentUser).forEach(u => {
    const div = document.createElement('div');
    div.textContent = `🟢 ${u}`;
    div.dataset.user = u;
    div.onclick = () => openPV(u);
    userList.appendChild(div);
  });
});

socket.on('my-groups', (groups) => {
  groupList.innerHTML = '';
  groups.forEach(g => {
    const div = document.createElement('div');
    div.textContent = `👥 ${g.name}`;
    div.dataset.groupId = g.id;
    div.dataset.link = `Rona_Hina://${g.link_id}`;
    div.onclick = () => openGroup(g.id, g.name, `Rona_Hina://${g.link_id}`);
    groupList.appendChild(div);
  });
});

socket.on('receive-message', (msg) => {
  // بررسی اینکه پیام مربوط به چت فعلی هست یا نه
  if (currentChatType === 'pv' && (msg.sender === currentChat || msg.receiver === currentChat)) {
    appendMessage(msg);
    if (msg.sender !== currentUser) {
      showGlassNotification(`📩 ${msg.sender}: ${msg.text}`);
    }
  } else if (currentChatType === 'group' && msg.group_id == currentChat) {
    appendMessage(msg);
  }
});

socket.on('history', (msgs) => {
  messagesDiv.innerHTML = '';
  msgs.forEach(appendMessage);
});

socket.on('level-up', (data) => {
  showGlassNotification(data.msg);
  levelBadge.textContent = `شیشه‌ای ${data.level}`;
});

socket.on('user-connected', (user) => {
  showGlassNotification(`🟢 ${user} وارد شد`);
});

socket.on('user-disconnected', (user) => {
  showGlassNotification(`🔴 ${user} خارج شد`);
});

socket.on('error', (err) => {
  showGlassNotification(`❌ ${err}`);
});

// ===== مدیریت لینک دعوت (کپی خودکار) =====
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-link]')) {
    const link = e.target.closest('[data-link]').dataset.link;
    if (link) {
      navigator.clipboard?.writeText(link).then(() => {
        showGlassNotification('🔗 لینک کپی شد!');
      });
    }
  }
});

console.log('🚀 شیشه‌ای ها آماده‌ست!');
