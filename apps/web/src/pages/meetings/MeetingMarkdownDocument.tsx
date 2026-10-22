type HeadingLevel = 1 | 2 | 3;

type MarkdownBlock =
  | { readonly kind: "heading"; readonly level: HeadingLevel; readonly text: string }
  | { readonly kind: "paragraph"; readonly lines: readonly string[] }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "table"; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] };

interface MeetingMarkdownDocumentProps {
  readonly markdown: string;
  readonly ariaLabel?: string;
}

interface HtmlDocumentInput {
  readonly title: string;
  readonly markdown: string;
}

export function MeetingMarkdownDocument({ markdown, ariaLabel = "회의록 문서 미리보기" }: MeetingMarkdownDocumentProps) {
  const blocks = parseMeetingMarkdown(markdown);

  return (
    <article className="meeting-document" role="document" aria-label={ariaLabel}>
      {blocks.length === 0 ? (
        <p className="meeting-document-empty">회의록 초안을 생성하면 문서 미리보기가 표시됩니다.</p>
      ) : (
        blocks.map((block, index) => renderBlock(block, index))
      )}
    </article>
  );
}

export function buildMeetingMinutesHtmlDocument({ title, markdown }: HtmlDocumentInput): string {
  const body = parseMeetingMarkdown(markdown).map(renderHtmlBlock).join("\n");

  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{margin:0;background:#eef2f7;color:#1f2937;font-family:Arial,'Malgun Gothic',sans-serif;}",
    ".page{box-sizing:border-box;max-width:840px;min-height:1120px;margin:32px auto;padding:72px 76px;background:white;box-shadow:0 18px 40px rgba(15,23,42,.18);}",
    "h1{font-size:30px;margin:0 0 28px;border-bottom:2px solid #1f2937;padding-bottom:14px;}h2{font-size:20px;margin:30px 0 12px;}h3{font-size:16px;margin:22px 0 10px;}",
    "p,li,td,th{font-size:14px;line-height:1.72;}ul{margin:0 0 16px 20px;padding:0;}table{width:100%;border-collapse:collapse;margin:12px 0 20px;}th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left;vertical-align:top;}th{background:#f1f5f9;font-weight:700;}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="page">',
    body || "<p>회의록 초안이 없습니다.</p>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function parseMeetingMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split(/\r?\n/u);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(HEADING_PATTERN);
    const headingMarker = headingMatch?.[1];
    const headingText = headingMatch?.[2];
    if (headingMarker && headingText) {
      blocks.push({ kind: "heading", level: headingLevel(headingMarker), text: headingText });
      index += 1;
      continue;
    }

    if (isListLine(line)) {
      const parsed = parseList(lines, index);
      blocks.push({ kind: "list", items: parsed.items });
      index = parsed.nextIndex;
      continue;
    }

    if (isTableStart(lines, index)) {
      const parsed = parseTable(lines, index);
      blocks.push({ kind: "table", headers: parsed.headers, rows: parsed.rows });
      index = parsed.nextIndex;
      continue;
    }

    const parsed = parseParagraph(lines, index);
    blocks.push({ kind: "paragraph", lines: parsed.lines });
    index = parsed.nextIndex;
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number) {
  switch (block.kind) {
    case "heading":
      return <HeadingBlock key={`heading-${index}`} level={block.level} text={block.text} />;
    case "paragraph":
      return <p key={`paragraph-${index}`}>{block.lines.join(" ")}</p>;
    case "list":
      return (
        <ul key={`list-${index}`}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <table key={`table-${index}`}>
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {block.headers.map((header, cellIndex) => (
                  <td key={`${header}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return assertNever(block);
  }
}

function HeadingBlock({ level, text }: { readonly level: HeadingLevel; readonly text: string }) {
  switch (level) {
    case 1:
      return <h1>{text}</h1>;
    case 2:
      return <h2>{text}</h2>;
    case 3:
      return <h3>{text}</h3>;
    default:
      return assertNever(level);
  }
}

function renderHtmlBlock(block: MarkdownBlock): string {
  switch (block.kind) {
    case "heading":
      return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    case "paragraph":
      return `<p>${escapeHtml(block.lines.join(" "))}</p>`;
    case "list":
      return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    case "table":
      return renderHtmlTable(block);
    default:
      return assertNever(block);
  }
}

function renderHtmlTable(block: Extract<MarkdownBlock, { readonly kind: "table" }>): string {
  const headers = block.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rows = block.rows
    .map((row) => {
      const cells = block.headers
        .map((_, cellIndex) => `<td>${escapeHtml(row[cellIndex] ?? "")}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function parseList(lines: readonly string[], startIndex: number): { readonly items: readonly string[]; readonly nextIndex: number } {
  const items: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!isListLine(line)) break;
    items.push(line.replace(/^[-*]\s+/u, ""));
    index += 1;
  }
  return { items, nextIndex: index };
}

function parseTable(
  lines: readonly string[],
  startIndex: number,
): { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly nextIndex: number } {
  const headers = parseTableCells(lines[startIndex] ?? "");
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!isTableRow(line)) break;
    rows.push(parseTableCells(line));
    index += 1;
  }

  return { headers, rows, nextIndex: index };
}

function parseParagraph(
  lines: readonly string[],
  startIndex: number,
): { readonly lines: readonly string[]; readonly nextIndex: number } {
  const paragraphLines: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line || isListLine(line) || isTableStart(lines, index) || isHeadingLine(line)) break;
    paragraphLines.push(line);
    index += 1;
  }
  return { lines: paragraphLines, nextIndex: index };
}

function headingLevel(marker: string): HeadingLevel {
  switch (marker.length) {
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return 3;
  }
}

function isListLine(line: string): boolean {
  return /^[-*]\s+/u.test(line);
}

const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/u;

function isHeadingLine(line: string): boolean {
  return HEADING_PATTERN.test(line);
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const line = lines[index]?.trim() ?? "";
  const nextLine = lines[index + 1]?.trim() ?? "";
  return isTableRow(line) && isTableSeparator(nextLine);
}

function isTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  return /^\|(?:\s*:?-{3,}:?\s*\|)+$/u.test(line);
}

function parseTableCells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled markdown block: ${JSON.stringify(value)}`);
}
