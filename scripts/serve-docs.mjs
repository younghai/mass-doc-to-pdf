// Tiny static server for docs/ — used by the Claude preview pane to display
// reports without adding dependencies or polluting the web app's public/.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "docs");
const port = Number(process.env.PORT ?? 5180);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    if (path === "/" || path === "\\") path = "/before-after-hardening.html";
    const file = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}).listen(port, () => console.log(`docs server on http://localhost:${port}`));
