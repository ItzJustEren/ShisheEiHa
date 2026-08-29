const socket = io({
  transports: ['websocket'],
  upgrade: false,
  auth: { token: localStorage.getItem('shisheiha_token') || '' }
});

let currentUser = '';
let currentChat = null;
let currentChatType = null;
let currentGroupId = null;
let currentOffset = 0;
const PAGE_SIZE = 50;
let replyToMessage = null;
let forwardMessageId = null;
const TOKEN_KEY = 'shisheiha_token';

// ===== DOM REFS =====
// ... (همون refهای قبلی)

// ===== TOKEN MANAGEMENT =====
function saveToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function removeToken() { localStorage.removeItem(TOKEN_KEY); }

// ===== NOTIFICATION =====
function showNotif(text, icon = 'fa-info-circle') {
  const el = document.getElementById('glassNotification');
  document.getElementById('notifIcon').className = 'fas ' + icon;
  document.getElementById('notifText').textContent = text;
  el.style.display = 'flex';
  el.style.animation = 'none';
  setTimeout(() => {
    el.style.animation = 'notifIn 0.3s ease-out, notifOut 0.4s 3.2s forwards';
  }, 10);
  setTimeout(() => { el.style.display = 'none'; }, 3800);
}

function showError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = '❌ ' + msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('loginError').style.display = 'none';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ===== VALIDATION =====
function validateUsername(username) {
  return /^@[a-zA-Z0-9_.]{3,30}$/.test(username);
}

// ===== AUTO LOGIN =====
async function autoLogin() {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch('/api/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.username;
      document.getElementById('displayName').textContent = data.display_name || data.username;
      document.getElementById('login').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      socket.auth.token = token;
      socket.connect();
      socket.emit('user-join');
      showNotif(`Welcome back ${data.display_name || data.username}! 🎉`, 'fa-glass-cheers');
      return true;
    } else {
      removeToken();
      return false;
    }
  } catch {
    removeToken();
    return false;
  }
}

// ===== AUTH =====
async function auth(mode) {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  hideError();

  if (!validateUsername(username)) {
    showError('Username: @ + letters, numbers, _ or . (3-30 chars)');
    return;
  }
  if (password.length < 4) {
    showError('Password must be at least 4 characters');
    return;
  }

  document.getElementById('login').style.display = 'none';
  document.getElementById('loading').style.display = 'flex';
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 12;
    if (progress >= 100) { progress = 100; clearInterval(interval); }
    document.getElementById('progressBar').style.width = progress + '%';
  }, 100);

  try {
    const endpoint = mode === 'login' ? '/api/login' : '/api/register';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.error) {
      clearInterval(interval);
      showError(data.error);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('login').style.display = 'block';
      return;
    }

    if (data.token) saveToken(data.token);
    setTimeout(() => {
      clearInterval(interval);
      document.getElementById('progressBar').style.width = '100%';
      setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        currentUser = username;
        document.getElementById('displayName').textContent = data.display_name || username;
        document.getElementById('levelBadge').innerHTML = `<i class="fas fa-star"></i> Level ${data.level || 1}`;
        if (data.avatar) document.getElementById('avatarImg').src = data.avatar;
        socket.auth.token = data.token || getToken();
        socket.connect();
        socket.emit('user-join');
        showNotif(`Welcome ${data.display_name || username}! 🎉`, 'fa-glass-cheers');
      }, 400);
    }, 400);
  } catch (err) {
    clearInterval(interval);
    showError('Connection error');
    document.getElementById('loading').style.display = 'none';
    document.getElementById('login').style.display = 'block';
  }
}

document.getElementById('loginBtn').onclick = () => auth('login');
document.getElementById('registerBtn').onclick = () => auth('register');
document.getElementById('username').addEventListener('keydown', e => { if (e.key === 'Enter') auth('login'); });
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') auth('login'); });

// ===== LOGOUT =====
document.getElementById('logoutBtn').onclick = () => {
  removeToken();
  localStorage.clear();
  location.reload();
};

// ===== AVATAR =====
document.getElementById('avatarUpload').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('avatar', file);
  form.append('username', currentUser);
  const res = await fetch('/api/upload-avatar', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: form
  });
  const data = await res.json();
  if (data.avatar) {
    document.getElementById('avatarImg').src = data.avatar;
    document.querySelectorAll(`img[data-user="${currentUser}"]`).forEach(el => el.src = data.avatar);
  }
};

