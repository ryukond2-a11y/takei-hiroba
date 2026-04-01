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
    socket.on('move', (data) => {
        if (!players[socket.id]) return;
        
        // 凍っている人は動けない（動かさない）
        if (gameStatus.frozenPages.includes(socket.id)) return;

        players[socket.id].x = data.x;
        players[socket.id].y = data.y;

        // 鬼が逃げに触れたかチェック
        if (gameStatus.isOnigokko && gameStatus.oniPages.includes(socket.id)) {
            for (let targetId in players) {
                if (gameStatus.oniPages.includes(targetId)) continue; // 鬼同士はスルー
                if (gameStatus.frozenPages.includes(targetId)) continue; // すでに凍ってればスルー

                const dx = players[socket.id].x - players[targetId].x;
                const dy = players[socket.id].y - players[targetId].y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < 40) { // 触れた！
                    gameStatus.frozenPages.push(targetId);
                    io.emit("onigokko_update", gameStatus);
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
