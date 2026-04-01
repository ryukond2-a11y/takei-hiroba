const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

let players = {};
let gameStatus = { 
    isOnigokko: false, 
    oniPages: [], 
    frozenPages: [],
    timeLeft: 0 
};

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        players[socket.id] = { id: socket.id, name: data.name, avatar: data.avatar, x: 750, y: 750 };
        io.emit('update_all', players);
    });

    // --- 鬼ごっこ開始 ---
    socket.on("start_onigokko", () => {
        const ids = Object.keys(players);
        if (ids.length < 2) return;

        gameStatus.isOnigokko = true;
        gameStatus.frozenPages = [];
        gameStatus.timeLeft = 60; // 1分間

        // 鬼の選出（20%切り上げ）
        const oniCount = Math.ceil(ids.length * 0.2);
        const shuffled = [...ids].sort(() => 0.5 - Math.random());
        gameStatus.oniPages = shuffled.slice(0, oniCount);

        io.emit("onigokko_update", gameStatus);
        
        // カウントダウン開始
        const timer = setInterval(() => {
            gameStatus.timeLeft--;
            if (gameStatus.timeLeft <= 0) {
                gameStatus.isOnigokko = false;
                clearInterval(timer);
            }
            io.emit("onigokko_update", gameStatus);
        }, 1000);
    });

    // --- 当たり判定（ここが重要！） ---
    // --- サーバー側：index.js の move イベント周辺 ---
socket.on('move', (data) => {
    if (!players[socket.id]) return;
    
    // 凍っている人は絶対に動かさない
    if (gameStatus.frozenPages.includes(socket.id)) return;

    players[socket.id].x = data.x;
    players[socket.id].y = data.y;

    if (gameStatus.isOnigokko) {
        const myId = socket.id;
        const myX = players[myId].x;
        const myY = players[myId].y;

        for (let targetId in players) {
            if (myId === targetId) continue;
            
            const dx = myX - players[targetId].x;
            const dy = myY - players[targetId].y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 40) { // 当たり判定
                const isIMoni = gameStatus.oniPages.includes(myId);
                const isTargetFrozen = gameStatus.frozenPages.includes(targetId);

                // 【攻撃】自分が鬼で、相手が逃げ（凍ってない）なら、凍らせる
                if (isIMoni && !gameStatus.oniPages.includes(targetId) && !isTargetFrozen) {
                    gameStatus.frozenPages.push(targetId);
                    io.emit("onigokko_update", gameStatus);
                } 
                // 【復活】自分が逃げで、相手が凍っている逃げなら、助ける
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
