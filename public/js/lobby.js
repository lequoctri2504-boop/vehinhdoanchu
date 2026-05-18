const socket = io();

document.getElementById('btnCreateRoom').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    if (!name) return alert('Vui lòng nhập tên!');
    
    // Lưu tên vào sessionStorage để sang game.html dùng
    sessionStorage.setItem('playerName', name);
    
    // Gửi yêu cầu tạo phòng
    socket.emit('create-room', { name });
});

document.getElementById('btnJoinRoom').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    const code = document.getElementById('roomCode').value.trim().toUpperCase();
    
    if (!name) return alert('Vui lòng nhập tên!');
    if (!code || code.length !== 6) return alert('Mã phòng phải có 6 ký tự!');
    
    sessionStorage.setItem('playerName', name);
    
    // Chuyển hướng sang game.html với query param
    window.location.href = `game.html?code=${code}`;
});

socket.on('room-created', (data) => {
    window.location.href = `game.html?code=${data.code}`;
});
