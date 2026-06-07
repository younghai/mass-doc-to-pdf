#!/usr/bin/env node
// Zero-dependency Markdown -> standalone HTML for dated change logs.
// Usage: node scripts/md2html.mjs <input.md> [output.html]
import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2];
if (!inPath) {
  console.error("usage: node scripts/md2html.mjs <input.md> [output.html]");
  process.exit(1);
}
const outPath = process.argv[3] ?? inPath.replace(/\.md$/, ".html");
const src = readFileSync(inPath, "utf8");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

const lines = src.split("\n");
const out = [];
let i = 0;
let inList = false;
const closeList = () => {
  if (inList) {
    out.push("</ul>");
    inList = false;
  }
};

while (i < lines.length) {
  const line = lines[i];

  if (/^\s*$/.test(line)) {
    closeList();
    i++;
    continue;
  }
  if (/^---+\s*$/.test(line)) {
    closeList();
    out.push("<hr>");
    i++;
    continue;
  }
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    closeList();
    const lvl = h[1].length;
    out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    i++;
    continue;
  }
  if (/^>\s?/.test(line)) {
    closeList();
    out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    i++;
    continue;
  }
  // table
  if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
    closeList();
    const cells = (r) =>
      r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const header = cells(line);
    i += 2;
    out.push("<table><thead><tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
    while (i < lines.length && /^\|/.test(lines[i])) {
      const row = cells(lines[i]);
      out.push("<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      i++;
    }
    out.push("</tbody></table>");
    continue;
  }
  const li = line.match(/^\s*[-*]\s+(.*)$/);
  if (li) {
    if (!inList) {
      out.push("<ul>");
      inList = true;
    }
    out.push(`<li>${inline(li[1])}</li>`);
    i++;
    continue;
  }
  closeList();
  out.push(`<p>${inline(line)}</p>`);
  i++;
}
closeList();

const title = (src.match(/^#\s+(.*)$/m)?.[1] ?? "변경 로그").replace(/[*`]/g, "");
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 920px; margin: 2rem auto; padding: 0 1.2rem;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
    line-height: 1.6; color: #1f2937; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #0f172a; } }
  h1,h2,h3 { line-height: 1.25; }
  h1 { border-bottom: 2px solid #6366f1; padding-bottom: .3rem; }
  h2 { margin-top: 2rem; border-bottom: 1px solid #94a3b833; padding-bottom: .2rem; }
  code { background: #6366f120; padding: .1rem .35rem; border-radius: 4px; font-size: .9em; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .94rem; }
  th,td { border: 1px solid #94a3b855; padding: .5rem .7rem; text-align: left; vertical-align: top; }
  th { background: #6366f115; }
  blockquote { border-left: 3px solid #6366f1; margin: 1rem 0; padding: .2rem 1rem; color: #6b7280; }
  hr { border: none; border-top: 1px solid #94a3b844; margin: 1.5rem 0; }
  a { color: #6366f1; }
</style>
</head>
<body>
${out.join("\n")}
</body>
</html>
`;

writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
