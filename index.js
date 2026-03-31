const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

let players = {};

wss.on("connection", (ws) => {
    const id = Math.random().toString(36).substr(2, 9);

    players[id] = {
        x: 5,
        y: 5,
        name: "名無し"
    };

    ws.send(JSON.stringify({ type: "init", id, players }));

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        if (data.type === "move") {
            players[id].x = data.x;
            players[id].y = data.y;
        }

        if (data.type === "name") {
            players[id].name = data.name;
        }
    });

    ws.on("close", () => {
        delete players[id];
    });
});

// 全員に配信（60fpsは重いので20fpsくらい）
setInterval(() => {
    const data = JSON.stringify({ type: "update", players });
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            c.send(data);
        }
    });
}, 50);

server.listen(3000, () => {
    console.log("Server running");
});
