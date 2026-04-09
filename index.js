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
// サッカー専用エリアの設定
const SOCCER_AREA = { x: 8000, y: 8000, w: 2000, h: 1200 }; 
let isSoccerActive = false;
let soccerTimer = 0;
let soccerScores = { red: 0, blue: 0 };
let ball = { x: 9000, y: 8600, vx: 0, vy: 0 };

setInterval(() => {
    // 1. 動く壁の計算（既存）
    wallOffset += 2 * wallDirection;
    if (wallOffset > 400 || wallOffset < -400) wallDirection *= -1;
    io.emit('wall_update', wallOffset);

    // 2. サッカーの物理演算（追加）
    if (isSoccerActive) {
        ball.vx *= 0.98; ball.vy *= 0.98; // 摩擦
        ball.x += ball.vx; ball.y += ball.vy;

        // 壁での跳ね返り
        if (ball.x < SOCCER_AREA.x + 20 || ball.x > SOCCER_AREA.x + 1980) ball.vx *= -1;
        if (ball.y < SOCCER_AREA.y + 20 || ball.y > SOCCER_AREA.y + 1180) ball.vy *= -1;

        // ゴール判定
        if (ball.y > SOCCER_AREA.y + 400 && ball.y < SOCCER_AREA.y + 800) {
            if (ball.x < SOCCER_AREA.x + 40) { // 青の得点
                soccerScores.blue++;
                resetBall();
                io.emit('announce', "青チーム得点！");
            } else if (ball.x > SOCCER_AREA.x + 1960) { // 赤の得点
                soccerScores.red++;
                resetBall();
                io.emit('announce', "赤チーム得点！");
            }
        }
    }
    io.emit('soccer_update', { ball, scores: soccerScores, timer: soccerTimer, active: isSoccerActive });
}, 30);

// この関数も setInterval のすぐ下あたりに追加
function resetBall() { ball = { x: 9000, y: 8600, vx: 0, vy: 0 }; }



function resetBall() { ball = { x: 9000, y: 8600, vx: 0, vy: 0 }; }
gateRoutes(app);
app.use(requireAccess, express.static('public'));

let gameTimer = null; 

