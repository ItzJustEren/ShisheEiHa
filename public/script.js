// ============================================================
// ===================== CONFIG ================================
// ============================================================

const socket = io({
  transports: ['websocket'],
  upgrade: false,
  auth: { token: localStorage.getItem('shisheiha_token') || '' }
});

const TOKEN_KEY = 'shisheiha_token';
const PAGE_SIZE = 50;

let currentUser = '';
let currentChat = null;
let currentChatType = null; // 'pv' or 'group'
let currentGroupId = null;
let currentOffset = 0;
let replyToMessage = null;
let forwardMessageId = null;

// ===== CALL VARIABLES =====
let callFrame = null;
let currentCallRoomUrl = null;
let isCallActive = false;

// ============================================================
// ===================== DOM REFS ==============================
// ============================================================

const loginPage = document.getElementById('login');
const loadingPage = document.getElementById('loading');
const appPage = document.getElementById('app');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const loginError = document.getElementById('loginError');
const progressBar = document.getElementById('progressBar');
const displayName = document.getElementById('displayName');
const levelBadge = document.getElementById('levelBadge');
const avatarImg = document.getElementById('avatarImg');
const avatarUpload = document.getElementById('avatarUpload');
const logoutBtn = document.getElementById('logoutBtn');
const userList = document.getElementById('userList');
const groupList = document.getElementById('groupList');
const searchUser = document.getElementById('searchUser');
const searchResults = document.getElementById('searchResults');
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const chatTitle = document.getElementById('chatTitle');
const chatSubtitle = document.getElementById('chatSubtitle');
const createGroupBtn = document.getElementById('createGroupBtn');
const joinGroupBtn = document.getElementById('joinGroupBtn');
const groupModal = document.getElementById('groupModal');
const joinGroupModal = document.getElementById('joinGroupModal');
const groupNameInput = document.getElementById('groupNameInput');
const groupLinkInput = document.getElementById('groupLinkInput');
const confirmCreateGroup = document.getElementById('confirmCreateGroup');
const confirmJoinGroup = document.getElementById('confirmJoinGroup');
const profileModal = document.getElementById('profileModal');
const editProfileModal = document.getElementById('editProfileModal');
const profileAvatar = document.getElementById('profileAvatar');
const profileUsername = document.getElementById('profileUsername');
const profileDisplayName = document.getElementById('profileDisplayName');
const profileBio = document.getElementById('profileBio');
const profileLevel = document.getElementById('profileLevel');
const editDisplayName = document.getElementById('editDisplayName');
const editBio = document.getElementById('editBio');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const editProfileBtn = document.getElementById('editProfileBtn');
const forwardModal = document.getElementById('forwardModal');
const forwardSearch = document.getElementById('forwardSearch');
const forwardResults = document.getElementById('forwardResults');

// ===== CALL BUTTONS =====
const callActions = document.getElementById('callActions');
const startCallBtn = document.getElementById('startCallBtn');
const joinCallBtn = document.getElementById('joinCallBtn');
const endCallBtn = document.getElementById('endCallBtn');
const callContainer = document.getElementById('callContainer');

// ============================================================
// ===================== TOKEN MANAGEMENT ======================
// ============================================================

function saveToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function removeToken() { localStorage.removeItem(TOKEN_KEY); }

// ============================================================
// ===================== NOTIFICATIONS =========================
// ============================================================

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
  loginError.textContent = '❌ ' + msg;
  loginError.style.display = 'block';
}

function hideError() {
  loginError.style.display = 'none';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ============================================================
// ===================== VALIDATION ============================
// ============================================================

function validateUsername(username) {
  return /^@[a-zA-Z0-9_.]{3,30}$/.test(username);
}

// ============================================================
// ===================== AUTO LOGIN ============================
// ============================================================

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
      displayName.textContent = data.display_name || data.username;
      loginPage.style.display = 'none';
      appPage.style.display = 'flex';
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

// ============================================================
// ===================== AUTH ==================================
// ============================================================

async function auth(mode) {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  hideError();

  if (!validateUsername(username)) {
    showError('Username: @ + letters, numbers, _ or . (3-30 chars)');
    return;
  }
  if (password.length < 4) {
    showError('Password must be at least 4 characters');
    return;
  }

  loginPage.style.display = 'none';
  loadingPage.style.display = 'flex';
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 12;
    if (progress >= 100) { progress = 100; clearInterval(interval); }
    progressBar.style.width = progress + '%';
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
      loadingPage.style.display = 'none';
      loginPage.style.display = 'block';
      return;
    }

    if (data.token) saveToken(data.token);
    setTimeout(() => {
      clearInterval(interval);
      progressBar.style.width = '100%';
      setTimeout(() => {
        loadingPage.style.display = 'none';
        appPage.style.display = 'flex';
        currentUser = username;
        displayName.textContent = data.display_name || username;
        levelBadge.innerHTML = `<i class="fas fa-star"></i> Level ${data.level || 1}`;
        if (data.avatar) avatarImg.src = data.avatar;
        socket.auth.token = data.token || getToken();
        socket.connect();
        socket.emit('user-join');
        showNotif(`Welcome ${data.display_name || username}! 🎉`, 'fa-glass-cheers');
      }, 400);
    }, 400);
  } catch (err) {
    clearInterval(interval);
    showError('Connection error');
    loadingPage.style.display = 'none';
    loginPage.style.display = 'block';
  }
}

