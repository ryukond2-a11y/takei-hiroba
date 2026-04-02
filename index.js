const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

let players = {};
let gameStatus = { isOnigokko: false, oniPages: [], frozenPages: [], timeLeft: 0 };

// --- サッカー用変数 ---
let ball = { x: 750, y: 2500, vx: 0, vy: 0, lastTouch: null, secondLastTouch: null };
let soccerStatus = { 
    isSoccer: false, 
    score: { blue: 0, white: 0 }, 
    timeLeft: 0,
    stats: {} // { socketId: { goals: 0, assists: 0, name: "" } }
};
let soccerTimer = null;

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        // チーム分け（青と白を交互に）
        const team = Object.keys(players).length % 2 === 0 ? 'blue' : 'white';
        const startX = (data.x !== undefined) ? data.x : 750;
        const startY = (data.y !== undefined) ? data.y : 750;

        players[socket.id] = { 
            id: socket.id, 
            name: data.name, 
            avatar: data.avatar, 
            x: startX, 
            y: startY,
            team: team 
        };
        io.emit('update_all', players);
    });

    // --- サッカー開始 ---
    socket.on("start_soccer", () => {
        if (soccerStatus.isSoccer) return;
        soccerStatus.isSoccer = true;
        soccerStatus.score = { blue: 0, white: 0 };
        soccerStatus.timeLeft = 180;
        soccerStatus.stats = {};
        
        // 全プレイヤーの統計を初期化
        for(let id in players) {
            soccerStatus.stats[id] = { goals: 0, assists: 0, name: players[id].name };
        }

        ball = { x: 750, y: 2500, vx: 0, vy: 0, lastTouch: null, secondLastTouch: null };
        io.emit("soccer_update", soccerStatus);

        soccerTimer = setInterval(() => {
            soccerStatus.timeLeft--;
            if (soccerStatus.timeLeft <= 0) {
                clearInterval(soccerTimer);
                soccerStatus.isSoccer = false;
                io.emit("announce", "サッカー終了！リザルトを確認してね");
            }
            io.emit("soccer_update", soccerStatus);
        }, 1000);
    });

    // --- 移動とボールの当たり判定 ---
    socket.on('move', (data) => {
        if (!players[socket.id]) return;
        players[socket.id].x = data.x;
        players[socket.id].y = data.y;

        // ボールとの接触判定
        const dx = data.x - ball.x;
        const dy = data.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 45) {
            // 蹴った方向へ加速
            ball.vx = (ball.x - data.x) * 0.4;
            ball.vy = (ball.y - data.y) * 0.4;

            // 触った人の記録（自分と違う人が触ったらずらす）
            if (ball.lastTouch !== socket.id) {
                ball.secondLastTouch = ball.lastTouch;
                ball.lastTouch = socket.id;
            }
        }
        socket.broadcast.emit('player_moved', players[socket.id]);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('update_all', players);
    });
});

// --- ボールの物理演算とゴール判定（サーバーで常に動かす） ---
setInterval(() => {
    if (!soccerStatus.isSoccer) return;

    // 摩擦で減速
    ball.vx *= 0.98;
    ball.vy *= 0.98;
    ball.x += ball.vx;
    ball.y += ball.vy;

    // 壁の跳ね返り
    if (ball.x < 50 || ball.x > 1450) {
        // ゴール判定（飛び出した部分）
        if (ball.y > 2400 && ball.y < 2600) {
            if (ball.x < 50) soccerStatus.score.white++;
            else soccerStatus.score.blue++;

            // 貢献度加算
            if (soccerStatus.stats[ball.lastTouch]) soccerStatus.stats[ball.lastTouch].goals++;
            if (soccerStatus.stats[ball.secondLastTouch]) soccerStatus.stats[ball.secondLastTouch].assists++;

            // リセット
            ball = { x: 750, y: 2500, vx: 0, vy: 0, lastTouch: null, secondLastTouch: null };
            io.emit("announce", "GOOOAL!!");
        } else {
            ball.vx *= -1; // 壁跳ね返り
            ball.x = ball.x < 50 ? 51 : 1449;
        }
    }
    if (ball.y < 2050 || ball.y > 2950) {
        ball.vy *= -1;
        ball.y = ball.y < 2050 ? 2051 : 2949;
    }

    io.emit("ball_update", ball);
}, 30);

http.listen(3000, () => { console.log('Server is running!'); });
