import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

const port = Number(process.env.WEB_PORT ?? process.env.PORT ?? 8081);
const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";
const root = resolve(process.env.WEB_DIST ?? "/home/vts/hwptopdf/apps/web/dist");
const indexPath = join(root, "index.html");
const skippedProxyHeaders = new Set([
  "connection",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function staticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const requested = normalize(decoded === "/" ? "/index.html" : decoded);
  const full = join(root, requested);
  const rel = relative(root, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel === "") {
    return indexPath;
  }
  return full;
}

async function serveStatic(req, res) {
  const requested = staticPath(req.url ?? "/");
  const path = existsSync(requested) ? requested : indexPath;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      send(res, 404, "not found");
      return;
    }
    res.writeHead(200, {
      "content-length": String(info.size),
      "content-type": types[extname(path)] ?? "application/octet-stream",
    });
    createReadStream(path).pipe(res);
  } catch {
    send(res, 404, "not found");
  }
}

async function proxyApi(req, res) {
  const target = new URL(req.url ?? "/", apiOrigin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || skippedProxyHeaders.has(key.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else {
      headers.set(key, value);
    }
  }
  try {
    const upstream = await fetch(target, {
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req),
      duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
      headers,
      method: req.method,
      redirect: "manual",
    });
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    send(res, 502, error instanceof Error ? error.message : "bad gateway");
  }
}

createServer((req, res) => {
  if ((req.url ?? "").startsWith("/api/")) {
    void proxyApi(req, res);
    return;
  }
  void serveStatic(req, res);
}).listen(port, "0.0.0.0");