loginBtn.onclick = () => auth('login');
registerBtn.onclick = () => auth('register');
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') auth('login'); });
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') auth('login'); });

// ============================================================
// ===================== LOGOUT ================================
// ============================================================

logoutBtn.onclick = () => {
  if (isCallActive) endCallUI();
  removeToken();
  localStorage.clear();
  location.reload();
};

// ============================================================
// ===================== AVATAR ================================
// ============================================================

avatarUpload.onchange = async (e) => {
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
    avatarImg.src = data.avatar;
    document.querySelectorAll(`img[data-user="${currentUser}"]`).forEach(el => el.src = data.avatar);
  }
};

// ============================================================
// ===================== PROFILE ===============================
// ============================================================

async function openProfile(username) {
  if (!username) return;
  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ username })
  });
  const data = await res.json();
  if (data.error) return showNotif(data.error, 'fa-exclamation-circle');
  
  profileAvatar.src = data.avatar || '';
  profileUsername.textContent = data.username;
  profileDisplayName.textContent = data.display_name || data.username;
  profileBio.textContent = data.bio || 'No bio yet';
  profileLevel.innerHTML = `<i class="fas fa-star"></i> Level ${data.level || 1}`;
  
  if (username === currentUser) {
    editProfileBtn.style.display = 'flex';
    editDisplayName.value = data.display_name || '';
    editBio.value = data.bio || '';
  } else {
    editProfileBtn.style.display = 'none';
  }
  profileModal.style.display = 'flex';
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

editProfileBtn.onclick = () => {
  closeModal('profileModal');
  editProfileModal.style.display = 'flex';
};

saveProfileBtn.onclick = async () => {
  const display_name = editDisplayName.value.trim() || currentUser;
  const bio = editBio.value.trim();
  const res = await fetch('/api/update-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ username: currentUser, display_name, bio })
  });
  const data = await res.json();
  if (data.success) {
    showNotif('Profile updated!', 'fa-check-circle');
    closeModal('editProfileModal');
    displayName.textContent = display_name;
  } else {
    showNotif(data.error, 'fa-exclamation-circle');
  }
};

// ============================================================
// ===================== SEARCH ================================
// ============================================================

let searchTimeout;
searchUser.oninput = () => {
  clearTimeout(searchTimeout);
  const query = searchUser.value.trim();
  if (query.length < 2) { searchResults.style.display = 'none'; return; }
  searchTimeout = setTimeout(async () => {
    const res = await fetch('/api/search-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ query })
    });
    const users = await res.json();
    searchResults.innerHTML = '';
    if (users.length === 0) {
      const div = document.createElement('div');
      div.textContent = 'No users found';
      div.style.color = 'rgba(255,255,255,0.3)';
      searchResults.appendChild(div);
    } else {
      users.forEach(u => {
        const div = document.createElement('div');
        div.innerHTML = `<img src="${u.avatar || ''}" onerror="this.style.display='none'"> ${u.display_name || u.username} (${u.username})`;
        div.onclick = () => { openPV(u.username); searchUser.value = ''; searchResults.style.display = 'none'; };
        searchResults.appendChild(div);
      });
    }
    searchResults.style.display = 'block';
  }, 300);
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) searchResults.style.display = 'none';
});

// ============================================================
// ===================== GROUPS ================================
// ============================================================

createGroupBtn.onclick = () => { groupModal.style.display = 'flex'; };
joinGroupBtn.onclick = () => { joinGroupModal.style.display = 'flex'; };

confirmCreateGroup.onclick = async () => {
  const name = groupNameInput.value.trim();
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
  groupNameInput.value = '';
  addGroupToList(data.id, name, data.link);
};

