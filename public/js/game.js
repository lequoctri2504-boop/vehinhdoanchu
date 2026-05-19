const socket = io();

// Lấy thông tin từ URL và Session
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('code');
const playerName = sessionStorage.getItem('playerName');

if (!roomCode || !playerName) {
    window.location.href = '/';
}

// UI Elements
const displayRoomCode = document.getElementById('display-room-code');
displayRoomCode.innerText = roomCode;

const btnStartGame = document.getElementById('btnStartGame');
const playersList = document.getElementById('players-list');
const wordHint = document.getElementById('word-hint');
const timerEl = document.getElementById('timer');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const toolsBar = document.getElementById('tools-bar');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const roundInfo = document.getElementById('round-info');

// Settings Elements
const settingTime = document.getElementById('setting-time');
const settingRounds = document.getElementById('setting-rounds');
const wordSelectScreen = document.getElementById('word-selection-screen');
const wordSelectTimer = document.getElementById('word-select-timer');
const wordOptions = document.getElementById('word-options');

// Canvas Setup
const canvas = document.getElementById('drawing-board');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let isMyTurn = false;
let lastX = 0;
let lastY = 0;

// Tool states
let brushColor = '#000000';
let brushSize = 5;
let isEraser = false;

// Resize canvas properly
function resizeCanvas() {
    const wrapper = document.querySelector('.canvas-wrapper');
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial call

// Tham gia phòng
socket.emit('join-room', { code: roomCode, name: playerName });

// ---- SOCKET EVENTS ----

socket.on('error-msg', (msg) => {
    alert(msg);
    window.location.href = '/';
});

socket.on('room-update', (room) => {
    // Update players list
    playersList.innerHTML = '';
    room.players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-item';
        if (room.state === 'playing' && room.players[room.currentDrawerIndex]?.id === p.id) {
            li.classList.add('drawer');
        }
        if (room.guessedPlayers.includes(p.id)) {
            li.classList.add('correct');
        }
        
        li.innerHTML = `<span>${p.name}</span> <span>${p.score}đ</span>`;
        playersList.appendChild(li);
    });

    // Show start button for host if in lobby and >= 2 players
    if (room.state === 'lobby' && room.host === socket.id) {
        // Kích hoạt settings cho host
        settingTime.disabled = false;
        settingRounds.disabled = false;

        if (room.players.length >= 2) {
            btnStartGame.style.display = 'block';
            overlayText.innerText = "Chờ chủ phòng bắt đầu...";
        } else {
            btnStartGame.style.display = 'none';
            overlayText.innerText = "Đang chờ người chơi...";
        }
    } else {
        settingTime.disabled = true;
        settingRounds.disabled = true;
    }

    // Sync settings
    if (room.settings) {
        if (settingTime.value != room.settings.time && document.activeElement !== settingTime) settingTime.value = room.settings.time;
        if (settingRounds.value != room.settings.rounds && document.activeElement !== settingRounds) settingRounds.value = room.settings.rounds;
    }
});

// Host thay đổi settings
settingTime.addEventListener('change', () => {
    socket.emit('update-settings', { time: parseInt(settingTime.value), rounds: parseInt(settingRounds.value) });
});
settingRounds.addEventListener('change', () => {
    socket.emit('update-settings', { time: parseInt(settingTime.value), rounds: parseInt(settingRounds.value) });
});

socket.on('game-started', () => {
    btnStartGame.style.display = 'none';
    const settingsPanel = document.getElementById('room-settings');
    if (settingsPanel) settingsPanel.style.display = 'none';
    addChatMsg('system', 'Hệ thống', 'Trò chơi bắt đầu!');
});

socket.on('choose-word', (data) => {
    isMyTurn = true; // Mình sẽ là người vẽ
    overlay.style.display = 'none';
    toolsBar.style.display = 'flex';
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Xóa bảng

    wordSelectScreen.style.display = 'flex';
    wordOptions.innerHTML = '';
    data.words.forEach(word => {
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.innerText = word;
        btn.onclick = () => {
            wordSelectScreen.style.display = 'none';
            socket.emit('word-chosen', word);
        };
        wordOptions.appendChild(btn);
    });
});

socket.on('new-turn', (data) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Xóa bảng khi qua lượt mới
    roundInfo.innerText = `${data.round}/${data.maxRounds}`;
    isMyTurn = (data.drawerId === socket.id);
    
    wordSelectScreen.style.display = 'none';

    if (isMyTurn) {
        overlay.style.display = 'none';
        toolsBar.style.display = 'flex';
    } else {
        overlay.style.display = 'flex'; // Dùng overlay cho chế độ người xem
        overlayText.innerText = `Đang đợi ${data.drawerName} chọn từ...`;
        toolsBar.style.display = 'none';
        wordHint.innerText = "Đang chờ...";
        addChatMsg('system', 'Hệ thống', `Đến lượt của ${data.drawerName} vẽ!`);
    }
});