// ===== PROFILE =====
async function openProfile(username) {
  if (!username) return;
  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ username })
  });
  const data = await res.json();
  if (data.error) return showNotif(data.error, 'fa-exclamation-circle');
  
  document.getElementById('profileAvatar').src = data.avatar || '';
  document.getElementById('profileUsername').textContent = data.username;
  document.getElementById('profileDisplayName').textContent = data.display_name || data.username;
  document.getElementById('profileBio').textContent = data.bio || 'No bio yet';
  document.getElementById('profileLevel').innerHTML = `<i class="fas fa-star"></i> Level ${data.level || 1}`;
  
  if (username === currentUser) {
    document.getElementById('editProfileBtn').style.display = 'flex';
    document.getElementById('editDisplayName').value = data.display_name || '';
    document.getElementById('editBio').value = data.bio || '';
  } else {
    document.getElementById('editProfileBtn').style.display = 'none';
  }
  document.getElementById('profileModal').style.display = 'flex';
}

document.addEventListener('click', (e) => {
  const avatarWrap = e.target.closest('.avatar-wrap');
  if (avatarWrap) {
    const username = avatarWrap.dataset.user;
    if (username) openProfile(username);
  }
  const senderName = e.target.closest('.sender-name');
  if (senderName) {
    const username = senderName.dataset.user;
    if (username) openProfile(username);
  }
});

document.getElementById('editProfileBtn').onclick = () => {
  closeModal('profileModal');
  document.getElementById('editProfileModal').style.display = 'flex';
};

document.getElementById('saveProfileBtn').onclick = async () => {
  const display_name = document.getElementById('editDisplayName').value.trim() || currentUser;
  const bio = document.getElementById('editBio').value.trim();
  const res = await fetch('/api/update-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ username: currentUser, display_name, bio })
  });
  const data = await res.json();
  if (data.success) {
    showNotif('Profile updated!', 'fa-check-circle');
    closeModal('editProfileModal');
    document.getElementById('displayName').textContent = display_name;
  } else {
    showNotif(data.error, 'fa-exclamation-circle');
  }
};

// ===== SEARCH =====
let searchTimeout;
document.getElementById('searchUser').oninput = () => {
  clearTimeout(searchTimeout);
  const query = document.getElementById('searchUser').value.trim();
  if (query.length < 2) { document.getElementById('searchResults').style.display = 'none'; return; }
  searchTimeout = setTimeout(async () => {
    const res = await fetch('/api/search-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ query })
    });
    const users = await res.json();
    const results = document.getElementById('searchResults');
    results.innerHTML = '';
    if (users.length === 0) {
      const div = document.createElement('div');
      div.textContent = 'No users found';
      div.style.color = 'rgba(255,255,255,0.3)';
      results.appendChild(div);
    } else {
      users.forEach(u => {
        const div = document.createElement('div');
        div.innerHTML = `<img src="${u.avatar || ''}" onerror="this.style.display='none'"> ${u.display_name || u.username} (${u.username})`;
        div.onclick = () => { openPV(u.username); document.getElementById('searchUser').value = ''; results.style.display = 'none'; };
        results.appendChild(div);
      });
    }
    results.style.display = 'block';
  }, 300);
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) document.getElementById('searchResults').style.display = 'none';
});

// ===== GROUPS =====
document.getElementById('createGroupBtn').onclick = () => { document.getElementById('groupModal').style.display = 'flex'; };
document.getElementById('joinGroupBtn').onclick = () => { document.getElementById('joinGroupModal').style.display = 'flex'; };

document.getElementById('confirmCreateGroup').onclick = async () => {
  const name = document.getElementById('groupNameInput').value.trim();
  if (!name) return showNotif('Enter group name', 'fa-exclamation-circle');
  const res = await fetch('/api/create-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ name, creator: currentUser })
  });
  const data = await res.json();
  if (data.error) return showNotif(data.error, 'fa-exclamation-circle');
  showNotif(`Group "${name}" created!`, 'fa-check-circle');
  closeModal('groupModal');
  document.getElementById('groupNameInput').value = '';
  addGroupToList(data.id, name, data.link);
};

