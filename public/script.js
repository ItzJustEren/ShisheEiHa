// ===== متغیرهای تماس =====
let callFrame = null;
let currentCallRoomUrl = null;
let isCallActive = false;

// ===== توابع تماس =====
function showCallUI(roomUrl) {
  const container = document.getElementById('callContainer');
  container.style.display = 'block';
  
  callFrame = Daily.createFrame(container, {
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
  
  document.getElementById('startCallBtn').style.display = 'none';
  document.getElementById('joinCallBtn').style.display = 'none';
  document.getElementById('endCallBtn').style.display = 'flex';
}

function endCallUI() {
  if (callFrame) {
    callFrame.leave();
    callFrame.destroy();
    callFrame = null;
  }
  document.getElementById('callContainer').style.display = 'none';
  isCallActive = false;
  currentCallRoomUrl = null;
  
  document.getElementById('endCallBtn').style.display = 'none';
  document.getElementById('startCallBtn').style.display = 'flex';
}

// ===== رویدادهای دکمه‌های تماس =====
document.getElementById('startCallBtn').onclick = () => {
  if (!currentGroupId) {
    showNotif('Please select a group first', 'fa-exclamation-circle');
    return;
  }
  socket.emit('start-group-call', { groupId: currentGroupId });
};

document.getElementById('endCallBtn').onclick = () => {
  if (currentGroupId) {
    socket.emit('end-group-call', { groupId: currentGroupId });
  }
  endCallUI();
};

document.getElementById('joinCallBtn').onclick = () => {
  if (currentCallRoomUrl) {
    showCallUI(currentCallRoomUrl);
  }
};

// ===== نمایش دکمه‌های تماس در گروه =====
// توی تابع openGroup، این رو اضافه کن:
function openGroup(id, name, link) {
  // ... کدهای قبلی
  document.getElementById('callActions').style.display = 'flex';
  document.getElementById('startCallBtn').style.display = 'flex';
  document.getElementById('joinCallBtn').style.display = 'none';
  document.getElementById('endCallBtn').style.display = 'none';
}

// ===== Socket.IO رویدادهای تماس =====
socket.on('group-call-started', (data) => {
  currentCallRoomUrl = data.roomUrl;
  if (data.startedBy !== currentUser) {
    document.getElementById('joinCallBtn').style.display = 'flex';
    showNotif(`🔔 ${data.startedBy} started a group call!`, 'fa-phone');
  } else {
    showCallUI(data.roomUrl);
  }
});

socket.on('group-call-ended', () => {
  endCallUI();
  showNotif('📴 Call ended', 'fa-phone-slash');
});

// ============================================================
// ===================== بقیه کدهای قبلی =======================
// ============================================================

// ... (همه کدهای قبلی: Auth, Profile, Search, Groups, Reply, Forward, Edit, Delete, Pin, Mention, init, etc)
