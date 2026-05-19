const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const wordList = [
    // Động vật
    "con mèo", "con chó", "con voi", "con thỏ", "con gà", "con bò", "con hổ", "con cá", "con chim", "con rắn", "con khỉ", "con heo", "con ngựa", "con vịt", "con ếch", "chuột túi", "sư tử", "gấu trúc", "chim cánh cụt", "đà điểu", "con báo", "con cua", "con tôm", "con ốc", "cá sấu", "hươu cao cổ", "tê giác", "cá mập", "cá voi", "con mực",
    // Đồ vật
    "cái nhà", "cái xe", "cái bàn", "cái ghế", "cái cây", "cái đèn", "cái túi", "cái nón", "cái kính", "cái điện thoại", "cái máy tính", "cái bút", "cái sách", "cái gương", "tủ lạnh", "máy giặt", "tivi", "đồng hồ", "chìa khóa", "cái quạt", "cây đàn", "cái chổi", "bàn chải", "cái cốc", "cái bát", "cái đĩa", "đôi đũa", "cái thìa", "cái gối", "cái chăn",
    // Thức ăn
    "trái táo", "trái chuối", "trái dưa hấu", "trái cam", "tô phở", "bánh mì", "ly cà phê", "bát cơm", "quả trứng", "bánh xèo", "bánh chưng", "trà sữa", "kem", "kẹo mút", "sô cô la", "khoai tây chiên", "gà rán", "hộp sữa", "trái xoài", "trái nho", "trái dâu", "trái dứa", "củ cà rốt", "củ khoai",
    // Khác
    "mặt trời", "ngôi sao", "đám mây", "ngọn núi", "con sóng", "cái cầu", "tòa nhà", "xe đạp", "máy bay", "con thuyền", "trái đất", "mặt trăng", "ngọn lửa", "giọt nước", "tia chớp", "cơn mưa", "cái ô", "cầu vồng", "bông hoa", "chiếc lá", "con đường", "bệnh viện", "trường học", "công viên", "bể bơi", "sân bóng", "bác sĩ", "giáo viên", "công an", "cứu hỏa"
];

function normalizeWord(word) {
    if (!word) return "";
    return word.toLowerCase().trim().replace(/\s+/g, ' ');
}

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

function getHint(word, percentTimeRemaining) {
    let words = word.split(' ');
    let hint = words.map(w => '_'.repeat(w.length)).join(' ');
    
    let hintArr = hint.split('');
    let wordArr = word.split('');
    
    // Mở chữ đầu tiên nếu còn dưới 50% thời gian
    if (percentTimeRemaining <= 0.5) {
        hintArr[0] = wordArr[0]; 
    }
    // Mở thêm chữ cái ở giữa nếu còn dưới 25% thời gian
    if (percentTimeRemaining <= 0.25 && word.length > 2) {
        let mid = Math.floor(word.length / 2);
        if (wordArr[mid] !== ' ') hintArr[mid] = wordArr[mid];
        else hintArr[mid+1] = wordArr[mid+1];
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

function get4RandomWords(usedWords) {
    let available = wordList.filter(w => !usedWords.includes(w));
    if (available.length < 4) {
        usedWords.length = 0; // Reset nếu hết từ
        available = [...wordList];
    }
    const shuffled = available.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 4);
}

function startWordSelection(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.state !== "playing") return;

    room.guessedPlayers = [];
    room.scoresForTurn = [100, 80, 60, 40, 20]; // Bậc điểm
    
    const drawer = room.players[room.currentDrawerIndex];
    const wordsToChoose = get4RandomWords(room.usedWords);

    io.to(roomCode).emit('new-turn', {
        drawerId: drawer.id,
        drawerName: drawer.name,
        round: room.round,
        maxRounds: room.settings.rounds
    });

    io.to(drawer.id).emit('choose-word', { words: wordsToChoose });

    // 15 giây để chọn
    room.timer = 15;
    room.isChoosing = true;
    room.currentWord = ""; // Clear current word
    
    clearInterval(room.interval);
    room.interval = setInterval(() => {
        room.timer--;
        io.to(roomCode).emit('timer-update', { time: room.timer, isChoosing: true });

        if (room.timer <= 0) {
            // Tự động chọn ngẫu nhiên 1 trong 4 từ nếu quá giờ
            const randomWord = wordsToChoose[Math.floor(Math.random() * wordsToChoose.length)];
            startGameWithWord(roomCode, randomWord);
        }
    }, 1000);
}

