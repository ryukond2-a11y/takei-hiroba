const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const path = require("path");

app.use(express.static("public"));

let players = {};
let gameStatus = { isOnigokko: false, oniPages: [], frozenPages: [] };
io.on("connection", (socket) => {
    socket.on("join", (data) => {
        // 初期位置を画像の真ん中あたりにする（例: 800, 600）
        players[socket.id] = {
            id: socket.id,
            x: 800,
            y: 600,
            name: data.name,
            avatar: data.avatar || null // ドット絵の配列データ
        };
        io.emit("update_all", players);
    });

    socket.on("move", (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            // サーバーの負荷を減らすため、ここでのemitは軽量化する
            socket.broadcast.emit("player_moved", {id: socket.id, x: data.x, y: data.y});
        }
    });
　　socket.on("start_onigokko", () => {
    const ids = Object.keys(players);
    if (ids.length < 2) return; // 2人以上いないと始まらない

    gameStatus.isOnigokko = true;
    gameStatus.frozenPages = [];
    
    // ★鬼の選出（20%切り上げ）
    const oniCount = Math.ceil(ids.length * 0.2);
    const shuffled = ids.sort(() => 0.5 - Math.random());
    gameStatus.oniPages = shuffled.slice(0, oniCount);

    // 全員に「開始」と「役職リスト」を一斉送信！
    io.emit("onigokko_update", gameStatus);
    io.emit("start_countdown"); // 全員の画面でカウントダウンさせる
});
    socket.on("disconnect", () => {
        delete players[socket.id];
        io.emit("player_left", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`たけい広場 起動: http://localhost:${PORT}`);
});
