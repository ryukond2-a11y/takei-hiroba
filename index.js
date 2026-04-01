const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const path = require("path");

app.use(express.static("public"));

let players = {};

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

    socket.on("disconnect", () => {
        delete players[socket.id];
        io.emit("player_left", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`たけい広場 起動: http://localhost:${PORT}`);
});