document.getElementById('confirmJoinGroup').onclick = async () => {
  const link = document.getElementById('groupLinkInput').value.trim();
  if (!link) return showNotif('Enter group link', 'fa-exclamation-circle');
  const linkId = link.replace('Shisheiha://', '').trim();
  if (!linkId) return showNotif('Invalid link format', 'fa-exclamation-circle');
  const res = await fetch('/api/join-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ linkId, username: currentUser })
  });
  const data = await res.json();
  if (data.error) return showNotif(data.error, 'fa-exclamation-circle');
  showNotif(`Joined "${data.groupName}"!`, 'fa-check-circle');
  closeModal('joinGroupModal');
  document.getElementById('groupLinkInput').value = '';
  socket.emit('user-join');
};

function addGroupToList(id, name, link) {
  const div = document.createElement('div');
  div.innerHTML = `<i class="fas fa-users" style="color:#4facfe;"></i> ${name}`;
  div.dataset.groupId = id;
  div.dataset.link = link;
  div.onclick = () => openGroup(id, name, link);
  document.getElementById('groupList').appendChild(div);
}

// ===== OPEN CHAT =====
function openPV(user) {
  if (user === currentUser) return;
  currentChat = user;
  currentChatType = 'pv';
  currentGroupId = null;
  currentOffset = 0;
  document.getElementById('chatTitle').textContent = user;
  document.getElementById('chatSubtitle').textContent = '';
  document.getElementById('messages').innerHTML = '';
  
  socket.emit('join-pv-room', { withUser: user });
  socket.emit('get-history', { withUser: user, limit: PAGE_SIZE, offset: 0 });
  
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#userList div[data-user="${user}"]`)?.classList.add('active');
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
}

function openGroup(id, name, link) {
  currentChat = id;
  currentChatType = 'group';
  currentGroupId = id;
  currentOffset = 0;
  document.getElementById('chatTitle').textContent = `👥 ${name}`;
  document.getElementById('chatSubtitle').textContent = link || '';
  document.getElementById('messages').innerHTML = '';
  
  socket.emit('join-group-room', id);
  socket.emit('get-history', { groupId: id, limit: PAGE_SIZE, offset: 0 });
  
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#groupList div[data-group-id="${id}"]`)?.classList.add('active');
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
}

// ===== REPLY =====
function setReply(messageId, sender, text, senderDisplay) {
  replyToMessage = { id: messageId, sender, text, sender_display: senderDisplay };
  const replyBar = document.getElementById('replyBar');
  document.getElementById('replySender').textContent = `Replying to ${senderDisplay || sender}`;
  document.getElementById('replyText').textContent = text.length > 60 ? text.slice(0, 60) + '...' : text;
  replyBar.style.display = 'flex';
  document.getElementById('msgInput').focus();
}

function cancelReply() {
  replyToMessage = null;
  document.getElementById('replyBar').style.display = 'none';
}

document.getElementById('cancelReplyBtn').onclick = cancelReply;

// ===== FORWARD =====
function openForwardModal(messageId) {
  forwardMessageId = messageId;
  document.getElementById('forwardModal').style.display = 'flex';
  document.getElementById('forwardSearch').value = '';
  document.getElementById('forwardResults').innerHTML = '';
  document.getElementById('forwardSearch').focus();
}

document.getElementById('forwardSearch').addEventListener('input', async (e) => {
  const query = e.target.value.trim();
  if (query.length < 2) {
    document.getElementById('forwardResults').innerHTML = '';
    return;
  }
  const res = await fetch('/api/search-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ query })
  });
  const users = await res.json();
  const groupsRes = await fetch('/api/my-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ username: currentUser })
  });
  const groups = await groupsRes.json();
  const results = document.getElementById('forwardResults');
  results.innerHTML = '';
  
  users.filter(u => u.username !== currentUser).forEach(u => {
    const div = document.createElement('div');
    div.className = 'forward-item';
    div.innerHTML = `
      <img src="${u.avatar || ''}" onerror="this.style.display='none'">
      <span>${u.display_name || u.username}</span>
      <small style="color:rgba(255,255,255,0.3);">${u.username}</small>
    `;
    div.onclick = () => {
      socket.emit('forward-message', { messageId: forwardMessageId, to: u.username });
      closeModal('forwardModal');
      showNotif('Message forwarded!', 'fa-check-circle');
    };
    results.appendChild(div);
  });
  
  groups.forEach(g => {
    const div = document.createElement('div');
    div.className = 'forward-item';
    div.innerHTML = `
      <i class="fas fa-users" style="color:#4facfe;"></i>
      <span>${g.name}</span>
      <small style="color:rgba(255,255,255,0.3);">Group</small>
    `;
    div.onclick = () => {
      socket.emit('forward-message', { messageId: forwardMessageId, groupId: g.id });
      closeModal('forwardModal');
      showNotif('Message forwarded to group!', 'fa-check-circle');
    };
    results.appendChild(div);
  });
  
  if (results.children.length === 0) {
    results.innerHTML = '<div style="color:rgba(255,255,255,0.3); padding:12px; text-align:center;">No users or groups found</div>';
  }
});

