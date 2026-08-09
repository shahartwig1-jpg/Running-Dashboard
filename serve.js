// Minimal static server for local preview of the dashboard.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8371;
const ROOT = __dirname;

// Never serve these, even locally — the browser has no business reading them.
const BLOCKED = new Set(["key.txt", "config.json", "config.example.json"]);

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (BLOCKED.has(path.basename(file))) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    const type = file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : file.endsWith(".json") ? "application/json; charset=utf-8"
      : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg"
      : file.endsWith(".png") ? "image/png"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`הפורט ${PORT} כבר תפוס — כנראה השרת כבר רץ בחלון אחר.`);
    console.error(`פשוט פתח בדפדפן: http://localhost:${PORT}`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => console.log("הדשבורד רץ על http://localhost:" + PORT + "   (Ctrl+C לעצירה)"));
