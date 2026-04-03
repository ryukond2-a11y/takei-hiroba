const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const FIREBASE_URL = "https://takei-net-default-rtdb.firebaseio.com/posts.json";
const { requireAccess, gateRoutes } = require('./gate'); 



let players = {};
let gameStatus = { 
    isOnigokko: false, 
    oniPages: [], 
    frozenPages: [],
    timeLeft: 0 
};
let wallOffset = 0;
let wallDirection = 1;
let soccerScores = { red: 0, blue: 0 };
let soccerTimer = 150;
let isSoccerActive = false;
let ball = { x: 750, y: 750, vx: 0, vy: 0 };


setInterval(() => {
    // --- 既存の壁の動き ---
    wallOffset += 2 * wallDirection;
    if (wallOffset > 400 || wallOffset < -400) wallDirection *= -1;
    io.emit('wall_update', wallOffset);

    // --- 【追加】ボールの計算 ---
    if (isSoccerActive) {
        ball.vx *= 0.98; ball.vy *= 0.98; // 摩擦
        ball.x += ball.vx; ball.y += ball.vy;

        // 壁での跳ね返り
        if (ball.x < 20 || ball.x > 1480) { ball.vx *= -1; ball.x = (ball.x < 20) ? 20 : 1480; }
        if (ball.y < 20 || ball.y > 1480) { ball.vy *= -1; ball.y = (ball.y < 20) ? 20 : 1480; }

        // ゴール判定
        if (ball.x > 600 && ball.x < 900) {
            if (ball.y <= 25) { soccerScores.blue++; ball = {x:750, y:750, vx:0, vy:0}; io.emit('announce', "青チーム得点！"); }
            if (ball.y >= 1475) { soccerScores.red++; ball = {x:750, y:750, vx:0, vy:0}; io.emit('announce', "赤チーム得点！"); }
        }
    }
    io.emit('soccer_update', { ball, scores: soccerScores, timer: soccerTimer, active: isSoccerActive });
}, 30);

gateRoutes(app);
app.use(requireAccess, express.static('public'));


let gameTimer = null; 

io.on('connection', (socket) => {
socket.on('send_chat', async (msg) => {
    if (!players[socket.id]) return;
// joinの中か外に追加
socket.on('kick_ball', (data) => {
    ball.vx = data.vx;
    ball.vy = data.vy;
});

socket.on('start_soccer', () => {
    soccerScores = { red: 0, blue: 0 };
    soccerTimer = 150;
    isSoccerActive = true;
    io.emit('announce', "サッカー開始！");
});

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
        gameStatus.timeLeft = 150;

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

// 30ミリ秒ごとに壁の位置を全員に送る
setInterval(() => {
    wallOffset += 2 * wallDirection;
    if (wallOffset > 400 || wallOffset < -400) wallDirection *= -1;
    
    // 全員に現在の位置を送信
    io.emit('wall_update', wallOffset);
}, 30);
http.listen(3000, () => { console.log('Server is running!'); });

    
