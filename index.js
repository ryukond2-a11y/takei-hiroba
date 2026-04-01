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

let gameTimer = null; // タイマーを管理する変数

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        players[socket.id] = { id: socket.id, name: data.name, avatar: data.avatar, x: 750, y: 750 };
        io.emit('update_all', players);
    });

    // --- 鬼ごっこ開始 ---
    socket.on("start_onigokko", () => {
        // ★ 鬼ごっこフロア（x > 5000）にいる人だけをリストアップ
        const participants = Object.keys(players).filter(id => players[id].x > 5000);

        // 参加者が2人未満なら開始しない
        if (participants.length < 2) {
            io.emit("announce", "参加者が足りません（鬼ごっこフロアに集まってね）");
            return;
        }

        if (gameTimer) clearInterval(gameTimer);

        gameStatus.isOnigokko = true;
        gameStatus.frozenPages = [];
        gameStatus.timeLeft = 180;

        // ★ ids ではなく participants を使用するように修正
        const oniCount = Math.ceil(participants.length * 0.2);
        const shuffled = [...participants].sort(() => 0.5 - Math.random());
        gameStatus.oniPages = shuffled.slice(0, oniCount);

        io.emit("onigokko_update", gameStatus);
        io.emit("announce", "鬼ごっこ開始！");

        gameTimer = setInterval(() => {
            gameStatus.timeLeft--;

            // ★ 判定もフロアにいる人（参加者）のみで行う
            const currentParticipants = Object.keys(players).filter(id => players[id].x > 5000);
            const nigeIds = currentParticipants.filter(id => !gameStatus.oniPages.includes(id));
            
            // 逃げが1人以上いて、その全員が凍結したか
            const allFrozen = nigeIds.length > 0 && nigeIds.every(id => gameStatus.frozenPages.includes(id));

            if (gameStatus.timeLeft <= 0 || allFrozen) {
                clearInterval(gameTimer);
                gameTimer = null;
                
                let resultMsg = allFrozen ? "鬼の勝利！" : "逃げの勝利！";
                io.emit("announce", "終了！ " + resultMsg);

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

        // ★ 自分がフロアにいる時だけ当たり判定を行う
        if (gameStatus.isOnigokko && players[socket.id].x > 5000) {
            const myId = socket.id;
            const myX = players[myId].x;
            const myY = players[myId].y;

            for (let targetId in players) {
                // 自分以外、かつ相手もフロアにいる場合のみ判定
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