function startGameWithWord(roomCode, word) {
    const room = rooms[roomCode];
    if (!room) return;
    
    clearInterval(room.interval);
    room.isChoosing = false;
    room.currentWord = word;
    room.usedWords.push(word);

    const drawer = room.players[room.currentDrawerIndex];
    io.to(drawer.id).emit('secret-word', room.currentWord);

    room.timer = room.settings.time;
    const totalTime = room.settings.time;
    
    room.interval = setInterval(() => {
        room.timer--;
        
        let percent = room.timer / totalTime;
        let hint = getHint(room.currentWord, percent);
        io.to(roomCode).emit('timer-update', { time: room.timer, hint: hint, isChoosing: false });

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
    }, 4000); // Tăng tg nghỉ lên 4s để đọc kết quả
}

function nextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.currentDrawerIndex++;
    if (room.currentDrawerIndex >= room.players.length) {
        room.currentDrawerIndex = 0;
        room.round++;
    }

    if (room.round > room.settings.rounds) {
        room.state = "ended";
        io.to(roomCode).emit('game-end', { players: room.players });
        return;
    }

    startWordSelection(roomCode);
}

io.on('connection', (socket) => {
    
    socket.on('create-room', (data) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            host: null,
            players: [],
            state: "lobby",
            settings: { time: 60, rounds: 3 },
            currentDrawerIndex: 0,
            currentWord: "",
            usedWords: [],
            round: 1,
            timer: 0,
            isChoosing: false,
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
               socket.emit('game-started');
               socket.emit('new-turn', {
                   drawerId: room.players[room.currentDrawerIndex].id,
                   drawerName: room.players[room.currentDrawerIndex].name,
                   round: room.round,
                   maxRounds: room.settings.rounds
               });
            }
        } else {
            socket.emit('error-msg', 'Phòng không tồn tại!');
        }
    });

    socket.on('update-settings', (data) => {
        const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
        const room = rooms[roomCode];
        if (room && room.host === socket.id && room.state === "lobby") {
            room.settings.time = data.time || 60;
            room.settings.rounds = data.rounds || 3;
            io.to(roomCode).emit('room-update', getSafeRoom(room));
        }
    });

    socket.on('start-game', (code) => {
        const room = rooms[code];
        if (room && room.host === socket.id && room.players.length >= 2) {
            room.state = "playing";
            io.to(code).emit('game-started');
            startWordSelection(code);
        }
    });

    socket.on('word-chosen', (word) => {
        const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
        const room = rooms[roomCode];
        if (room && room.isChoosing && room.players[room.currentDrawerIndex].id === socket.id) {
            startGameWithWord(roomCode, word);
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
        if (!room || room.state !== "playing" || room.isChoosing) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (room.players[room.currentDrawerIndex].id === socket.id || room.guessedPlayers.includes(socket.id)) {
            // Chỉ gửi tin nhắn bình thường, không tính điểm đoán
            io.to(roomCode).emit('chat-message', { name: player.name, text: guess });
            return;
        }

        if (checkGuess(guess, room.currentWord)) {
            room.guessedPlayers.push(socket.id);
            
            // Tính điểm: Người đoán lấy điểm từ mảng bậc điểm, nếu hết lấy 20
            const earnedPoints = room.scoresForTurn.shift() || 20;
            player.score += earnedPoints;
            
            // Người vẽ được 20đ cho mỗi người đoán đúng
            room.players[room.currentDrawerIndex].score += 20;
            
            io.to(roomCode).emit('correct-guess', { name: player.name });
            io.to(roomCode).emit('room-update', getSafeRoom(room));

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
                            startWordSelection(code);
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