confirmJoinGroup.onclick = async () => {
  const link = groupLinkInput.value.trim();
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
  groupLinkInput.value = '';
  socket.emit('user-join');
};

function addGroupToList(id, name, link) {
  const div = document.createElement('div');
  div.innerHTML = `<i class="fas fa-users" style="color:#4facfe;"></i> ${name}`;
  div.dataset.groupId = id;
  div.dataset.link = link;
  div.onclick = () => openGroup(id, name, link);
  groupList.appendChild(div);
}

// ============================================================
// ===================== OPEN CHAT =============================
// ============================================================

function openPV(user) {
  if (user === currentUser) return;
  if (isCallActive) endCallUI();
  currentChat = user;
  currentChatType = 'pv';
  currentGroupId = null;
  currentOffset = 0;
  chatTitle.textContent = user;
  chatSubtitle.textContent = '';
  messagesDiv.innerHTML = '';
  
  callActions.style.display = 'none';
  
  socket.emit('join-pv-room', { withUser: user });
  socket.emit('get-history', { withUser: user, limit: PAGE_SIZE, offset: 0 });
  
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#userList div[data-user="${user}"]`)?.classList.add('active');
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
}

function openGroup(id, name, link) {
  if (isCallActive) endCallUI();
  currentChat = id;
  currentChatType = 'group';
  currentGroupId = id;
  currentOffset = 0;
  chatTitle.textContent = `👥 ${name}`;
  chatSubtitle.textContent = link || '';
  messagesDiv.innerHTML = '';
  
  // نمایش دکمه‌های تماس
  callActions.style.display = 'flex';
  startCallBtn.style.display = 'flex';
  joinCallBtn.style.display = 'none';
  endCallBtn.style.display = 'none';
  
  socket.emit('join-group-room', id);
  socket.emit('get-history', { groupId: id, limit: PAGE_SIZE, offset: 0 });
  
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#groupList div[data-group-id="${id}"]`)?.classList.add('active');
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
}

// ============================================================
// ===================== CALL FUNCTIONS ========================
// ============================================================

function showCallUI(roomUrl) {
  callContainer.style.display = 'block';
  
  callFrame = Daily.createFrame(callContainer, {
    showLeaveButton: true,
    showFullscreenButton: true,
    iframeStyle: {
      width: '100%',
      height: '100%',
      border: 'none'
    }
  });
  
  callFrame.join({ url: roomUrl });
  isCallActive = true;
  
  startCallBtn.style.display = 'none';
  joinCallBtn.style.display = 'none';
  endCallBtn.style.display = 'flex';
}

function endCallUI() {
  if (callFrame) {
    callFrame.leave();
    callFrame.destroy();
    callFrame = null;
  }
  callContainer.style.display = 'none';
  isCallActive = false;
  currentCallRoomUrl = null;
  
  endCallBtn.style.display = 'none';
  startCallBtn.style.display = 'flex';
}

// ===== CALL BUTTON EVENTS =====
startCallBtn.onclick = () => {
  if (!currentGroupId) {
    showNotif('Please select a group first', 'fa-exclamation-circle');
    return;
  }
  socket.emit('start-group-call', { groupId: currentGroupId });
};

endCallBtn.onclick = () => {
  if (currentGroupId) {
    socket.emit('end-group-call', { groupId: currentGroupId });
  }
  endCallUI();
};

joinCallBtn.onclick = () => {
  if (currentCallRoomUrl) {
    showCallUI(currentCallRoomUrl);
  }
};

// ============================================================
// ===================== REPLY =================================
// ============================================================

function setReply(messageId, sender, text, senderDisplay) {
  replyToMessage = { id: messageId, sender, text, sender_display: senderDisplay };
  const replyBar = document.getElementById('replyBar');
  document.getElementById('replySender').textContent = `Replying to ${senderDisplay || sender}`;
  document.getElementById('replyText').textContent = text.length > 60 ? text.slice(0, 60) + '...' : text;
  replyBar.style.display = 'flex';
  msgInput.focus();
}

function cancelReply() {
  replyToMessage = null;
  document.getElementById('replyBar').style.display = 'none';
}

document.getElementById('cancelReplyBtn').onclick = cancelReply;

// ============================================================
// ===================== FORWARD ===============================
// ============================================================

function openForwardModal(messageId) {
  forwardMessageId = messageId;
  forwardModal.style.display = 'flex';
  forwardSearch.value = '';
  forwardResults.innerHTML = '';
  forwardSearch.focus();
}