// ===== SEND MESSAGE =====
function sendMessage() {
  const text = document.getElementById('msgInput').value.trim();
  if (!text || !currentChat) return;
  const payload = { text, type: 'text' };
  if (currentChatType === 'pv') payload.to = currentChat;
  else if (currentChatType === 'group') payload.groupId = currentChat;
  if (replyToMessage) {
    payload.replyTo = replyToMessage.id;
    cancelReply();
  }
  socket.emit('send-message', payload);
  document.getElementById('msgInput').value = '';
}

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ===== FILE UPLOAD =====
document.getElementById('fileBtn').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const payload = { text: '📷 Photo', type: 'image', fileUrl: reader.result };
    if (currentChatType === 'pv') payload.to = currentChat;
    else if (currentChatType === 'group') payload.groupId = currentChat;
    socket.emit('send-message', payload);
  };
  reader.readAsDataURL(file);
};

// ===== MENTION =====
let mentionTimeout;
document.getElementById('msgInput').addEventListener('input', async (e) => {
  const text = document.getElementById('msgInput').value;
  const lastAt = text.lastIndexOf('@');
  if (lastAt !== -1 && text.length - lastAt <= 20) {
    const query = text.slice(lastAt + 1);
    clearTimeout(mentionTimeout);
    mentionTimeout = setTimeout(async () => {
      if (query.length >= 1 && currentChatType === 'group' && currentGroupId) {
        const res = await fetch('/api/search-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
          body: JSON.stringify({ query, groupId: currentGroupId })
        });
        const users = await res.json();
        showMentionSuggestions(users, lastAt);
      }
    }, 300);
  } else {
    hideMentionSuggestions();
  }
});

function showMentionSuggestions(users, atIndex) {
  let container = document.getElementById('mentionSuggestions');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mentionSuggestions';
    container.className = 'mention-suggestions';
    document.getElementById('inputArea').style.position = 'relative';
    document.getElementById('inputArea').appendChild(container);
  }
  container.innerHTML = '';
  if (users.length === 0) {
    const div = document.createElement('div');
    div.textContent = 'No users found';
    div.style.color = 'rgba(255,255,255,0.3)';
    container.appendChild(div);
  } else {
    users.forEach(u => {
      const div = document.createElement('div');
      div.innerHTML = `<img src="${u.avatar || ''}" onerror="this.style.display='none'"> ${u.display_name || u.username}`;
      div.onclick = () => {
        const beforeAt = document.getElementById('msgInput').value.slice(0, atIndex);
        document.getElementById('msgInput').value = beforeAt + `@${u.username} `;
        hideMentionSuggestions();
        document.getElementById('msgInput').focus();
      };
      container.appendChild(div);
    });
  }
  container.style.display = 'block';
}

function hideMentionSuggestions() {
  const container = document.getElementById('mentionSuggestions');
  if (container) container.style.display = 'none';
}

