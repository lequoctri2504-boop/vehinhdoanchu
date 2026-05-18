const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Trạng thái server (Lưu trong RAM)
const rooms = {};

const wordList = [
    "con mèo", "con chó", "con voi", "con thỏ", "con gà", "con bò", "con hổ", "con cá", "con chim", "con rắn", "con khỉ", "con heo", "con ngựa", "con vịt", "con ếch",
    "cái nhà", "cái xe", "cái bàn", "cái ghế", "cái cây", "cái đèn", "cái túi", "cái nón", "cái kính", "cái điện thoại", "cái máy tính", "cái bút", "cái sách", "cái gương",
    "trái táo", "trái chuối", "trái dưa hấu", "trái cam", "tô phở", "bánh mì", "ly cà phê", "bát cơm", "con tôm", "quả trứng",
    "mặt trời", "ngôi sao", "đám mây", "ngọn núi", "con sóng", "cái cầu", "tòa nhà", "xe đạp", "máy bay", "con thuyền"
];

function normalizeWord(word) {
    if (!word) return "";
    return word.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Chấp nhận bỏ qua dấu tiếng Việt (đơn giản hóa)
function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function checkGuess(guess, answer) {
    let normGuess = normalizeWord(guess);
    let normAnswer = normalizeWord(answer);
    if (normGuess === normAnswer) return true;
    if (removeAccents(normGuess) === removeAccents(normAnswer)) return true;
    return false;
}

function getHint(word, timeRemaining) {
    let words = word.split(' ');
    let hint = words.map(w => '_'.repeat(w.length)).join(' ');
    
    // Hint logic:
    // Mặc định _ _ _
    // Còn 30s: hiện chữ cái đầu
    // Còn 15s: hiện chữ cái giữa/cuối tuỳ ý
    let hintArr = hint.split('');
    let wordArr = word.split('');
    
    if (timeRemaining <= 30) {
        hintArr[0] = wordArr[0]; // Chữ cái đầu của từ đầu tiên
    }
    if (timeRemaining <= 15 && word.length > 2) {
        let mid = Math.floor(word.length / 2);
        if (wordArr[mid] !== ' ') {
             hintArr[mid] = wordArr[mid];
        } else {
             hintArr[mid+1] = wordArr[mid+1];
        }
    }
    return hintArr.join('');
}

function getSafeRoom(room) {
    const { interval, ...safeRoom } = room;
    return safeRoom;
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function startTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.state !== "playing") return;

    room.guessedPlayers = [];
    room.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
    const drawer = room.players[room.currentDrawerIndex];

    io.to(roomCode).emit('new-turn', {
        drawerId: drawer.id,
        drawerName: drawer.name,
        round: room.round,
        maxRounds: room.maxRounds
    });

    // Gửi từ cho người vẽ
    io.to(drawer.id).emit('secret-word', room.currentWord);

    // Bắt đầu đếm ngược 60s
    room.timer = 60;
    
    clearInterval(room.interval);
    room.interval = setInterval(() => {
        room.timer--;
        
        let hint = getHint(room.currentWord, room.timer);
        io.to(roomCode).emit('timer-update', { time: room.timer, hint: hint });

        if (room.timer <= 0) {
            endTurn(roomCode);
        }
    }, 1000);
}

function endTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    clearInterval(room.interval);
    
    io.to(roomCode).emit('system-message', `Hết thời gian! Từ khóa là: ${room.currentWord}`);
    io.to(roomCode).emit('round-end', { currentWord: room.currentWord });
    
    setTimeout(() => {
        nextTurn(roomCode);
    }, 3000);
}

function nextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.currentDrawerIndex++;
    if (room.currentDrawerIndex >= room.players.length) {
        room.currentDrawerIndex = 0;
        room.round++;
    }

    if (room.round > room.maxRounds) {
        room.state = "ended";
        io.to(roomCode).emit('game-end', { players: room.players });
        return;
    }

    startTurn(roomCode);
}


io.on('connection', (socket) => {
    
    socket.on('create-room', (data) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            host: null, // Sẽ gán host khi join
            players: [],
            state: "lobby",
            currentDrawerIndex: 0,
            currentWord: "",
            round: 1,
            maxRounds: 3,
            timer: 0,
            guessedPlayers: []
        };
        socket.emit('room-created', { code });
    });

    socket.on('join-room', (data) => {
        const room = rooms[data.code];
        if (room) {
            if (room.players.length === 0 || !room.host) {
                room.host = socket.id;
            }
            room.players.push({ id: socket.id, name: data.name, score: 0 });
            socket.join(data.code);
            socket.emit('room-joined', { code: data.code });
            io.to(data.code).emit('room-update', getSafeRoom(room));
            
            if(room.state === "playing"){
               // Gửi state hiện tại cho người vào sau
               socket.emit('game-started');
               socket.emit('new-turn', {
                   drawerId: room.players[room.currentDrawerIndex].id,
                   drawerName: room.players[room.currentDrawerIndex].name,
                   round: room.round,
                   maxRounds: room.maxRounds
               });
            }
        } else {
            socket.emit('error-msg', 'Phòng không tồn tại!');
        }
    });

    socket.on('start-game', (code) => {
        const room = rooms[code];
        if (room && room.host === socket.id && room.players.length >= 2) {
            room.state = "playing";
            io.to(code).emit('game-started');
            startTurn(code);
        }
    });

    socket.on('draw-data', (data) => {
        const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
        if (roomCode) {
            socket.to(roomCode).emit('draw-data', data);
        }
    });

    socket.on('clear-canvas', () => {
        const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
        if (roomCode) {
            socket.to(roomCode).emit('clear-canvas');
        }
    });

    socket.on('send-guess', (guess) => {
        const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
        const room = rooms[roomCode];
        if (!room || room.state !== "playing") return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Nếu người đang vẽ, không cho đoán
        if (room.players[room.currentDrawerIndex].id === socket.id) return;
        
        // Đã đoán đúng rồi, không cho đoán tiếp
        if (room.guessedPlayers.includes(socket.id)) return;

        if (checkGuess(guess, room.currentWord)) {
            room.guessedPlayers.push(socket.id);
            player.score += 100;
            room.players[room.currentDrawerIndex].score += 50;
            
            io.to(roomCode).emit('correct-guess', { name: player.name });
            io.to(roomCode).emit('room-update', getSafeRoom(room));

            // Kiểm tra xem tất cả người đoán đã đúng chưa (trừ người vẽ)
            if (room.guessedPlayers.length === room.players.length - 1) {
                endTurn(roomCode);
            }
        } else {
            io.to(roomCode).emit('chat-message', { name: player.name, text: guess });
        }
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                const isDrawer = (room.currentDrawerIndex === pIndex && room.state === "playing");
                
                room.players.splice(pIndex, 1);
                io.to(code).emit('room-update', getSafeRoom(room));
                io.to(code).emit('system-message', `Một người chơi đã thoát.`);
                
                if (room.players.length === 0) {
                    clearInterval(room.interval);
                    delete rooms[code];
                } else {
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                    }
                    if (isDrawer) {
                        clearInterval(room.interval);
                        if(room.currentDrawerIndex >= room.players.length) {
                             room.currentDrawerIndex = 0;
                             room.round++;
                        }
                        if(room.players.length > 1) {
                            startTurn(code);
                        } else {
                            room.state = "ended";
                            io.to(code).emit('system-message', `Không đủ người chơi.`);
                            io.to(code).emit('game-end', { players: room.players });
                        }
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