io.on('connection', (socket) => {
    // --- 【修正点3】joinイベントを整理し、チーム均等振分を実装 ---
    socket.on('join', (data) => {
        let red = 0, blue = 0;
        Object.values(players).forEach(p => {
            if(p.team === 'red') red++;
            else if(p.team === 'blue') blue++;
        });
        const team = (red <= blue) ? 'red' : 'blue';

        players[socket.id] = { 
            id: socket.id, name: data.name, avatar: data.avatar, 
            x: data.x || 750, y: data.y || 750, team: team 
        };
        socket.emit('assign_team', team);
        io.emit('update_all', players);
    });

    socket.on('send_chat', async (msg) => {
        if (!players[socket.id]) return;
        const chatData = {
            username: players[socket.id].name,
            realname: null,
            text: msg,
            timestamp: Date.now()
        };
        try {
            await fetch(FIREBASE_URL, {
                method: 'POST',
                body: JSON.stringify(chatData),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) { console.error("Firebase Error:", e); }
        io.emit('announce', `${chatData.username}: ${msg}`);
    });

    socket.on('kick_ball', (data) => {
        if (!isSoccerActive) return;
        ball.vx = data.vx;
        ball.vy = data.vy;
    });

    socket.on('start_soccer', () => {
        soccerScores = { red: 0, blue: 0 };
        soccerTimer = 150;
        isSoccerActive = true;
        io.emit('announce', "サッカー開始！");
    });

    socket.on("start_onigokko", () => {
        if (gameStatus.isOnigokko) return;
        const participants = Object.keys(players).filter(id => players[id].x > 5000);
        if (participants.length < 2) {
            socket.emit("announce", "参加者が足りません");
            return;
        }
        if (gameTimer) clearInterval(gameTimer);
        gameStatus.isOnigokko = true;
        gameStatus.frozenPages = [];
        gameStatus.timeLeft = 150;
        const oniCount = Math.ceil(participants.length * 0.3);
        const shuffled = [...participants].sort(() => 0.5 - Math.random());
        gameStatus.oniPages = shuffled.slice(0, oniCount);
        io.emit("onigokko_update", gameStatus);
        participants.forEach(id => io.to(id).emit("announce", "鬼ごっこ開始！"));

        gameTimer = setInterval(() => {
            gameStatus.timeLeft--;
            const currentParticipants = Object.keys(players).filter(id => players[id].x > 5000);
            const nigeIds = currentParticipants.filter(id => !gameStatus.oniPages.includes(id));
            const allFrozen = nigeIds.length > 0 && nigeIds.every(id => gameStatus.frozenPages.includes(id));

            if (gameStatus.timeLeft <= 0 || allFrozen) {
                clearInterval(gameTimer);
                gameTimer = null;
                let resultMsg = allFrozen ? "鬼の勝利！" : "逃げの勝利！";
                currentParticipants.forEach(id => io.to(id).emit("announce", "終了！ " + resultMsg));
                gameStatus.isOnigokko = false;
                gameStatus.oniPages = [];
                gameStatus.frozenPages = [];
                io.emit("onigokko_update", gameStatus);
            } else {
                io.emit("onigokko_update", gameStatus);
            }
        }, 1000);
    });
// ボールを蹴るイベント
socket.on('kick_ball', (data) => {
    if (!isSoccerActive) return;
    // 蹴った方向(vx, vy)をボールに加える
    ball.vx = data.vx;
    ball.vy = data.vy;
});
 socket.on('move', (data) => {
    if (!players[socket.id]) return;
    
    // 凍結されているプレイヤーは動けない（鬼ごっこのルール）
    if (gameStatus.frozenPages.includes(socket.id)) return;

    players[socket.id].x = data.x;
    players[socket.id].y = data.y;

    // --- 【追加】サッカーのチーム分けロジック ---
    if (data.x > 7500) { // サッカー場エリアにいる場合
        if (!players[socket.id].team) {
            const pArray = Object.values(players).filter(p => p.x > 7500 && p.team);
            const redC = pArray.filter(p => p.team === 'red').length;
            const blueC = pArray.filter(p => p.team === 'blue').length;
            players[socket.id].team = (redC <= blueC) ? 'red' : 'blue';
            socket.emit('announce', `あなたは ${players[socket.id].team === 'red' ? '赤' : '青'} チーム！`);
        }
    } else {
        players[socket.id].team = null; // エリア外なら解除
    }

    // --- 【既存】鬼ごっこの接触判定ロジック ---
    if (gameStatus.isOnigokko && players[socket.id].x > 5000) {
        const myId = socket.id;
        for (let targetId in players) {
            // 自分自身、または鬼ごっこエリア(x > 5000)外の人は無視
            if (myId === targetId || players[targetId].x <= 5000) continue;

            const dx = players[myId].x - players[targetId].x;
            const dy = players[myId].y - players[targetId].y;

            if (Math.sqrt(dx*dx + dy*dy) < 40) { // 接触した
                const isIMoni = gameStatus.oniPages.includes(myId);
                const isTargetFrozen = gameStatus.frozenPages.includes(targetId);

                // 自分が鬼で、相手が逃げ（かつ凍っていない）なら凍らせる
                if (isIMoni && !gameStatus.oniPages.includes(targetId) && !isTargetFrozen) {
                    gameStatus.frozenPages.push(targetId);
                } 
                // 自分が鬼でなく、相手が凍っているなら助ける
                else if (!isIMoni && !gameStatus.oniPages.includes(targetId) && isTargetFrozen) {
                    gameStatus.frozenPages = gameStatus.frozenPages.filter(id => id !== targetId);
                }
                io.emit("onigokko_update", gameStatus);
            }
        }
    }

    // 全員に位置を同期
    socket.broadcast.emit('player_moved', players[socket.id]);
});
    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('update_all', players);
    });
});

http.listen(3000, () => { console.log('Server is running!'); });
