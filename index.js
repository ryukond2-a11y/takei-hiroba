const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const path = require("path");

app.use(express.static("public"));

// 全プレイヤーの情報を保存するオブジェクト
let players = {};

io.on("connection", (socket) => {
    console.log("ユーザーが参加しました:", socket.id);

    // 新規参加時の処理
    socket.on("join", (data) => {
        players[socket.id] = {
            id: socket.id,
            x: 400,
            y: 300,
            name: data.name,
            avatar: data.avatar, // ドット絵データ（配列など）
            color: data.color || "#1d9bf0"
        };
        // 全員に現在のプレイヤー状況を送信
        io.emit("update_all", players);
    });

    // 移動データを受信（滑らかにするため、頻繁に送られてくる）
    socket.on("move", (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            // 他の全員に「誰がどこに動いたか」をブロードキャスト
            socket.broadcast.emit("player_moved", players[socket.id]);
        }
    });

    socket.on("disconnect", () => {
        delete players[socket.id];
        io.emit("player_left", socket.id);
        console.log("ユーザーが退出しました:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`たけい広場 起動: http://localhost:${PORT}`);
});