forwardSearch.addEventListener('input', async (e) => {
  const query = e.target.value.trim();
  if (query.length < 2) {
    forwardResults.innerHTML = '';
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
  forwardResults.innerHTML = '';
  
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
    forwardResults.appendChild(div);
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
    forwardResults.appendChild(div);
  });
  
  if (forwardResults.children.length === 0) {
    forwardResults.innerHTML = '<div style="color:rgba(255,255,255,0.3); padding:12px; text-align:center;">No users or groups found</div>';
  }
});

// ============================================================
// ===================== SEND MESSAGE ==========================
// ============================================================

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !currentChat) return;
  const payload = { text, type: 'text' };
  if (currentChatType === 'pv') payload.to = currentChat;
  else if (currentChatType === 'group') payload.groupId = currentChat;
  if (replyToMessage) {
    payload.replyTo = replyToMessage.id;
    cancelReply();
  }
  socket.emit('send-message', payload);
  msgInput.value = '';
}

sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ============================================================
// ===================== FILE UPLOAD ===========================
// ============================================================

fileBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => {
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

// ============================================================
// ===================== MENTION ===============================
// ============================================================

let mentionTimeout;
msgInput.addEventListener('input', async (e) => {
  const text = msgInput.value;
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
        const beforeAt = msgInput.value.slice(0, atIndex);
        msgInput.value = beforeAt + `@${u.username} `;
        hideMentionSuggestions();
        msgInput.focus();
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

// ============================================================
// ===================== RENDER MESSAGE ========================
// ============================================================

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
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ============================================================
// ===================== SOCKET EVENTS =========================
// ============================================================

socket.on('connect', () => {
  console.log('🟢 Socket connected');
  if (currentUser) socket.emit('user-join');
});

socket.on('user-data', (user) => {
  levelBadge.innerHTML = `<i class="fas fa-star"></i> Level ${user.level}`;
  if (user.avatar) avatarImg.src = user.avatar;
  displayName.textContent = user.display_name || user.username;
});

socket.on('online-users', (users) => {
  userList.innerHTML = '';
  users.filter(u => u.username !== currentUser).forEach(u => {
    const div = document.createElement('div');
    const avatar = u.avatar ? `<img src="${u.avatar}" onerror="this.style.display='none'">` : `<i class="fas fa-user" style="color:rgba(255,255,255,0.3);"></i>`;
    div.innerHTML = `${avatar} ${u.display_name || u.username} <i class="fas fa-circle" style="color:#4caf50; font-size:8px; margin-left:auto;"></i>`;
    div.dataset.user = u.username;
    div.onclick = () => openPV(u.username);
    userList.appendChild(div);
  });
});

socket.on('my-groups', (groups) => {
  groupList.innerHTML = '';
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
  messagesDiv.innerHTML = '';
  const pinned = msgs.filter(m => m.is_pinned);
  const normal = msgs.filter(m => !m.is_pinned);
  
  if (pinned.length > 0) {
    const header = document.createElement('div');
    header.className = 'pinned-header';
    header.innerHTML = `<i class="fas fa-thumbtack" style="color:#4facfe;"></i> Pinned Messages`;
    messagesDiv.appendChild(header);
    pinned.forEach(appendMessage);
  }
  
  normal.forEach(appendMessage);
  
  if (msgs.length === 0) {
    const sys = document.createElement('div');
    sys.className = 'system-msg';
    sys.textContent = 'No messages yet. Say hello! 👋';
    messagesDiv.appendChild(sys);
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
  levelBadge.innerHTML = `<i class="fas fa-star"></i> Level ${data.level}`;
});

socket.on('user-connected', (data) => {
  showNotif(`${data.display_name || data.username} joined`, 'fa-user-plus');
});

socket.on('user-disconnected', (username) => {
  showNotif(`${username} left`, 'fa-user-minus');
});

// ===== CALL SOCKET EVENTS =====
socket.on('group-call-started', (data) => {
  currentCallRoomUrl = data.roomUrl;
  if (data.startedBy !== currentUser) {
    joinCallBtn.style.display = 'flex';
    showNotif(`🔔 ${data.startedBy} started a group call!`, 'fa-phone');
  } else {
    showCallUI(data.roomUrl);
  }
});

socket.on('group-call-ended', () => {
  endCallUI();
  showNotif('📴 Call ended', 'fa-phone-slash');
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
    loginPage.style.display = 'block';
    appPage.style.display = 'none';
  }
})();

console.log('🚀 Shisheiha v4.1 ready!');
