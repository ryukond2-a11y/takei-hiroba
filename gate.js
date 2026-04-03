const ACCESS_CODE = "aisiteruyotakei"; // 今使ってるコード

function gateRoutes(app) {
  app.get("/gate", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f2f5;
          font-family: sans-serif;
        }
        .container {
          background: white;
          padding: 2rem;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          text-align: center;
          width: 90%;
          max-width: 400px;
        }
        h2 { color: #333; margin-bottom: 1.5rem; }
        input[type="password"] {
          width: 100%;
          padding: 15px;
          font-size: 18px;
          border: 2px solid #ddd;
          border-radius: 8px;
          box-sizing: border-box;
          margin-bottom: 1rem;
          outline: none;
          transition: border-color 0.3s;
        }
        input[type="password"]:focus {
          border-color: #007bff;
        }
        button {
          width: 100%;
          padding: 15px;
          font-size: 18px;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          transition: background 0.3s;
        }
        button:hover {
          background-color: #0056b3;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>アクセス認証</h2>
        <form method="POST" action="/gate">
          <input type="password" name="code" placeholder="アクセスコードを入力" autofocus>
          <button type="submit">入室する</button>
        </form>
      </div>
    </body>
    </html>
  `);
});


  app.post("/gate", (req, res) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const code = new URLSearchParams(body).get("code");
      if (code === ACCESS_CODE) {
        res.setHeader(
          "Set-Cookie",
          "access=ok; Path=/; Max-Age=86400"
        );
        res.redirect("/");
      } else {
        res.send("コードが違います");
      }
    });
  });
}

function requireAccess(req, res, next) {
  if (req.headers.cookie?.includes("access=ok")) {
    next();
  } else {
    res.redirect("/gate");
  }
}

module.exports = { requireAccess, gateRoutes };
