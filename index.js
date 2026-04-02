const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const FIREBASE_URL = "https://takei-net-default-rtdb.firebaseio.com/posts.json";



let players = {};
let gameStatus = { 
    isOnigokko: false, 
    oniPages: [], 
    frozenPages: [],
    timeLeft: 0 
};

app.use(express.static('public'));

let gameTimer = null; 

io.on('connection', (socket) => {
socket.on('send_chat', async (msg) => {
    if (!players[socket.id]) return;

    const chatData = {
        username: players[socket.id].name, // アバター名
        realname: null,                    // 本名はnull
        text: msg,
        timestamp: Date.now()
    };

    // 1. Firebaseに保存
    try {
        await fetch(FIREBASE_URL, {
            method: 'POST',
            body: JSON.stringify(chatData),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error("Firebase Save Error:", e);
    }

    // 2. 全員の画面に通知として表示
    io.emit('announce', `${chatData.username}: ${msg}`);
});
    socket.on('join', (data) => {
        const startX = (data.x !== undefined) ? data.x : 750;
        const startY = (data.y !== undefined) ? data.y : 750;

        players[socket.id] = { 
            id: socket.id, 
            name: data.name, 
            avatar: data.avatar, 
            x: startX, 
            y: startY 
        };
        io.emit('update_all', players);
    });

    // --- 鬼ごっこ開始 ---
    socket.on("start_onigokko", () => {
        // ★ すでに開始しているなら、二重に開始させない
        if (gameStatus.isOnigokko) return;

        const participants = Object.keys(players).filter(id => players[id].x > 5000);

        if (participants.length < 2) {
            socket.emit("announce", "参加者が足りません（鬼ごっこフロアに集まってね）");
            return;
        }

        if (gameTimer) clearInterval(gameTimer);

        gameStatus.isOnigokko = true;
        gameStatus.frozenPages = [];
        gameStatus.timeLeft = 180;

        // ★ 鬼の割合を 30% (0.3) に設定
        const oniCount = Math.ceil(participants.length * 0.3);
        const shuffled = [...participants].sort(() => 0.5 - Math.random());
        gameStatus.oniPages = shuffled.slice(0, oniCount);

        io.emit("onigokko_update", gameStatus);

        participants.forEach(id => {
            io.to(id).emit("announce", "鬼ごっこ開始！");
        });

        gameTimer = setInterval(() => {
            gameStatus.timeLeft--;

            const currentParticipants = Object.keys(players).filter(id => players[id].x > 5000);
            const nigeIds = currentParticipants.filter(id => !gameStatus.oniPages.includes(id));
            
            const allFrozen = nigeIds.length > 0 && nigeIds.every(id => gameStatus.frozenPages.includes(id));

            if (gameStatus.timeLeft <= 0 || allFrozen) {
                clearInterval(gameTimer);
                gameTimer = null;
                
                let resultMsg = allFrozen ? "鬼の勝利！" : "逃げの勝利！";
                
                currentParticipants.forEach(id => {
                    io.to(id).emit("announce", "終了！ " + resultMsg);
                });

                gameStatus.isOnigokko = false;
                gameStatus.oniPages = [];
                gameStatus.frozenPages = [];
                io.emit("onigokko_update", gameStatus);
            } else {
                io.emit("onigokko_update", gameStatus);
            }
        }, 1000);
    });

    // --- 当たり判定 ---
    socket.on('move', (data) => {
        if (!players[socket.id]) return;
        if (gameStatus.frozenPages.includes(socket.id)) return;

        players[socket.id].x = data.x;
        players[socket.id].y = data.y;

        if (gameStatus.isOnigokko && players[socket.id].x > 5000) {
            const myId = socket.id;
            const myX = players[myId].x;
            const myY = players[myId].y;

            for (let targetId in players) {
                if (myId === targetId || players[targetId].x <= 5000) continue;
                
                const dx = myX - players[targetId].x;
                const dy = myY - players[targetId].y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < 40) {
                    const isIMoni = gameStatus.oniPages.includes(myId);
                    const isTargetFrozen = gameStatus.frozenPages.includes(targetId);

                    if (isIMoni && !gameStatus.oniPages.includes(targetId) && !isTargetFrozen) {
                        gameStatus.frozenPages.push(targetId);
                        io.emit("onigokko_update", gameStatus);
                    } 
                    else if (!isIMoni && !gameStatus.oniPages.includes(targetId) && isTargetFrozen) {
                        gameStatus.frozenPages = gameStatus.frozenPages.filter(id => id !== targetId);
                        io.emit("onigokko_update", gameStatus);
                    }
                }
            }
        }
        socket.broadcast.emit('player_moved', players[socket.id]);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('update_all', players);
    });
});

http.listen(3000, () => { console.log('Server is running!'); });

    
