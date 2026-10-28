import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = 8000;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

createServer(async (request, response) => {
  try {
    const requested = request.url === "/" ? "index.html" : request.url.split("?")[0].slice(1);
    const path = normalize(join(root, requested));
    if (!path.startsWith(root)) throw new Error("Invalid path");
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": `${types[extname(path)] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`ENDLESS//CITY running at http://127.0.0.1:${port}`);
});
