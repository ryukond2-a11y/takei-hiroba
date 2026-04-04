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
    // 参加
    socket.on('join', (data) => {
        players[socket.id] = { 
            id: socket.id, name: data.name, avatar: data.avatar, 
            x: data.x || 750, y: data.y || 750, 
            team: null // サッカーチームは最初なし
        };
        io.emit('update_all', players);
    });

    // --- 鬼ごっこシステム（元通り） ---
    socket.on("start_onigokko", () => {
        if (gameStatus.isOnigokko) return;
        // 参加者チェック（x座標5000-7000のエリアにいる人）
        const participants = Object.keys(players).filter(id => players[id].x > 5000 && players[id].x < 7000);
        
        // 【元に戻した】一人では開始できない制限
        if (participants.length < 2) {
            socket.emit("announce", "鬼ごっこには2人以上の参加者が必要です！");
            return;
        }

        gameStatus.isOnigokko = true;
        gameStatus.frozenPages = [];
        gameStatus.timeLeft = 150;
        const oniCount = Math.ceil(participants.length * 0.3);
        const shuffled = [...participants].sort(() => 0.5 - Math.random());
        gameStatus.oniPages = shuffled.slice(0, oniCount);
        io.emit("onigokko_update", gameStatus);

        if (gameTimer) clearInterval(gameTimer);
        gameTimer = setInterval(() => {
            gameStatus.timeLeft--;
            if (gameStatus.timeLeft <= 0) {
                clearInterval(gameTimer);
                gameTimer = null;
                gameStatus.isOnigokko = false;
                io.emit("announce", "鬼ごっこ終了！");
            }
            io.emit("onigokko_update", gameStatus);
        }, 1000);
    });

    // --- 移動とチーム割り振り ---
    socket.on('move', (data) => {
        if (!players[socket.id]) return;
        // 鬼ごっこで凍結中は動けない
        if (gameStatus.frozenPages.includes(socket.id)) return;

        players[socket.id].x = data.x;
        players[socket.id].y = data.y;

        // 【修正】サッカーコート(x > 8000)に触れたときだけチーム割り振り
        if (data.x > 8000) {
            if (!players[socket.id].team) {
                const inCourt = Object.values(players).filter(p => p.x > 8000 && p.team);
                const redCount = inCourt.filter(p => p.team === 'red').length;
                const blueCount = inCourt.filter(p => p.team === 'blue').length;
                players[socket.id].team = (redCount <= blueCount) ? 'red' : 'blue';
                socket.emit('announce', `${players[socket.id].team === 'red' ? '赤' : '青'}チームに入りました！`);
            }
        } else {
            // コートを出たらチーム解除
            players[socket.id].team = null;
        }

        // 鬼ごっこの接触判定（ここも元通りのロジック）
        if (gameStatus.isOnigokko && data.x > 5000 && data.x < 7000) {
            // ...既存の接触判定コード（そのまま維持）
        }

        socket.broadcast.emit('player_moved', players[socket.id]);
    });

    // サッカー開始（独立）
    socket.on('start_soccer', () => {
        soccerScores = { red: 0, blue: 0 };
        soccerTimer = 150;
        isSoccerActive = true;
        io.emit('announce', "サッカー試合開始！");
    });

    socket.on('kick_ball', (data) => {
        if (!isSoccerActive) return;
        ball.vx = data.vx; ball.vy = data.vy;
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('update_all', players);
    });
});
// サーバー起動
http.listen(3000, () => { 
    console.log('Server is running!'); 
});