// ===== RENDER MESSAGE =====
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.dataset.msgId = msg.id;
  if (msg.sender === currentUser) div.classList.add('sent');
  else div.classList.add('received');
  
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'avatar-wrap';
  avatarWrap.dataset.user = msg.sender;
  const avatarImg = document.createElement('img');
  avatarImg.src = msg.sender_avatar || '';
  avatarImg.onerror = () => { avatarImg.style.display = 'none'; };
  avatarWrap.appendChild(avatarImg);
  div.appendChild(avatarWrap);
  
  const content = document.createElement('div');
  content.className = 'content';
  
  if (msg.group_id && msg.sender !== currentUser) {
    const nameSpan = document.createElement('div');
    nameSpan.className = 'sender-name';
    nameSpan.dataset.user = msg.sender;
    nameSpan.textContent = msg.sender_display || msg.sender;
    content.appendChild(nameSpan);
  }
  
  if (msg.reply_to) {
    const replyPreview = document.createElement('div');
    replyPreview.className = 'reply-preview';
    replyPreview.innerHTML = `
      <i class="fas fa-reply"></i>
      <span><strong>${msg.reply_sender_display || msg.reply_sender}</strong>: ${msg.reply_text || 'Deleted message'}</span>
    `;
    content.appendChild(replyPreview);
  }
  
  const textSpan = document.createElement('span');
  textSpan.textContent = msg.text;
  content.appendChild(textSpan);
  
  if (msg.is_edited) {
    const editBadge = document.createElement('span');
    editBadge.className = 'edit-badge';
    editBadge.textContent = ' (edited)';
    content.appendChild(editBadge);
  }
  
  if (msg.type === 'image' && msg.file_url) {
    const img = document.createElement('img');
    img.src = msg.file_url;
    content.appendChild(img);
  }
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : '';
  content.appendChild(timeSpan);
  div.appendChild(content);
  
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  
  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn';
  replyBtn.innerHTML = '<i class="fas fa-reply"></i>';
  replyBtn.title = 'Reply';
  replyBtn.onclick = (e) => {
    e.stopPropagation();
    setReply(msg.id, msg.sender, msg.text, msg.sender_display);
  };
  actions.appendChild(replyBtn);
  
  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'msg-action-btn';
  forwardBtn.innerHTML = '<i class="fas fa-share"></i>';
  forwardBtn.title = 'Forward';
  forwardBtn.onclick = (e) => {
    e.stopPropagation();
    openForwardModal(msg.id);
  };
  actions.appendChild(forwardBtn);
  
  const pinBtn = document.createElement('button');
  pinBtn.className = 'msg-action-btn';
  if (msg.is_pinned) {
    pinBtn.innerHTML = '<i class="fas fa-thumbtack" style="color:#4facfe;"></i>';
    pinBtn.title = 'Unpin';
  } else {
    pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
    pinBtn.title = 'Pin';
  }
  pinBtn.onclick = (e) => {
    e.stopPropagation();
    socket.emit('pin-message', { messageId: msg.id });
  };
  actions.appendChild(pinBtn);
  
  if (msg.sender === currentUser) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-btn';
    deleteBtn.innerHTML = '<i class="fas fa-trash" style="color:#ff6b6b;"></i>';
    deleteBtn.title = 'Delete';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm('Delete this message?')) {
        socket.emit('delete-message', { messageId: msg.id });
      }
    };
    actions.appendChild(deleteBtn);
    
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
    editBtn.title = 'Edit';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      const newText = prompt('Edit message:', msg.text);
      if (newText && newText.trim() && newText.trim() !== msg.text) {
        socket.emit('edit-message', { messageId: msg.id, newText: newText.trim() });
      }
    };
    actions.appendChild(editBtn);
  }
  
  div.appendChild(actions);
  document.getElementById('messages').appendChild(div);
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}

// ============================================================
// ===================== SOCKET EVENTS =========================
// ============================================================

socket.on('connect', () => {
  console.log('🟢 Socket connected');
  if (currentUser) socket.emit('user-join');
});

socket.on('user-data', (user) => {
  document.getElementById('levelBadge').innerHTML = `<i class="fas fa-star"></i> Level ${user.level}`;
  if (user.avatar) document.getElementById('avatarImg').src = user.avatar;
  document.getElementById('displayName').textContent = user.display_name || user.username;
});

socket.on('online-users', (users) => {
  const list = document.getElementById('userList');
  list.innerHTML = '';
  users.filter(u => u.username !== currentUser).forEach(u => {
    const div = document.createElement('div');
    const avatar = u.avatar ? `<img src="${u.avatar}" onerror="this.style.display='none'">` : `<i class="fas fa-user" style="color:rgba(255,255,255,0.3);"></i>`;
    div.innerHTML = `${avatar} ${u.display_name || u.username} <i class="fas fa-circle" style="color:#4caf50; font-size:8px; margin-left:auto;"></i>`;
    div.dataset.user = u.username;
    div.onclick = () => openPV(u.username);
    list.appendChild(div);
  });
});

socket.on('my-groups', (groups) => {
  const list = document.getElementById('groupList');
  list.innerHTML = '';
  groups.forEach(g => addGroupToList(g.id, g.name, `Shisheiha://${g.link_id}`));
});

socket.on('receive-message', (msg) => {
  if (currentChatType === 'pv' && (msg.sender === currentChat || msg.receiver === currentChat)) {
    appendMessage(msg);
    if (msg.sender !== currentUser) showNotif(`${msg.sender_display || msg.sender}: ${msg.text}`, 'fa-comment');
  } else if (currentChatType === 'group' && msg.group_id == currentChat) {
    appendMessage(msg);
  }
});

