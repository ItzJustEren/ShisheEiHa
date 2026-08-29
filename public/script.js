const socket = io();
let currentUser = '';
let currentChat = null;
let currentChatType = null; // 'pv' or 'group'
let currentGroupId = null;

// ===== DOM refs =====
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

// ===== VALIDATION =====
function validateUsername(username) {
  return /^@[a-zA-Z0-9_.]{3,30}$/.test(username);
}

// ===== NOTIFICATION =====
function showNotif(text, icon = 'ti ti-info-circle') {
  const el = document.getElementById('glassNotification');
  document.getElementById('notifIcon').className = icon;
  document.getElementById('notifText').textContent = text;
  el.style.display = 'flex';
  el.style.animation = 'none';
  setTimeout(() => {
    el.style.animation = 'notifIn 0.3s ease-out, notifOut 0.4s 3.2s forwards';
  }, 10);
  setTimeout(() => { el.style.display = 'none'; }, 3800);
}

// ===== ERROR =====
function showError(msg) {
  loginError.textContent = msg;
  loginError.style.display = 'block';
}

function hideError() {
  loginError.style.display = 'none';
}

// ===== AUTH =====
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

    setTimeout(() => {
      clearInterval(interval);
      progressBar.style.width = '100%';
      setTimeout(() => {
        loadingPage.style.display = 'none';
        appPage.style.display = 'flex';
        currentUser = username;
        displayName.textContent = username;
        levelBadge.textContent = `Level ${data.level}`;
        if (data.avatar) avatarImg.src = data.avatar;
        socket.emit('user-join', username);
        showNotif(`Welcome ${username}! 🎉`, 'ti ti-glass');
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

// ===== LOGOUT =====
logoutBtn.onclick = () => {
  localStorage.clear();
  location.reload();
};

// ===== AVATAR =====
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

// ===== SEARCH USER =====
let searchTimeout;
searchUser.oninput = () => {
  clearTimeout(searchTimeout);
  const query = searchUser.value.trim();
  if (query.length < 2) { searchResults.style.display = 'none'; return; }
  searchTimeout = setTimeout(async () => {
    const res = await fetch('/api/search-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        div.textContent = u.username;
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

// ===== GROUPS =====
createGroupBtn.onclick = () => { groupModal.style.display = 'flex'; };
joinGroupBtn.onclick = () => { joinGroupModal.style.display = 'flex'; };

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

confirmCreateGroup.onclick = async () => {
  const name = groupNameInput.value.trim();
  if (!name) return showNotif('Enter group name', 'ti ti-alert-circle');
  const res = await fetch('/api/create-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, creator: currentUser })
  });
  const data = await res.json();
  if (data.error) return showNotif(data.error, 'ti ti-alert-circle');
  showNotif(`Group "${name}" created!`, 'ti ti-check');
  groupModal.style.display = 'none';
  groupNameInput.value = '';
  addGroupToList(data.id, name, data.link);
};

confirmJoinGroup.onclick = async () => {
  const link = groupLinkInput.value.trim();
  if (!link) return showNotif('Enter group link', 'ti ti-alert-circle');
  const linkId = link.replace('Shisheiha://', '').trim();
  if (!linkId) return showNotif('Invalid link format', 'ti ti-alert-circle');
  const res = await fetch('/api/join-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkId, username: currentUser })
  });
  const data = await res.json();
  if (data.error) return showNotif(data.error, 'ti ti-alert-circle');
  showNotif(`Joined "${data.groupName}"!`, 'ti ti-check');
  joinGroupModal.style.display = 'none';
  groupLinkInput.value = '';
  // reload groups
  socket.emit('user-join', currentUser);
};

function addGroupToList(id, name, link) {
  const div = document.createElement('div');
  div.textContent = `👥 ${name}`;
  div.dataset.groupId = id;
  div.dataset.link = link;
  div.onclick = () => openGroup(id, name, link);
  groupList.appendChild(div);
}

// ===== OPEN CHAT =====
function openPV(user) {
  if (user === currentUser) return;
  currentChat = user;
  currentChatType = 'pv';
  currentGroupId = null;
  chatTitle.textContent = user;
  chatSubtitle.textContent = '';
  messagesDiv.innerHTML = '';
  socket.emit('get-history', { withUser: user });
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#userList div[data-user="${user}"]`)?.classList.add('active');
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
}

function openGroup(id, name, link) {
  currentChat = id;
  currentChatType = 'group';
  currentGroupId = id;
  chatTitle.textContent = `👥 ${name}`;
  chatSubtitle.textContent = link || '';
  messagesDiv.innerHTML = '';
  socket.emit('join-group-room', id);
  socket.emit('get-history', { groupId: id });
  document.querySelectorAll('#groupList div').forEach(el => el.classList.remove('active'));
  document.querySelector(`#groupList div[data-group-id="${id}"]`)?.classList.add('active');
  document.querySelectorAll('#userList div').forEach(el => el.classList.remove('active'));
}

// ===== SEND MESSAGE =====
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !currentChat) return;
  const payload = { text, type: 'text' };
  if (currentChatType === 'pv') payload.to = currentChat;
  else if (currentChatType === 'group') payload.groupId = currentChat;
  socket.emit('send-message', payload);
  msgInput.value = '';
}

sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

// ===== FILE UPLOAD =====
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

// ===== RENDER MESSAGE =====
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg';
  if (msg.sender === currentUser) div.classList.add('sent');
  else div.classList.add('received');
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
  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : '';
  div.appendChild(timeSpan);
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ===== SOCKET EVENTS =====
socket.on('user-data', (user) => {
  levelBadge.textContent = `Level ${user.level}`;
  if (user.avatar) avatarImg.src = user.avatar;
});

socket.on('online-users', (users) => {
  userList.innerHTML = '';
  users.filter(u => u !== currentUser).forEach(u => {
    const div = document.createElement('div');
    div.innerHTML = `<span>${u}</span><span class="status online"></span>`;
    div.dataset.user = u;
    div.onclick = () => openPV(u);
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
    if (msg.sender !== currentUser) showNotif(`${msg.sender}: ${msg.text}`, 'ti ti-message');
  } else if (currentChatType === 'group' && msg.group_id == currentChat) {
    appendMessage(msg);
  }
});

socket.on('history', (msgs) => {
  messagesDiv.innerHTML = '';
  msgs.forEach(appendMessage);
});

socket.on('level-up', (data) => {
  showNotif(data.msg, 'ti ti-trophy');
  levelBadge.textContent = `Level ${data.level}`;
});

socket.on('user-connected', (user) => {
  showNotif(`${user} joined`, 'ti ti-user-plus');
});

socket.on('user-disconnected', (user) => {
  showNotif(`${user} left`, 'ti ti-user-minus');
});

socket.on('error', (err) => {
  showNotif(`Error: ${err}`, 'ti ti-alert-circle');
});

// ===== INIT =====
console.log('🚀 Shisheiha ready!');