socket.on('secret-word', (word) => {
    wordHint.innerText = `Vẽ: ${word}`;
    overlay.style.display = 'none'; // Ẩn overlay nếu là người khác
});

socket.on('timer-update', (data) => {
    if (data.isChoosing) {
        wordSelectTimer.innerText = data.time;
        if (!isMyTurn) {
            timerEl.innerText = data.time; // Hiển thị đồng hồ đếm ngược chờ chọn
            wordHint.innerText = "Đang chọn từ...";
        }
        return;
    }

    timerEl.innerText = data.time;
    if (data.time <= 10) {
        timerEl.style.boxShadow = "0 0 20px rgba(239, 68, 68, 1)";
    } else {
        timerEl.style.boxShadow = "0 0 10px rgba(239, 68, 68, 0.5)";
    }
    
    if (!isMyTurn) {
        wordHint.innerText = data.hint.split('').join(' '); // Thêm khoảng trắng cho dễ nhìn
        overlay.style.display = 'none'; // Ẩn chữ đang chờ...
    }
});

socket.on('correct-guess', (data) => {
    addChatMsg('correct', '✓', `${data.name} đã đoán đúng!`);
    
    // Nếu là mình đoán đúng -> bắn pháo giấy
    if (data.name === playerName) {
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        });
    }
});

socket.on('chat-message', (data) => {
    addChatMsg('normal', data.name, data.text);
});

socket.on('system-message', (msg) => {
    addChatMsg('system', 'Hệ thống', msg);
});

socket.on('round-end', (data) => {
    overlay.style.display = 'flex';
    overlayText.innerText = `Đáp án: ${data.currentWord}`;
    toolsBar.style.display = 'none';
});

socket.on('game-end', (data) => {
    document.getElementById('end-screen').style.display = 'flex';
    const ul = document.getElementById('final-ranking');
    ul.innerHTML = '';
    
    // Sort players by score
    const sorted = data.players.sort((a,b) => b.score - a.score);
    sorted.forEach((p, idx) => {
        const li = document.createElement('li');
        li.innerText = `#${idx + 1} - ${p.name}: ${p.score} điểm`;
        ul.appendChild(li);
    });
});

// ---- DRAWING LOGIC ----

function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (evt.touches) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
    } else {
        clientX = evt.clientX;
        clientY = evt.clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    if (!isMyTurn) return;
    e.preventDefault();
    isDrawing = true;
    const pos = getMousePos(e);
    lastX = pos.x;
    lastY = pos.y;
}

function draw(e) {
    if (!isDrawing || !isMyTurn) return;
    e.preventDefault();
    const pos = getMousePos(e);
    
    drawLine(lastX, lastY, pos.x, pos.y, isEraser ? '#ffffff' : brushColor, brushSize, true);
    
    lastX = pos.x;
    lastY = pos.y;
}

function stopDrawing() {
    isDrawing = false;
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

canvas.addEventListener('touchstart', startDrawing, {passive: false});
canvas.addEventListener('touchmove', draw, {passive: false});
canvas.addEventListener('touchend', stopDrawing);

function drawLine(x0, y0, x1, y1, color, size, emit) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();

    if (!emit) return;

    // Chuẩn hóa tọa độ theo % để đồng bộ các màn hình kích thước khác nhau
    socket.emit('draw-data', {
        x0: x0 / canvas.width,
        y0: y0 / canvas.height,
        x1: x1 / canvas.width,
        y1: y1 / canvas.height,
        color: color,
        size: size
    });
}

socket.on('draw-data', (data) => {
    drawLine(
        data.x0 * canvas.width,
        data.y0 * canvas.height,
        data.x1 * canvas.width,
        data.y1 * canvas.height,
        data.color,
        data.size,
        false
    );
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---- TOOLS UI ----

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        isEraser = false;
        brushColor = e.target.getAttribute('data-color');
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
    });
});

document.getElementById('color-picker').addEventListener('input', (e) => {
    isEraser = false;
    brushColor = e.target.value;
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
});

document.getElementById('brush-size-slider').addEventListener('input', (e) => {
    brushSize = e.target.value;
});

document.getElementById('btn-eraser').addEventListener('click', () => {
    isEraser = true;
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
});

document.getElementById('btn-clear').addEventListener('click', () => {
    if (!isMyTurn) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear-canvas');
});

// ---- ACTIONS ----

btnStartGame.addEventListener('click', () => {
    socket.emit('start-game', roomCode);
});

document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
        socket.emit('send-guess', text);
        chatInput.value = '';
    }
});

function addChatMsg(type, name, text) {
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    if (type === 'system' || type === 'correct') {
         div.innerText = text;
    } else {
         div.innerHTML = `<strong>${name}:</strong> ${text}`;
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