socket.on('history', (msgs) => {
  document.getElementById('messages').innerHTML = '';
  const pinned = msgs.filter(m => m.is_pinned);
  const normal = msgs.filter(m => !m.is_pinned);
  
  if (pinned.length > 0) {
    const header = document.createElement('div');
    header.className = 'pinned-header';
    header.innerHTML = `<i class="fas fa-thumbtack" style="color:#4facfe;"></i> Pinned Messages`;
    document.getElementById('messages').appendChild(header);
    pinned.forEach(appendMessage);
  }
  
  normal.forEach(appendMessage);
  
  if (msgs.length === 0) {
    const sys = document.createElement('div');
    sys.className = 'system-msg';
    sys.textContent = 'No messages yet. Say hello! 👋';
    document.getElementById('messages').appendChild(sys);
  }
});

socket.on('message-pinned', () => {
  showNotif('📌 Message pinned', 'fa-thumbtack');
  if (currentChatType === 'pv') socket.emit('get-history', { withUser: currentChat, limit: PAGE_SIZE, offset: 0 });
  else if (currentChatType === 'group') socket.emit('get-history', { groupId: currentGroupId, limit: PAGE_SIZE, offset: 0 });
});

socket.on('message-unpinned', () => {
  showNotif('📌 Message unpinned', 'fa-thumbtack');
  if (currentChatType === 'pv') socket.emit('get-history', { withUser: currentChat, limit: PAGE_SIZE, offset: 0 });
  else if (currentChatType === 'group') socket.emit('get-history', { groupId: currentGroupId, limit: PAGE_SIZE, offset: 0 });
});

socket.on('message-deleted', ({ messageId }) => {
  const msgEl = document.querySelector(`.msg[data-msg-id="${messageId}"]`);
  if (msgEl) {
    msgEl.style.opacity = '0.3';
    msgEl.style.pointerEvents = 'none';
    msgEl.innerHTML = `
      <div class="content" style="display:flex; align-items:center; gap:8px; opacity:0.5; font-style:italic;">
        <i class="fas fa-trash"></i>
        <span>Message deleted</span>
      </div>
    `;
  }
});

socket.on('message-edited', (msg) => {
  const msgEl = document.querySelector(`.msg[data-msg-id="${msg.id}"]`);
  if (msgEl) {
    const textSpan = msgEl.querySelector('.content > span:not(.edit-badge)');
    if (textSpan) textSpan.textContent = msg.text;
    let editBadge = msgEl.querySelector('.edit-badge');
    if (!editBadge) {
      editBadge = document.createElement('span');
      editBadge.className = 'edit-badge';
      editBadge.textContent = ' (edited)';
      msgEl.querySelector('.content').appendChild(editBadge);
    }
  }
});

socket.on('mention-notification', (data) => {
  showNotif(`🔔 ${data.from_display || data.from} mentioned you: ${data.message}`, 'fa-at');
});

socket.on('mention-badge', ({ groupId, username }) => {
  // نمایش @ کنار گروه
  const groupDiv = document.querySelector(`#groupList div[data-group-id="${groupId}"]`);
  if (groupDiv) {
    let badge = groupDiv.querySelector('.mention-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mention-badge';
      badge.innerHTML = `<i class="fas fa-at"></i> ${username}`;
      groupDiv.appendChild(badge);
    }
    setTimeout(() => { badge.remove(); }, 5000);
  }
});

socket.on('level-up', (data) => {
  showNotif(data.msg, 'fa-trophy');
  document.getElementById('levelBadge').innerHTML = `<i class="fas fa-star"></i> Level ${data.level}`;
});

socket.on('user-connected', (data) => {
  showNotif(`${data.display_name || data.username} joined`, 'fa-user-plus');
});

socket.on('user-disconnected', (username) => {
  showNotif(`${username} left`, 'fa-user-minus');
});

socket.on('error', (err) => {
  showNotif(`Error: ${err}`, 'fa-exclamation-circle');
});

// ============================================================
// ===================== INIT ==================================
// ============================================================

(async function init() {
  const loggedIn = await autoLogin();
  if (!loggedIn) {
    document.getElementById('login').style.display = 'block';
    document.getElementById('app').style.display = 'none';
  }
})();

console.log('🚀 Shisheiha v4.0 ready!');
