#!/usr/bin/env node

/**
 * rabbitQ-skill-lark-xhs
 *
 * 小兔Q彬 · 飞书云文档 Markdown + 附件 → 可编辑小红书 3:4 图文 Studio
 *
 * Flow:
 *   Lark export package -> XHS source snapshot -> 3:4 paginated XHS Studio
 *
 * Keeps article hierarchy, removes video blocks, keeps images,
 * paginates by measured browser height, and exports PNG ZIP.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { pathToFileURL } = require("url");
const cheerio = require("cheerio");

const VERSION = "0.8.39";
const HEADING_LEVEL2_SIZE_BONUS_PX = 2;
const HEADING_LEVEL2_MARGIN_BOTTOM_PX = 20;

function headingLevel2FontSize(headingTitleSize) {
  return Math.round(Number(headingTitleSize || 48) * 0.8) + HEADING_LEVEL2_SIZE_BONUS_PX;
}
const DEFAULT_BG_THEME = "white";
const DEFAULT_ACCENT_THEME = "blue";
const CARD_LABEL_WORDS = "高亮|划重点|卡片|注意|结论|金句|关键|判断|提醒|重点";
// Trailing !/！ (0-2) is part of the recognized token, e.g. "注意！！" / "提醒!!".
const CARD_LABEL_TOKEN = `(?:${CARD_LABEL_WORDS})[!！]{0,2}`;
const CARD_LABEL_EXACT = new RegExp(`^${CARD_LABEL_TOKEN}$`);
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1440;
const BODY_PAD_X = 90;
const BODY_PAD_TOP = 91;
const BODY_PAD_BOTTOM = 89;

function printUsage() {
  console.log(`rabbitQ-skill-lark-xhs

Usage:
  node scripts/convert.js <markdown-file-or-package-dir-or-zip> [options]

Options:
  -o, --output-dir <dir>   Output directory. Default: <input>-xhs
  --title <text>           Override title
  --subtitle <text>        Cover subtitle. Default: editable placeholder
  --keywords <a,b,c>       Extra keywords metadata, kept for compatibility
  --size <WxH>             Canvas size. Default: 1080x1440
  --width <px>             Canvas width
  --height <px>            Canvas height
  --help                   Show help

Output:
  xhs-studio.html          Local editable Studio URL
  manifest.json            Output manifest
`);
}

function parseArgs(argv) {
  const opts = {
    input: "",
    outputDir: "",
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if ((arg === "-o" || arg === "--output-dir") && argv[i + 1]) {
      opts.outputDir = argv[++i];
    } else if (arg === "--title" && argv[i + 1]) {
      opts.title = argv[++i];
    } else if (arg === "--subtitle" && argv[i + 1]) {
      opts.subtitle = argv[++i];
    } else if (arg === "--topic" && argv[i + 1]) {
      // Deprecated: kept for old commands, intentionally ignored.
      i += 1;
    } else if (arg === "--keywords" && argv[i + 1]) {
      opts.keywords = argv[++i];
    } else if (arg === "--size" && argv[i + 1]) {
      const m = argv[++i].match(/^(\d+)x(\d+)$/i);
      if (!m) throw new Error("--size must look like 1080x1440");
      opts.width = Number(m[1]);
      opts.height = Number(m[2]);
    } else if (arg === "--width" && argv[i + 1]) {
      opts.width = Number(argv[++i]);
    } else if (arg === "--height" && argv[i + 1]) {
      opts.height = Number(argv[++i]);
    } else if (!arg.startsWith("-") && !opts.input) {
      opts.input = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!opts.input) {
    printUsage();
    process.exit(1);
  }
  if (Math.abs(opts.width / opts.height - 3 / 4) > 0.012) {
    throw new Error(`Canvas must be 3:4. Received ${opts.width}x${opts.height}.`);
  }
  return opts;
}

function stripWrappingQuotes(value) {
  let s = String(value ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) frontmatter[m[1]] = stripWrappingQuotes(m[2]);
  }
  return { frontmatter, body: raw.slice(match[0].length) };
}

const CHINESE_COVER_LABELS = [
  { key: "title", pattern: /^(?:\*\*)?(?:大标题|标题|封面标题)(?:\*\*)?\s*[：:]\s*(.+)$/ },
  { key: "subtitle", pattern: /^(?:\*\*)?(?:副标题|封面副标题)(?:\*\*)?\s*[：:]\s*(.+)$/ },
];

/** Parse leading Chinese cover labels like `标题：…` / `副标题：…` and strip them from body. */
function extractChineseCoverMeta(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const meta = {};
  let cut = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      cut = i + 1;
      continue;
    }
    let matched = false;
    for (const { key, pattern } of CHINESE_COVER_LABELS) {
      const hit = line.match(pattern);
      if (!hit) continue;
      if (!meta[key]) meta[key] = plainMarkdownText(stripWrappingQuotes(hit[1]));
      matched = true;
      cut = i + 1;
      break;
    }
    if (!matched) break;
  }
  return {
    meta,
    body: lines.slice(cut).join("\n").replace(/^\n+/, ""),
  };
}

function prepareMarkdownBody(markdown) {
  const { frontmatter, body: afterFrontmatter } = parseFrontmatter(markdown);
  const { meta: chineseMeta, body } = extractChineseCoverMeta(afterFrontmatter);
  return { frontmatter, chineseMeta, body };
}

function extractTitle(markdown) {
  const { frontmatter, chineseMeta, body } = prepareMarkdownBody(markdown);
  if (frontmatter.title) return frontmatter.title;
  if (chineseMeta.title) return chineseMeta.title;
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return plainMarkdownText(h1[1]);
  return "";
}

function unescapeMarkdownEscapes(value) {
  return String(value || "").replace(/\\([\\`*_[\]{}()#+\-.!<>])/g, "$1");
}

function plainMarkdownText(value) {
  let text = String(value || "").trim();
  text = unescapeMarkdownEscapes(text)
    .replace(/`([^`]+)`/g, "$1");
  let changed = true;
  while (changed) {
    const previous = text;
    text = text
      .replace(/^\*\*([\s\S]*?)\*\*$/g, "$1")
      .replace(/^__([\s\S]*?)__$/g, "$1")
      .replace(/^\*([\s\S]*?)\*$/g, "$1")
      .replace(/^_([\s\S]*?)_$/g, "$1")
      .trim();
    changed = text !== previous;
  }
  return text;
}

/** Infer card corner label (max 3 chars) from paragraph content. */
function inferCardLabel(text) {
  const plain = plainMarkdownText(text).replace(/\s+/g, "");
  if (!plain) return "卡片";
  if (/注意|小心|切记|务必|千万|别忘|警告|风险|提醒/.test(plain)) return "注意";
  if (/结论|总之|归根|一句话|所以|这就是/.test(plain)) return "结论";
  if (/金句|名言|记住|必杀/.test(plain)) return "金句";
  if (/判断/.test(plain)) return "判断";
  if (/关键/.test(plain)) return "关键";
  if (/重点|划重点|高亮|核心|真相|本质/.test(plain)) return "划重点";
  if (plain.length <= 24 && /[。！？!?]$/.test(plain)) return "金句";
  if (plain.length <= 18) return "金句";
  return "划重点";
}

function normalizeCoverHeadingText(value) {
  return plainMarkdownText(value)
    .replace(/[·•・]/g, " ")
    .replace(/[—–-]+/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isCoverTitleHeading(text, coverTitle) {
  if (!coverTitle || !text) return false;
  const left = plainMarkdownText(text);
  const right = plainMarkdownText(coverTitle);
  if (left === right) return true;
  return normalizeCoverHeadingText(left) === normalizeCoverHeadingText(right);
}

/** Rank heading depths in body. Least # → L1, second least → L2. Skips only cover-title duplicates. */
function resolveHeadingRanks(body, title, options = {}) {
  const levels = new Set();
  let hasDepth1 = false;
  for (const rawLine of String(body || "").replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) continue;
    const text = plainMarkdownText(heading[2]);
    if (isCoverTitleHeading(text, title)) continue;
    const depth = heading[1].length;
    if (depth === 1) hasDepth1 = true;
    levels.add(depth);
  }
  let ranks = [...levels].sort((a, b) => a - b);
  let introDepth = null;
  // Cover already fixed (frontmatter / CLI / 中文标签): a lone `#` echoing the doc name
  // is intro, while `## 01 …` chapters stay the real level-1 sections.
  if (options.coverTitleExplicit && hasDepth1 && ranks.includes(2)) {
    introDepth = 1;
    ranks = ranks.filter((depth) => depth !== 1);
  }
  return { level1: ranks[0] || null, level2: ranks[1] || null, introDepth };
}

function isCoverTitleExplicit(markdown, cliTitle) {
  if (cliTitle) return true;
  const { frontmatter, chineseMeta } = prepareMarkdownBody(markdown);
  return Boolean(frontmatter.title || chineseMeta.title);
}

function slugify(value) {
  const cleaned = String(value || "xhs-note")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "xhs-note";
}

function findMarkdownInDir(dir) {
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name) && !entry.name.startsWith("."))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-Hans-CN"));
  return files[0] || "";
}

function findMarkdownRecursive(dir) {
  const found = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.md$/i.test(entry.name)) found.push(full);
    }
  }
  walk(dir);
  found.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-Hans-CN"));
  return found[0] || "";
}

function resolveInput(input) {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) throw new Error(`Input not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const md = findMarkdownInDir(resolved);
    if (!md) throw new Error(`No .md file found in ${resolved}`);
    return { markdownFile: md, packageDir: resolved, cleanup: null };
  }
  if (/\.zip$/i.test(resolved)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lark-xhs-"));
    const result = childProcess.spawnSync("unzip", ["-q", resolved, "-d", tmp], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `Failed to unzip ${resolved}`);
    const md = findMarkdownInDir(tmp) || findMarkdownRecursive(tmp);
    if (!md) throw new Error(`No .md file found inside ${resolved}`);
    return {
      markdownFile: md,
      packageDir: path.dirname(md),
      cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
    };
  }
  if (!/\.md$/i.test(resolved)) throw new Error(`Input must be .md, directory, or .zip: ${resolved}`);
  return { markdownFile: resolved, packageDir: path.dirname(resolved), cleanup: null };
}

function mimeTypeForFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function assetToDataUrl(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
  return `data:${mimeTypeForFile(file)};base64,${fs.readFileSync(file).toString("base64")}`;
}

function unescapeMarkdownUrl(value) {
  return stripWrappingQuotes(String(value || "").trim())
    .replace(/\\([() ])/g, "$1")
    .replace(/^<|>$/g, "");
}

function resolveMarkdownAsset(src, markdownFile) {
  const clean = unescapeMarkdownUrl(src).split("#")[0].split("?")[0];
  if (!clean || /^(?:https?:|data:|file:)/i.test(clean)) return unescapeMarkdownUrl(src);
  let decoded = clean;
  try {
    decoded = decodeURI(clean);
  } catch (_) {
    decoded = clean;
  }
  const candidate = path.isAbsolute(decoded)
    ? decoded
    : path.resolve(path.dirname(markdownFile), decoded);
  const dataUrl = assetToDataUrl(candidate);
  return dataUrl || unescapeMarkdownUrl(src);
}

function autoDecorateInlineHtml(html) {
  return String(html || "")
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith("<")) return part;
      return part.replace(
        /(?<![A-Za-z0-9])(\d+(?:\.\d+)?(?:\+|%|倍|天|条|封|周|个月|小时)|\d+(?:\.\d+)?\s*(?:刀|美金|倍|天|条|封|周|个月|小时)|[0-9]+×[0-9]+)(?![A-Za-z0-9])/g,
        '<span class="xhs-green-text">$1</span>',
      );
    })
    .join("");
}

function plainEscapedHtmlText(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function shouldAutoUnderlineBold(content) {
  const compact = plainEscapedHtmlText(content).replace(/\s+/g, "");
  if (!compact) return false;
  if (compact.length > 18) return false;
  if (/[。！？!?；;：:]/.test(compact)) return false;
  return true;
}

function boldMarkdownHtml(content) {
  const tag = shouldAutoUnderlineBold(content)
    ? '<strong class="xhs-green-underline" data-xhs-auto-underline="1">'
    : "<strong>";
  return `${tag}${content}</strong>`;
}

function inlineMarkdownToHtml(text, markdownFile) {
  const unescaped = unescapeMarkdownEscapes(text);
  let html = escapeHtml(unescaped)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, (_, content) => boldMarkdownHtml(content))
    .replace(/__([^_]+)__/g, (_, content) => boldMarkdownHtml(content))
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_, label, href) => {
    const cleanHref = unescapeMarkdownUrl(href);
    if (/\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(cleanHref)) {
      const src = resolveMarkdownAsset(cleanHref, markdownFile);
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" draggable="false" />`;
    }
    if (/\.(?:mp4|mov|m4v|webm|avi|mkv)(?:[?#].*)?$/i.test(cleanHref)) return "";
    return escapeHtml(label || cleanHref);
  });
  return autoDecorateInlineHtml(html);
}

function isMarkdownVideoLine(line) {
  return /\.(?:mp4|mov|m4v|webm|avi|mkv)(?:[?#].*)?$/i.test(unescapeMarkdownUrl(line));
}

function stripLeadingListMarkerText(text) {
  let value = String(text || "").trim();
  for (let i = 0; i < 5; i += 1) {
    const next = value
      .replace(/^(?:[-+•·◦]\s*)/, "")
      .replace(/^\*\s+/, "")
      .replace(/^(?:\d+[.)、．]\s*)/, "")
      .replace(/^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]|（\d+）|\(\d+\))\s*/, "")
      .replace(/^[1-9](?=[\u4e00-\u9fff])/, "")
      .replace(/^[·•]\s*/, "")
      .trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

function isMarkdownListLine(line) {
  return /^(\d+)[.)、]\s+/.test(line) || /^[-*+•·◦]\s+/.test(line);
}

function markdownListType(line) {
  if (/^(\d+)[.)、]\s+/.test(String(line || ""))) return "ordered";
  if (/^[-*+•·◦]\s+/.test(String(line || ""))) return "unordered";
  return "";
}

function splitMarkdownTableRow(line) {
  let value = String(line || "").trim();
  if (!value.includes("|")) return [];
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const cells = [];
  let cell = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && value[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableDelimiter(line, expectedColumns) {
  const cells = splitMarkdownTableRow(line);
  return cells.length === expectedColumns &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function renderMarkdownTable(header, rows, markdownFile) {
  const width = header.length;
  const cellHtml = (tag, value) =>
    `<${tag}>${inlineMarkdownToHtml(String(value || ""), markdownFile) || "&nbsp;"}</${tag}>`;
  const head = `<thead><tr>${header.map((cell) => cellHtml("th", cell)).join("")}</tr></thead>`;
  const body = rows.map((row) => {
    const normalized = Array.from({ length: width }, (_, index) => row[index] || "");
    return `<tr>${normalized.map((cell) => cellHtml("td", cell)).join("")}</tr>`;
  }).join("");
  return `<section data-xhs-block-type="table"><table>${head}<tbody>${body}</tbody></table></section>`;
}

function renderNativeXhsSourceHtml(markdownFile, markdown, title, options = {}) {
  const { body } = prepareMarkdownBody(markdown);
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let quote = [];
  let code = [];
  let inCode = false;
  let headingIndex = 0;
  const headingRanks = resolveHeadingRanks(body, title, options);

  function pushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    const strongStart = text.match(/^(?:\*\*|__)([\s\S]+?)(?:\*\*|__)([\s\S]*)$/);
    const strongOnly = text.match(/^(?:\*\*|__)([\s\S]+?)(?:\*\*|__)$/);
    const strongLabel = plainMarkdownText(strongStart?.[1] || "").replace(/[:：\s]+$/g, "");
    const explicitCardStart = CARD_LABEL_EXACT.test(strongLabel);
    if ((strongOnly || explicitCardStart) && plainMarkdownText(text).length >= 18) {
      const label = inferCardLabel(text);
      blocks.push(`<section data-xhs-block-type="callout" style="border-left:4px solid #57b560;background:#f4faf3;"><strong>${escapeHtml(label)}</strong><p>${inlineMarkdownToHtml(text, markdownFile)}</p></section>`);
      return;
    }
    blocks.push(`<p>${inlineMarkdownToHtml(text, markdownFile)}</p>`);
  }
  function pushList() {
    if (!list.length) return;
    const listType = list[0].type || "unordered";
    const cards = list.map((item, index) => {
      const bodyHtml = inlineMarkdownToHtml(item.text, markdownFile);
      if (listType === "ordered") {
        const marker = String(item.marker || index + 1);
        return `<section><span>${escapeHtml(marker)}.</span><span>${bodyHtml}</span></section>`;
      }
      const marker = '<span style="border-radius:50%;display:inline-block;width:10px;height:10px;background:#57b560;"></span>';
      return `<section>${marker}<span>${bodyHtml}</span></section>`;
    }).join("");
    blocks.push(`<section data-xhs-block-type="list" style="background:#f3f8f1;" data-list-type="${listType}">${cards}</section>`);
    list = [];
  }
  function pushQuote() {
    if (!quote.length) return;
    const quoteLines = quote.slice();
    while (quoteLines.length && !plainMarkdownText(quoteLines[0]).trim()) quoteLines.shift();
    while (quoteLines.length && !plainMarkdownText(quoteLines[quoteLines.length - 1]).trim()) quoteLines.pop();
    const body = quoteLines.map((line) => inlineMarkdownToHtml(line, markdownFile)).join("<br>");
    if (!body) {
      quote = [];
      return;
    }
    blocks.push(`<blockquote data-xhs-block-type="quote" style="border-left:4px solid #d5ded3;">${body}</blockquote>`);
    quote = [];
  }
  function pushCode() {
    if (!code.length) return;
    blocks.push(`<blockquote data-xhs-block-type="quote" style="border-left:4px solid #d5ded3;"><em>${escapeHtml(code.join("\n"))}</em></blockquote>`);
    code = [];
  }
  function flushAll() {
    pushParagraph();
    pushList();
    pushQuote();
    pushCode();
  }
  function peekNextSubstantiveLine(startIndex) {
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const trimmed = String(lines[i] || "").trim();
      if (trimmed) return trimmed;
    }
    return "";
  }
  function lastMarkdownBlockKind() {
    const last = blocks[blocks.length - 1] || "";
    if (!last) return "none";
    if (last.includes("data-xhs-flow-blank")) return "blank";
    if (last.includes("data-xhs-heading-level")) return "heading";
    if (last.includes("data-xhs-block-type=\"list\"")) return "list";
    if (last.includes("data-xhs-block-type=\"table\"")) return "table";
    if (last.includes("data-xhs-page-break")) return "pagebreak";
    if (last.includes("<img")) return "image";
    if (last.includes("data-xhs-block-type=\"callout\"")) return "callout";
    if (last.includes("data-xhs-block-type=\"quote\"")) return "quote";
    if (last.startsWith("<p>")) return "prose";
    if (/<section[^>]*><strong>/.test(last)) return "prose";
    return "other";
  }
  function isMarkdownHeadingLine(text) {
    return /^#{1,6}\s+/.test(String(text || "").trim());
  }
  function upcomingMarkdownLineKind(text) {
    const line = String(text || "").trim();
    if (!line) return "none";
    if (isMarkdownHeadingLine(line)) return "heading";
    if (/^!\[/.test(line)) return "image";
    if (markdownListType(line)) return "list";
    if (/^>\s?/.test(line)) return "quote";
    if (/^`{3}/.test(line)) return "code";
    if (splitMarkdownTableRow(line).length >= 2) return "table";
    const strongOnly = line.match(/^(?:\*\*|__)([\s\S]+?)(?:\*\*|__)$/);
    if (strongOnly && plainMarkdownText(line).length >= 18) return "callout";
    return "prose";
  }
  function shouldInsertMarkdownFlowBlank(upcoming) {
    const last = lastMarkdownBlockKind();
    const next = upcomingMarkdownLineKind(upcoming);
    const structural = new Set(["heading", "list", "image", "table", "quote", "pagebreak", "blank", "none", "other", "code"]);
    if (structural.has(last) || structural.has(next)) return false;
    if (last === "prose" && next === "prose") return true;
    if (last === "callout" && next === "prose") return true;
    return false;
  }
  function pushFlowBlank() {
    const last = blocks[blocks.length - 1] || "";
    if (String(last).includes("data-xhs-flow-blank")) return;
    blocks.push('<p data-xhs-flow-blank="1"><br /></p>');
  }
  function pushImage(alt, src) {
    const cleanSrc = unescapeMarkdownUrl(src);
    if (/\.(?:mp4|mov|m4v|webm|avi|mkv)(?:[?#].*)?$/i.test(cleanSrc)) return;
    blocks.push(`<section><img src="${escapeHtml(resolveMarkdownAsset(cleanSrc, markdownFile))}" alt="${escapeHtml(alt)}" draggable="false" /></section>`);
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      if (inCode) {
        inCode = false;
        pushCode();
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(rawLine);
      continue;
    }
    if (/^<table(?:\s|>)/i.test(line)) {
      flushAll();
      const tableLines = [rawLine];
      while (!/<\/table>\s*$/i.test(tableLines[tableLines.length - 1]) && lineIndex + 1 < lines.length) {
        tableLines.push(lines[++lineIndex]);
      }
      blocks.push(`<section data-xhs-block-type="table">${tableLines.join("\n")}</section>`);
      continue;
    }
    const tableHeader = splitMarkdownTableRow(line);
    const nextLine = String(lines[lineIndex + 1] || "").trim();
    if (tableHeader.length >= 2 && isMarkdownTableDelimiter(nextLine, tableHeader.length)) {
      flushAll();
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const rowLine = String(lines[lineIndex] || "").trim();
        if (!rowLine) break;
        const row = splitMarkdownTableRow(rowLine);
        if (row.length < 2) {
          lineIndex -= 1;
          break;
        }
        rows.push(row);
        lineIndex += 1;
      }
      if (lineIndex >= lines.length || !String(lines[lineIndex] || "").trim()) lineIndex -= 1;
      blocks.push(renderMarkdownTable(tableHeader, rows, markdownFile));
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      blocks.push(`<section data-xhs-page-break="1" aria-hidden="true"></section>`);
      continue;
    }
    if (!line) {
      let upcomingListType = "";
      for (let j = lineIndex + 1; j < lines.length; j += 1) {
        const upcoming = lines[j].trim();
        if (!upcoming) continue;
        upcomingListType = markdownListType(upcoming);
        break;
      }
      if (list.length && upcomingListType && upcomingListType === list[0].type) continue;
      const upcoming = peekNextSubstantiveLine(lineIndex);
      const hadBlocks = blocks.length > 0;
      const hadPending = paragraph.length > 0 || list.length > 0 || quote.length > 0 || code.length > 0;
      flushAll();
      if (!upcoming || !shouldInsertMarkdownFlowBlank(upcoming)) continue;
      if (hadBlocks || hadPending) pushFlowBlank();
      continue;
    }
    const imgOnly = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgOnly) {
      flushAll();
      pushImage(imgOnly[1], imgOnly[2]);
      continue;
    }
    if (isMarkdownVideoLine(line)) {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      // Support closed ATX headings ("## 标题 ##"): a trailing #-run preceded
      // by whitespace is decorative and not part of the title text.
      const text = plainMarkdownText(heading[2].replace(/\s+#+$/, ""));
      // Only skip a heading that duplicates the resolved cover title — never blanket-skip all `#`.
      if (isCoverTitleHeading(text, title)) continue;
      if (headingRanks.introDepth != null && level === headingRanks.introDepth) {
        blocks.push(`<section><strong>${escapeHtml(text)}</strong></section>`);
        continue;
      }
      if (headingRanks.level1 != null && level === headingRanks.level1) {
        const explicit = text.match(/^(\d{1,2})[.、\s]+(.+)$/);
        const number = explicit ? String(Number(explicit[1])).padStart(2, "0") : String(++headingIndex).padStart(2, "0");
        if (explicit) headingIndex = Math.max(headingIndex, Number(explicit[1]));
        const titleText = explicit ? explicit[2].trim() : text;
        blocks.push(`<section data-xhs-heading-level="1" style="border-bottom:1px solid #d9e7d8;"><span>${number}</span><strong>${escapeHtml(titleText)}</strong></section>`);
      } else if (headingRanks.level2 != null && level === headingRanks.level2) {
        blocks.push(`<section data-xhs-heading-level="2"><strong>${escapeHtml(text)}</strong></section>`);
      } else {
        blocks.push(`<section><strong>${escapeHtml(text)}</strong></section>`);
      }
      continue;
    }
    const ordered = line.match(/^(\d+)[.)、]\s+(.+)$/);
    const unordered = line.match(/^[-*+•·◦]\s+(.+)$/);
    const bullet = unordered || ordered;
    if (bullet) {
      pushParagraph();
      pushQuote();
      const nextListType = ordered ? "ordered" : "unordered";
      if (list.length && list[0].type !== nextListType) pushList();
      const rawText = ordered ? ordered[2] : unordered[1];
      list.push(ordered
        ? { type: "ordered", marker: ordered[1], text: stripLeadingListMarkerText(rawText) }
        : { type: "unordered", marker: "", text: stripLeadingListMarkerText(rawText) });
      continue;
    }
    if (/^>\s?/.test(line)) {
      pushParagraph();
      pushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    pushList();
    pushQuote();
    paragraph.push(line);
  }
  flushAll();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <section>${blocks.join("\n")}</section>
</body>
</html>`;
}

function extractWechatContent(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const warnings = [];

  $("video").each((_, video) => {
    const src = $(video).attr("src") || "";
    warnings.push({
      label: path.basename(decodeURIComponent(src || "video")),
      src,
      reason: "小红书图文卡片只放图片，视频已从分页内容中移除。",
    });
    const container = $(video).closest("section");
    if (container.length) container.remove();
    else $(video).remove();
  });

  $("script,style").remove();
  $("img").each((_, img) => {
    $(img).attr("draggable", "false");
  });

  const root = $("body > section").first();
  const contentHtml = root.length ? root.html() : $("body").html();
  const title = $("title").first().text().trim();
  return { contentHtml: contentHtml || "", title, warnings };
}

function extractMarkdownVideoWarnings(markdown) {
  const warnings = [];
  const seen = new Set();
  const videoLinkRe = /!?\[[^\]]*]\(([^)\s]+(?:\.(?:mp4|mov|m4v|webm|avi|mkv))(?:\?[^)]*)?)\)/gi;
  let match;
  while ((match = videoLinkRe.exec(markdown))) {
    const src = match[1].replace(/\\([()])/g, "$1");
    if (seen.has(src)) continue;
    seen.add(src);
    warnings.push({
      label: path.basename(decodeURIComponent(src)),
      src,
      reason: "小红书图文卡片只放图片，Markdown 视频链接已跳过。",
    });
  }
  return warnings;
}

function readBrowserDependency(modulePath) {
  const resolved = require.resolve(modulePath, { paths: [path.resolve(__dirname, "..")] });
  return fs.readFileSync(resolved, "utf8");
}

function studioHtmlV2(payload, libs) {
  const {
    title,
    subtitle,
    contentHtml,
    warnings,
    width,
    height,
    coverSplitY,
    bodyPadX,
    bodyPadTop,
    bodyPadBottom,
    bodyContentWidth,
    bodyContentHeight,
    bodyFontSize,
    bodyLineHeight,
    bodyCharsPerLine = 21,
    headingNumberSize,
    headingTitleSize,
  } = payload;
  const coverPadX = Math.round(width * 0.082);
  const coverPadTop = Math.round(height * 0.066);
  const coverPadBottom = Math.round(height * 0.052);
  const coverGap = Math.round(height * 0.02);
  const coverTailPadTop = Math.max(20, Math.round(bodyPadTop * 0.32));
  const coverNoImagePadBottom = Math.max(18, Math.round(coverPadBottom * 0.36));
  const coverTitleSize = Math.round(width * 0.112);
  const coverSubtitleSize = Math.max(28, Math.round(width * 34 / DEFAULT_WIDTH));
  const imageFrameHeight = Math.round(height * 0.31);
  const calloutBorder = Math.max(5, Math.round(width * 0.006));
  const supportBodySize = Math.max(28, Math.round(34 * width / DEFAULT_WIDTH));
  const calloutLabelSize = Math.max(22, Math.round(bodyFontSize - 10));
  const headingLevel2Size = headingLevel2FontSize(headingTitleSize);
  const imageGridGap = Math.round(width * 0.018);
  const songtiFont = `"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif`;
  const wechatFont = songtiFont;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} - XHS Studio</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      --body-pad-x: ${bodyPadX}px;
      --body-pad-top: ${bodyPadTop}px;
      --body-pad-bottom: ${bodyPadBottom}px;
      --body-content-width: ${bodyContentWidth}px;
      --body-content-height: ${bodyContentHeight}px;
      --body-font: ${bodyFontSize}px;
      --body-line: ${bodyLineHeight};
      --body-line-px: ${Math.round(bodyFontSize * bodyLineHeight * 100) / 100}px;
      --body-text-width: 100%;
      --cover-title-size: ${coverTitleSize}px;
      --cover-subtitle-size: ${coverSubtitleSize}px;
      --xhs-font: ${songtiFont};
      --xhs-shell-bg: #f3f4f2;
      --xhs-card-bg: #ffffff;
      --xhs-accent: #4d7fd2;
      --xhs-accent-strong: #2e5fb2;
      --xhs-accent-soft: rgba(77, 127, 210, .16);
      --xhs-accent-pale: #f5faff;
      --xhs-underline: #b8cbee;
      --xhs-cover-bg: #ffffff;
      --xhs-cover-border: #b8cbee;
      --xhs-cover-placeholder: #8f948d;
    }
    html, body { margin: 0; min-height: 100%; background: var(--xhs-shell-bg); color: #111; }
    body { font-family: var(--xhs-font); letter-spacing: 0; }
    button, input { font: inherit; border: 1px solid #cfd8df; border-radius: 8px; background: #fff; color: #17202a; }
    button { padding: 9px 12px; font-weight: 760; cursor: pointer; }
    button.primary { background: var(--xhs-accent-strong); color: #fff; border-color: var(--xhs-accent-strong); }
    button.dark, button.active { background: #17202a; color: #fff; border-color: #17202a; }
    input[type="range"] { width: 100%; accent-color: var(--xhs-accent-strong); }
    .app { display: grid; grid-template-columns: 1fr 320px; min-height: 100vh; }
    .main { padding: 20px; overflow: auto; }
    .toolbar { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; margin: 0 0 14px; }
    .notice { max-width: 760px; margin: 0 auto 14px; padding: 11px 14px; border: 1px solid #f4c78b; border-radius: 10px; background: #fff7e8; color: #7a4a12; font-size: 13px; line-height: 1.55; font-weight: 700; }
    .notice.runtime-notice { border-color: #9ec5fe; background: #eef6ff; color: #174a7a; }
    .page-tabs { display: flex; gap: 7px; justify-content: center; flex-wrap: wrap; margin: 0 0 16px; }
    .page-tabs button { min-width: 42px; padding: 8px 10px; }
    .stage-wrap { width: min(70vw, 620px); aspect-ratio: ${width} / ${height}; position: relative; margin: 0 auto 24px; }
    .stage-scale { position: absolute; left: 0; top: 0; transform-origin: top left; width: ${width}px; height: ${height}px; }
    .xhs-card { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background-color: var(--xhs-card-bg); background-image: var(--xhs-paper-pattern, none); background-size: var(--xhs-paper-size, auto); color: #111; letter-spacing: 0; box-shadow: 0 26px 90px rgba(20, 24, 30, .18); }
    .cover-media { position: absolute; left: 0; top: 0; width: 100%; height: ${coverSplitY}px; background-color: var(--xhs-cover-bg); background-image: var(--xhs-paper-pattern, none); background-size: var(--xhs-paper-size, auto); }
    .cover-image-frame { position: relative; width: 100%; height: 100%; overflow: hidden; background-color: var(--xhs-cover-bg); background-image: var(--xhs-paper-pattern, none); background-size: var(--xhs-paper-size, auto); cursor: grab; touch-action: none; }
    .cover-image-frame img, .xhs-image-frame img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: 50% 50%; transform: translate(0px, 0px) scale(1); transform-origin: center center; user-select: none; -webkit-user-drag: none; }
    .cover-placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: var(--xhs-cover-placeholder); font-size: 34px; font-weight: 850; border: 3px dashed var(--xhs-cover-border); }
    .cover-text { position: absolute; left: 0; top: ${coverSplitY}px; width: 100%; height: ${height - coverSplitY}px; padding: ${coverPadTop}px ${coverPadX}px ${coverPadBottom}px; background-color: var(--xhs-card-bg); background-image: var(--xhs-paper-pattern, none); background-size: var(--xhs-paper-size, auto); display: flex; flex-direction: column; gap: ${coverGap}px; box-sizing: border-box; }
    .cover-title { flex: 0 1 auto; min-height: 0; width: 100%; color: #111; font-family: var(--xhs-font); font-size: var(--cover-title-size); line-height: 1.1; font-weight: 900; word-break: normal; overflow-wrap: break-word; letter-spacing: 0; outline: none; }
    .cover-title *, .cover-title strong, .cover-title b, .cover-title .xhs-cover-bold { font-family: inherit !important; font-size: inherit !important; line-height: inherit !important; letter-spacing: inherit !important; }
    .cover-title strong, .cover-title b, .cover-title .xhs-cover-bold { font-weight: 900 !important; }
    .cover-title-bar { flex: 0 0 auto; width: ${Math.round(width * 0.12)}px; height: ${Math.max(5, Math.round(width * 0.005))}px; background: var(--xhs-accent); border-radius: 999px; margin: ${Math.round(height * 0.006)}px 0 ${Math.round(height * 0.014)}px; }
    .xhs-cover-card.no-cover-image .cover-media { display: none; }
    .xhs-cover-card.no-cover-image .cover-text { top: 0; height: ${coverSplitY}px; padding-bottom: ${coverNoImagePadBottom}px; z-index: 2; justify-content: flex-start; }
    .cover-subtitle { flex: 0 0 auto; display: block; position: relative; box-sizing: border-box; width: 100%; max-width: none; max-height: calc(1.62em * 2); overflow: hidden; padding-left: ${Math.max(5, Math.round(width * 0.006)) + Math.round(width * 0.022)}px; color: #111; font-family: var(--xhs-font); font-size: var(--cover-subtitle-size); line-height: 1.62; font-weight: 650; word-break: normal; overflow-wrap: anywhere; outline: none; letter-spacing: 2px; font-kerning: normal; text-rendering: geometricPrecision; }
    .cover-subtitle * { font-size: inherit !important; line-height: inherit !important; letter-spacing: inherit; }
    .cover-subtitle strong, .cover-subtitle b, .cover-subtitle .xhs-cover-bold { font-weight: 900 !important; }
    .cover-subtitle::before { content: ""; position: absolute; left: 0; top: 50%; width: ${Math.max(5, Math.round(width * 0.006))}px; height: 1.08em; transform: translateY(-50%); background: var(--xhs-accent); border-radius: 999px; pointer-events: none; }
    .cover-subtitle:empty::after { content: attr(data-placeholder); color: #8f948d; letter-spacing: 0; pointer-events: none; }
    .xhs-page-break { height: 0; margin: 0; padding: 0; border: 0; overflow: hidden; visibility: hidden; break-inside: avoid; page-break-inside: avoid; }
    .xhs-body-frame > .xhs-page-break + .xhs-page-break { display: none; }
    .xhs-body-frame { position: absolute; left: var(--body-pad-x); top: var(--body-pad-top); width: var(--body-content-width); height: var(--body-content-height); overflow: hidden; outline: none; background: transparent; font-family: var(--xhs-font); -webkit-font-smoothing: antialiased; }
    .xhs-card .xhs-body-frame.xhs-cover-tail-frame { top: ${coverSplitY}px; left: var(--body-pad-x); width: var(--body-content-width); height: ${height - coverSplitY}px; padding-top: ${coverTailPadTop}px; padding-bottom: ${bodyPadBottom}px; box-sizing: border-box; z-index: 1; }
    .xhs-cover-card:not(.no-cover-image) .xhs-cover-tail-frame { display: none; }
    .xhs-block { width: 100%; }
    .xhs-body-frame > div { min-height: 1.8em; color: #111; font-size: var(--body-font); line-height: var(--body-line); word-break: normal; overflow-wrap: break-word; }
    .xhs-p { margin: 0 0 0.88em; max-width: var(--body-text-width); color: #111; font-size: var(--body-font) !important; line-height: var(--body-line); font-weight: 720; text-align: left; text-align-last: left; text-justify: auto; word-break: normal; overflow-wrap: break-word; letter-spacing: 0 !important; overflow: hidden; }
    .xhs-manual-blank { min-height: calc(var(--body-font) * var(--body-line)); }
    .xhs-caret-marker { display: inline-block !important; width: 0 !important; height: 0 !important; min-height: 0 !important; overflow: hidden !important; padding: 0 !important; margin: 0 !important; line-height: 0 !important; }
    .xhs-caret-anchor { height: 1px !important; min-height: 1px !important; margin: -0.5px 0 !important; padding: 0 !important; font-size: 0 !important; line-height: 0 !important; overflow: visible; opacity: 0; cursor: text; transition: opacity 0.15s; position: relative; }
    .xhs-caret-anchor:hover { opacity: 1; }
    .xhs-caret-anchor::before { content: ''; position: absolute; left: 10%; right: 10%; top: -8px; height: 16px; border-top: 1.5px dashed var(--xhs-accent, #5fa66a); opacity: 0.55; pointer-events: auto; }
    .xhs-block-halo { position: absolute; pointer-events: none; z-index: 200; }
    .xhs-block-halo-btn { position: absolute; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: var(--xhs-accent, #5fa66a); color: #fff; border: none; cursor: pointer; font-size: 16px; line-height: 22px; text-align: center; padding: 0; pointer-events: all; opacity: 0.82; box-shadow: 0 2px 6px rgba(0,0,0,.18); transition: opacity 0.15s, transform 0.1s; }
    .xhs-block-halo-btn:hover { opacity: 1; transform: translateX(-50%) scale(1.12); }
    .xhs-block-halo-btn.halo-before { top: -11px; }
    .xhs-block-halo-btn.halo-after { bottom: -11px; }
    .xhs-block-halo-btn.halo-remove { display: none; background: #738078; }
    .xhs-p span, .xhs-callout span, .xhs-quote span, .xhs-rich span, .xhs-list-line span { font-family: inherit !important; font-size: inherit !important; line-height: inherit !important; letter-spacing: 0 !important; }
    .xhs-card code { font-family: inherit !important; font-size: inherit !important; font-weight: inherit; font-style: inherit; line-height: inherit !important; letter-spacing: inherit !important; color: inherit; background: none; }
    .xhs-heading { margin: 0 0 ${Math.round(width * 0.03) + 2}px; padding: 0 0 ${Math.round(width * 0.014)}px; border-bottom: 1px solid var(--xhs-underline); display: flex; column-gap: 0; align-items: center; font-family: var(--xhs-font); overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
    .xhs-heading[contenteditable="false"] { outline: none; }
    .xhs-heading-number { flex: 0 0 ${Math.round(headingNumberSize * 1.16)}px; width: ${Math.round(headingNumberSize * 1.16)}px; display: flex; align-items: center; color: var(--xhs-underline); font-size: ${headingNumberSize}px; line-height: 1; font-weight: 950; font-style: italic; white-space: nowrap; }
    .xhs-heading-space { display: none; }
    .xhs-heading-title { flex: 1 1 auto; min-width: 0; margin-left: 7px; color: #111; font-size: ${headingTitleSize}px; line-height: 1.16; font-weight: 900; word-break: normal; overflow-wrap: break-word; white-space: pre-wrap; }
    .xhs-heading[data-level="2"] { display: block; margin: 0.62em 0 ${HEADING_LEVEL2_MARGIN_BOTTOM_PX}px; padding: 0; border-bottom: 0; }
    .xhs-heading[data-level="2"] .xhs-heading-title { display: inline; flex: none; margin-left: 0; color: var(--xhs-accent-strong); font-size: ${headingLevel2Size}px; line-height: 1.5; font-weight: 800; background: none; padding: 0 1px; border-bottom: 2px solid var(--xhs-underline); border-radius: 0; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .xhs-callout { margin: 0 0 0.78em; padding: 0.72em 0.84em 0.74em; background: var(--xhs-accent-pale); border-left: ${calloutBorder}px solid var(--xhs-accent); border-radius: 0 10px 10px 0; font-family: var(--xhs-font); font-size: var(--body-font); line-height: var(--body-line); overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
    .xhs-callout-label { margin: 0 0 0.42em; color: var(--xhs-accent-strong); font-size: ${calloutLabelSize}px; line-height: 1.2; font-weight: 900; }
    .xhs-callout-body { max-width: var(--body-text-width); color: #111; font-size: ${supportBodySize}px; line-height: 1.76; font-weight: 760; text-align: left; text-align-last: left; text-justify: auto; word-break: normal; overflow-wrap: break-word; letter-spacing: 0; overflow: hidden; }
    .xhs-callout.xhs-card-frame { border-left: 0; border: 1.5px solid var(--xhs-underline); border-radius: 8px; background: var(--xhs-accent-pale); padding: 0.78em 0.9em; }
    .xhs-callout.xhs-card-frame .xhs-callout-label { color: var(--xhs-accent-strong); }
    .xhs-callout.xhs-card-frame .xhs-callout-body { color: #000; font-weight: 720; }
    .xhs-quote { margin: 0 0 0.98em; max-width: var(--body-text-width); padding: 0.62em 0.68em; border-left: ${Math.max(4, Math.round(width * 0.005))}px solid #d5ded3; background: #fbfbfb; color: #303832; font-size: ${supportBodySize}px; line-height: var(--body-line); font-style: italic; font-weight: 650; text-align: left; text-align-last: left; text-justify: auto; word-break: normal; overflow-wrap: break-word; letter-spacing: 0; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
    .xhs-image-block { margin: 0 auto 1.1em; width: 100%; max-width: 100%; text-align: center; break-inside: avoid; page-break-inside: avoid; }
    .xhs-image-frame { position: relative; width: 100%; min-height: 80px; height: ${imageFrameHeight}px; overflow: hidden; resize: none; border: 1px solid #e1e8df; border-radius: 0; background: #fff; cursor: grab; touch-action: none; }
    .xhs-resize-handle { position: absolute; z-index: 8; display: none; background: #2563eb; border: 3px solid #fff; box-shadow: 0 2px 9px rgba(37, 99, 235, .34); opacity: .96; }
    .selected-image-frame .xhs-resize-handle { display: block; }
    .xhs-resize-handle.handle-e { right: 4px; top: 50%; width: 14px; height: 58px; transform: translateY(-50%); border-radius: 999px; cursor: ew-resize; }
    .xhs-resize-handle.handle-s { left: 50%; bottom: 4px; width: 58px; height: 14px; transform: translateX(-50%); border-radius: 999px; cursor: ns-resize; }
    .xhs-resize-handle.handle-se { right: 4px; bottom: 4px; width: 22px; height: 22px; border-radius: 4px; cursor: nwse-resize; }
    .resizing-image-frame { cursor: nwse-resize; }
    .xhs-image-grid { display: grid; gap: ${imageGridGap}px; margin: 0 0 1.1em; align-items: start; justify-items: center; text-align: center; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
    .xhs-image-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .xhs-image-grid.three, .xhs-image-grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .xhs-image-grid .xhs-image-block { margin: 0 auto; }
    .selectable-image.dragging { cursor: grabbing; }
    .xhs-image-block.reorder-dragging, .xhs-image-grid.reorder-dragging, .xhs-callout.reorder-dragging, .xhs-quote.reorder-dragging, .xhs-list-line.reorder-dragging, .xhs-table-block.reorder-dragging { opacity: .72; outline: 3px dashed var(--xhs-accent); outline-offset: 4px; }
    .selected-flow-block { outline: 4px solid rgba(37, 99, 235, .58); outline-offset: 4px; }
    .xhs-drop-indicator { position: absolute; left: var(--body-pad-x); width: var(--body-content-width); height: 4px; background: var(--xhs-accent); border-radius: 999px; pointer-events: none; z-index: 220; box-shadow: 0 0 0 2px rgba(255,255,255,.9); }
    .xhs-list-line { display: flex; flex-direction: row; align-items: flex-start; gap: 0.18em; margin: 0 0 0.42em; max-width: var(--body-text-width); color: #111; font-size: var(--body-font); line-height: var(--body-line); font-weight: 720; overflow: visible; }
    .xhs-list-line .xhs-list-marker { flex: 0 0 0.72em; width: 0.72em; flex-shrink: 0; user-select: none; pointer-events: none; line-height: inherit; font-size: 0.8em !important; }
    .xhs-list-line .xhs-list-marker-ordered { flex-basis: 1.16em; width: 1.16em; height: var(--body-line-px); color: var(--xhs-accent-strong); font-weight: 900; text-align: right; white-space: nowrap; display: flex; align-items: center; justify-content: flex-end; font-size: calc(0.8em + 2px) !important; line-height: 1 !important; }
    .xhs-list-marker-dot::before { content: ''; display: inline-block; width: 0.42em; height: 0.42em; margin-top: 0.58em; border-radius: 50%; background: var(--xhs-accent); }
    .xhs-list-body { flex: 1 1 auto; min-width: 0; max-width: var(--body-text-width); text-align: left; text-align-last: left; text-justify: auto; word-break: normal; overflow-wrap: break-word; letter-spacing: 0; }
    .xhs-list-body span { font-family: inherit !important; font-size: inherit !important; line-height: inherit !important; letter-spacing: 0 !important; }
    .xhs-table-block { margin: 0 0 1.02em; width: 100%; max-width: var(--body-text-width); overflow: hidden; font-family: var(--xhs-font); break-inside: avoid; page-break-inside: avoid; }
    .xhs-table { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; color: #111; font-size: ${Math.max(24, Math.round(bodyFontSize * 0.75))}px; line-height: 1.48; }
    .xhs-table th, .xhs-table td { padding: 0.58em 0.62em; text-align: left; vertical-align: top; word-break: normal; overflow-wrap: anywhere; letter-spacing: 0; }
    .xhs-table thead th { background: var(--xhs-accent-pale); color: var(--xhs-accent-strong); font-weight: 900; border-top: 1.5px solid var(--xhs-accent); border-bottom: 1.5px solid var(--xhs-accent); }
    .xhs-table tbody td { background: #fff; border-bottom: 1px dashed #d5ded3; font-weight: 700; }
    .xhs-table tbody tr:last-child td { border-bottom: 2px solid var(--xhs-underline); }
    .xhs-table strong, .xhs-table b { font-weight: 900; }
    .xhs-table em { font-style: italic; }
    .xhs-rich { margin: 0 0 0.92em; max-width: var(--body-text-width); color: #111; font-size: var(--body-font); line-height: var(--body-line); font-weight: 720; text-align: left; text-align-last: left; text-justify: auto; word-break: normal; overflow-wrap: break-word; letter-spacing: 0; overflow: hidden; }
    .xhs-green-text { color: var(--xhs-accent-strong); font-weight: inherit; }
    .xhs-green-underline { font-weight: inherit; color:#111; background: linear-gradient(to top, var(--xhs-accent-soft) 0 46%, transparent 46% 100%); padding:0 2px; border-bottom:1px solid var(--xhs-underline); border-radius:2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .xhs-split-head { margin-bottom: 0 !important; }
    .xhs-p.xhs-split-tail, .xhs-rich.xhs-split-tail { margin-top: 0 !important; }
    .xhs-callout.xhs-split-tail { padding-top: 0.72em; }
    .xhs-rich img { max-width: 100%; height: auto; }
    .selected-image-frame { outline: 5px solid rgba(37, 99, 235, .92); outline-offset: 5px; }
    .measure { position: fixed; left: -20000px; top: 0; width: var(--body-content-width); visibility: hidden; pointer-events: none; background: #fff; font-family: var(--xhs-font); }
    .source, template { display: none; }
    .panel { background: #fff; border-left: 1px solid #d8e0e8; padding: 18px; max-height: 100vh; overflow: auto; position: sticky; top: 0; }
    .panel h2 { margin: 0 0 12px; font-size: 18px; }
    .hint { margin: 0 0 14px; color: #667085; font-size: 12px; line-height: 1.65; }
    .tool-group { display: grid; gap: 10px; margin: 0 0 16px; padding: 12px; border: 1px solid #e1e7df; border-radius: 8px; background: #fbfcfb; }
    .tool-group[hidden] { display: none; }
    .tool-label { display: grid; gap: 5px; color: #4b5563; font-size: 12px; font-weight: 750; }
    .tool-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .theme-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tool-title { margin: 0; color: #4b5563; font-size: 12px; font-weight: 850; }
    .image-list { display: grid; gap: 8px; }
    .image-list button { text-align: left; font-size: 12px; padding: 8px 9px; font-weight: 650; }
    .export-root { position: fixed; left: -20000px; top: 0; width: ${width}px; height: ${height}px; pointer-events: none; }
    .export-root .xhs-resize-handle, .measure .xhs-resize-handle { display: none !important; }
    @media (max-width: 980px) {
      .app { grid-template-columns: 1fr; }
      .panel { max-height: none; border-left: 0; border-top: 1px solid #d8e0e8; position: relative; }
      .stage-wrap { width: min(92vw, 620px); }
    }
  </style>
</head>
<body>
  <div class="app">
    <main class="main">
      ${warnings.length ? `<div class="notice">原稿里有 ${warnings.length} 个视频链接。小红书图文卡片这里只放图片，视频已跳过；需要视频请在小红书发布页单独上传，或先截帧/转图片再放入卡片。</div>` : ""}
      <div id="runtimeNotice" class="notice runtime-notice" hidden></div>
      <div class="toolbar">
        <button id="boldBtn" class="dark">B 加粗</button>
        <button id="headingBtn1">一级标题</button>
        <button id="headingBtn2">二级标题</button>
        <button id="italicBtn">引用块</button>
        <button id="greenTextBtn">有色字</button>
        <button id="greenUnderlineBtn">下划线</button>
        <button id="keypointBtn">卡片</button>
        <button id="listBtn">序列</button>
        <button id="saveHtmlBtn">保存编辑 HTML</button>
        <button id="exportBtn" class="primary">批量导出 PNG ZIP</button>
        <button id="resetBtn" title="清除当前编辑，恢复生成时的初始内容">一键复原</button>
      </div>
      <div id="pageTabs" class="page-tabs"></div>
      <div id="stageWrap" class="stage-wrap"><div id="stageScale" class="stage-scale"></div></div>
    </main>
    <aside class="panel">
      <h2>小兔Q彬 · 飞书转小红书</h2>
      <p class="hint">飞书导出的 Markdown 与附件自动分页为 3:4 图文。图纸 / 背景色 / 强调色可自由组合。按住 Alt 拖动可移动卡片、引用块、序列、图片等块。</p>
      <div id="pageInfo" class="hint"></div>
      <div id="coverTools" class="tool-group" hidden>
        <p class="tool-title">封面图</p>
        <div class="tool-row">
          <button id="coverImageOnBtn" class="active">显示封面图</button>
          <button id="coverImageOffBtn">关闭封面图</button>
        </div>
        <p class="hint">关闭后标题区上移占上半页，下半页自动接续正文内容。</p>
      </div>
      <div id="cardStyleTools" class="tool-group" hidden>
        <p class="tool-title">卡片样式</p>
        <div class="theme-grid">
          <button data-card-style="bar" class="active">竖边</button>
          <button data-card-style="frame">细框</button>
        </div>
      </div>
      <div id="themeTools" class="tool-group">
        <p class="tool-title">图纸背景</p>
        <div class="theme-grid">
          <button data-paper-pattern="none" class="active">无</button>
          <button data-paper-pattern="grid">方格纸</button>
          <button data-paper-pattern="dot">点阵纸</button>
          <button data-paper-pattern="ruled">横线纸</button>
          <button data-paper-pattern="blueprint">蓝图格</button>
        </div>
        <p class="tool-title">背景主题</p>
        <div class="theme-grid">
          <button data-bg-theme="white" class="active">纯白</button>
          <button data-bg-theme="paper">米白</button>
          <button data-bg-theme="mint">薄荷</button>
          <button data-bg-theme="gray">浅灰</button>
          <button data-bg-theme="sand">煎黄</button>
          <button data-bg-theme="blue">浅蓝</button>
        </div>
        <p class="tool-title">强调色</p>
        <div class="theme-grid">
          <button data-accent-theme="blue" class="active">知蓝</button>
          <button data-accent-theme="green">翠绿</button>
          <button data-accent-theme="pink">莓粉</button>
          <button data-accent-theme="teal">青缎</button>
          <button data-accent-theme="orange">活力橙</button>
          <button data-accent-theme="purple">雾紫</button>
        </div>
        <div id="coverThemeTools">
          <p class="tool-title">封面占位色</p>
          <div class="theme-grid">
            <button data-cover-theme="background" class="active">跟背景</button>
            <button data-cover-theme="accent">跟强调</button>
            <button data-cover-theme="dark">深色</button>
          </div>
        </div>
      </div>
      <div id="layoutTools" class="tool-group" hidden>
        <div class="tool-row">
          <button id="fontWechatBtn">宋体固定</button>
          <button id="fontSongtiBtn" class="active">宋体固定</button>
        </div>
        <label class="tool-label">封面标题字号 <input id="coverTitleRange" type="range" min="70" max="150" value="${coverTitleSize}" /></label>
        <label class="tool-label">正文字号 <input id="bodyFontRange" type="range" min="30" max="46" value="${bodyFontSize}" /></label>
        <label class="tool-label">正文行距 <input id="bodyLineRange" type="range" min="145" max="210" value="${Math.round(bodyLineHeight * 100)}" /></label>
        <label class="tool-label">左右边距 <input id="bodyPadXRange" type="range" min="48" max="120" value="${bodyPadX}" /></label>
        <label class="tool-label">上下边距 <input id="bodyPadYRange" type="range" min="48" max="130" value="${bodyPadTop}" /></label>
      </div>
      <div id="imageTools" class="tool-group" hidden>
        <div class="tool-row">
          <button id="fitContainBtn">完整显示</button>
          <button id="fitCoverBtn">裁剪填满</button>
        </div>
        <div class="tool-row">
          <button id="imageMoveUpBtn">上移</button>
          <button id="imageMoveDownBtn">下移</button>
        </div>
        <div class="tool-row">
          <button id="imagePairPrevBtn">和前图并排</button>
          <button id="imagePairNextBtn">和后图并排</button>
        </div>
        <button id="imageSplitGridBtn">拆成上下排列</button>
        <label id="widthControl" class="tool-label">图片框宽度 <input id="imageWidthRange" type="range" min="35" max="160" value="100" /></label>
        <label id="heightControl" class="tool-label">图片框高度 <input id="imageHeightRange" type="range" min="90" max="${Math.round(height * 1.4)}" value="${imageFrameHeight}" /></label>
        <label class="tool-label">图片缩放 <input id="imageZoomRange" type="range" min="10" max="1000" value="100" /></label>
        <label class="tool-label">左右裁剪中心 <input id="imageXRange" type="range" min="-1000" max="1100" value="50" /></label>
        <label class="tool-label">上下裁剪中心 <input id="imageYRange" type="range" min="-1000" max="1100" value="50" /></label>
        <p class="hint">图片框内拖动是裁剪位置；按住 Alt 再拖动可上下移动各类块。</p>
      </div>
      <div id="imageList" class="image-list"></div>
    </aside>
  </div>
  <input id="imageInput" type="file" accept="image/*" style="display:none" />
  <template id="wechatTemplate">${contentHtml}</template>
  <div id="measure" class="measure"></div>
  <div id="exportRoot" class="export-root"></div>
  <script>${libs.html2canvas}</script>
  <script>${libs.jszip}</script>
  <script>
    const config = ${escapeJsonForScript({
      version: VERSION,
      title,
      subtitle,
      width,
      height,
      coverSplitY,
      coverZoneHeight: height - coverSplitY,
      coverGap,
      coverPadTop,
      coverPadBottom,
      coverTailPadTop,
      coverSubtitleMaxChars: 48,
      coverTailLimit: Math.max(240, height - coverSplitY - coverTailPadTop - bodyPadBottom),
      pageLimit: bodyContentHeight,
      imageFrameHeight,
      bodyPadX,
      bodyPadTop,
      bodyPadBottom,
      bodyFontSize,
      bodyLineHeight,
      bodyCharsPerLine,
      bodyContentWidth,
      bodyContentHeight,
      coverTitleSize,
      coverSubtitleSize,
      headingTitleSize,
      wechatFont,
      songtiFont,
      warnings,
      sourceFingerprint: payload.sourceFingerprint || "",
      sourcePath: payload.sourcePath || "",
    })};
    const initialLayout = Object.freeze({
      coverTitleSize: config.coverTitleSize,
      bodyFontSize: config.bodyFontSize,
      bodyLineHeight: config.bodyLineHeight,
      bodyPadX: config.bodyPadX,
      bodyPadTop: config.bodyPadTop,
    });
    const embeddedState = /* XHS_EMBEDDED_STATE */ null;
    let pages = [];
    let pageIndex = 0;
    let selectedFrame = null;
    let selectedFlowBlock = null;
    let coverImageEnabled = true;
    let blockReorderDrag = null;
    let blockDropIndicator = null;
    let reflowTimer = null;
    let reflowForcePending = false;
    let lightSaveTimer = null;
    let headingNormalizeTimer = null;
    let compositionFinishTimer = null;
    let isComposingText = false;
    let compositionNeedsReflow = false;
    let layoutReflowTimer = null;
    let imageReflowTimer = null;
    let splitFlowCounter = 0;
    let imageIdCounter = 0;
    let caretMarkerCounter = 0;
    let manualBlankDeleteKeydownHandled = false;
    let manualBlankDeleteKeydownTimer = null;
    let paragraphEnterKeydownHandled = false;
    let paragraphEnterKeydownTimer = null;
    const boundFrames = new WeakSet();
    const imageResizeObserver = window.ResizeObserver ? new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const frame = entry.target;
        if (!frame.classList.contains('xhs-image-frame') || frame.classList.contains('cover-image-frame')) return;
        if (frame.dataset.resizing === '1') return;
        const height = Math.round(entry.contentRect.height);
        if (!height || frame.dataset.lastObservedHeight === String(height)) return;
        frame.dataset.lastObservedHeight = String(height);
        if (frame.dataset.userHeight !== '1') {
          frame.dataset.userHeight = '1';
          frame.style.height = height + 'px';
          scheduleImageLayoutReflow(620);
        }
      });
    }) : null;
    const measure = document.getElementById('measure');
    const stageWrap = document.getElementById('stageWrap');
    const stageScale = document.getElementById('stageScale');
    const pageTabs = document.getElementById('pageTabs');
    const pageInfo = document.getElementById('pageInfo');
    const runtimeNotice = document.getElementById('runtimeNotice');
    const imageList = document.getElementById('imageList');
    const imageTools = document.getElementById('imageTools');
    const imageInput = document.getElementById('imageInput');
    const exportRoot = document.getElementById('exportRoot');
    const fitContainBtn = document.getElementById('fitContainBtn');
    const fitCoverBtn = document.getElementById('fitCoverBtn');
    const italicBtn = document.getElementById('italicBtn');
    const headingBtn1 = document.getElementById('headingBtn1');
    const headingBtn2 = document.getElementById('headingBtn2');
    const greenTextBtn = document.getElementById('greenTextBtn');
    const greenUnderlineBtn = document.getElementById('greenUnderlineBtn');
    const keypointBtn = document.getElementById('keypointBtn');
    const listBtn = document.getElementById('listBtn');
    const coverTools = document.getElementById('coverTools');
    const coverThemeTools = document.getElementById('coverThemeTools');
    const cardStyleTools = document.getElementById('cardStyleTools');
    const coverImageOnBtn = document.getElementById('coverImageOnBtn');
    const coverImageOffBtn = document.getElementById('coverImageOffBtn');
    const bgThemeButtons = Array.from(document.querySelectorAll('[data-bg-theme]'));
    const accentThemeButtons = Array.from(document.querySelectorAll('[data-accent-theme]'));
    const coverThemeButtons = Array.from(document.querySelectorAll('[data-cover-theme]'));
    const paperPatternButtons = Array.from(document.querySelectorAll('[data-paper-pattern]'));
    const cardStyleButtons = Array.from(document.querySelectorAll('[data-card-style]'));
    const fontWechatBtn = document.getElementById('fontWechatBtn');
    const fontSongtiBtn = document.getElementById('fontSongtiBtn');
    const coverTitleRange = document.getElementById('coverTitleRange');
    const bodyFontRange = document.getElementById('bodyFontRange');
    const bodyLineRange = document.getElementById('bodyLineRange');
    const bodyPadXRange = document.getElementById('bodyPadXRange');
    const bodyPadYRange = document.getElementById('bodyPadYRange');
    const imageWidthRange = document.getElementById('imageWidthRange');
    const imageHeightRange = document.getElementById('imageHeightRange');
    const imageZoomRange = document.getElementById('imageZoomRange');
    const imageXRange = document.getElementById('imageXRange');
    const imageYRange = document.getElementById('imageYRange');
    const imageMoveUpBtn = document.getElementById('imageMoveUpBtn');
    const imageMoveDownBtn = document.getElementById('imageMoveDownBtn');
    const imagePairPrevBtn = document.getElementById('imagePairPrevBtn');
    const imagePairNextBtn = document.getElementById('imagePairNextBtn');
    const imageSplitGridBtn = document.getElementById('imageSplitGridBtn');
    const widthControl = document.getElementById('widthControl');
    const heightControl = document.getElementById('heightControl');
    const BG_THEMES = {
      paper: { shell: '#f1f4ef', card: '#fffdf8' },
      white: { shell: '#f3f4f2', card: '#ffffff' },
      mint: { shell: '#eef5ef', card: '#fbfff9' },
      gray: { shell: '#eff1ef', card: '#fbfbfa' },
      sand: { shell: '#f5f1e8', card: '#fffaf0' },
      blue: { shell: '#eef3f6', card: '#fbfdff' },
    };
    const ACCENT_THEMES = {
      green: { accent: '#5fa66a', strong: '#2f7d3b', soft: 'rgba(95,166,106,.18)', pale: '#f4faf3', underline: '#b8ddb4' },
      blue: { accent: '#4d7fd2', strong: '#2e5fb2', soft: 'rgba(77,127,210,.16)', pale: '#f5faff', underline: '#b8cbee' },
      pink: { accent: '#d7789b', strong: '#b94f76', soft: 'rgba(215,120,155,.16)', pale: '#fff5f8', underline: '#efbfd0' },
      teal: { accent: '#47a69e', strong: '#227a73', soft: 'rgba(71,166,158,.16)', pale: '#f1fbf9', underline: '#abdcd6' },
      orange: { accent: '#d99542', strong: '#b66b18', soft: 'rgba(217,149,66,.16)', pale: '#fff8ec', underline: '#edcea3' },
      purple: { accent: '#9676d8', strong: '#6d4ab3', soft: 'rgba(150,118,216,.16)', pale: '#f8f5ff', underline: '#cfbfef' },
    };
    const DEFAULT_BG_THEME = '${DEFAULT_BG_THEME}';
    const DEFAULT_ACCENT_THEME = '${DEFAULT_ACCENT_THEME}';
    let currentBgTheme = DEFAULT_BG_THEME;
    let currentAccentTheme = DEFAULT_ACCENT_THEME;
    let currentCoverTheme = 'background';
    let currentPaperPattern = 'none';
    let currentCardStyle = 'bar';
    function paperPatternSpec(key) {
      const line = Math.max(28, Math.round((config.bodyFontSize || 36) * (config.bodyLineHeight || 1.74)));
      switch (key) {
        case 'grid':
          return {
            pattern: 'linear-gradient(rgba(30,41,59,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(30,41,59,.07) 1px, transparent 1px)',
            size: line + 'px ' + line + 'px',
          };
        case 'dot':
          return {
            pattern: 'radial-gradient(circle, rgba(30,41,59,.14) 1px, transparent 1.4px)',
            size: '22px 22px',
          };
        case 'ruled':
          return {
            pattern: 'linear-gradient(rgba(30,41,59,.09) 1px, transparent 1px)',
            size: '100% ' + line + 'px',
          };
        case 'blueprint':
          return {
            pattern: 'linear-gradient(rgba(147,197,253,.42) 1px, transparent 1px), linear-gradient(90deg, rgba(147,197,253,.42) 1px, transparent 1px)',
            size: '40px 40px',
          };
        default:
          return { pattern: 'none', size: 'auto' };
      }
    }
    function syncPaperPatternUi() {
      paperPatternButtons.forEach((button) => button.classList.toggle('active', button.dataset.paperPattern === currentPaperPattern));
      syncCardStyleUi();
    }
    function syncCardStyleUi() {
      const selectedCard = selectedFlowBlock?.classList?.contains('xhs-callout') ? selectedFlowBlock : null;
      const style = selectedCard
        ? (selectedCard.classList.contains('xhs-card-frame') ? 'frame' : 'bar')
        : currentCardStyle;
      cardStyleButtons.forEach((button) => button.classList.toggle('active', button.dataset.cardStyle === style));
    }
    function applyCardStyle(key, shouldSave = true) {
      currentCardStyle = key === 'frame' ? 'frame' : 'bar';
      const selectedCard = selectedFlowBlock?.classList?.contains('xhs-callout') && stageScale.contains(selectedFlowBlock)
        ? selectedFlowBlock
        : null;
      if (selectedCard) selectedCard.classList.toggle('xhs-card-frame', currentCardStyle === 'frame');
      syncCardStyleUi();
      if (shouldSave) saveCurrentPage();
    }
    function applyPaperPattern(key, shouldSave = true) {
      if (!['none', 'grid', 'dot', 'ruled', 'blueprint'].includes(key)) key = 'none';
      currentPaperPattern = key;
      const spec = paperPatternSpec(key);
      const root = document.documentElement.style;
      root.setProperty('--xhs-paper-pattern', spec.pattern);
      root.setProperty('--xhs-paper-size', spec.size);
      if (key === 'blueprint' && currentBgTheme !== 'blue') applyBackgroundTheme('blue', false);
      syncPaperPatternUi();
      if (shouldSave) saveCurrentPage();
    }

    function esc(value) {
      return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function cleanText(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim();
    }
    function inferCardLabel(text) {
      const plain = cleanText(text).replace(/\\s+/g, '');
      if (!plain) return '卡片';
      if (/注意|小心|切记|务必|千万|别忘|警告|风险|提醒/.test(plain)) return '注意';
      if (/结论|总之|归根|一句话|所以|这就是/.test(plain)) return '结论';
      if (/金句|名言|记住|必杀/.test(plain)) return '金句';
      if (/判断/.test(plain)) return '判断';
      if (/关键/.test(plain)) return '关键';
      if (/重点|划重点|高亮|核心|真相|本质/.test(plain)) return '划重点';
      if (plain.length <= 24 && /[。！？!?]$/.test(plain)) return '金句';
      if (plain.length <= 18) return '金句';
      return '划重点';
    }
    function textWithBreaks(node) {
      if (!node) return '';
      const clone = node.cloneNode(true);
      clone.querySelectorAll('br').forEach((br) => br.replaceWith('\\n'));
      return String(clone.textContent || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/[ \\t]+\\n/g, '\\n')
        .replace(/\\n[ \\t]+/g, '\\n')
        .replace(/[ \\t]{2,}/g, ' ')
        .trim();
    }
    function textWithBreaksPreservingSpaces(node) {
      if (!node) return '';
      const clone = node.cloneNode(true);
      clone.querySelectorAll('br').forEach((br) => br.replaceWith('\\n'));
      return String(clone.textContent || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\r\\n?/g, '\\n')
        .replace(/[ \\t]+\\n/g, '\\n')
        .replace(/\\n[ \\t]+/g, '\\n')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();
    }
    function escWithBreaks(value) {
      return esc(value).replace(/\\n/g, '<br>');
    }
    function normalizeInlineHtml(html) {
      return String(html || '')
        .replace(/font-size\\s*:\\s*[0-9.]+px\\s*;?/gi, '')
        .replace(/font-family\\s*:\\s*[^;\"]+;?/gi, '')
        .replace(/line-height\\s*:\\s*[0-9.]+\\s*;?/gi, '')
        .replace(/color\\s*:\\s*#(?:303832|161a17)\\s*;?/gi, '')
        .replace(/letter-spacing\\s*:\\s*[^;"]+;?/gi, '');
    }
    function htmlTextContent(html) {
      const holder = document.createElement('div');
      holder.innerHTML = String(html || '');
      return holder.textContent || '';
    }
    function clearUnderlineInlineStyles(node) {
      if (!node?.style) return;
      node.style.background = '';
      node.style.backgroundColor = '';
      node.style.backgroundImage = '';
      node.style.boxShadow = '';
      node.style.borderBottom = '';
      node.style.textDecoration = '';
      node.style.padding = '';
      node.style.borderRadius = '';
      node.style.display = '';
      node.style.boxDecorationBreak = '';
      node.style.webkitBoxDecorationBreak = '';
    }
    function shouldKeepAutoUnderlineText(text) {
      const compact = cleanText(text || '').replace(/\\s+/g, '');
      if (!compact) return false;
      if (compact.length > 18) return false;
      if (/[。！？!?；;：:]/.test(compact)) return false;
      return true;
    }
    function isBlockUnderlineNode(node) {
      const tag = (node?.tagName || '').toLowerCase();
      return node?.classList?.contains('xhs-block') ||
        /^(p|div|section|article|li|ul|ol)$/i.test(tag) ||
        node?.classList?.contains('xhs-body-frame') ||
        node?.classList?.contains('cover-text') ||
        Boolean(node?.querySelector?.('.xhs-block, p, div, section, article, li, ul, ol'));
    }
    function normalizeUnderlineDecorations(root = stageScale) {
      root?.querySelectorAll?.('.xhs-green-underline').forEach((node) => {
        const tag = (node.tagName || '').toLowerCase();
        if (isBlockUnderlineNode(node)) {
          node.classList.remove('xhs-green-underline');
          delete node.dataset.xhsAutoUnderline;
          clearUnderlineInlineStyles(node);
          return;
        }
        if ((tag === 'strong' || tag === 'b') && !shouldKeepAutoUnderlineText(node.textContent || '')) {
          node.classList.remove('xhs-green-underline');
          delete node.dataset.xhsAutoUnderline;
          clearUnderlineInlineStyles(node);
        }
      });
    }
    function isCjkOrFullWidth(ch) {
      const cp = ch.codePointAt(0) || 0;
      return (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x3000 && cp <= 0x303f) ||
        (cp >= 0xff00 && cp <= 0xffef);
    }
    function textCharUnits(ch) {
      if (!ch) return 0;
      if (/\\s/.test(ch)) return 0.6;
      return 1;
    }
    function textUnits(value) {
      let total = 0;
      for (const ch of String(value || '')) total += textCharUnits(ch);
      return total;
    }
    function isAsciiWordChar(ch) {
      return /[A-Za-z0-9_+.#%-]/.test(ch || '');
    }
    function isBadLineStart(ch) {
      return /[，。！？、；：,.!?:;）】》」』”’%]/.test(ch || '');
    }
    function isBadLineEnd(ch) {
      return /[（【《「『“‘]/.test(ch || '');
    }
    function safeBreakAt(text, pos) {
      if (pos <= 0 || pos >= text.length) return false;
      const prev = text[pos - 1] || '';
      const next = text[pos] || '';
      if (isBadLineStart(next) || isBadLineEnd(prev)) return false;
      if (isAsciiWordChar(prev) && isAsciiWordChar(next)) return false;
      return true;
    }
    function preferredBreakAt(text, pos) {
      const prev = text[pos - 1] || '';
      return /[\\s，。！？、；：,.!?:;]/.test(prev);
    }
    function bodyLineBreakPositions(text, limit) {
      const chars = [];
      let offset = 0;
      for (const ch of String(text || '')) {
        const start = offset;
        offset += ch.length;
        chars.push({ ch, start, end: offset });
      }
      const breaks = [];
      let lineStart = 0;
      let lineUnits = 0;
      let lastSafe = -1;
      let lastPreferred = -1;
      for (let i = 0; i < chars.length; i += 1) {
        const item = chars[i];
        const cw = textCharUnits(item.ch);
        if (lineUnits + cw > limit && item.start > lineStart) {
          const preferredUnits = lastPreferred > lineStart ? textUnits(text.slice(lineStart, lastPreferred)) : 0;
          const preferredFillsLine = preferredUnits >= limit * 0.86;
          const breakPos = preferredFillsLine ? lastPreferred : (lastSafe > lineStart ? lastSafe : item.start);
          if (breakPos > lineStart && breakPos < text.length) {
            breaks.push(breakPos);
            lineStart = breakPos;
            lineUnits = textUnits(text.slice(lineStart, item.start));
            lastSafe = -1;
            lastPreferred = -1;
          }
        }
        lineUnits += cw;
        if (safeBreakAt(text, item.end)) {
          lastSafe = item.end;
          if (preferredBreakAt(text, item.end)) lastPreferred = item.end;
        }
      }
      return breaks;
    }
    function removeAutoLineBreaks(root) {
      root.querySelectorAll?.('br[data-xhs-wrap="1"]').forEach((br) => br.remove());
    }
    function insertAutoBreakAtTextOffset(root, offset) {
      let pos = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = (node.nodeValue || '').length;
        if (offset <= pos + len) {
          const local = Math.max(0, Math.min(len, offset - pos));
          const after = node.splitText(local);
          const br = document.createElement('br');
          br.dataset.xhsWrap = '1';
          node.nodeValue = (node.nodeValue || '').replace(/[ \\t]+$/, '');
          after.nodeValue = (after.nodeValue || '').replace(/^[ \\t]+/, '');
          after.parentNode.insertBefore(br, after);
          return true;
        }
        pos += len;
      }
      return false;
    }
    function wrapTextTargetLines(target) {
      if (!target || target.querySelector?.('img, .xhs-image-frame, .cover-image-frame')) return;
      removeAutoLineBreaks(target);
    }
    function wrapBodyTextLines(root) {
      const targets = [];
      if (root.matches?.('.xhs-p, .xhs-rich, .xhs-quote')) targets.push(root);
      root.querySelectorAll?.('.xhs-p, .xhs-rich, .xhs-quote, .xhs-callout-body, .xhs-list-body').forEach((node) => {
        if (!targets.includes(node)) targets.push(node);
      });
      targets.forEach(wrapTextTargetLines);
      return root;
    }
    function stripCalloutBodyLabelPrefix(root) {
      if (!root) return false;
      const text = String(root.textContent || '');
      const match = text.match(/^\\s*${CARD_LABEL_TOKEN}(?:\\s*[:：]\\s*|\\s*[—–-]\\s*|\\s+)/);
      if (!match) return false;
      let remaining = match[0].length;
      const textNodes = [];
      const collect = (node) => {
        Array.from(node.childNodes || []).forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) textNodes.push(child);
          else collect(child);
        });
      };
      collect(root);
      for (const node of textNodes) {
        if (remaining <= 0) break;
        const value = node.nodeValue || '';
        const cut = Math.min(remaining, value.length);
        node.nodeValue = value.slice(cut);
        remaining -= cut;
      }
      root.querySelectorAll('strong, b, em, i, span').forEach((node) => {
        if (!cleanText(node.textContent)) node.remove();
      });
      return true;
    }
    function normalizeCalloutBodyLabels(root = stageScale) {
      root?.querySelectorAll?.('.xhs-callout-body').forEach((body) => stripCalloutBodyLabelPrefix(body));
    }
    function cleanCalloutBodyHtml(html) {
      const holder = document.createElement('div');
      holder.innerHTML = normalizeInlineHtml(html);
      holder.querySelectorAll('[style]').forEach((node) => {
        const style = node.getAttribute('style') || '';
        if (/box-shadow|background|border-bottom|color\\s*:/i.test(style)) node.removeAttribute('style');
      });
      stripCalloutBodyLabelPrefix(holder);
      return holder.innerHTML;
    }
    function makeElement(tag, className, html) {
      const el = document.createElement(tag);
      el.className = className;
      if (html != null) el.innerHTML = html;
      return el;
    }
    function isHeroBlock(el, index) {
      if (index !== 0 || el.querySelector('img')) return false;
      const compactTitle = cleanText(config.title).replace(/\\s/g, '');
      const compactText = cleanText(el.textContent).replace(/\\s/g, '');
      if (!compactTitle) return false;
      if (compactText.includes(compactTitle.slice(0, Math.min(12, compactTitle.length)))) return true;
      if (el.dataset?.xhsHeadingLevel !== '1') return false;
      const titleEl = el.querySelector('strong, .xhs-heading-title');
      const headingTitle = cleanText(titleEl?.textContent || '').replace(/\\s/g, '');
      return headingTitle === compactTitle ||
        headingTitle.includes(compactTitle.slice(0, Math.min(12, compactTitle.length)));
    }
    function stripHeadingNumberPrefix(titleText, number) {
      let value = String(titleText || '').trim();
      if (!value) return '';
      value = value.replace(new RegExp('^(?:' + number + '[\\\\s\\\\n]*)+', 'i'), '');
      value = value.replace(/^(?:\\d{2}[\\s\\n]*)+/, '').trim();
      return value;
    }
    function hoistStrayHeadingContent(heading) {
      if (!heading.classList?.contains('xhs-heading')) return;
      const stray = [];
      Array.from(heading.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          if (cleanText(child.textContent)) stray.push(child);
          else child.remove();
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        if (child.classList.contains('xhs-heading-number') ||
            child.classList.contains('xhs-heading-title') ||
            child.classList.contains('xhs-heading-space')) return;
        stray.push(child);
      });
      if (!stray.length) return;
      const merged = document.createElement('p');
      merged.className = 'xhs-p xhs-block';
      stray.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) merged.appendChild(document.createTextNode(node.textContent));
        else merged.appendChild(node);
        node.remove();
      });
      if (!hasEditableContent(merged)) return;
      heading.after(merged);
    }
    function detectHeadingLevel(heading) {
      if (heading?.dataset?.level === '2') return '2';
      if (heading?.dataset?.xhsHeadingLevel === '2') return '2';
      return '1';
    }
    function parseHeadingParts(heading) {
      hoistStrayHeadingContent(heading);
      const level = detectHeadingLevel(heading);
      if (level === '2') {
        const titleEl = heading.querySelector('.xhs-heading-title') || heading.querySelector('strong');
        const titleText = titleEl ? cleanText(textWithBreaksPreservingSpaces(titleEl)) : cleanText(heading.textContent);
        return { number: '', titleText, level };
      }
      const numberEl = heading.querySelector('.xhs-heading-number') ||
        Array.from(heading.children).find((child) => /^\\d{2}$/.test(cleanText(child.textContent)));
      const titleEl = heading.querySelector('.xhs-heading-title') || heading.querySelector('strong');
      const raw = cleanText(heading.textContent);
      const spaced = raw.match(/^(\\d{2})\\s+(.+)$/);
      const numberRaw = cleanText(numberEl?.textContent || '');
      const numberOnly = numberRaw.match(/^(\\d{2})/)?.[1];
      let number = '01';
      if (numberOnly && numberRaw.length <= 2) number = numberOnly;
      else if (spaced) number = spaced[1];
      else if (numberOnly) number = numberOnly;
      let titleText = '';
      const titleFromEl = titleEl ? textWithBreaksPreservingSpaces(titleEl) : '';
      if (cleanText(titleFromEl)) titleText = stripHeadingNumberPrefix(titleFromEl, number);
      else if (spaced) titleText = spaced[2].trim();
      else titleText = stripHeadingNumberPrefix(raw, number);
      return { number, titleText, level: '1' };
    }
    function isHeadingBlock(el) {
      if (el.querySelector('img')) return false;
      if (el.classList?.contains('xhs-heading')) return true;
      if (el.dataset?.xhsHeadingLevel === '1' || el.dataset?.xhsHeadingLevel === '2') return true;
      const style = el.getAttribute('style') || '';
      const tag = (el.tagName || '').toLowerCase();
      if (/^h[2-6]$/.test(tag)) return true;
      const text = cleanText(el.textContent);
      if (/^\\d{2}\\s+/.test(text) && /border-bottom/i.test(style)) return true;
      if (!/border-bottom/i.test(style)) return false;
      const directChildren = Array.from(el.children);
      const numberChild = directChildren.find((child) => /^\\d{2}$/.test(cleanText(child.textContent)));
      const titleChild = directChildren.find((child) => child.tagName?.toLowerCase() === 'strong' && cleanText(child.textContent));
      return Boolean(numberChild && titleChild);
    }
    function headingHtml(number, titleText, level) {
      if (String(level) === '2') {
        const safeTitle = String(titleText || '').trim();
        return '<span class="xhs-heading-title" contenteditable="true" spellcheck="false">' + escWithBreaks(safeTitle) + '</span>';
      }
      const safeNumber = String(number || '00').match(/^(\\d{2})/)?.[1] || '00';
      const safeTitle = stripHeadingNumberPrefix(titleText, safeNumber);
      return '<span class="xhs-heading-number" contenteditable="true" spellcheck="false">' + esc(safeNumber) + '</span>' +
        '<span class="xhs-heading-space" aria-hidden="true">&nbsp;</span>' +
        '<span class="xhs-heading-title" contenteditable="true" spellcheck="false">' + escWithBreaks(safeTitle) + '</span>';
    }
    function makeNewHeadingBlock(number = '00', titleText = '', level = '1') {
      const block = makeElement('section', 'xhs-heading xhs-block');
      block.setAttribute('contenteditable', 'false');
      block.dataset.level = String(level) === '2' ? '2' : '1';
      block.innerHTML = headingHtml(number, titleText, block.dataset.level);
      return block;
    }
    function headingFromElement(el) {
      const { number, titleText, level } = parseHeadingParts(el);
      return makeNewHeadingBlock(number, titleText, level);
    }
    function normalizeHeadingBlock(heading) {
      const { number, titleText, level } = parseHeadingParts(heading);
      heading.setAttribute('contenteditable', 'false');
      heading.dataset.level = level;
      heading.innerHTML = headingHtml(number, titleText, level);
    }
    function activeHeadingEditField() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const node = sel.anchorNode;
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return el?.closest?.('.xhs-heading-title, .xhs-heading-number');
    }
    function saveCaretBookmark() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      const field = activeHeadingEditField();
      if (!field) return null;
      return {
        field,
        startContainer: range.startContainer,
        startOffset: range.startOffset,
      };
    }
    function restoreCaretBookmark(bookmark) {
      if (!bookmark?.field?.isConnected) return;
      const sel = window.getSelection();
      if (!sel) return;
      try {
        const range = document.createRange();
        const container = bookmark.startContainer;
        if (container?.isConnected) {
          const max = container.nodeType === Node.TEXT_NODE
            ? (container.textContent || '').length
            : container.childNodes.length;
          range.setStart(container, Math.min(bookmark.startOffset, max));
        } else {
          range.selectNodeContents(bookmark.field);
          range.collapse(false);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {
        setCaretInside(bookmark.field);
      }
    }
    function scheduleHeadingNormalize() {
      if (isComposingText) return;
      window.clearTimeout(headingNormalizeTimer);
      headingNormalizeTimer = window.setTimeout(() => {
        const field = activeHeadingEditField();
        if (!field) return;
        const heading = field.closest('.xhs-heading');
        if (!heading || !stageScale.contains(heading)) return;
        const bookmark = saveCaretBookmark();
        normalizeHeadingBlock(heading);
        restoreCaretBookmark(bookmark);
        fitHeadingTitles(stageScale);
      }, 180);
    }
    function normalizeHeadings(root = stageScale) {
      root.querySelectorAll('.xhs-heading').forEach(normalizeHeadingBlock);
      fitHeadingTitles(root);
    }
    function isCalloutBlock(el) {
      if (el.querySelector('img')) return false;
      const explicitType = el.dataset?.xhsBlockType || '';
      const tag = (el.tagName || '').toLowerCase();
      if (explicitType === 'callout') return true;
      if (explicitType || tag === 'blockquote') return false;
      const text = cleanText(el.textContent);
      const first = cleanText(el.firstElementChild?.textContent || '');
      const style = el.getAttribute('style') || '';
      return /${CARD_LABEL_WORDS}/.test(first || text) || /border-left\\s*:\\s*4px[^;]*#57b560/i.test(style);
    }
    function calloutFromElement(el) {
      const children = Array.from(el.children);
      const firstText = cleanText(children[0]?.textContent || '');
      const hasExplicitLabel = /^(${CARD_LABEL_TOKEN})$/.test(firstText);
      const bodyChildren = hasExplicitLabel ? children.slice(1) : children;
      const rawBodyHtml = bodyChildren.length
        ? bodyChildren.map((child) => normalizeInlineHtml(child.innerHTML || child.textContent)).join('')
        : normalizeInlineHtml(el.innerHTML || el.textContent);
      const bodyHtml = cleanCalloutBodyHtml(rawBodyHtml);
      const plainBody = cleanText(bodyHtml.replace(/<[^>]*>/g, ''));
      const label = hasExplicitLabel ? firstText : inferCardLabel(plainBody);
      const block = makeElement('section', 'xhs-callout xhs-block' + (currentCardStyle === 'frame' ? ' xhs-card-frame' : ''));
      block.innerHTML = '<div class="xhs-callout-label">' + esc(label) + '</div><div class="xhs-callout-body">' + bodyHtml + '</div>';
      return block;
    }
    function stripLeadingListMarkerText(text) {
      let value = String(text || '').trim();
      for (let i = 0; i < 5; i += 1) {
        const next = value
          .replace(/^(?:[-+•·◦]\\s*)/, '')
          .replace(/^\\*\\s+/, '')
          .replace(/^(?:\\d+[.)、．]\\s*)/, '')
          .replace(/^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]|（\\d+）|\\(\\d+\\))\\s*/, '')
          .replace(/^[1-9](?=[\\u4e00-\\u9fff])/, '')
          .replace(/^[·•]\\s*/, '')
          .trim();
        if (next === value) break;
        value = next;
      }
      return value;
    }
    function stripListMarkerFromHtml(html) {
      if (!html) return '';
      const holder = document.createElement('div');
      holder.innerHTML = html;
      while (holder.firstChild) {
        if (holder.firstChild.nodeType === Node.TEXT_NODE) {
          const stripped = stripLeadingListMarkerText(holder.firstChild.textContent || '');
          if (stripped !== holder.firstChild.textContent) holder.firstChild.textContent = stripped;
          if (!cleanText(holder.firstChild.textContent)) {
            holder.removeChild(holder.firstChild);
            continue;
          }
          break;
        }
        if (holder.firstChild.nodeType === Node.ELEMENT_NODE) {
          const el = holder.firstChild;
          const markerText = cleanText(el.textContent || '');
          if (/^\\d+[.)、．]?$/.test(markerText) || /^[-*+•·◦]$/.test(markerText)) {
            el.remove();
            continue;
          }
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const first = walker.nextNode();
          if (first) first.textContent = stripLeadingListMarkerText(first.textContent || '');
          break;
        }
        break;
      }
      const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      if (first) first.textContent = stripLeadingListMarkerText(first.textContent || '');
      return holder.innerHTML;
    }
    function paragraphLooksLikeListItem(node) {
      const text = cleanText(node?.textContent || '');
      return /^(?:[-*+•·◦]|\\d+[.)、])\\s/.test(text);
    }
    function paragraphListType(node) {
      const text = cleanText(node?.textContent || '');
      if (/^\\d+[.)、]\\s/.test(text)) return 'ordered';
      if (/^[-*+•·◦]\\s/.test(text)) return 'unordered';
      return '';
    }
    function buildReasonStackFromParagraphs(paragraphs, listType = 'unordered') {
      const items = paragraphs.map((node) => {
        const html = stripListMarkerFromHtml(normalizeInlineHtml(node.innerHTML || node.textContent));
        const plain = stripLeadingListMarkerText(cleanText(node.textContent));
        return plain ? { html, plain } : null;
      }).filter(Boolean);
      return items.length ? buildListLines(items, listType) : [];
    }
    function mergeAdjacentListParagraphs(blocks) {
      const merged = [];
      let buffer = [];
      let bufferType = '';
      function flushBuffer() {
        if (!buffer.length) return;
        const lines = buildReasonStackFromParagraphs(buffer, bufferType || 'unordered');
        lines.forEach((line) => merged.push(line));
        buffer = [];
        bufferType = '';
      }
      blocks.forEach((block) => {
        if (block.classList?.contains('xhs-p') && paragraphLooksLikeListItem(block)) {
          const nextType = paragraphListType(block) || 'unordered';
          if (buffer.length && bufferType !== nextType) flushBuffer();
          bufferType = nextType;
          buffer.push(block);
          return;
        }
        flushBuffer();
        merged.push(block);
      });
      flushBuffer();
      return merged;
    }
    function isReasonListBlock(el) {
      if (el.querySelector('img')) return false;
      if (el.dataset?.listType && Array.from(el.children).length >= 1) return true;
      const children = Array.from(el.children);
      if (children.length < 2) return false;
      const style = el.getAttribute('style') || '';
      const listCards = children.filter((child) => {
        const spans = Array.from(child.querySelectorAll('span'));
        const hasDot = spans.some((span) => /border-radius\\s*:\\s*50%/i.test(span.getAttribute('style') || '') || /^\\d+$/.test(cleanText(span.textContent)));
        return hasDot && cleanText(child.textContent).length > 8;
      }).length;
      return listCards >= 2 || (/background\\s*:\\s*#f3f8f1/i.test(style) && listCards >= 1);
    }
    function reasonListLinesFromElement(el) {
      const listType = el.dataset?.listType === 'ordered' ? 'ordered' : 'unordered';
      const items = Array.from(el.children).map((child) => {
        const spans = Array.from(child.querySelectorAll('span'));
        const contentSpan = spans.find((span) => {
          const text = cleanText(span.textContent);
          return text.length > 0 && !/^\\d+[.)、．]?$/.test(text);
        });
        const textHtml = stripListMarkerFromHtml(normalizeInlineHtml(contentSpan ? contentSpan.innerHTML : child.innerHTML));
        const plain = stripLeadingListMarkerText(cleanText(textHtml.replace(/<[^>]*>/g, '')));
        return plain ? { html: textHtml, plain } : null;
      }).filter(Boolean);
      return buildListLines(items, listType);
    }
    function reasonListLinesFromStack(stack) {
      const items = Array.from(stack.querySelectorAll('.xhs-reason-card, .xhs-reason-text')).map((node) => {
        const textEl = node.classList?.contains('xhs-reason-text') ? node : node.querySelector('.xhs-reason-text');
        const html = textEl ? stripListMarkerFromHtml(normalizeInlineHtml(textEl.innerHTML)) : '';
        const plain = stripLeadingListMarkerText(cleanText(textEl?.textContent || ''));
        return plain ? { html, plain } : null;
      }).filter(Boolean);
      return buildListLines(items, 'unordered');
    }
    function normalizeListLinesInFrame(frame) {
      if (!frame) return false;
      let changed = false;
      const processed = new Set();
      Array.from(frame.querySelectorAll('.xhs-list-line')).forEach((line) => {
        if (processed.has(line)) return;
        const listType = line.dataset.listType === 'ordered' ? 'ordered' : 'unordered';
        const group = collectContiguousListLines(line);
        group.forEach((item, index) => {
          processed.add(item);
          // Inline emphasis must live inside the body. Older drafts can contain
          // a wrapper around the marker and body after a broad text selection.
          const body = item.querySelector('.xhs-list-body');
          const markerNode = item.querySelector('.xhs-list-marker');
          if (body && markerNode && (body.parentElement !== item || markerNode.parentElement !== item || item.children.length !== 2)) {
            Array.from(item.childNodes).forEach((child) => {
              if (child === markerNode || child === body) return;
              // A wrapper already containing the recovered body is only a
              // temporary outer shell. Otherwise preserve its inline style.
              if (child.nodeType === Node.ELEMENT_NODE && child.contains(body)) return;
              body.appendChild(child);
            });
            item.replaceChildren(markerNode, body);
            changed = true;
          }
          if (item.dataset.listType !== listType) {
            item.dataset.listType = listType;
            changed = true;
          }
          const marker = item.querySelector('.xhs-list-marker');
          const markerIsValid = listType === 'ordered'
            ? Boolean(marker?.classList.contains('xhs-list-marker-ordered') && cleanText(marker.textContent) === String(index + 1) + '.')
            : Boolean(marker?.classList.contains('xhs-list-marker-dot'));
          if (!markerIsValid) {
            marker?.replaceWith(listMarkerElement(listType, index + 1));
            changed = true;
          }
        });
      });
      return changed;
    }
    function expandReasonStacksInFrame(frame) {
      if (!frame) return false;
      let changed = false;
      Array.from(frame.querySelectorAll('.xhs-reason-stack')).forEach((stack) => {
        if (!frame.contains(stack)) return;
        const lines = reasonListLinesFromStack(stack);
        const frag = document.createDocumentFragment();
        lines.forEach((line) => frag.appendChild(line));
        stack.replaceWith(frag);
        changed = true;
      });
      return changed;
    }
    function tableFromElement(el) {
      const source = el.tagName?.toLowerCase() === 'table' ? el : el.querySelector('table');
      if (!source) return null;
      const block = document.createElement('section');
      block.className = 'xhs-table-block xhs-block';
      const table = document.createElement('table');
      table.className = 'xhs-table';
      const sourceRows = Array.from(source.querySelectorAll('tr'));
      if (!sourceRows.length) return null;
      const explicitHeadRows = Array.from(source.querySelectorAll('thead tr'));
      const headRows = explicitHeadRows.length ? explicitHeadRows : [sourceRows[0]];
      const headSet = new Set(headRows);
      const thead = document.createElement('thead');
      headRows.forEach((row) => {
        const nextRow = document.createElement('tr');
        Array.from(row.children).forEach((cell) => {
          const th = document.createElement('th');
          th.innerHTML = normalizeInlineHtml(cell.innerHTML || cell.textContent || '');
          nextRow.appendChild(th);
        });
        thead.appendChild(nextRow);
      });
      const tbody = document.createElement('tbody');
      sourceRows.filter((row) => !headSet.has(row)).forEach((row) => {
        const nextRow = document.createElement('tr');
        Array.from(row.children).forEach((cell) => {
          const td = document.createElement('td');
          td.innerHTML = normalizeInlineHtml(cell.innerHTML || cell.textContent || '');
          nextRow.appendChild(td);
        });
        tbody.appendChild(nextRow);
      });
      table.append(thead, tbody);
      block.appendChild(table);
      return block;
    }
    function isQuoteBlock(el) {
      if (el.querySelector('img')) return false;
      const explicitType = el.dataset?.xhsBlockType || '';
      const tag = (el.tagName || '').toLowerCase();
      if (explicitType === 'quote' || tag === 'blockquote') return true;
      if (explicitType === 'callout') return false;
      const style = el.getAttribute('style') || '';
      return /border-left/i.test(style) && !isCalloutBlock(el);
    }
    function readU16(raw, offset) {
      return ((raw.charCodeAt(offset) & 255) << 8) + (raw.charCodeAt(offset + 1) & 255);
    }
    function readU32(raw, offset) {
      return ((raw.charCodeAt(offset) & 255) * 16777216) + ((raw.charCodeAt(offset + 1) & 255) << 16) + ((raw.charCodeAt(offset + 2) & 255) << 8) + (raw.charCodeAt(offset + 3) & 255);
    }
    function imageDimensionsFromSrc(src) {
      const match = String(src || '').match(/^data:image\\/(png|jpe?g);base64,([\\s\\S]+)$/i);
      if (!match) return null;
      const kind = match[1].toLowerCase();
      const base64 = match[2].replace(/\\s/g, '');
      try {
        if (kind === 'png') {
          const raw = atob(base64.slice(0, 96));
          if (raw.length > 24) return { width: readU32(raw, 16), height: readU32(raw, 20) };
        }
        const partial = base64.slice(0, Math.min(base64.length, 32768));
        const raw = atob(partial.slice(0, partial.length - (partial.length % 4)));
        let offset = 2;
        while (offset + 9 < raw.length) {
          if ((raw.charCodeAt(offset) & 255) !== 255) {
            offset += 1;
            continue;
          }
          const marker = raw.charCodeAt(offset + 1) & 255;
          const length = readU16(raw, offset + 2);
          if (marker >= 192 && marker <= 195) {
            return { width: readU16(raw, offset + 7), height: readU16(raw, offset + 5) };
          }
          offset += Math.max(2, length + 2);
        }
      } catch (_) {}
      return null;
    }
    function defaultImageHeight(dims, frameWidth) {
      if (!dims || !dims.width || !dims.height) return config.imageFrameHeight;
      const ratio = dims.width / dims.height;
      const rawHeight = frameWidth / ratio;
      if (ratio > 2.35) return Math.round(Math.max(210, Math.min(420, rawHeight)));
      if (ratio < 0.76) return Math.round(Math.max(420, Math.min(780, rawHeight)));
      return Math.round(Math.max(300, Math.min(650, rawHeight)));
    }
    function imageBlockFromSrc(src, alt = '', options = {}) {
      const figure = document.createElement('figure');
      figure.className = 'xhs-image-block xhs-block';
      figure.dataset.imageId = 'img-' + (++imageIdCounter);
      if (options.inGrid) figure.classList.add('xhs-image-cell');
      figure.style.width = '100%';
      const frame = document.createElement('div');
      frame.className = 'xhs-image-frame selectable-image';
      frame.dataset.fit = 'contain';
      const nextImg = document.createElement('img');
      nextImg.src = src || '';
      nextImg.alt = alt || '';
      nextImg.draggable = false;
      nextImg.style.objectFit = 'contain';
      nextImg.style.objectPosition = '50% 50%';
      nextImg.dataset.offsetX = '0';
      nextImg.dataset.offsetY = '0';
      nextImg.style.transform = 'translate(0px, 0px) scale(1)';
      const dims = imageDimensionsFromSrc(nextImg.src);
      if (dims) {
        frame.dataset.naturalWidth = String(dims.width);
        frame.dataset.naturalHeight = String(dims.height);
      }
      frame.style.height = defaultImageHeight(dims, options.frameWidth || config.bodyContentWidth) + 'px';
      frame.appendChild(nextImg);
      figure.appendChild(frame);
      return figure;
    }
    function imageBlockFromImg(img, options = {}) {
      return imageBlockFromSrc(img.getAttribute('src') || '', img.getAttribute('alt') || '', options);
    }
    function ensureImageId(block) {
      if (!block || !block.classList?.contains('xhs-image-block')) return '';
      if (!block.dataset.imageId) block.dataset.imageId = 'img-' + (++imageIdCounter);
      return block.dataset.imageId;
    }
    function findImageBlockById(root, id) {
      if (!root || !id) return null;
      return Array.from(root.querySelectorAll('.xhs-image-block')).find((block) => block.dataset.imageId === id) || null;
    }
    function collectBodyFlowHolder() {
      saveCurrentPage();
      const holder = document.createElement('div');
      pages.filter((page) => page.type === 'body').forEach((page) => {
        const pageHolder = document.createElement('div');
        pageHolder.innerHTML = page.html;
        removeAutoLineBreaks(pageHolder);
        Array.from(pageHolder.children).forEach((node) => holder.appendChild(node));
      });
      holder.querySelectorAll('.xhs-image-block').forEach(ensureImageId);
      return holder;
    }
    function pageIndexForImageId(id) {
      if (!id) return -1;
      return pages.findIndex((page) => page.type === 'body' && page.html.includes('data-image-id="' + id + '"'));
    }
    function repaginateBodyBlocks(blocks, selectedImageId = '') {
      const cover = pages.find((page) => page.type === 'cover') || { type: 'cover', html: initialCoverHtml() };
      let normalizedBlocks = blocks;
      if (blocks.length) {
        const holder = document.createElement('div');
        holder.className = 'xhs-body-frame';
        blocks.forEach((block) => holder.appendChild(block));
        normalizeEditableBodyBlocks(holder);
        normalizedBlocks = Array.from(holder.children);
      }
      const baseBlocks = normalizedBlocks.length ? mergeSplitBlocks(normalizedBlocks) : extractBlocksFromTemplate();
      const flowBlocks = pairAdjacentPortraitImages(baseBlocks);
      pages = [cover].concat(paginateBlocks(flowBlocks));
      const nextIndex = pageIndexForImageId(selectedImageId);
      pageIndex = nextIndex >= 0 ? nextIndex : Math.min(pageIndex, Math.max(0, pages.length - 1));
      selectedFrame = null;
      renderAll();
      const selectedBlock = findImageBlockById(stageScale, selectedImageId);
      const frame = selectedBlock?.querySelector('.xhs-image-frame');
      if (frame) selectFrame(frame);
    }
    function imageGroupFromImgs(imgs) {
      if (imgs.length === 1) return [imageBlockFromImg(imgs[0])];
      const grid = document.createElement('section');
      const countClass = imgs.length === 2 ? 'two' : (imgs.length === 3 ? 'three' : 'four');
      grid.className = 'xhs-image-grid xhs-block ' + countClass;
      const gap = ${imageGridGap};
      const columns = imgs.length > 1 ? 2 : 1;
      const frameWidth = columns === 2 ? Math.floor((config.bodyContentWidth - gap) / 2) : config.bodyContentWidth;
      imgs.slice(0, 4).forEach((image) => grid.appendChild(imageBlockFromImg(image, { inGrid: true, frameWidth })));
      return [grid];
    }
    function imageDimsFromFrame(frame) {
      const width = Number(frame?.dataset?.naturalWidth || 0);
      const height = Number(frame?.dataset?.naturalHeight || 0);
      return width && height ? { width, height } : null;
    }
    function isPairablePortraitImage(block) {
      if (!block || !block.classList?.contains('xhs-image-block')) return false;
      if (block.dataset.noAutoGrid === '1') return false;
      const frame = block.querySelector('.xhs-image-frame');
      const dims = imageDimsFromFrame(frame);
      if (!dims) return false;
      return dims.height / dims.width >= 1.15;
    }
    function updateGridClass(grid) {
      const items = Array.from(grid.children).filter((child) => child.classList?.contains('xhs-image-block'));
      grid.classList.remove('two', 'three', 'four');
      grid.classList.add(items.length === 2 ? 'two' : (items.length === 3 ? 'three' : 'four'));
    }
    function imageGridFromBlocks(blocks) {
      const grid = document.createElement('section');
      grid.className = 'xhs-image-grid xhs-block ' + (blocks.length === 2 ? 'two' : (blocks.length === 3 ? 'three' : 'four'));
      const gap = ${imageGridGap};
      const columns = blocks.length > 1 ? 2 : 1;
      const frameWidth = columns === 2 ? Math.floor((config.bodyContentWidth - gap) / 2) : config.bodyContentWidth;
      blocks.slice(0, 4).forEach((block) => {
        block.classList.add('xhs-image-cell');
        block.style.width = '100%';
        const frame = block.querySelector('.xhs-image-frame');
        const dims = imageDimsFromFrame(frame);
        if (frame && !frame.dataset.userHeight) frame.style.height = defaultImageHeight(dims, frameWidth) + 'px';
        grid.appendChild(block);
      });
      return grid;
    }
    function pairAdjacentPortraitImages(blocks) {
      const output = [];
      for (let i = 0; i < blocks.length; i++) {
        const current = blocks[i];
        if (!isPairablePortraitImage(current)) {
          output.push(current);
          continue;
        }
        const run = [current];
        let j = i + 1;
        while (j < blocks.length && run.length < 3 && isPairablePortraitImage(blocks[j])) {
          run.push(blocks[j]);
          j += 1;
        }
        if (run.length >= 2) {
          output.push(imageGridFromBlocks(run));
          i += run.length - 1;
        } else {
          output.push(current);
        }
      }
      return output;
    }
    function stripSplitState(node) {
      node.classList.remove('xhs-split-head', 'xhs-split-tail');
      delete node.dataset.split;
      delete node.dataset.flowId;
      return node;
    }
    function appendSplitContent(target, source) {
      if (target.classList.contains('xhs-table-block')) {
        const targetBody = target.querySelector('tbody');
        const sourceBody = source.querySelector('tbody');
        if (targetBody && sourceBody) {
          Array.from(sourceBody.rows).forEach((row) => targetBody.appendChild(row.cloneNode(true)));
        }
        return;
      }
      if (target.classList.contains('xhs-callout')) {
        const targetBody = target.querySelector('.xhs-callout-body');
        const sourceBody = source.querySelector('.xhs-callout-body');
        if (targetBody && sourceBody) {
          Array.from(sourceBody.childNodes).forEach((node) => targetBody.appendChild(node.cloneNode(true)));
        }
        return;
      }
      Array.from(source.childNodes).forEach((node) => target.appendChild(node.cloneNode(true)));
    }
    function canMergeSplitBlock(base, next) {
      return base?.dataset?.flowId &&
        next?.dataset?.flowId &&
        base.dataset.flowId === next.dataset.flowId &&
        base.tagName === next.tagName &&
        (isPlainSplittable(base) || base.classList.contains('xhs-callout') || base.classList.contains('xhs-table-block'));
    }
    function mergeSplitBlocks(blocks) {
      const merged = [];
      for (const block of blocks) {
        const previous = merged[merged.length - 1];
        if (canMergeSplitBlock(previous, block)) {
          appendSplitContent(previous, block);
          stripSplitState(previous);
        } else {
          merged.push(block);
        }
      }
      return merged.map((block) => {
        if (!block.dataset?.split) return block;
        return stripSplitState(block);
      });
    }
    function isStructuredFlowBlock(node) {
      return node?.nodeType === Node.ELEMENT_NODE && (
        node.classList.contains('xhs-p') ||
        node.classList.contains('xhs-rich') ||
        node.classList.contains('xhs-heading') ||
        node.classList.contains('xhs-callout') ||
        node.classList.contains('xhs-quote') ||
        node.classList.contains('xhs-list-line') ||
        node.classList.contains('xhs-table-block') ||
        node.classList.contains('xhs-image-block') ||
        node.classList.contains('xhs-image-grid') ||
        node.classList.contains('xhs-page-break') ||
        node.classList.contains('xhs-caret-anchor')
      );
    }
    function hasEditableContent(node) {
      if (node?.classList?.contains('xhs-manual-blank')) return true;
      return Boolean(cleanText(node?.textContent || '') || node?.querySelector?.('img, .xhs-image-frame, .cover-image-frame'));
    }
    function isEmptyGeneratedFlowBlock(node) {
      if (!node?.classList) return false;
      if (node.classList.contains('xhs-caret-anchor')) return isEmptyCaretAnchor(node);
      if (node.classList.contains('xhs-manual-blank')) return false;
      if (node.classList.contains('xhs-callout')) return !cleanText(node.querySelector('.xhs-callout-body')?.textContent || '');
      if (node.classList.contains('xhs-p') || node.classList.contains('xhs-rich')) {
        if (node.classList.contains('xhs-manual-blank')) return false;
        return !cleanText(node.textContent) && !node.querySelector('br');
      }
      return false;
    }
    function hoistNestedBlockFromWrapper(nested, wrapper, frame) {
      if (!nested || !wrapper || wrapper.parentElement !== frame) return false;
      const before = wrapper.cloneNode(false);
      const after = wrapper.cloneNode(false);
      let seenNested = false;
      Array.from(wrapper.childNodes).forEach((child) => {
        if (child === nested) {
          seenNested = true;
          return;
        }
        (seenNested ? after : before).appendChild(child.cloneNode(true));
      });
      if (hasEditableContent(before)) wrapper.before(before);
      wrapper.before(nested);
      if (hasEditableContent(after)) wrapper.before(after);
      wrapper.remove();
      return true;
    }
    function normalizeNestedFlowBlocks(root) {
      const frame = root?.classList?.contains('xhs-body-frame') ? root : root?.querySelector?.('.xhs-body-frame, .xhs-cover-tail-frame');
      if (!frame) return false;
      let changed = false;
      Array.from(frame.querySelectorAll('.xhs-p > .xhs-callout, .xhs-rich > .xhs-callout, .xhs-p > .xhs-quote, .xhs-rich > .xhs-quote')).forEach((nested) => {
        const wrapper = nested.parentElement;
        if (hoistNestedBlockFromWrapper(nested, wrapper, frame)) changed = true;
      });
      Array.from(frame.querySelectorAll('.xhs-callout-body > .xhs-callout, .xhs-callout-body > .xhs-quote, .xhs-callout-body > .xhs-reason-stack, .xhs-quote > .xhs-callout, .xhs-quote > .xhs-quote')).forEach((nested) => {
        const host = nested.parentElement;
        const outer = host?.closest?.('.xhs-callout, .xhs-quote');
        if (outer && frame.contains(outer)) {
          outer.after(nested);
          changed = true;
        }
      });
      Array.from(frame.querySelectorAll('.xhs-heading .xhs-heading')).forEach((inner) => {
        const outer = inner.parentElement?.closest('.xhs-heading');
        if (outer && outer !== inner) {
          outer.replaceWith(inner);
          changed = true;
        }
      });
      Array.from(frame.querySelectorAll('.xhs-p > .xhs-heading, .xhs-rich > .xhs-heading, .xhs-heading-title > .xhs-heading')).forEach((nested) => {
        const wrapper = nested.parentElement;
        if (wrapper && frame.contains(wrapper)) {
          if (hoistNestedBlockFromWrapper(nested, wrapper, frame)) changed = true;
          else {
            wrapper.before(nested);
            changed = true;
          }
        }
      });
      Array.from(frame.children).forEach((node) => {
        if (node.classList?.contains('xhs-manual-blank')) return;
        if (isEmptyGeneratedFlowBlock(node)) {
          node.remove();
          changed = true;
        }
      });
      return changed;
    }
    function editableNodeToParagraph(node) {
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block';
      if (node.nodeType === Node.TEXT_NODE) {
        p.textContent = node.textContent || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        p.innerHTML = normalizeInlineHtml(node.innerHTML || node.textContent || '');
      }
      if (cleanText(p.textContent) || p.querySelector('img')) return p;
      return null;
    }
    function normalizeEditableBodyBlocks(root) {
      const frame = root?.classList?.contains('xhs-body-frame') ? root : root?.querySelector?.('.xhs-body-frame');
      if (!frame) return false;
      let changed = expandReasonStacksInFrame(frame);
      changed = normalizeListLinesInFrame(frame) || changed;
      changed = normalizeNestedFlowBlocks(frame) || changed;
      const normalized = [];
      Array.from(frame.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!cleanText(node.textContent)) return;
          const p = editableNodeToParagraph(node);
          if (p) normalized.push(p);
          changed = true;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === 'BR') {
          const p = makeEmptyParagraph();
          normalized.push(p);
          changed = true;
          return;
        }
        if (isStructuredFlowBlock(node)) {
          if (isEmptyGeneratedFlowBlock(node)) {
            changed = true;
            return;
          }
          normalized.push(node);
          return;
        }
        if (node.querySelector?.('.xhs-image-frame, .cover-image-frame, .xhs-image-grid, img')) {
          normalized.push(node);
          return;
        }
        const p = editableNodeToParagraph(node);
        if (p) normalized.push(p);
        changed = true;
      });
      if (!changed) return false;
      frame.innerHTML = '';
      normalized.forEach((node) => frame.appendChild(node));
      normalizeNestedFlowBlocks(frame);
      return true;
    }
    function paragraphFromElement(el) {
      const p = makeElement('p', 'xhs-p xhs-block', normalizeInlineHtml(el.innerHTML || el.textContent));
      return cleanText(p.textContent) ? p : null;
    }
    function richFromElement(el) {
      const rich = makeElement('section', 'xhs-rich xhs-block', normalizeInlineHtml(el.innerHTML || el.textContent));
      return cleanText(rich.textContent) || rich.querySelector('img') ? rich : null;
    }
    function convertSourceElement(el, index) {
      if (el.getAttribute?.('data-xhs-page-break') === '1' || el.dataset?.xhsPageBreak === '1') {
        const marker = makeElement('section', 'xhs-page-break xhs-block');
        marker.dataset.xhsPageBreak = '1';
        marker.setAttribute('aria-hidden', 'true');
        return [marker];
      }
      if (el.getAttribute?.('data-xhs-flow-blank') === '1' || el.dataset?.xhsFlowBlank === '1') {
        return [makeManualBlank()];
      }
      if (isHeroBlock(el, index)) return [];
      const text = cleanText(el.textContent);
      const imgs = Array.from(el.querySelectorAll('img')).filter((img) => img.getAttribute('src'));
      if (!text && !imgs.length) return [];
      if (imgs.length) return imageGroupFromImgs(imgs);
      if (el.dataset?.xhsBlockType === 'table' || el.tagName?.toLowerCase() === 'table' || el.querySelector('table')) {
        const table = tableFromElement(el);
        return table ? [table] : [];
      }
      if (isHeadingBlock(el)) return [headingFromElement(el)];
      if (isReasonListBlock(el)) return reasonListLinesFromElement(el);
      if (isQuoteBlock(el)) return [makeElement('section', 'xhs-quote xhs-block', normalizeInlineHtml(el.innerHTML || el.textContent))];
      if (isCalloutBlock(el)) return [calloutFromElement(el)];
      if (el.tagName && el.tagName.toLowerCase() === 'p') {
        const p = paragraphFromElement(el);
        return p ? [p] : [];
      }
      const rich = richFromElement(el);
      return rich ? [rich] : [];
    }
    function extractBlocksFromTemplate() {
      const tpl = document.getElementById('wechatTemplate');
      const sourceNodes = Array.from(tpl.content.cloneNode(true).children);
      const blocks = [];
      sourceNodes.forEach((el, index) => {
        convertSourceElement(el, index).forEach((block) => blocks.push(block));
      });
      return mergeAdjacentListParagraphs(blocks);
    }
    function outerHeight(node) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.height + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
    }
    function measureBlock(node) {
      measure.innerHTML = '';
      const clone = node.cloneNode(true);
      measure.appendChild(clone);
      return outerHeight(clone);
    }
    function htmlFromNodes(nodes) {
      return nodes.map((node) => node.outerHTML || esc(node.textContent)).join('');
    }
    function textLengthDeep(node) {
      if (!node) return 0;
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.length;
      return Array.from(node.childNodes || []).reduce((total, child) => total + textLengthDeep(child), 0);
    }
    function cloneTextRangeNode(node, start, end, state) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const nodeStart = state.pos;
        const nodeEnd = nodeStart + text.length;
        state.pos = nodeEnd;
        const from = Math.max(start, nodeStart);
        const to = Math.min(end, nodeEnd);
        if (to <= from) return null;
        return document.createTextNode(text.slice(from - nodeStart, to - nodeStart));
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const clone = node.cloneNode(false);
      Array.from(node.childNodes).forEach((child) => {
        const next = cloneTextRangeNode(child, start, end, state);
        if (next) clone.appendChild(next);
      });
      return clone.childNodes.length ? clone : null;
    }
    function cloneTextRangeElement(el, start, end) {
      const state = { pos: 0 };
      const clone = el.cloneNode(false);
      Array.from(el.childNodes).forEach((child) => {
        const next = cloneTextRangeNode(child, start, end, state);
        if (next) clone.appendChild(next);
      });
      return clone;
    }
    function flowIdFor(block) {
      if (!block.dataset.flowId) block.dataset.flowId = 'flow-' + (++splitFlowCounter);
      return block.dataset.flowId;
    }
    function markSplitPart(node, id, kind) {
      wrapBodyTextLines(node);
      node.dataset.flowId = id;
      node.dataset.split = kind;
      node.classList.toggle('xhs-split-head', kind === 'head');
      node.classList.toggle('xhs-split-tail', kind === 'tail');
      return node;
    }
    function isPlainSplittable(block) {
      return (block.classList.contains('xhs-p') || block.classList.contains('xhs-rich')) &&
        !block.classList.contains('xhs-list-line') &&
        !block.classList.contains('xhs-manual-blank');
    }
    function isAtomicFlowBlock(block) {
      return block.classList.contains('xhs-heading') ||
        block.classList.contains('xhs-callout') ||
        block.classList.contains('xhs-quote') ||
        block.classList.contains('xhs-image-block') ||
        block.classList.contains('xhs-image-grid') ||
        block.classList.contains('xhs-table-block') ||
        block.classList.contains('xhs-manual-blank');
    }
    function isSplittableTextBlock(block) {
      return isPlainSplittable(block) && !isAtomicFlowBlock(block);
    }
    function sanitizeMergedFlowBlocks(blocks) {
      return blocks.filter((node) => {
        if (node.classList?.contains('xhs-manual-blank') || node.dataset?.xhsPageBreak === '1') return true;
        if (node.classList?.contains('xhs-caret-anchor')) return false;
        if (isEmptyGeneratedFlowBlock(node) && isPlainSplittable(node)) return false;
        return true;
      });
    }
    function preferredTextSplitIndex(text, best, total) {
      if (!text || best <= 2 || best >= total - 1) return best;
      const lower = Math.max(2, best - 90);
      const boundary = /[。！？!?；;，,、：:]/;
      for (let i = best - 1; i >= lower; i--) {
        if (!boundary.test(text[i])) continue;
        let next = i + 1;
        while (next < total && /[”’」』）】》]/.test(text[next])) next += 1;
        if (next >= 2 && total - next >= 2) return next;
      }
      return best;
    }
    function splitPlainTextBlock(block, available) {
      const total = textLengthDeep(block);
      const oneLine = config.bodyFontSize * config.bodyLineHeight;
      if (total < 4 || available < Math.max(24, oneLine * 0.45)) return null;
      const id = flowIdFor(block);
      let lo = 1;
      let hi = total - 1;
      let best = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const head = markSplitPart(cloneTextRangeElement(block, 0, mid), id, 'head');
        if (!cleanText(head.textContent)) {
          lo = mid + 1;
          continue;
        }
        const h = measureBlock(head);
        if (h <= available) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best < 1 || best >= total - 1) return null;
      const rawBest = best;
      const preferred = preferredTextSplitIndex(block.textContent || '', rawBest, total);
      if (preferred !== rawBest) {
        const preferredHead = markSplitPart(cloneTextRangeElement(block, 0, preferred), id, 'head');
        const preferredHeight = measureBlock(preferredHead);
        const leavesTinyGap = available - preferredHeight <= oneLine * 0.25;
        best = leavesTinyGap ? preferred : rawBest;
      }
      const head = markSplitPart(cloneTextRangeElement(block, 0, best), id, 'head');
      const tail = markSplitPart(cloneTextRangeElement(block, best, total), id, 'tail');
      return cleanText(head.textContent) && cleanText(tail.textContent) ? { head, tail } : null;
    }
    function splitCalloutBlock(block, available) {
      const body = block.querySelector('.xhs-callout-body');
      if (!body) return null;
      const total = textLengthDeep(body);
      if (total < 10 || available < Math.max(118, config.bodyFontSize * config.bodyLineHeight * 2)) return null;
      const id = flowIdFor(block);
      let lo = 1;
      let hi = total - 1;
      let best = 0;
      function makePart(end) {
        const part = block.cloneNode(true);
        const partBody = part.querySelector('.xhs-callout-body');
        partBody.innerHTML = '';
        const piece = cloneTextRangeElement(body, 0, end);
        Array.from(piece.childNodes).forEach((node) => partBody.appendChild(node));
        return markSplitPart(part, id, 'head');
      }
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const head = makePart(mid);
        if (!cleanText(head.textContent)) {
          lo = mid + 1;
          continue;
        }
        const h = measureBlock(head);
        if (h <= available) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best < 2 || best >= total - 1) return null;
      const head = makePart(best);
      const tail = block.cloneNode(true);
      tail.querySelector('.xhs-callout-label')?.remove();
      const tailBody = tail.querySelector('.xhs-callout-body');
      tailBody.innerHTML = '';
      const tailPiece = cloneTextRangeElement(body, best, total);
      Array.from(tailPiece.childNodes).forEach((node) => tailBody.appendChild(node));
      markSplitPart(tail, id, 'tail');
      return cleanText(head.textContent) && cleanText(tail.textContent) ? { head, tail } : null;
    }
    function splitTableBlock(block, available) {
      const rows = Array.from(block.querySelectorAll('tbody > tr'));
      if (rows.length < 2 || available < 120) return null;
      const id = flowIdFor(block);
      function makePart(from, to, kind) {
        const part = block.cloneNode(true);
        const body = part.querySelector('tbody');
        body.innerHTML = '';
        rows.slice(from, to).forEach((row) => body.appendChild(row.cloneNode(true)));
        return markSplitPart(part, id, kind);
      }
      let best = 0;
      let lo = 1;
      let hi = rows.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = makePart(0, mid, 'head');
        if (measureBlock(candidate) <= available) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best < 1 || best >= rows.length) return null;
      return {
        head: makePart(0, best, 'head'),
        tail: makePart(best, rows.length, 'tail'),
      };
    }
    function splitTextBlockToFit(block, available) {
      if (!isSplittableTextBlock(block)) return null;
      return splitPlainTextBlock(block, available);
    }
    function isSplittableBlock(block) {
      if (isSplittableTextBlock(block)) return true;
      if (block.classList.contains('xhs-callout')) return true;
      if (block.classList.contains('xhs-table-block')) {
        return block.querySelectorAll('tbody > tr').length >= 2;
      }
      return false;
    }
    function splitBlockToFit(block, available) {
      if (isSplittableTextBlock(block)) return splitPlainTextBlock(block, available);
      if (block.classList.contains('xhs-callout')) return splitCalloutBlock(block, available);
      if (block.classList.contains('xhs-table-block')) return splitTableBlock(block, available);
      return null;
    }
    function paginateBlocks(blocks) {
      const nextPages = [];
      let current = [];
      let used = 0;
      function pushPage() {
        if (current.length) nextPages.push({ type: 'body', html: htmlFromNodes(current) });
        current = [];
        used = 0;
      }
      for (const sourceBlock of blocks) {
        if (sourceBlock.dataset?.xhsPageBreak === '1') {
          pushPage();
          continue;
        }
        let pending = sourceBlock.cloneNode(true);
        while (pending) {
          let block = pending;
          wrapBodyTextLines(block);
          let h = measureBlock(block);
          let remaining = config.pageLimit - used;
          if (current.length && block.classList.contains('xhs-heading') && block.dataset.level !== '2' && remaining < 160) {
            pushPage();
            remaining = config.pageLimit;
          }
          if (current.length && h > remaining) {
            if (isSplittableBlock(block)) {
              const split = splitBlockToFit(block, remaining);
              if (split) {
                current.push(split.head);
                pushPage();
                pending = split.tail;
                continue;
              }
            }
            pushPage();
            continue;
          }
          if (!current.length && h > config.pageLimit && isSplittableBlock(block)) {
            const split = splitBlockToFit(block, config.pageLimit);
            if (split) {
              current.push(split.head);
              pushPage();
              pending = split.tail;
              continue;
            }
          }
          if (!current.length && h > config.pageLimit && (block.classList.contains('xhs-image-block') || block.classList.contains('xhs-image-grid'))) {
            const frames = Array.from(block.querySelectorAll('.xhs-image-frame'));
            const nextHeight = Math.floor(config.pageLimit * (block.classList.contains('xhs-image-grid') ? 0.38 : 0.86));
            frames.forEach((frame) => {
              if (frame.dataset.userHeight !== '1') frame.style.height = nextHeight + 'px';
            });
            h = measureBlock(block);
          }
          current.push(block);
          used += h;
          pending = null;
        }
      }
      pushPage();
      return nextPages;
    }
    function paginateBlocksWithCoverTail(blocks, coverPage) {
      const tailLimit = Number(config.coverTailLimit || Math.floor(config.pageLimit * 0.55));
      const tailNodes = [];
      let used = 0;
      let tailClosed = false;
      const rest = [];
      for (const sourceBlock of blocks) {
        if (sourceBlock.dataset?.xhsPageBreak === '1') {
          if (!tailClosed) tailClosed = true;
          else rest.push(sourceBlock);
          continue;
        }
        if (tailClosed) {
          rest.push(sourceBlock);
          continue;
        }
        let pending = sourceBlock.cloneNode(true);
        let placed = false;
        while (pending) {
          let block = pending;
          wrapBodyTextLines(block);
          let h = measureBlock(block);
          const remaining = tailLimit - used;
          if (h > remaining && isSplittableBlock(block)) {
            const split = splitBlockToFit(block, Math.max(remaining, tailLimit));
            if (split) {
              tailNodes.push(split.head);
              rest.push(split.tail);
              used += measureBlock(split.head);
              tailClosed = true;
              pending = null;
              placed = true;
              continue;
            }
          }
          if (!tailNodes.length && h > tailLimit && isSplittableBlock(block)) {
            const split = splitBlockToFit(block, tailLimit);
            if (split) {
              tailNodes.push(split.head);
              rest.push(split.tail);
              used = tailLimit;
              tailClosed = true;
              pending = null;
              placed = true;
              continue;
            }
          }
          if (h <= remaining || (!tailNodes.length && h <= tailLimit + 40)) {
            tailNodes.push(block);
            used += h;
            pending = null;
            placed = true;
          } else {
            pending = null;
          }
        }
        if (!placed) {
          rest.push(sourceBlock);
          tailClosed = true;
        }
      }
      coverPage.tailHtml = htmlFromNodes(tailNodes);
      return paginateBlocks(rest);
    }
    function initialCoverHtml() {
      const sub = config.subtitle ? esc(config.subtitle) : '';
      return '<div class="cover-media"><div class="cover-image-frame selectable-image" data-fit="cover" data-role="cover"><div class="cover-placeholder">点击替换封面图</div></div></div>' +
        '<div class="cover-text"><div class="cover-title" contenteditable="true" spellcheck="false">' + esc(config.title) + '</div><div class="cover-title-bar"></div>' +
        '<div class="cover-subtitle" contenteditable="true" spellcheck="false" data-placeholder="点击这里填写副标题">' + sub + '</div></div>';
    }
    function paginate() {
      const blocks = pairAdjacentPortraitImages(extractBlocksFromTemplate());
      const cover = { type: 'cover', html: initialCoverHtml(), tailHtml: '' };
      pages = [cover].concat(
        coverImageEnabled ? paginateBlocks(blocks) : paginateBlocksWithCoverTail(blocks, cover)
      );
      pageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
      selectedFrame = null;
      renderAll();
    }
    function cardHtml(page) {
      if (!page) page = { type: 'body', html: '' };
      if (page.type === 'cover') {
        const noCover = !coverImageEnabled;
        const tail = noCover
          ? '<div class="xhs-body-frame xhs-cover-tail-frame" contenteditable="true" spellcheck="false">' + (page.tailHtml || '') + '</div>'
          : '';
        return '<div class="xhs-card xhs-cover-card' + (noCover ? ' no-cover-image' : '') + '">' + page.html + tail + '</div>';
      }
      return '<div class="xhs-card xhs-body-card"><div class="xhs-body-frame" contenteditable="true" spellcheck="false">' + page.html + '</div></div>';
    }
    function fitStage() {
      const box = stageWrap.getBoundingClientRect();
      const scale = box.width / config.width;
      stageScale.style.transform = 'scale(' + scale + ')';
    }
    function renderTabs() {
      pageTabs.innerHTML = pages.map((_, i) => '<button class="' + (i === pageIndex ? 'active' : '') + '" data-index="' + i + '">' + String(i + 1).padStart(2, '0') + '</button>').join('');
      pageTabs.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          saveCurrentPage({ skipNormalize: true });
          persistDraftCheckpoint();
          pageIndex = Number(button.dataset.index);
          selectedFrame = null;
          renderAll();
        });
      });
    }
    function imageFrameParentWidth(block, scale) {
      const parent = block?.parentElement;
      const rect = parent?.getBoundingClientRect?.();
      const width = rect?.width ? rect.width / Math.max(0.1, scale) : config.bodyContentWidth;
      return Math.max(1, width);
    }
    function applyFrameSizeFromDrag(frame, block, start, mode, event) {
      const scale = Math.max(0.1, start.scale || 1);
      const dx = (event.clientX - start.x) / scale;
      const dy = (event.clientY - start.y) / scale;
      if (mode.includes('e') && block) {
        const nextWidth = Math.max(80, Math.min(start.parentWidth * 1.6, start.blockWidth + dx));
        const pct = Math.round((nextWidth / start.parentWidth) * 100);
        block.style.width = Math.max(35, Math.min(160, pct)) + '%';
        block.dataset.manualWidth = '1';
        imageWidthRange.value = String(Math.round(parsePercent(block.style.width, 100)));
      }
      if (mode.includes('s')) {
        const nextHeight = Math.max(90, Math.min(config.height * 1.4, start.frameHeight + dy));
        frame.style.height = Math.round(nextHeight) + 'px';
        frame.dataset.userHeight = '1';
        imageHeightRange.value = String(Math.round(nextHeight));
      }
      saveCurrentPage();
    }
    function bindResizeHandle(handle, frame) {
      if (handle.dataset.resizeBound === '1') return;
      handle.dataset.resizeBound = '1';
      let drag = null;
      handle.addEventListener('pointerdown', (event) => {
        const block = frame.closest('.xhs-image-block');
        if (!block) return;
        event.preventDefault();
        event.stopPropagation();
        selectFrame(frame);
        const scale = stageLocalScale(frame);
        drag = {
          id: event.pointerId,
          mode: handle.dataset.resizeDir || 'se',
          x: event.clientX,
          y: event.clientY,
          scale,
          blockWidth: block.getBoundingClientRect().width / Math.max(0.1, scale),
          parentWidth: imageFrameParentWidth(block, scale),
          frameHeight: frame.getBoundingClientRect().height / Math.max(0.1, scale),
        };
        frame.dataset.resizing = '1';
        frame.classList.add('resizing-image-frame');
        window.clearTimeout(imageReflowTimer);
        handle.setPointerCapture?.(event.pointerId);
      });
      handle.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        event.preventDefault();
        event.stopPropagation();
        applyFrameSizeFromDrag(frame, frame.closest('.xhs-image-block'), drag, drag.mode, event);
      });
      function finishResize(event) {
        if (!drag || event.pointerId !== drag.id) return;
        event.preventDefault();
        event.stopPropagation();
        handle.releasePointerCapture?.(event.pointerId);
        frame.dataset.resizing = '0';
        frame.classList.remove('resizing-image-frame');
        drag = null;
        saveCurrentPage();
        scheduleImageLayoutReflow(120);
      }
      handle.addEventListener('pointerup', finishResize);
      handle.addEventListener('pointercancel', finishResize);
    }
    function ensureResizeHandles(frame) {
      if (!frame.classList.contains('xhs-image-frame') || frame.classList.contains('cover-image-frame')) return;
      ['e', 's', 'se'].forEach((dir) => {
        let handle = frame.querySelector('.xhs-resize-handle.handle-' + dir);
        if (!handle) {
          handle = document.createElement('span');
          handle.className = 'xhs-resize-handle handle-' + dir;
          handle.dataset.resizeDir = dir;
          handle.setAttribute('aria-hidden', 'true');
          frame.appendChild(handle);
        }
        bindResizeHandle(handle, frame);
      });
    }
    function bindSelectableFrame(frame) {
      if (boundFrames.has(frame)) return;
      boundFrames.add(frame);
      ensureResizeHandles(frame);
      frame.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectFrame(frame);
        if (frame.classList.contains('cover-image-frame') && !frame.querySelector('img')) replaceImage();
      });
      frame.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectFrame(frame);
        replaceImage();
      });
      bindImageDrag(frame);
      if (imageResizeObserver && frame.classList.contains('xhs-image-frame') && !frame.classList.contains('cover-image-frame')) {
        frame.dataset.lastObservedHeight = String(Math.round(frame.clientHeight || parseFloat(frame.style.height || 0) || 0));
        imageResizeObserver.observe(frame);
      }
    }
    function isEmptyCaretAnchor(node) {
      return node?.classList?.contains('xhs-caret-anchor') && !cleanText(node.textContent) && !node.querySelector('img');
    }
    function isEditorHardBlock(node) {
      return node?.classList?.contains('xhs-image-block') ||
        node?.classList?.contains('xhs-image-grid') ||
        node?.classList?.contains('xhs-callout') ||
        node?.classList?.contains('xhs-quote') ||
        node?.classList?.contains('xhs-table-block');
    }
    function makeCaretAnchor() {
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block xhs-caret-anchor';
      p.innerHTML = '<br>';
      return p;
    }
    function makeManualBlank() {
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block xhs-manual-blank';
      p.innerHTML = '<br>';
      return p;
    }
    function ensureEditorCaretAnchors(root = stageScale) {
      const frames = Array.from(root.querySelectorAll('.xhs-body-frame, .xhs-cover-tail-frame'));
      frames.forEach((frame) => {
        frame.querySelectorAll('.xhs-caret-anchor').forEach((node) => {
          if (isEmptyCaretAnchor(node)) node.remove();
        });
        Array.from(frame.children).forEach((node) => {
          if (!isEditorHardBlock(node) && !node.classList?.contains('xhs-heading')) return;
          const next = node.nextElementSibling;
          if (next?.classList?.contains('xhs-caret-anchor')) return;
          if (!next || isEditorHardBlock(next) || next.classList?.contains('xhs-heading')) {
            node.after(makeCaretAnchor());
          }
        });
      });
    }
    function stripCaretAnchors(root) {
      root.querySelectorAll('.xhs-caret-anchor').forEach((node) => {
        if (isEmptyCaretAnchor(node)) node.remove();
        else node.classList.remove('xhs-caret-anchor');
      });
    }
    function renderStage() {
      stageScale.innerHTML = cardHtml(pages[pageIndex]);
      removeAutoLineBreaks(stageScale);
      normalizeUnderlineDecorations(stageScale);
      normalizeCalloutBodyLabels(stageScale);
      const coverCard = stageScale.querySelector('.xhs-cover-card');
      if (coverCard) coverCard.classList.toggle('no-cover-image', !coverImageEnabled);
      sanitizeCoverTitleNode(stageScale.querySelector('.cover-title'));
      balanceCoverSubtitle();
      balanceCoverTitle();
      normalizeHeadings(stageScale);
      stageScale.querySelectorAll('.xhs-body-frame, .xhs-cover-tail-frame').forEach((frame) => {
        expandReasonStacksInFrame(frame);
        normalizeListLinesInFrame(frame);
      });
      ensureEditorCaretAnchors(stageScale);
      stageScale.querySelectorAll('.selectable-image').forEach(bindSelectableFrame);
      const bodyFrame = stageScale.querySelector('.xhs-body-card .xhs-body-frame');
      const coverTailFrame = stageScale.querySelector('.xhs-cover-tail-frame');
      if (bodyFrame) bindBodyFrameReorder(bodyFrame);
      if (coverTailFrame) bindBodyFrameReorder(coverTailFrame);
      bindEditableReflow();
      bindBlockHalo();
      clearSelectedFlowBlock();
      syncPanelTools();
      if (pages[pageIndex]?.type === 'cover') saveCurrentPage();
    }
    function normalizeLooseImages(root = stageScale) {
      let changed = false;
      const insertionAnchors = new Map();
      const looseImages = Array.from(root.querySelectorAll('img')).filter((img) => {
        return !img.closest('.xhs-image-frame') && !img.closest('.cover-image-frame');
      });
      looseImages.forEach((img) => {
        const block = imageBlockFromSrc(img.getAttribute('src') || img.src || '', img.getAttribute('alt') || '');
        const textBlock = img.closest('.xhs-p, .xhs-rich, .xhs-quote, .xhs-callout, .xhs-list-line');
        if (textBlock && textBlock.parentNode && root.contains(textBlock)) {
          const anchor = insertionAnchors.get(textBlock) || textBlock;
          textBlock.parentNode.insertBefore(block, anchor.nextSibling);
          insertionAnchors.set(textBlock, block);
          img.remove();
          if (!cleanText(textBlock.textContent) && !textBlock.querySelector('img')) textBlock.remove();
        } else {
          img.replaceWith(block);
        }
        changed = true;
      });
      if (changed) {
        stageScale.querySelectorAll('.selectable-image').forEach(bindSelectableFrame);
        renderImageList();
        syncImageTools();
      }
      return changed;
    }
    function readFileAsDataUrl(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    }
    function insertNodesAtSelection(nodes, editable) {
      const selection = window.getSelection();
      let range = null;
      if (selection && selection.rangeCount) {
        const candidate = selection.getRangeAt(0);
        const parent = candidate.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? candidate.commonAncestorContainer
          : candidate.commonAncestorContainer.parentElement;
        if (parent && editable.contains(parent)) {
          const textBlock = parent.closest?.('.xhs-p, .xhs-rich, .xhs-quote, .xhs-callout, .xhs-list-line');
          if (textBlock && editable.contains(textBlock)) {
            textBlock.after(...nodes);
            selection.removeAllRanges();
            return;
          }
          range = candidate;
        }
      }
      if (!range) {
        nodes.forEach((node) => editable.appendChild(node));
        return;
      }
      range.deleteContents();
      nodes.forEach((node) => {
        range.insertNode(node);
        range.setStartAfter(node);
      });
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    async function handleImagePaste(event, editable) {
      const files = Array.from(event.clipboardData?.files || []).filter((file) => /^image\//i.test(file.type));
      if (files.length) {
        event.preventDefault();
        const srcs = (await Promise.all(files.map(readFileAsDataUrl))).filter(Boolean);
        if (!srcs.length) return;
        const blocks = srcs.map((src) => imageBlockFromSrc(src));
        const nodes = blocks.length > 1 ? [imageGridFromBlocks(blocks)] : blocks;
        insertNodesAtSelection(nodes, editable);
        stageScale.querySelectorAll('.selectable-image').forEach(bindSelectableFrame);
        saveCurrentPage();
        reflow();
        return;
      }
      window.setTimeout(() => {
        if (normalizeLooseImages(editable)) {
          saveCurrentPage();
          reflow();
        }
      }, 30);
    }
    function saveCurrentPage(options = {}) {
      const skipNormalize = Boolean(options.skipNormalize);
      const page = pages[pageIndex];
      const card = stageScale.querySelector('.xhs-card');
      if (!page || !card) return;
      if (!skipNormalize && (page.type !== 'cover' || card.querySelector('.xhs-cover-tail-frame'))) {
        normalizeLooseImages(card);
        normalizeHeadings(card);
        normalizeEditableBodyBlocks(card);
      }
      normalizeUnderlineDecorations(card);
      const clone = card.cloneNode(true);
      removeAutoLineBreaks(clone);
      stripCaretAnchors(clone);
      clone.querySelectorAll('.selected-image-frame').forEach((node) => node.classList.remove('selected-image-frame'));
      clone.querySelectorAll('.selected-flow-block').forEach((node) => node.classList.remove('selected-flow-block'));
      clone.querySelectorAll('.resizing-image-frame').forEach((node) => node.classList.remove('resizing-image-frame'));
      clone.querySelectorAll('.xhs-resize-handle').forEach((node) => node.remove());
      if (page.type === 'cover') {
        const tail = clone.querySelector('.xhs-cover-tail-frame');
        if (tail) {
          page.tailHtml = tail.innerHTML;
          tail.remove();
        } else {
          page.tailHtml = page.tailHtml || '';
        }
        page.html = clone.innerHTML;
      } else {
        const frame = clone.querySelector('.xhs-body-card .xhs-body-frame') || clone.querySelector('.xhs-body-frame:not(.xhs-cover-tail-frame)');
        if (frame) page.html = frame.innerHTML;
      }
      persistDraft();
    }
    function scheduleLightSave() {
      if (isComposingText) return;
      window.clearTimeout(lightSaveTimer);
      lightSaveTimer = window.setTimeout(() => saveCurrentPage({ skipNormalize: true }), 180);
    }
    function scheduleOverflowReflow(force = false) {
      if (isComposingText) {
        compositionNeedsReflow = compositionNeedsReflow || force;
        return;
      }
      window.clearTimeout(reflowTimer);
      if (force) reflowForcePending = true;
      const delay = force ? 520 : 1400;
      reflowTimer = window.setTimeout(() => {
        if (isComposingText) {
          compositionNeedsReflow = compositionNeedsReflow || force || reflowForcePending;
          return;
        }
        const frame = stageScale.querySelector('.xhs-cover-tail-frame') ||
          stageScale.querySelector('.xhs-body-card .xhs-body-frame');
        if (!frame) {
          saveCurrentPage({ skipNormalize: true });
          reflowForcePending = false;
          return;
        }
        saveCurrentPage({ skipNormalize: true });
        if (force || reflowForcePending || frame.scrollHeight > frame.clientHeight + 8) reflow();
        reflowForcePending = false;
      }, delay);
    }
    function insertReflowCaretMarker() {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return '';
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const frame = element?.closest?.('.xhs-body-frame, .xhs-cover-tail-frame');
      if (!frame || !stageScale.contains(frame)) return '';
      const id = 'caret-' + (++caretMarkerCounter);
      const marker = document.createElement('span');
      marker.className = 'xhs-caret-marker';
      marker.dataset.xhsCaretMarker = id;
      marker.textContent = String.fromCharCode(8288);
      range.insertNode(marker);
      range.setStartAfter(marker);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return id;
    }
    function pageIndexForCaretMarker(id) {
      if (!id) return -1;
      const token = 'data-xhs-caret-marker="' + id + '"';
      return pages.findIndex((page) => String(page.html || '').includes(token) || String(page.tailHtml || '').includes(token));
    }
    function restoreReflowCaretMarker(id) {
      if (!id) return false;
      const marker = stageScale.querySelector('[data-xhs-caret-marker="' + id + '"]');
      if (!marker) return false;
      const parent = marker.parentNode;
      const next = marker.nextSibling;
      const previous = marker.previousSibling;
      const editable = marker.closest('[contenteditable="true"]');
      marker.remove();
      editable?.focus?.({ preventScroll: true });
      const selection = window.getSelection();
      if (!selection || !parent) return false;
      const range = document.createRange();
      if (next?.isConnected && next.nodeType === Node.TEXT_NODE) {
        range.setStart(next, 0);
      } else if (next?.isConnected) {
        range.setStartBefore(next);
      } else if (previous?.isConnected && previous.nodeType === Node.TEXT_NODE) {
        range.setStart(previous, (previous.textContent || '').length);
      } else if (previous?.isConnected) {
        range.setStartAfter(previous);
      } else {
        range.selectNodeContents(parent);
        range.collapse(false);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      saveCurrentPage();
      return true;
    }
    function setCaretInside(node) {
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    function headingTextBeforeRange(heading, range) {
      const probe = document.createRange();
      probe.selectNodeContents(heading);
      try {
        probe.setEnd(range.startContainer, range.startOffset);
        return cleanText(probe.toString());
      } catch (_) {
        return cleanText(heading.textContent);
      } finally {
        probe.detach?.();
      }
    }
    function headingTextAfterRange(heading, range) {
      const probe = document.createRange();
      probe.selectNodeContents(heading);
      try {
        probe.setStart(range.endContainer, range.endOffset);
        return cleanText(probe.toString());
      } catch (_) {
        return '';
      } finally {
        probe.detach?.();
      }
    }
    function insertBlankParagraphNearHeading(heading, beforeHeading) {
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block xhs-manual-blank';
      p.innerHTML = '<br>';
      normalizeHeadingBlock(heading);
      if (beforeHeading) heading.before(p);
      else heading.after(p);
      setCaretInside(p);
      markParagraphEnterHandled();
      saveCurrentPage();
      scheduleOverflowReflow(true);
      return true;
    }
    function handleHeadingEnter(event) {
      if (event.key !== 'Enter' || isHistoryShortcut(event)) return false;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return false;
      const range = selection.getRangeAt(0);
      const parent = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const heading = parent?.closest?.('.xhs-heading');
      if (!heading || !stageScale.contains(heading)) return false;
      event.preventDefault();
      const title = parent?.closest?.('.xhs-heading-title');
      if (title && heading.contains(title)) {
        const beforeTitleText = headingTextBeforeRange(title, range);
        const afterTitleText = headingTextAfterRange(title, range);
        if (!event.shiftKey && (!beforeTitleText || !afterTitleText)) {
          return insertBlankParagraphNearHeading(heading, !beforeTitleText);
        }
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        markParagraphEnterHandled();
        saveCurrentPage();
        scheduleOverflowReflow(true);
        return true;
      }
      const beforeText = headingTextBeforeRange(heading, range);
      const inserted = insertBlankParagraphNearHeading(heading, !beforeText);
      if (inserted) markParagraphEnterHandled();
      return inserted;
    }
    function listMarkerElement(listType = 'unordered', index = 1) {
      const marker = document.createElement('span');
      if (listType === 'ordered') {
        marker.className = 'xhs-list-marker xhs-list-marker-ordered';
        marker.textContent = String(index) + '.';
      } else {
        marker.className = 'xhs-list-marker xhs-list-marker-dot';
      }
      marker.contentEditable = 'false';
      return marker;
    }
    function buildListLine(entry, listType = 'unordered', index = 1, options = {}) {
      const normalizedType = listType === 'ordered' ? 'ordered' : 'unordered';
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block xhs-list-line';
      p.dataset.listType = normalizedType;
      const body = document.createElement('span');
      body.className = 'xhs-list-body';
      body.innerHTML = options.preserveBodyHtml
        ? (entry.html || '<br>')
        : (stripListMarkerFromHtml(entry.html) || '<br>');
      p.append(listMarkerElement(normalizedType, index), body);
      return p;
    }
    function buildListLines(items, listType = 'unordered') {
      return items.map((entry, index) => buildListLine(entry, listType, index + 1));
    }
    function collectContiguousListLines(line) {
      if (!line?.classList?.contains('xhs-list-line')) return [line].filter(Boolean);
      const listType = line.dataset.listType || 'unordered';
      const group = [line];
      let prev = line.previousElementSibling;
      while (prev?.classList?.contains('xhs-caret-anchor')) prev = prev.previousElementSibling;
      while (prev?.classList?.contains('xhs-list-line') && (prev.dataset.listType || 'unordered') === listType) {
        group.unshift(prev);
        prev = prev.previousElementSibling;
        while (prev?.classList?.contains('xhs-caret-anchor')) prev = prev.previousElementSibling;
      }
      let next = line.nextElementSibling;
      while (next?.classList?.contains('xhs-caret-anchor')) next = next.nextElementSibling;
      while (next?.classList?.contains('xhs-list-line') && (next.dataset.listType || 'unordered') === listType) {
        group.push(next);
        next = next.nextElementSibling;
        while (next?.classList?.contains('xhs-caret-anchor')) next = next.nextElementSibling;
      }
      return group;
    }
    function renumberContiguousListLines(activeLine) {
      const listType = activeLine?.dataset?.listType === 'ordered' ? 'ordered' : 'unordered';
      collectContiguousListLines(activeLine).forEach((line, index) => {
        line.dataset.listType = listType;
        const marker = line.querySelector('.xhs-list-marker');
        marker?.replaceWith(listMarkerElement(listType, index + 1));
      });
    }
    function splitListBodyHtml(textEl, range) {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(textEl);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeHolder = document.createElement('div');
      beforeHolder.appendChild(beforeRange.cloneContents());
      const beforeHtml = beforeHolder.innerHTML || '';
      const afterRange = document.createRange();
      afterRange.selectNodeContents(textEl);
      afterRange.setStart(range.startContainer, range.startOffset);
      const afterHolder = document.createElement('div');
      afterHolder.appendChild(afterRange.cloneContents());
      const afterHtml = afterHolder.innerHTML || '';
      return {
        beforeHtml,
        afterHtml,
        valid: htmlTextContent(beforeHtml) + htmlTextContent(afterHtml) === (textEl.textContent || ''),
      };
    }
    function convertListLineToParagraph(line) {
      const body = line?.querySelector?.('.xhs-list-body');
      if (!body || !line?.classList?.contains('xhs-list-line')) return null;
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block';
      p.innerHTML = body.innerHTML || '<br>';
      line.replaceWith(p);
      return p;
    }
    function removeEmptyListLine(line) {
      const frame = line?.closest?.('[contenteditable="true"]');
      let nextFocus = line.nextElementSibling;
      while (nextFocus?.classList?.contains('xhs-caret-anchor')) nextFocus = nextFocus.nextElementSibling;
      if (!nextFocus) {
        nextFocus = line.previousElementSibling;
        while (nextFocus?.classList?.contains('xhs-caret-anchor')) nextFocus = nextFocus.previousElementSibling;
      }
      line.remove();
      if (nextFocus && frame) {
        frame.focus({ preventScroll: true });
        setCaretInside(nearestCaretTarget(nextFocus));
      }
      return nextFocus;
    }
    function handleParagraphBackspace(event) {
      if (event.key !== 'Backspace' || isHistoryShortcut(event)) return false;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
      const range = selection.getRangeAt(0);
      const frame = event.currentTarget;
      const block = directFlowChild(frame, range.startContainer, range.startOffset);
      if (!isEditableParagraphBlock(block)) return false;
      if (!isCaretAtFieldStart(range, block)) return false;
      event.preventDefault();
      const prev = block.previousElementSibling;
      while (prev?.classList?.contains('xhs-caret-anchor')) prev = prev.previousElementSibling;
      if (!cleanText(block.textContent)) {
        block.remove();
        if (prev) {
          frame.focus({ preventScroll: true });
          setCaretAtFieldEnd(nearestCaretTarget(prev) || prev);
        }
      } else if (prev && isEditableParagraphBlock(prev)) {
        const mergeOffset = (prev.textContent || '').length;
        prev.innerHTML = normalizeInlineHtml((prev.innerHTML || '') + (block.innerHTML || ''));
        block.remove();
        frame.focus({ preventScroll: true });
        const textNode = prev.firstChild;
        if (textNode?.nodeType === Node.TEXT_NODE) {
          const nextRange = document.createRange();
          nextRange.setStart(textNode, Math.min(mergeOffset, textNode.textContent.length));
          nextRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(nextRange);
        } else {
          setCaretAtFieldEnd(prev);
        }
      } else {
        return false;
      }
      saveCurrentPage({ skipNormalize: true });
      scheduleOverflowReflow(false);
      return true;
    }
    function performParagraphEnter(frame, range) {
      if (paragraphEnterKeydownHandled) return false;
      const block = directFlowChild(frame, range.startContainer, range.startOffset);
      if (!isEditableParagraphBlock(block)) return false;
      saveCurrentPage({ skipNormalize: true });
      persistDraftCheckpoint();
      if (isCaretAtFieldStart(range, block)) {
        markParagraphEnterHandled();
        const emptyP = makeEmptyParagraph();
        block.before(emptyP);
        frame.focus({ preventScroll: true });
        setCaretInside(emptyP);
      } else if (isCaretAtFieldEnd(range, block)) {
        markParagraphEnterHandled();
        const emptyP = makeEmptyParagraph();
        block.after(emptyP);
        frame.focus({ preventScroll: true });
        setCaretInside(emptyP);
      } else {
        const { beforeHtml, afterHtml, valid } = splitParagraphHtml(block, range);
        if (!valid) return false;
        markParagraphEnterHandled();
        block.innerHTML = beforeHtml || '<br>';
        const nextP = makeEmptyParagraph();
        if (afterHtml) {
          nextP.innerHTML = afterHtml;
          nextP.classList.remove('xhs-manual-blank');
        }
        block.after(nextP);
        frame.focus({ preventScroll: true });
        setCaretInside(nextP);
      }
      return true;
    }
    function handleParagraphEnter(event) {
      if (event.key !== 'Enter' || event.shiftKey || isHistoryShortcut(event)) return false;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
      const range = selection.getRangeAt(0);
      const frame = event.currentTarget;
      if (!performParagraphEnter(frame, range)) return false;
      event.preventDefault();
      event.stopPropagation();
      saveCurrentPage({ skipNormalize: true });
      scheduleParagraphOverflowCheck(frame);
      return true;
    }
    function rangeFromBeforeInputEvent(event) {
      try {
        const target = event.getTargetRanges?.()[0];
        if (target?.startContainer && target?.endContainer) {
          const range = document.createRange();
          range.setStart(target.startContainer, target.startOffset);
          range.setEnd(target.endContainer, target.endOffset);
          return range;
        }
      } catch (_) {}
      const selection = window.getSelection();
      return selection?.rangeCount ? selection.getRangeAt(0) : null;
    }
    function handleBodyParagraphBeforeInput(event) {
      if (event.inputType !== 'insertParagraph') return;
      if (paragraphEnterKeydownHandled) {
        event.preventDefault();
        return;
      }
      const range = rangeFromBeforeInputEvent(event);
      if (!range || !range.collapsed) return;
      const frame = event.currentTarget;
      if (!performParagraphEnter(frame, range)) return;
      event.preventDefault();
      saveCurrentPage({ skipNormalize: true });
      scheduleParagraphOverflowCheck(frame);
    }
    function handleListBackspace(event) {
      if (event.key !== 'Backspace' || isHistoryShortcut(event)) return false;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
      const range = selection.getRangeAt(0);
      const parent = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const textEl = parent?.closest?.('.xhs-list-body');
      const line = textEl?.closest?.('.xhs-list-line');
      if (!textEl || !line || !stageScale.contains(line)) return false;
      if (!isCaretAtFieldStart(range, textEl)) return false;
      event.preventDefault();
      const frame = line.closest('[contenteditable="true"]');
      if (!cleanText(textEl.textContent)) {
        removeEmptyListLine(line);
      } else {
        const p = convertListLineToParagraph(line);
        if (p && frame) {
          frame.focus({ preventScroll: true });
          setCaretInside(p);
        }
      }
      saveCurrentPage({ skipNormalize: true });
      scheduleOverflowReflow(false);
      return true;
    }
    function handleListEnter(event) {
      if (event.key !== 'Enter' || event.shiftKey || isHistoryShortcut(event)) return false;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
      const range = selection.getRangeAt(0);
      const parent = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const textEl = parent?.closest?.('.xhs-list-body');
      const line = textEl?.closest?.('.xhs-list-line');
      if (!textEl || !line || !stageScale.contains(line)) return false;
      const frame = line.closest('[contenteditable="true"]');
      const listType = line.dataset.listType === 'ordered' ? 'ordered' : 'unordered';
      saveCurrentPage({ skipNormalize: true });
      persistDraftCheckpoint();
      if (isCaretAtFieldStart(range, textEl)) {
        event.preventDefault();
        const newLine = buildListLine({ html: '<br>', plain: '' }, listType, 1, { preserveBodyHtml: true });
        line.before(newLine);
        renumberContiguousListLines(line);
        frame?.focus({ preventScroll: true });
        setCaretInside(textEl);
        markParagraphEnterHandled();
        saveCurrentPage({ skipNormalize: true });
        scheduleParagraphOverflowCheck(frame);
        return true;
      }
      const { beforeHtml, afterHtml, valid } = splitListBodyHtml(textEl, range);
      if (!valid) return false;
      event.preventDefault();
      textEl.innerHTML = beforeHtml || '<br>';
      const nextLine = buildListLine(
        { html: afterHtml || '<br>', plain: '' },
        listType,
        1,
        { preserveBodyHtml: true },
      );
      line.after(nextLine);
      renumberContiguousListLines(line);
      const nextBody = nextLine.querySelector('.xhs-list-body');
      if (nextBody) {
        frame?.focus({ preventScroll: true });
        setCaretInside(nextBody);
      }
      markParagraphEnterHandled();
      saveCurrentPage({ skipNormalize: true });
      scheduleParagraphOverflowCheck(frame);
      return true;
    }
    function directFlowChild(frame, node, offset = 0) {
      let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (node === frame) {
        const boundaryNode = frame.childNodes[Math.max(0, Math.min(offset, frame.childNodes.length - 1))] ||
          frame.childNodes[Math.max(0, offset - 1)];
        element = boundaryNode?.nodeType === Node.ELEMENT_NODE ? boundaryNode : boundaryNode?.parentElement;
      }
      while (element && element.parentElement !== frame) element = element.parentElement;
      return element?.parentElement === frame ? element : null;
    }
    function caretFieldForBlock(block, node) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.('.xhs-heading-title, .xhs-heading-number') ||
        block?.querySelector?.('.xhs-heading-title, .xhs-callout-body, .xhs-quote, .xhs-list-body') ||
        block;
    }
    function isCaretAtFieldStart(range, field) {
      if (!range?.collapsed || !field) return false;
      const probe = document.createRange();
      try {
        probe.selectNodeContents(field);
        probe.setEnd(range.startContainer, range.startOffset);
        return !cleanText(probe.toString().replace(String.fromCharCode(8288), ''));
      } catch (_) {
        return false;
      } finally {
        probe.detach?.();
      }
    }
    function isCaretAtFieldEnd(range, field) {
      if (!range?.collapsed || !field) return false;
      const probe = document.createRange();
      try {
        probe.selectNodeContents(field);
        probe.setStart(range.startContainer, range.startOffset);
        return !cleanText(probe.toString().replace(String.fromCharCode(8288), ''));
      } catch (_) {
        return false;
      } finally {
        probe.detach?.();
      }
    }
    function isHistoryShortcut(event) {
      const key = String(event.key || '').toLowerCase();
      const mod = Boolean(event.ctrlKey || event.metaKey);
      return mod && (key === 'z' || key === 'y' || (event.shiftKey && key === 'z'));
    }
    function isHistoryInputType(inputType) {
      return /^history(?:Undo|Redo)$/.test(String(inputType || ''));
    }
    function cancelPendingReflow() {
      window.clearTimeout(reflowTimer);
      window.clearTimeout(layoutReflowTimer);
      reflowForcePending = false;
    }
    function beginTextComposition() {
      isComposingText = true;
      window.clearTimeout(lightSaveTimer);
      window.clearTimeout(headingNormalizeTimer);
      window.clearTimeout(compositionFinishTimer);
      cancelPendingReflow();
    }
    function finishTextComposition(editable) {
      isComposingText = false;
      window.clearTimeout(compositionFinishTimer);
      compositionFinishTimer = window.setTimeout(() => {
        if (isComposingText || !editable?.isConnected) return;
        if (editable.classList.contains('xhs-body-frame') || editable.classList.contains('xhs-cover-tail-frame')) {
          normalizeFilledManualBlanks(editable);
          if (activeHeadingEditField()) scheduleHeadingNormalize();
          scheduleLightSave();
          const needsReflow = compositionNeedsReflow || editable.scrollHeight > editable.clientHeight + 8;
          compositionNeedsReflow = false;
          if (needsReflow) scheduleOverflowReflow(false);
          return;
        }
        if (editable.classList.contains('cover-title')) {
          sanitizeCoverTitleNode(editable);
          balanceCoverTitle();
        }
        if (editable.classList.contains('cover-subtitle')) {
          enforceCoverSubtitleLimit(editable);
          balanceCoverSubtitle();
        }
        saveCurrentPage();
      }, 0);
    }
    function isStructuralHaloBlock(node) {
      return node?.classList?.contains('xhs-heading') ||
        node?.classList?.contains('xhs-callout') ||
        node?.classList?.contains('xhs-quote') ||
        node?.classList?.contains('xhs-table-block') ||
        node?.classList?.contains('xhs-image-block') ||
        node?.classList?.contains('xhs-image-grid');
    }
    function isHaloTargetBlock(node) {
      return isStructuralHaloBlock(node);
    }
    function isEditableParagraphBlock(block) {
      return Boolean(block?.classList &&
        (block.classList.contains('xhs-p') || block.classList.contains('xhs-rich')) &&
        !block.classList.contains('xhs-manual-blank') &&
        !block.classList.contains('xhs-list-line') &&
        !block.classList.contains('xhs-caret-anchor'));
    }
    function makeEmptyParagraph() {
      const p = document.createElement('p');
      p.className = 'xhs-p xhs-block xhs-manual-blank';
      p.innerHTML = '<br>';
      return p;
    }
    function normalizeFilledManualBlanks(root) {
      root?.querySelectorAll?.('.xhs-manual-blank').forEach((blank) => {
        if (cleanText(blank.textContent || '')) blank.classList.remove('xhs-manual-blank');
      });
    }
    function splitParagraphHtml(block, range) {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(block);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeHolder = document.createElement('div');
      beforeHolder.appendChild(beforeRange.cloneContents());
      const beforeHtml = beforeHolder.innerHTML || '';
      const afterRange = document.createRange();
      afterRange.selectNodeContents(block);
      afterRange.setStart(range.startContainer, range.startOffset);
      const afterHolder = document.createElement('div');
      afterHolder.appendChild(afterRange.cloneContents());
      const afterHtml = afterHolder.innerHTML || '';
      return {
        beforeHtml,
        afterHtml,
        valid: htmlTextContent(beforeHtml) + htmlTextContent(afterHtml) === (block.textContent || ''),
      };
    }
    function setCaretAtFieldEnd(field) {
      const selection = window.getSelection();
      if (!selection || !field) return;
      const range = document.createRange();
      range.selectNodeContents(field);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    function isCaretAtFlowBlockStart(range, block) {
      if (!range?.collapsed || !block) return false;
      if (range.startContainer === block) return range.startOffset === 0;
      const parent = block.parentNode;
      if (range.startContainer !== parent) return false;
      return Array.prototype.indexOf.call(parent.childNodes, block) === range.startOffset;
    }
    function previousManualBlank(block) {
      let previous = block?.previousElementSibling;
      while (previous?.classList?.contains('xhs-caret-anchor')) previous = previous.previousElementSibling;
      return previous?.classList?.contains('xhs-manual-blank') ? previous : null;
    }
    function contiguousManualBlanksBefore(block) {
      const blanks = [];
      let sibling = block?.previousElementSibling;
      while (sibling?.classList?.contains('xhs-caret-anchor')) sibling = sibling.previousElementSibling;
      while (sibling?.classList?.contains('xhs-manual-blank')) {
        blanks.unshift(sibling);
        sibling = sibling.previousElementSibling;
        while (sibling?.classList?.contains('xhs-caret-anchor')) sibling = sibling.previousElementSibling;
      }
      return blanks;
    }
    function leadingManualBlankContext(frame) {
      const blanks = [];
      let firstContent = null;
      for (const child of Array.from(frame?.children || [])) {
        if (child.classList?.contains('xhs-caret-anchor')) continue;
        if (child.classList?.contains('xhs-manual-blank')) {
          blanks.push(child);
          continue;
        }
        firstContent = child;
        break;
      }
      return { blanks, firstContent };
    }
    function nearestCaretTarget(block) {
      return block?.querySelector?.('.xhs-heading-title, .xhs-callout-body, .xhs-quote, .xhs-list-body') || block;
    }
    function markManualBlankDeleteHandled() {
      manualBlankDeleteKeydownHandled = true;
      window.clearTimeout(manualBlankDeleteKeydownTimer);
      manualBlankDeleteKeydownTimer = window.setTimeout(() => {
        manualBlankDeleteKeydownHandled = false;
      }, 80);
    }
    function markParagraphEnterHandled() {
      paragraphEnterKeydownHandled = true;
      window.clearTimeout(paragraphEnterKeydownTimer);
      paragraphEnterKeydownTimer = window.setTimeout(() => {
        paragraphEnterKeydownHandled = false;
      }, 320);
    }
    function scheduleParagraphOverflowCheck(frame) {
      scheduleOverflowReflow(true);
    }
    function scheduleReflowAfterBlankRemoval() {
      cancelPendingReflow();
      reflowTimer = window.setTimeout(() => {
        reflow();
        reflowForcePending = false;
      }, 180);
    }
    function finalizeManualBlankDelete(frame, caretTarget) {
      if (caretTarget?.isConnected) {
        frame.focus({ preventScroll: true });
        setCaretInside(nearestCaretTarget(caretTarget));
      }
      saveCurrentPage({ skipNormalize: true });
      scheduleReflowAfterBlankRemoval();
    }
    function handleManualBlankDelete(event) {
      if (isHistoryShortcut(event)) return false;
      const key = event.key || (event.inputType === 'deleteContentForward' ? 'Delete' :
        (event.inputType === 'deleteContentBackward' ? 'Backspace' : ''));
      if (key !== 'Backspace' && key !== 'Delete') return false;
      if (event.type === 'beforeinput') {
        if (manualBlankDeleteKeydownHandled) {
          event.preventDefault();
          return true;
        }
        if (isHistoryInputType(event.inputType)) return false;
      }
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
      const range = selection.getRangeAt(0);
      const frame = event.currentTarget;
      const block = directFlowChild(frame, range.startContainer, range.startOffset);
      if (!block) return false;
      const leading = leadingManualBlankContext(frame);
      if (block.classList.contains('xhs-manual-blank')) {
        event.preventDefault();
        const isLeadingBlank = leading.blanks.includes(block);
        const target = isLeadingBlank ? leading.firstContent : (block.nextElementSibling || block.previousElementSibling);
        const blanksToRemove = isLeadingBlank ? [block] : [block];
        blanksToRemove.forEach((blank) => blank.remove());
        finalizeManualBlankDelete(frame, target);
        if (event.type === 'keydown' || event.type === 'beforeinput') markManualBlankDeleteHandled();
        return true;
      }
      if (!isStructuralHaloBlock(block)) return false;
      const field = caretFieldForBlock(block, range.startContainer);
      const atBlockStart = isCaretAtFlowBlockStart(range, block);
      const headingNumber = block.classList.contains('xhs-heading')
        ? block.querySelector('.xhs-heading-number')
        : null;
      const caretInsideHeadingNumber = Boolean(headingNumber &&
        (range.startContainer === headingNumber || headingNumber.contains(range.startContainer)));
      const atFieldStart = isCaretAtFieldStart(range, field);
      if (key === 'Delete' && leading.firstContent === block && leading.blanks.length &&
        (atBlockStart || atFieldStart || caretInsideHeadingNumber)) {
        event.preventDefault();
        leading.blanks.slice(0, 1).forEach((blank) => blank.remove());
        const caretTarget = caretInsideHeadingNumber && headingNumber ? headingNumber : field;
        finalizeManualBlankDelete(frame, caretTarget);
        if (event.type === 'keydown' || event.type === 'beforeinput') markManualBlankDeleteHandled();
        return true;
      }
      if (key !== 'Backspace') return false;
      if (!atBlockStart && !caretInsideHeadingNumber && !atFieldStart) return false;
      const leadingBlanks = leading.firstContent === block ? leading.blanks : [];
      const blanks = leadingBlanks.length
        ? leadingBlanks.slice(0, 1)
        : contiguousManualBlanksBefore(block).slice(-1);
      if (!blanks.length) return false;
      event.preventDefault();
      blanks.forEach((blank) => blank.remove());
      const caretTarget = (atBlockStart || caretInsideHeadingNumber) && headingNumber
        ? headingNumber
        : field;
      finalizeManualBlankDelete(frame, caretTarget);
      if (event.type === 'keydown' || event.type === 'beforeinput') markManualBlankDeleteHandled();
      return true;
    }
    function bindBlockHalo() {
      document.getElementById('blockHalo')?.remove();
      const halo = document.createElement('div');
      halo.id = 'blockHalo';
      halo.className = 'xhs-block-halo';
      halo.style.display = 'none';
      stageWrap.appendChild(halo);
      const btnBefore = document.createElement('button');
      btnBefore.className = 'xhs-block-halo-btn halo-before halo-add';
      btnBefore.title = '在上方插入空行';
      btnBefore.textContent = '+';
      const btnBeforeRemove = document.createElement('button');
      btnBeforeRemove.className = 'xhs-block-halo-btn halo-before halo-remove';
      btnBeforeRemove.title = '减少上方空行';
      btnBeforeRemove.textContent = '−';
      const btnAfter = document.createElement('button');
      btnAfter.className = 'xhs-block-halo-btn halo-after halo-add';
      btnAfter.title = '在下方插入空行';
      btnAfter.textContent = '+';
      const btnAfterRemove = document.createElement('button');
      btnAfterRemove.className = 'xhs-block-halo-btn halo-after halo-remove';
      btnAfterRemove.title = '减少下方空行';
      btnAfterRemove.textContent = '−';
      halo.appendChild(btnBefore);
      halo.appendChild(btnBeforeRemove);
      halo.appendChild(btnAfter);
      halo.appendChild(btnAfterRemove);
      let targetBlock = null;
      let haloHideTimer = null;
      function adjacentManualBlank(block, direction) {
        let sibling = direction === 'before' ? block?.previousElementSibling : block?.nextElementSibling;
        while (sibling?.classList?.contains('xhs-caret-anchor')) {
          sibling = direction === 'before' ? sibling.previousElementSibling : sibling.nextElementSibling;
        }
        return sibling?.classList?.contains('xhs-manual-blank') ? sibling : null;
      }
      function syncBlankControls(block) {
        const frame = block?.closest?.('[contenteditable="true"]');
        const leading = frame ? leadingManualBlankContext(frame) : null;
        const hasBefore = Boolean(adjacentManualBlank(block, 'before')) ||
          Boolean(leading?.firstContent === block && leading.blanks.length);
        const hasAfter = Boolean(adjacentManualBlank(block, 'after'));
        btnBefore.style.left = hasBefore ? 'calc(50% - 13px)' : '50%';
        btnBeforeRemove.style.left = 'calc(50% + 13px)';
        btnBeforeRemove.style.display = hasBefore ? 'block' : 'none';
        btnAfter.style.left = hasAfter ? 'calc(50% - 13px)' : '50%';
        btnAfterRemove.style.left = 'calc(50% + 13px)';
        btnAfterRemove.style.display = hasAfter ? 'block' : 'none';
      }
      function showHalo(block) {
        if (!block || !stageScale.contains(block)) return;
        targetBlock = block;
        clearTimeout(haloHideTimer);
        const wrapRect = stageWrap.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        const scale = stageScale.getBoundingClientRect().width / config.width;
        const left = (blockRect.left - wrapRect.left);
        const top = (blockRect.top - wrapRect.top);
        const w = blockRect.width;
        const h = blockRect.height;
        halo.style.left = left + 'px';
        halo.style.top = top + 'px';
        halo.style.width = w + 'px';
        halo.style.height = h + 'px';
        syncBlankControls(block);
        halo.style.display = 'block';
      }
      function hideHalo() {
        haloHideTimer = setTimeout(() => {
          halo.style.display = 'none';
          targetBlock = null;
        }, 120);
      }
      halo.addEventListener('mouseenter', () => clearTimeout(haloHideTimer));
      halo.addEventListener('mouseleave', hideHalo);
      function insertAndFocusBlank(blank) {
        const frame = blank.closest?.('[contenteditable="true"]') || stageScale.querySelector('.xhs-body-frame');
        if (frame) frame.focus({ preventScroll: true });
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (!sel) return;
          try {
            const range = document.createRange();
            range.setStart(blank, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) {}
        });
      }
      btnBefore.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!targetBlock) return;
        const blank = makeManualBlank();
        targetBlock.before(blank);
        ensureEditorCaretAnchors(stageScale);
        insertAndFocusBlank(blank);
        saveCurrentPage();
        showHalo(targetBlock);
        scheduleOverflowReflow(true);
      });
      btnAfter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!targetBlock) return;
        const blank = makeManualBlank();
        targetBlock.after(blank);
        ensureEditorCaretAnchors(stageScale);
        insertAndFocusBlank(blank);
        saveCurrentPage();
        showHalo(targetBlock);
        scheduleOverflowReflow(true);
      });
      function removeAdjacentBlank(e, direction) {
        e.preventDefault();
        if (!targetBlock) return;
        const frame = targetBlock.closest?.('[contenteditable="true"]');
        const leading = frame ? leadingManualBlankContext(frame) : { blanks: [], firstContent: null };
        if (direction === 'before' && leading.firstContent === targetBlock && leading.blanks.length) {
          leading.blanks.slice(0, 1).forEach((blank) => blank.remove());
        } else {
          const blank = adjacentManualBlank(targetBlock, direction);
          if (!blank) return;
          blank.remove();
        }
        saveCurrentPage({ skipNormalize: true });
        showHalo(targetBlock);
        scheduleReflowAfterBlankRemoval();
      }
      btnBeforeRemove.addEventListener('mousedown', (e) => removeAdjacentBlank(e, 'before'));
      btnAfterRemove.addEventListener('mousedown', (e) => removeAdjacentBlank(e, 'after'));
      const frame = stageScale.querySelector('.xhs-cover-tail-frame') ||
        stageScale.querySelector('.xhs-body-card .xhs-body-frame');
      if (!frame) return;
      frame.addEventListener('mousedown', (e) => {
        const blank = e.target.closest?.('.xhs-manual-blank');
        if (blank && frame.contains(blank)) {
          e.preventDefault();
          setCaretInside(blank);
        }
      });
      frame.addEventListener('mouseover', (e) => {
        const hard = e.target.closest?.('.xhs-callout, .xhs-image-block, .xhs-image-grid, .xhs-quote, .xhs-table-block, .xhs-heading');
        if (hard && frame.contains(hard) && isHaloTargetBlock(hard)) showHalo(hard);
      });
      frame.addEventListener('mouseleave', hideHalo);
    }
    function bindEditableReflow() {
      stageScale.querySelectorAll('[contenteditable="true"]').forEach((editable) => {
        editable.addEventListener('compositionstart', beginTextComposition);
        editable.addEventListener('compositionend', () => finishTextComposition(editable));
        if (editable.classList.contains('xhs-body-frame') || editable.classList.contains('xhs-cover-tail-frame')) {
          editable.addEventListener('keydown', handleParagraphEnter, true);
          editable.addEventListener('keydown', handleListEnter, true);
          editable.addEventListener('beforeinput', (event) => {
            if (event.isComposing || isComposingText) return;
            if (isHistoryInputType(event.inputType)) {
              cancelPendingReflow();
              return;
            }
            handleBodyParagraphBeforeInput(event);
            if (event.inputType === 'insertParagraph' && paragraphEnterKeydownHandled) {
              event.preventDefault();
              return;
            }
            if (/^deleteContent(?:Backward|Forward)$/.test(event.inputType || '')) handleManualBlankDelete(event);
          }, true);
          editable.addEventListener('keydown', handleParagraphBackspace);
          editable.addEventListener('keydown', handleListBackspace);
          editable.addEventListener('keydown', handleManualBlankDelete);
          editable.addEventListener('keydown', handleHeadingEnter);
          editable.addEventListener('paste', (event) => handleImagePaste(event, editable));
        }
        if (editable.classList.contains('cover-title') || editable.classList.contains('cover-subtitle')) {
          editable.addEventListener('paste', handleCoverTextPaste);
          editable.addEventListener('blur', () => {
            if (editable.classList.contains('cover-title')) sanitizeCoverTitleNode(editable);
            if (editable.classList.contains('cover-title')) balanceCoverTitle();
            if (editable.classList.contains('cover-subtitle')) balanceCoverSubtitle();
            saveCurrentPage();
          });
        }
        editable.addEventListener('input', (event) => {
          const inputType = event.inputType || '';
          if (event.isComposing || isComposingText) return;
          if (editable.classList.contains('cover-title')) {
            sanitizeCoverTitleNode(editable);
            if (inputType !== 'formatBold') balanceCoverTitle();
          }
          if (editable.classList.contains('cover-subtitle')) {
            enforceCoverSubtitleLimit(editable);
            balanceCoverSubtitle();
          }
          if (editable.classList.contains('xhs-body-frame') || editable.classList.contains('xhs-cover-tail-frame')) {
            normalizeFilledManualBlanks(editable);
            if (isHistoryInputType(inputType)) {
              cancelPendingReflow();
              scheduleLightSave();
              return;
            }
            scheduleLightSave();
            if (activeHeadingEditField()) scheduleHeadingNormalize();
            if (inputType === 'insertParagraph' && paragraphEnterKeydownHandled) return;
            if (/^deleteContent(?:Backward|Forward)$/.test(inputType)) {
              scheduleOverflowReflow(true);
              return;
            }
            if (/insertFromPaste|insertParagraph|insertLineBreak|insertText/.test(inputType)) {
              window.setTimeout(() => {
                if (editable.scrollHeight > editable.clientHeight + 8) scheduleOverflowReflow(false);
              }, 80);
            }
            return;
          }
        });
      });
    }
    function coverTitleRects(title) {
      const range = document.createRange();
      range.selectNodeContents(title);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 2 && rect.height > 2);
      range.detach?.();
      return rects;
    }
    function coverTextInnerHeight(coverText) {
      const style = getComputedStyle(coverText);
      const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      return Math.max(80, coverText.clientHeight - pad);
    }
    function balanceCoverTitle() {
      const title = stageScale.querySelector('.cover-title');
      const coverText = stageScale.querySelector('.cover-text');
      if (!title || !coverText) return;
      balanceCoverSubtitle();
      void coverText.offsetHeight;
      const maxSize = Number(coverTitleRange.value || config.coverTitleSize || 121);
      const minSize = Math.max(48, Math.round(maxSize * 0.42));
      const subtitleSize = Number(config.coverSubtitleSize || 32);
      const subtitleSlot = Math.ceil(subtitleSize * 1.62 * 2);
      const bar = stageScale.querySelector('.cover-title-bar');
      const barSlot = bar ? bar.offsetHeight : 0;
      const gap = Number(config.coverGap || 20);
      const innerHeight = coverTextInnerHeight(coverText);
      const maxTitleHeight = Math.max(64, innerHeight - subtitleSlot - barSlot - gap * 2);
      const maxWidth = coverText.clientWidth - 6;
      title.style.width = '100%';
      title.style.removeProperty('max-height');
      title.style.flex = '0 1 auto';
      title.style.lineHeight = '1.1';
      title.style.overflow = 'visible';
      let fitted = minSize;
      for (let size = maxSize; size >= minSize; size -= 1) {
        title.style.fontSize = size + 'px';
        if (title.scrollHeight <= maxTitleHeight + 4 && title.scrollWidth <= maxWidth + 2) {
          fitted = size;
          break;
        }
      }
      title.style.fontSize = fitted + 'px';
    }
    function coverTextRects(node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 2 && rect.height > 2);
      range.detach?.();
      return rects;
    }
    function coverSubtitleCharWeight(char) {
      if (!char || /\\s/.test(char)) return 0;
      const code = char.codePointAt(0) || 0;
      if (code >= 0x4E00 && code <= 0x9FFF) return 1;
      if (code >= 0x3400 && code <= 0x4DBF) return 1;
      if (code >= 0xF900 && code <= 0xFAFF) return 1;
      if (code >= 0xFF01 && code <= 0xFF5E) return 1;
      return 0.5;
    }
    function coverSubtitleWeightedLength(text) {
      let total = 0;
      for (const char of String(text || '')) total += coverSubtitleCharWeight(char);
      return total;
    }
    function trimToCoverSubtitleWeight(text, maxWeight) {
      let total = 0;
      let result = '';
      for (const char of String(text || '')) {
        const weight = coverSubtitleCharWeight(char);
        if (weight <= 0) {
          if (result && !/\\s$/.test(result)) result += char;
          continue;
        }
        if (total + weight > maxWeight) break;
        total += weight;
        result += char;
      }
      return result.replace(/\\s+/g, ' ').trim();
    }
    function coverSubtitleUsedLines(subtitle) {
      if (!cleanText(subtitle?.textContent)) return 1;
      const rects = coverTextRects(subtitle);
      if (!rects.length) return 1;
      const lineTops = [];
      rects.forEach((rect) => {
        const top = Math.round(rect.top);
        if (!lineTops.some((value) => Math.abs(value - top) <= 4)) lineTops.push(top);
      });
      return Math.min(2, Math.max(1, lineTops.length));
    }
    function lockCoverSubtitleBox(subtitle, size) {
      const lineHeight = Math.ceil(size * 1.62);
      subtitle.style.display = 'block';
      subtitle.style.removeProperty('align-items');
      subtitle.style.position = 'relative';
      subtitle.style.boxSizing = 'border-box';
      subtitle.style.width = '100%';
      subtitle.style.maxWidth = 'none';
      subtitle.style.whiteSpace = 'normal';
      subtitle.style.wordBreak = 'normal';
      subtitle.style.overflowWrap = 'anywhere';
      subtitle.style.lineHeight = '1.62';
      subtitle.style.maxHeight = (lineHeight * 2) + 'px';
      subtitle.style.overflow = 'hidden';
    }
    function enforceCoverSubtitleLimit(subtitle) {
      if (!subtitle) return;
      const max = Number(config.coverSubtitleMaxChars || 48);
      const plain = (subtitle.innerText || subtitle.textContent || '').replace(/\\s+/g, ' ').trim();
      if (coverSubtitleWeightedLength(plain) <= max) return;
      subtitle.textContent = trimToCoverSubtitleWeight(plain, max);
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(subtitle);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    function balanceCoverSubtitle(root = stageScale) {
      const subtitle = root.querySelector?.('.cover-subtitle');
      if (!subtitle) return;
      enforceCoverSubtitleLimit(subtitle);
      if (!cleanText(subtitle.textContent)) subtitle.innerHTML = '';
      const base = Number(config.coverSubtitleSize || 32);
      const lineSlot = Math.ceil(base * 1.62);
      const usedLines = coverSubtitleUsedLines(subtitle);
      subtitle.style.fontSize = base + 'px';
      lockCoverSubtitleBox(subtitle, base);
      subtitle.style.minHeight = (lineSlot * usedLines) + 'px';
      subtitle.style.flex = '0 0 auto';
    }
    function stabilizeExportInlineStyles(card, theme) {
      // Match the on-screen CSS marker exactly:
      //   background: linear-gradient(to top, accentSoft 0 46%, transparent 46% 100%)
      //   border-bottom: 1px solid underline
      // html2canvas renders that gradient as a full solid fill, so we strip the
      // node's visual styles and repaint the identical band + baseline manually.
      const bandFill = theme.accentSoft || theme.soft || 'rgba(95,166,106,.18)';
      const lineFill = theme.underline || 'rgba(95,166,106,.5)';
      normalizeUnderlineDecorations(card);
      const cardRect = card.getBoundingClientRect();
      const underlineRects = [];
      card.querySelectorAll('.xhs-green-underline').forEach((node) => {
        // Inside callouts the marker is intentionally hidden (see CSS), skip it.
        const inCallout = !!node.closest('.xhs-callout');
        const range = document.createRange();
        range.selectNodeContents(node);
        if (!inCallout) {
          Array.from(range.getClientRects()).forEach((rect) => {
            if (rect.width < 2 || rect.height < 2) return;
            const bandHeight = Math.max(4, rect.height * 0.46);
            const lineHeightPx = Math.max(1.5, rect.height * 0.045);
            underlineRects.push({
              x: rect.left - cardRect.left,
              y: rect.bottom - cardRect.top - bandHeight,
              w: rect.width,
              h: bandHeight,
              color: bandFill,
            });
            underlineRects.push({
              x: rect.left - cardRect.left,
              y: rect.bottom - cardRect.top - lineHeightPx,
              w: rect.width,
              h: lineHeightPx,
              color: lineFill,
            });
          });
        }
        range.detach?.();
        node.style.display = 'inline';
        node.style.background = 'transparent';
        node.style.backgroundColor = 'transparent';
        node.style.backgroundImage = 'none';
        node.style.boxShadow = 'none';
        node.style.borderBottom = '0';
        node.style.textDecoration = 'none';
        node.style.padding = '0';
        node.style.borderRadius = '0';
        node.style.boxDecorationBreak = 'clone';
        node.style.webkitBoxDecorationBreak = 'clone';
      });
      card.querySelectorAll('.cover-subtitle').forEach((subtitle) => {
        const size = parseFloat(getComputedStyle(subtitle).fontSize) || Number(config.coverSubtitleSize || 32);
        lockCoverSubtitleBox(subtitle, size);
      });
      return underlineRects;
    }
    function paintExportUnderlineRects(canvas, rects) {
      if (!canvas || !Array.isArray(rects) || !rects.length) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scaleX = canvas.width / config.width;
      const scaleY = canvas.height / config.height;
      ctx.save();
      if (typeof ctx.resetTransform === 'function') ctx.resetTransform();
      else ctx.setTransform(1, 0, 0, 1, 0, 0);
      rects.forEach((rect) => {
        ctx.fillStyle = rect.color || 'rgba(95,166,106,.18)';
        ctx.fillRect(
          Math.round(rect.x * scaleX),
          Math.round(rect.y * scaleY),
          Math.max(1, Math.ceil(rect.w * scaleX)),
          Math.max(1, Math.ceil(rect.h * scaleY)),
        );
      });
      ctx.restore();
    }
    function fitHeadingTitles(root = stageScale) {
      const base = Number(config.headingTitleSize || 48);
      const lv2Size = Math.round(base * 0.8) + ${HEADING_LEVEL2_SIZE_BONUS_PX};
      root.querySelectorAll('.xhs-heading-title').forEach((title) => {
        const heading = title.closest('.xhs-heading');
        const isLv2 = detectHeadingLevel(heading) === '2';
        title.style.fontSize = (isLv2 ? lv2Size : base) + 'px';
        title.style.whiteSpace = 'pre-wrap';
      });
    }
    function clampPercent(value) {
      return Math.max(-1000, Math.min(1100, Math.round(value)));
    }
    function clampPx(value, max) {
      return Math.max(-max, Math.min(max, Math.round(value)));
    }
    function stageLocalScale(frame) {
      const rect = frame.getBoundingClientRect();
      return rect.width ? rect.width / Math.max(1, frame.offsetWidth || rect.width) : 1;
    }
    function imageOffset(img) {
      return {
        x: Number(img?.dataset?.offsetX || 0),
        y: Number(img?.dataset?.offsetY || 0),
      };
    }
    function setImageTransform(img, scale, offsetX, offsetY) {
      if (!img) return;
      const nextScale = Math.max(0.1, Math.min(10, Number(scale) || 1));
      const maxOffset = 5000;
      const nextX = clampPx(offsetX || 0, maxOffset);
      const nextY = clampPx(offsetY || 0, maxOffset);
      img.dataset.offsetX = String(nextX);
      img.dataset.offsetY = String(nextY);
      img.style.transform = 'translate(' + nextX + 'px, ' + nextY + 'px) scale(' + nextScale.toFixed(2) + ')';
      imageZoomRange.value = String(Math.round(nextScale * 100));
    }
    function updateImageOffset(offsetX, offsetY) {
      const img = selectedImage();
      if (!selectedFrame || !img) return;
      setImageTransform(img, parseScale(img.style.transform) / 100, offsetX, offsetY);
      saveCurrentPage();
    }
    function updateImageZoom(nextValue) {
      const img = selectedImage();
      if (!selectedFrame || !img) return;
      const offsets = imageOffset(img);
      const value = Math.max(Number(imageZoomRange.min || 10), Math.min(Number(imageZoomRange.max || 1000), Math.round(nextValue)));
      imageZoomRange.value = String(value);
      setImageTransform(img, value / 100, offsets.x, offsets.y);
      saveCurrentPage();
    }
    function updateImagePosition(x, y) {
      const img = selectedImage();
      if (!selectedFrame || !img) return;
      const nextX = clampPercent(x);
      const nextY = clampPercent(y);
      img.style.objectPosition = nextX + '% ' + nextY + '%';
      imageXRange.value = String(nextX);
      imageYRange.value = String(nextY);
      saveCurrentPage();
    }
    function rangeCoversEntireBlock(range, block) {
      if (!range || !block) return false;
      try {
        const full = document.createRange();
        full.selectNodeContents(block);
        return range.compareBoundaryPoints(Range.START_TO_START, full) <= 0 &&
          range.compareBoundaryPoints(Range.END_TO_END, full) >= 0;
      } catch (_) {
        return false;
      }
    }
    function sanitizeCoverTitleNode(title) {
      if (!title) return;
      title.style.removeProperty('background');
      title.style.removeProperty('background-color');
      title.style.removeProperty('color');
      title.querySelectorAll('[style],[class],[bgcolor],[color]').forEach((node) => {
        const tag = node.tagName;
        if (tag === 'STRONG' || tag === 'B') return;
        node.replaceWith(document.createTextNode(node.textContent || ''));
      });
    }
    function handleCoverTextPaste(event) {
      event.preventDefault();
      let text = String(event.clipboardData?.getData('text/plain') || '').replace(/\\r\\n/g, '\\n');
      if (!text) return;
      const editable = event.currentTarget;
      if (editable?.classList?.contains('cover-subtitle')) {
        const max = Number(config.coverSubtitleMaxChars || 48);
        const current = (editable.textContent || '').replace(/\\s+/g, ' ').trim();
        const remaining = Math.max(0, max - coverSubtitleWeightedLength(current));
        text = trimToCoverSubtitleWeight(text.replace(/\\s+/g, ' '), remaining);
        if (!text) return;
      }
      document.execCommand('insertText', false, text);
      if (editable?.classList?.contains('cover-title')) {
        sanitizeCoverTitleNode(editable);
        balanceCoverTitle();
      }
      if (editable?.classList?.contains('cover-subtitle')) balanceCoverSubtitle();
      saveCurrentPage();
    }
    function syncPanelTools() {
      const isCover = pages[pageIndex]?.type === 'cover';
      if (coverTools) coverTools.hidden = !isCover;
      if (coverThemeTools) coverThemeTools.hidden = !isCover || !coverImageEnabled;
      if (cardStyleTools) cardStyleTools.hidden = !(selectedFlowBlock?.classList?.contains('xhs-callout'));
      syncCardStyleUi();
      if (coverImageOnBtn && coverImageOffBtn) {
        coverImageOnBtn.classList.toggle('active', coverImageEnabled);
        coverImageOffBtn.classList.toggle('active', !coverImageEnabled);
      }
    }
    function clearSelectedFlowBlock() {
      stageScale.querySelectorAll('.selected-flow-block').forEach((node) => node.classList.remove('selected-flow-block'));
      selectedFlowBlock = null;
      syncPanelTools();
    }
    function selectFlowBlock(block) {
      clearSelectedFlowBlock();
      selectedFlowBlock = block || null;
      if (selectedFlowBlock) selectedFlowBlock.classList.add('selected-flow-block');
      syncPanelTools();
    }
    function applyCoverImageMode(enabled, shouldSave = true) {
      coverImageEnabled = enabled !== false;
      if (coverImageOnBtn && coverImageOffBtn) {
        coverImageOnBtn.classList.toggle('active', coverImageEnabled);
        coverImageOffBtn.classList.toggle('active', !coverImageEnabled);
      }
      reflow();
      if (shouldSave) saveCurrentPage();
    }
    function reorderableFlowNode(target) {
      return target?.closest?.('.xhs-callout, .xhs-quote, .xhs-list-line, .xhs-table-block, .xhs-image-grid, .xhs-image-block');
    }
    function flowBlocksInBody(bodyFrame) {
      return Array.from(bodyFrame.children).filter((node) => {
        return node.classList?.contains('xhs-block') ||
          node.classList?.contains('xhs-image-block') ||
          node.classList?.contains('xhs-image-grid') ||
          node.classList?.contains('xhs-heading') ||
          node.classList?.contains('xhs-p') ||
          node.classList?.contains('xhs-callout') ||
          node.classList?.contains('xhs-quote') ||
          node.classList?.contains('xhs-list-line') ||
          node.classList?.contains('xhs-table-block') ||
          node.classList?.contains('xhs-rich');
      });
    }
    function ensureBlockDropIndicator() {
      if (blockDropIndicator) return blockDropIndicator;
      blockDropIndicator = document.createElement('div');
      blockDropIndicator.className = 'xhs-drop-indicator';
      blockDropIndicator.hidden = true;
      stageScale.appendChild(blockDropIndicator);
      return blockDropIndicator;
    }
    function hideBlockDropIndicator() {
      if (blockDropIndicator) blockDropIndicator.hidden = true;
    }
    function updateBlockDropIndicator(clientY, bodyFrame) {
      const flowNode = blockReorderDrag?.node;
      if (!bodyFrame || !flowNode) return hideBlockDropIndicator();
      const blocks = flowBlocksInBody(bodyFrame).filter((node) => node !== flowNode);
      const indicator = ensureBlockDropIndicator();
      const cardRect = stageScale.getBoundingClientRect();
      const scale = stageLocalScale(bodyFrame);
      let target = null;
      let top = bodyFrame.getBoundingClientRect().top;
      for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) {
          target = block;
          top = rect.top;
          break;
        }
        top = rect.bottom;
      }
      indicator.hidden = false;
      indicator.style.top = ((top - cardRect.top) / scale) + 'px';
      blockReorderDrag.insertBefore = target;
    }
    function finishFlowBlockReorder() {
      const bodyFrame = blockReorderDrag?.bodyFrame;
      const flowNode = blockReorderDrag?.node;
      if (!bodyFrame || !flowNode) return;
      const parent = flowNode.parentNode;
      if (!parent) return;
      if (blockReorderDrag.insertBefore) parent.insertBefore(flowNode, blockReorderDrag.insertBefore);
      else parent.appendChild(flowNode);
      flowNode.classList.remove('reorder-dragging');
      hideBlockDropIndicator();
      saveCurrentPage();
      scheduleOverflowReflow(true);
    }
    function bindBodyFrameReorder(bodyFrame) {
      if (!bodyFrame || bodyFrame.dataset.reorderBound === '1') return;
      bodyFrame.dataset.reorderBound = '1';
      bodyFrame.addEventListener('pointerdown', (event) => {
        if (!event.altKey) return;
        if (event.target?.closest?.('.xhs-resize-handle')) return;
        const flowNode = reorderableFlowNode(event.target);
        if (!flowNode || !bodyFrame.contains(flowNode)) return;
        event.preventDefault();
        event.stopPropagation();
        selectFlowBlock(flowNode);
        const imgFrame = flowNode.querySelector?.('.xhs-image-frame');
        if (imgFrame) selectFrame(imgFrame);
        blockReorderDrag = {
          id: event.pointerId,
          node: flowNode,
          insertBefore: null,
          bodyFrame,
        };
        flowNode.classList.add('reorder-dragging');
        bodyFrame.setPointerCapture?.(event.pointerId);
        updateBlockDropIndicator(event.clientY, bodyFrame);
      }, true);
      bodyFrame.addEventListener('pointermove', (event) => {
        if (!blockReorderDrag || event.pointerId !== blockReorderDrag.id) return;
        event.preventDefault();
        updateBlockDropIndicator(event.clientY, blockReorderDrag.bodyFrame);
      });
      function endBlockReorder(event) {
        if (!blockReorderDrag || event.pointerId !== blockReorderDrag.id) return;
        blockReorderDrag.bodyFrame.releasePointerCapture?.(event.pointerId);
        finishFlowBlockReorder();
        blockReorderDrag = null;
      }
      bodyFrame.addEventListener('pointerup', endBlockReorder);
      bodyFrame.addEventListener('pointercancel', endBlockReorder);
      bodyFrame.addEventListener('mousedown', (event) => {
        if (event.altKey) return;
        const block = reorderableFlowNode(event.target);
        if (block) {
          selectFlowBlock(block);
          const imgFrame = block.querySelector?.('.xhs-image-frame');
          if (imgFrame && event.target.closest('.xhs-image-frame, .xhs-image-block, .xhs-image-grid')) selectFrame(imgFrame);
          return;
        }
        if (!event.target.closest?.('.selectable-image')) {
          clearSelectedFlowBlock();
        }
      });
    }
    function bindImageDrag(frame) {
      let drag = null;
      frame.tabIndex = 0;
      frame.addEventListener('pointerdown', (event) => {
        if (event.target?.closest?.('.xhs-resize-handle')) return;
        if (event.altKey && !frame.classList.contains('cover-image-frame')) return;
        const img = frame.querySelector('img');
        if (!img) return;
        event.preventDefault();
        selectFrame(frame);
        frame.focus({ preventScroll: true });
        const offsets = imageOffset(img);
        drag = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: offsets.x,
          y: offsets.y,
          scale: stageLocalScale(frame),
        };
        frame.setPointerCapture?.(event.pointerId);
        frame.classList.add('dragging');
      });
      frame.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        event.preventDefault();
        const dx = (event.clientX - drag.startX) / Math.max(0.1, drag.scale);
        const dy = (event.clientY - drag.startY) / Math.max(0.1, drag.scale);
        updateImageOffset(drag.x + dx, drag.y + dy);
      });
      function endDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        frame.releasePointerCapture?.(event.pointerId);
        frame.classList.remove('dragging');
        drag = null;
        saveCurrentPage();
      }
      frame.addEventListener('pointerup', endDrag);
      frame.addEventListener('pointercancel', endDrag);
      frame.addEventListener('wheel', (event) => {
        const img = frame.querySelector('img');
        if (!img) return;
        event.preventDefault();
        selectFrame(frame);
        const delta = event.deltaY > 0 ? -6 : 6;
        updateImageZoom(Number(imageZoomRange.value || 100) + delta);
      }, { passive: false });
      frame.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const img = frame.querySelector('img');
        if (!img) return;
        event.preventDefault();
        selectFrame(frame);
        const step = event.shiftKey ? 24 : 8;
        const offsets = imageOffset(img);
        const dx = event.key === 'ArrowLeft' ? -step : (event.key === 'ArrowRight' ? step : 0);
        const dy = event.key === 'ArrowUp' ? -step : (event.key === 'ArrowDown' ? step : 0);
        updateImageOffset(offsets.x + dx, offsets.y + dy);
      });
    }
    function currentFrames() {
      return Array.from(stageScale.querySelectorAll('.selectable-image'));
    }
    function selectedImage() {
      return selectedFrame ? selectedFrame.querySelector('img') : null;
    }
    function frameBlock() {
      return selectedFrame ? selectedFrame.closest('.xhs-image-block') : null;
    }
    function selectedImageFlowBlock() {
      const block = frameBlock();
      if (!block) return null;
      return block.closest('.xhs-image-grid') || block;
    }
    function clearSelectedFrame() {
      stageScale.querySelectorAll('.selectable-image').forEach((item) => item.classList.remove('selected-image-frame'));
      selectedFrame = null;
      syncImageTools();
      renderImageList();
    }
    function selectFrame(frame) {
      stageScale.querySelectorAll('.selectable-image').forEach((item) => item.classList.remove('selected-image-frame'));
      selectedFrame = frame;
      if (selectedFrame) {
        selectedFrame.classList.add('selected-image-frame');
        selectedFrame.focus?.({ preventScroll: true });
      }
      syncImageTools();
      renderImageList();
    }
    function parsePercent(value, fallback) {
      const n = parseFloat(String(value || '').replace('%', ''));
      return Number.isFinite(n) ? n : fallback;
    }
    function parseScale(transform) {
      const m = String(transform || '').match(/scale\\(([^)]+)\\)/);
      return m ? Math.round(parseFloat(m[1]) * 100) : 100;
    }
    function syncImageTools() {
      if (!selectedFrame) {
        imageTools.hidden = true;
        return;
      }
      imageTools.hidden = false;
      const img = selectedImage();
      const block = frameBlock();
      const isCover = selectedFrame.classList.contains('cover-image-frame');
      widthControl.style.display = isCover ? 'none' : 'grid';
      heightControl.style.display = isCover ? 'none' : 'grid';
      imageWidthRange.value = String(Math.round(parsePercent(block?.style.width, 100)));
      imageHeightRange.value = String(Math.round(parseFloat(selectedFrame.style.height || selectedFrame.getBoundingClientRect().height || config.imageFrameHeight)));
      imageZoomRange.value = img ? String(parseScale(img.style.transform)) : '100';
      const position = img ? getComputedStyle(img).objectPosition.split(' ') : ['50%', '50%'];
      imageXRange.value = String(Math.round(parsePercent(position[0], 50)));
      imageYRange.value = String(Math.round(parsePercent(position[1], 50)));
      const fit = img ? (img.style.objectFit || selectedFrame.dataset.fit || 'contain') : (selectedFrame.dataset.fit || 'contain');
      fitContainBtn.classList.toggle('active', fit === 'contain');
      fitCoverBtn.classList.toggle('active', fit === 'cover');
      const grid = selectedFrame.closest('.xhs-image-grid');
      imageSplitGridBtn.disabled = isCover || !grid;
      imagePairPrevBtn.disabled = isCover || Boolean(grid);
      imagePairNextBtn.disabled = isCover || Boolean(grid);
      imageMoveUpBtn.disabled = isCover;
      imageMoveDownBtn.disabled = isCover;
    }
    function renderImageList() {
      const frames = currentFrames();
      imageList.innerHTML = frames.map((frame, idx) => {
        const selected = frame === selectedFrame;
        const img = frame.querySelector('img');
        const isCover = frame.classList.contains('cover-image-frame');
        const label = isCover ? '封面图' : (img?.getAttribute('alt') || img?.getAttribute('src')?.slice(0, 32) || '图片');
        return '<button class="' + (selected ? 'active' : '') + '" data-index="' + idx + '">' + String(idx + 1).padStart(2, '0') + ' · ' + esc(label) + '</button>';
      }).join('');
      imageList.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          const frame = frames[Number(button.dataset.index)];
          if (frame) selectFrame(frame);
        });
      });
      const page = pages[pageIndex];
      const label = page?.type === 'cover' ? '封面页' : '正文页';
      const coverFlowHint = page?.type === 'cover' && !coverImageEnabled ? ' · 正文已接入封面下半区' : '';
      pageInfo.textContent = pages.length ? label + ' · 当前第 ' + (pageIndex + 1) + ' / ' + pages.length + ' 页' + coverFlowHint : '暂无分页';
    }
    function renderAll() {
      renderTabs();
      fitStage();
      renderStage();
      renderImageList();
      syncImageTools();
      syncPanelTools();
    }
    function applyLayout(schedule) {
      const padX = Number(bodyPadXRange.value);
      const padY = Number(bodyPadYRange.value);
      const fontSize = Number(bodyFontRange.value);
      const lineHeight = Number(bodyLineRange.value) / 100;
      const bottomPad = schedule ? padY : Number(config.bodyPadBottom || padY);
      const contentWidth = Math.max(360, config.width - padX * 2);
      const contentHeight = Math.max(420, config.height - padY - bottomPad);
      config.pageLimit = contentHeight;
      config.bodyPadX = padX;
      config.bodyPadTop = padY;
      config.bodyPadBottom = bottomPad;
      config.bodyFontSize = fontSize;
      config.bodyLineHeight = lineHeight;
      config.bodyContentWidth = contentWidth;
      config.bodyContentHeight = contentHeight;
      const root = document.documentElement.style;
      root.setProperty('--body-pad-x', padX + 'px');
      root.setProperty('--body-pad-top', padY + 'px');
      root.setProperty('--body-pad-bottom', bottomPad + 'px');
      root.setProperty('--body-content-width', contentWidth + 'px');
      root.setProperty('--body-content-height', contentHeight + 'px');
      root.setProperty('--body-font', fontSize + 'px');
      root.setProperty('--body-line', String(lineHeight));
      root.setProperty('--body-line-px', (fontSize * lineHeight) + 'px');
      root.setProperty('--cover-title-size', coverTitleRange.value + 'px');
      if (!schedule) return;
      saveCurrentPage();
      window.clearTimeout(layoutReflowTimer);
      layoutReflowTimer = window.setTimeout(reflow, 280);
    }
    function setFontMode(mode) {
      const isSongti = mode === 'songti';
      document.documentElement.style.setProperty('--xhs-font', isSongti ? config.songtiFont : config.wechatFont);
      fontWechatBtn.classList.toggle('active', !isSongti);
      fontSongtiBtn.classList.toggle('active', isSongti);
      saveCurrentPage();
      window.clearTimeout(layoutReflowTimer);
      layoutReflowTimer = window.setTimeout(reflow, 280);
    }
    function applyBackgroundTheme(key, shouldSave = true) {
      const theme = BG_THEMES[key] || BG_THEMES[DEFAULT_BG_THEME];
      currentBgTheme = BG_THEMES[key] ? key : DEFAULT_BG_THEME;
      const root = document.documentElement.style;
      root.setProperty('--xhs-shell-bg', theme.shell);
      root.setProperty('--xhs-card-bg', theme.card);
      bgThemeButtons.forEach((button) => button.classList.toggle('active', button.dataset.bgTheme === key));
      if (currentCoverTheme === 'background') applyCoverTheme(currentCoverTheme, false);
      if (shouldSave) saveCurrentPage();
    }
    function applyAccentTheme(key, shouldSave = true) {
      const theme = ACCENT_THEMES[key] || ACCENT_THEMES[DEFAULT_ACCENT_THEME];
      currentAccentTheme = ACCENT_THEMES[key] ? key : DEFAULT_ACCENT_THEME;
      const root = document.documentElement.style;
      root.setProperty('--xhs-accent', theme.accent);
      root.setProperty('--xhs-accent-strong', theme.strong);
      root.setProperty('--xhs-accent-soft', theme.soft);
      root.setProperty('--xhs-accent-pale', theme.pale);
      root.setProperty('--xhs-underline', theme.underline);
      accentThemeButtons.forEach((button) => button.classList.toggle('active', button.dataset.accentTheme === key));
      if (currentCoverTheme === 'accent') applyCoverTheme(currentCoverTheme, false);
      if (currentCoverTheme === 'background') applyCoverTheme(currentCoverTheme, false);
      if (shouldSave) saveCurrentPage();
    }
    function applyCoverTheme(key, shouldSave = true) {
      currentCoverTheme = key || 'background';
      const bg = BG_THEMES[currentBgTheme] || BG_THEMES[DEFAULT_BG_THEME];
      const accent = ACCENT_THEMES[currentAccentTheme] || ACCENT_THEMES[DEFAULT_ACCENT_THEME];
      const root = document.documentElement.style;
      if (currentCoverTheme === 'accent') {
        root.setProperty('--xhs-cover-bg', accent.underline);
        root.setProperty('--xhs-cover-border', accent.accent);
        root.setProperty('--xhs-cover-placeholder', accent.strong);
      } else if (currentCoverTheme === 'dark') {
        root.setProperty('--xhs-cover-bg', '#171c1a');
        root.setProperty('--xhs-cover-border', 'rgba(255,255,255,.28)');
        root.setProperty('--xhs-cover-placeholder', 'rgba(255,255,255,.82)');
      } else {
        root.setProperty('--xhs-cover-bg', bg.card);
        root.setProperty('--xhs-cover-border', accent.underline);
        root.setProperty('--xhs-cover-placeholder', '#8f948d');
      }
      coverThemeButtons.forEach((button) => button.classList.toggle('active', button.dataset.coverTheme === currentCoverTheme));
      if (shouldSave) saveCurrentPage();
    }
    function getStageSelection() {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!parent || !stageScale.contains(parent)) return null;
      return { selection, range };
    }
    function unwrapElement(el) {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    function isCoverBoldElement(el) {
      if (!el?.matches) return false;
      const tag = (el.tagName || '').toLowerCase();
      const style = el.getAttribute('style') || '';
      return el.classList.contains('xhs-cover-bold') ||
        tag === 'strong' ||
        tag === 'b' ||
        /font-weight\\s*:\\s*(bold|[7-9]00)/i.test(style);
    }
    function closestCoverBoldElement(node, root) {
      let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      while (el && el !== root) {
        if (isCoverBoldElement(el)) return el;
        el = el.parentElement;
      }
      return null;
    }
    function coverBoldNodesInRange(root, range) {
      const nodes = [];
      const startBold = closestCoverBoldElement(range.startContainer, root);
      const endBold = closestCoverBoldElement(range.endContainer, root);
      if (startBold) nodes.push(startBold);
      if (endBold) nodes.push(endBold);
      root.querySelectorAll('.xhs-cover-bold, b, strong, [style*="font-weight"]').forEach((node) => {
        if (!isCoverBoldElement(node)) return;
        try {
          if (range.intersectsNode(node)) nodes.push(node);
        } catch (_) {}
      });
      const unique = Array.from(new Set(nodes)).filter((node) => root.contains(node));
      return unique.sort((a, b) => {
        let da = 0;
        let db = 0;
        for (let node = a; node && node !== root; node = node.parentElement) da += 1;
        for (let node = b; node && node !== root; node = node.parentElement) db += 1;
        return db - da;
      });
    }
    function toggleCoverSubtitleBold(selection, range, subtitle) {
      if (range.collapsed) {
        const existing = closestCoverBoldElement(range.startContainer, subtitle);
        if (!existing) {
          alert('请先选中要加粗的副标题文字，或把光标放在已加粗文字里再点一次取消。');
          return;
        }
        const caret = document.createTextNode('');
        existing.after(caret);
        unwrapElement(existing);
        const nextRange = document.createRange();
        nextRange.setStartAfter(caret);
        nextRange.collapse(true);
        caret.remove();
        selection.removeAllRanges();
        selection.addRange(nextRange);
        saveCurrentPage();
        balanceCoverSubtitle();
        return;
      }
      const boldNodes = coverBoldNodesInRange(subtitle, range);
      if (boldNodes.length) {
        boldNodes.forEach(unwrapElement);
        selection.removeAllRanges();
        saveCurrentPage();
        balanceCoverSubtitle();
        return;
      }
      const span = document.createElement('span');
      span.className = 'xhs-cover-bold';
      try {
        range.surroundContents(span);
      } catch (_) {
        const fragment = range.extractContents();
        span.appendChild(fragment);
        range.insertNode(span);
      }
      selection.removeAllRanges();
      const styledRange = document.createRange();
      styledRange.selectNodeContents(span);
      selection.addRange(styledRange);
      saveCurrentPage();
      balanceCoverSubtitle();
    }
    function toggleCoverTitleBold(selection, range, title) {
      if (range.collapsed) {
        const existing = closestCoverBoldElement(range.startContainer, title);
        if (!existing) {
          alert('请先选中要加粗的封面标题文字，或把光标放在已加粗文字里再点一次取消。');
          return;
        }
        const caret = document.createTextNode('');
        existing.after(caret);
        unwrapElement(existing);
        const nextRange = document.createRange();
        nextRange.setStartAfter(caret);
        nextRange.collapse(true);
        caret.remove();
        selection.removeAllRanges();
        selection.addRange(nextRange);
        saveCurrentPage();
        return;
      }
      const boldNodes = coverBoldNodesInRange(title, range);
      if (boldNodes.length) {
        boldNodes.forEach(unwrapElement);
        selection.removeAllRanges();
        saveCurrentPage();
        return;
      }
      const span = document.createElement('span');
      span.className = 'xhs-cover-bold';
      try {
        range.surroundContents(span);
      } catch (_) {
        const fragment = range.extractContents();
        span.appendChild(fragment);
        range.insertNode(span);
      }
      selection.removeAllRanges();
      const styledRange = document.createRange();
      styledRange.selectNodeContents(span);
      selection.addRange(styledRange);
      saveCurrentPage();
    }
    function closestStyledAncestor(range, className, marker) {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      if (!start || !stageScale.contains(start)) return null;
      let el = start.closest?.('.' + className);
      if (el && stageScale.contains(el)) return el;
      el = start;
      while (el && el !== stageScale) {
        const style = el.getAttribute?.('style') || '';
        if (marker && style.includes(marker)) return el;
        el = el.parentElement;
      }
      return null;
    }
    function selectedStyledNodes(range, className, marker) {
      const holder = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!holder || !stageScale.contains(holder)) return [];
      const candidates = Array.from(holder.querySelectorAll('.' + className));
      if (marker) {
        candidates.push(...Array.from(holder.querySelectorAll('[style*="' + marker + '"]')));
      }
      return Array.from(new Set(candidates)).filter((node) => {
        if (!stageScale.contains(node)) return false;
        try {
          return range.intersectsNode(node);
        } catch (_) {
          return false;
        }
      });
    }
    function rangeIntersectsNode(range, node) {
      try {
        return range.intersectsNode(node);
      } catch (_) {
        return false;
      }
    }
    function alternateInlineEmphasisClass(className) {
      if (className === 'xhs-green-text') return 'xhs-green-underline';
      if (className === 'xhs-green-underline') return 'xhs-green-text';
      return '';
    }
    function adjacentStyledNodeAtCaret(range, className, marker) {
      if (!range.collapsed) return null;
      const container = range.startContainer;
      const offset = range.startOffset;
      const candidates = [];
      if (container.nodeType === Node.ELEMENT_NODE) {
        candidates.push(container.childNodes[offset - 1], container.childNodes[offset]);
      } else if (container.nodeType === Node.TEXT_NODE) {
        if (offset === 0) candidates.push(container.previousSibling);
        if (offset >= (container.textContent || '').length) candidates.push(container.nextSibling);
      }
      for (const item of candidates) {
        let el = item?.nodeType === Node.ELEMENT_NODE ? item : item?.parentElement;
        while (el && el !== stageScale) {
          const style = el.getAttribute?.('style') || '';
          if (el.classList?.contains(className) || (marker && style.includes(marker))) return el;
          el = el.parentElement;
        }
      }
      return null;
    }
    function inlineFormattingHost(node) {
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const listLine = el?.closest?.('.xhs-list-line');
      if (listLine) return listLine.querySelector('.xhs-list-body');
      return el?.closest?.('.xhs-list-body, .xhs-p, .xhs-rich, .xhs-callout-body, .xhs-quote, .xhs-heading-title') || null;
    }
    function restrictRangeToInlineHost(range) {
      const startHost = inlineFormattingHost(range.startContainer);
      const endHost = inlineFormattingHost(range.endContainer);
      const commonEl = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const listBody = commonEl?.closest?.('.xhs-list-line')?.querySelector('.xhs-list-body');
      const host = startHost && (!endHost || startHost === endHost)
        ? startHost
        : (endHost && !startHost ? endHost : (listBody || null));
      if (!host) return range;
      const restricted = range.cloneRange();
      if (!host.contains(range.startContainer)) restricted.setStart(host, 0);
      if (!host.contains(range.endContainer)) restricted.setEnd(host, host.childNodes.length);
      return restricted;
    }
    function inlineRangeTextOffsets(range) {
      const host = inlineFormattingHost(range.commonAncestorContainer);
      if (!host) return null;
      try {
        const beforeStart = document.createRange();
        beforeStart.selectNodeContents(host);
        beforeStart.setEnd(range.startContainer, range.startOffset);
        const beforeEnd = document.createRange();
        beforeEnd.selectNodeContents(host);
        beforeEnd.setEnd(range.endContainer, range.endOffset);
        return { host, start: beforeStart.toString().length, end: beforeEnd.toString().length };
      } catch (_) {
        return null;
      }
    }
    function textBoundaryAtOffset(host, offset) {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let remaining = Math.max(0, Number(offset) || 0);
      while (node) {
        const length = (node.textContent || '').length;
        if (remaining <= length) return { node, offset: remaining };
        remaining -= length;
        node = walker.nextNode();
      }
      return { node: host, offset: host.childNodes.length };
    }
    function restoreInlineRange(offsets) {
      if (!offsets?.host?.isConnected) return null;
      const range = document.createRange();
      const start = textBoundaryAtOffset(offsets.host, offsets.start);
      const end = textBoundaryAtOffset(offsets.host, offsets.end);
      try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
      } catch (_) {
        return null;
      }
    }
    function fragmentClassNodes(fragment, className) {
      const nodes = [];
      Array.from(fragment.childNodes).forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains(className)) nodes.push(node);
        if (node.nodeType === Node.ELEMENT_NODE) nodes.push(...node.querySelectorAll('.' + className));
      });
      return Array.from(new Set(nodes));
    }
    function removeClassFromFragment(fragment, className) {
      fragmentClassNodes(fragment, className).reverse().forEach((node) => {
        node.classList.remove(className);
        if (node.tagName === 'SPAN' && !node.className && node.attributes.length === 0) unwrapElement(node);
      });
    }
    function fragmentHasInlineContent(fragment) {
      return Boolean((fragment.textContent || '').length || fragment.querySelector?.('br, img, code'));
    }
    function markedAncestorContainingRange(range, className) {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      const marked = start?.closest?.('.' + className);
      if (!marked) return null;
      return marked.contains(range.endContainer) ? marked : null;
    }
    function removeInlineMarkFromRange(range, marked, className) {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(marked);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const selected = range.cloneContents();
      removeClassFromFragment(selected, className);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(marked);
      afterRange.setStart(range.endContainer, range.endOffset);
      const replacement = document.createDocumentFragment();
      const before = marked.cloneNode(false);
      before.appendChild(beforeRange.cloneContents());
      if (fragmentHasInlineContent(before)) replacement.appendChild(before);
      replacement.appendChild(selected);
      const after = marked.cloneNode(false);
      after.appendChild(afterRange.cloneContents());
      if (fragmentHasInlineContent(after)) replacement.appendChild(after);
      marked.replaceWith(replacement);
    }
    function toggleInlineMarkInRange(range, className) {
      const marked = markedAncestorContainingRange(range, className);
      if (marked) {
        removeInlineMarkFromRange(range, marked, className);
        return null;
      }
      const fragment = range.extractContents();
      removeClassFromFragment(fragment, className);
      const span = document.createElement('span');
      span.className = className;
      span.appendChild(fragment);
      range.insertNode(span);
      return span;
    }
    function toggleInlineClass(className, marker) {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) {
        alert('请先选中要处理的文字。');
        return;
      }
      let range = restrictRangeToInlineHost(selection.getRangeAt(0));
      const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!parent || !stageScale.contains(parent)) {
        alert('请先选中要处理的文字。');
        return;
      }
      const item = { selection, range };
      if (range.collapsed) {
        const existing = closestStyledAncestor(range, className, marker) || adjacentStyledNodeAtCaret(range, className, marker);
        if (existing) {
          const caret = document.createTextNode('');
          existing.after(caret);
          unwrapElement(existing);
          const nextRange = document.createRange();
          nextRange.setStartAfter(caret);
          nextRange.collapse(true);
          caret.remove();
          selection.removeAllRanges();
          selection.addRange(nextRange);
          saveCurrentPage();
          return;
        }
        alert('请先选中要处理的文字，或把光标放在已应用该样式的文字里再点一次取消。');
        return;
      }
      const span = toggleInlineMarkInRange(item.range, className);
      item.selection.removeAllRanges();
      if (span) {
        const styledRange = document.createRange();
        styledRange.selectNodeContents(span);
        item.selection.addRange(styledRange);
      }
      normalizeNestedFlowBlocks(stageScale);
      normalizeListLinesInFrame(stageScale.querySelector('.xhs-body-frame'));
      saveCurrentPage();
    }
    function applyFormattingMultiBlock(range, className) {
      const BLOCK_SELS = '.xhs-p, .xhs-rich, .xhs-callout-body, .xhs-quote, .xhs-list-body, .xhs-heading-title';
      const frame = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const scopeFrame = frame?.closest?.('.xhs-body-frame') || frame;
      if (!scopeFrame) return false;
      const blocks = Array.from(scopeFrame.querySelectorAll(BLOCK_SELS)).filter((block) => {
        if (block.classList.contains('xhs-list-line')) return false;
        return range.intersectsNode(block);
      });
      if (blocks.length < 2) return false;
      blocks.forEach((block) => {
        const br = document.createRange();
        br.selectNodeContents(block);
        if (block === blocks[0]) {
          try { br.setStart(range.startContainer, range.startOffset); } catch (_) {}
        }
        if (block === blocks[blocks.length - 1]) {
          try { br.setEnd(range.endContainer, range.endOffset); } catch (_) {}
        }
        if (br.collapsed) return;
        toggleInlineMarkInRange(br, className);
      });
      window.getSelection()?.removeAllRanges();
      normalizeListLinesInFrame(scopeFrame);
      saveCurrentPage();
      return true;
    }
    function applyGreenText() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
        const r = restrictRangeToInlineHost(sel.getRangeAt(0));
        if (applyFormattingMultiBlock(r, 'xhs-green-text')) return;
      }
      toggleInlineClass('xhs-green-text', 'color:#2f7d3b');
    }
    function applyGreenUnderline() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
        const r = restrictRangeToInlineHost(sel.getRangeAt(0));
        if (applyFormattingMultiBlock(r, 'xhs-green-underline')) return;
      }
      toggleInlineClass('xhs-green-underline', 'box-shadow');
    }
    function blockNestHost(node) {
      return node?.closest?.('.xhs-callout-body, .xhs-quote, .xhs-list-body');
    }
    function nextAutoHeadingNumber() {
      const existingLevel1 = stageScale.querySelectorAll('.xhs-heading[data-level="1"], .xhs-heading:not([data-level])');
      return String(existingLevel1.length + 1).padStart(2, '0');
    }
    // Shared cross-switch model for the four flow-block style buttons
    // (一级标题 / 二级标题 / 引用块 / 卡片 / 序列): placing the caret inside
    // any one of them and clicking a different button's style converts the
    // block in place; clicking the same style again converts it back to
    // plain paragraph(s).
    function activeFlowBlockAt(node) {
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!el || !stageScale.contains(el)) return null;
      const heading = el.closest('.xhs-heading');
      if (heading) return { type: 'heading', level: detectHeadingLevel(heading), el: heading };
      const quote = el.closest('.xhs-quote');
      if (quote) return { type: 'quote', el: quote };
      const callout = el.closest('.xhs-callout');
      if (callout) return { type: 'card', el: callout };
      const list = el.closest('.xhs-list-line');
      if (list) {
        return {
          type: 'list',
          el: list,
          els: collectContiguousListLines(list),
          listType: list.dataset.listType || 'unordered',
        };
      }
      return null;
    }
    function flowBlockListBodies(info) {
      if (info?.type !== 'list') return [];
      const lines = info.els?.length ? info.els : [info.el];
      return lines.map((line) => line.querySelector('.xhs-list-body')).filter(Boolean);
    }
    function flowBlockContentHtml(info) {
      if (!info) return '';
      if (info.type === 'heading') {
        const title = info.el.querySelector('.xhs-heading-title');
        return title ? title.innerHTML : info.el.innerHTML;
      }
      if (info.type === 'card') {
        const body = info.el.querySelector('.xhs-callout-body');
        return body ? body.innerHTML : info.el.innerHTML;
      }
      if (info.type === 'list') {
        return flowBlockListBodies(info)
          .map((body) => normalizeInlineHtml(body.innerHTML))
          .join('<br>');
      }
      return info.el.innerHTML;
    }
    function flowBlockPlainText(info) {
      if (!info) return '';
      if (info.type === 'heading') {
        const title = info.el.querySelector('.xhs-heading-title');
        return textWithBreaks(title || info.el);
      }
      if (info.type === 'card') {
        const body = info.el.querySelector('.xhs-callout-body');
        return textWithBreaks(body || info.el);
      }
      if (info.type === 'list') {
        return flowBlockListBodies(info).map((body) => textWithBreaks(body)).join('\\n');
      }
      return textWithBreaks(info.el);
    }
    function buildFlowBlocksFromContent(targetType, targetLevel, info) {
      if (targetType === 'heading') {
        const plain = stripHeadingNumberPrefix(flowBlockPlainText(info), '00');
        const number = targetLevel === '1' ? nextAutoHeadingNumber() : '';
        return [makeNewHeadingBlock(number, plain, targetLevel)];
      }
      if (targetType === 'quote') {
        const block = document.createElement('section');
        block.className = 'xhs-quote xhs-block';
        block.innerHTML = normalizeInlineHtml(flowBlockContentHtml(info));
        return [block];
      }
      if (targetType === 'card') {
        const label = inferCardLabel(cleanText(flowBlockPlainText(info)));
        const block = document.createElement('section');
        block.className = 'xhs-callout xhs-block' + (currentCardStyle === 'frame' ? ' xhs-card-frame' : '');
        block.innerHTML = '<div class="xhs-callout-label">' + esc(label) + '</div><div class="xhs-callout-body">' +
          cleanCalloutBodyHtml(flowBlockContentHtml(info)) + '</div>';
        return [block];
      }
      if (targetType === 'list') {
        const html = stripListMarkerFromHtml(normalizeInlineHtml(flowBlockContentHtml(info)));
        const plain = stripLeadingListMarkerText(cleanText(flowBlockPlainText(info)));
        return [buildListLine({ html, plain })];
      }
      return [];
    }
    function replaceFlowBlock(info, replacements) {
      const nextBlocks = Array.from(replacements || []).filter(Boolean);
      if (!info?.el || !nextBlocks.length) return null;
      if (info.type !== 'list') {
        info.el.replaceWith(...nextBlocks);
        return nextBlocks[0];
      }
      const lines = info.els?.length ? info.els : [info.el];
      const first = lines[0];
      const last = lines[lines.length - 1];
      const parent = first?.parentNode;
      if (!parent || last?.parentNode !== parent) return null;
      const after = last.nextSibling;
      const fragment = document.createDocumentFragment();
      nextBlocks.forEach((block) => fragment.appendChild(block));
      parent.insertBefore(fragment, first);
      let node = first;
      while (node && node !== after) {
        const next = node.nextSibling;
        node.remove();
        node = next;
      }
      return nextBlocks[0];
    }
    function focusFlowBlock(block) {
      const target = block?.querySelector?.('.xhs-heading-title, .xhs-callout-body, .xhs-list-body') || block;
      if (target) setCaretInside(target);
    }
    function tryToggleOrSwitchFlowBlock(targetType, targetLevel) {
      const selection = window.getSelection();
      const info = activeFlowBlockAt(selection?.anchorNode) || activeFlowBlockAt(selectedFlowBlock);
      if (!info) return false;
      const sameType = info.type === targetType && (targetType !== 'heading' || info.level === targetLevel);
      let replacements = [];
      if (sameType) {
        if (info.type === 'list') {
          replacements = flowBlockListBodies(info).map((body) => {
            const p = document.createElement('p');
            p.className = 'xhs-p xhs-block';
            p.innerHTML = normalizeInlineHtml(body.innerHTML) || '<br>';
            return p;
          });
        } else {
          const p = document.createElement('p');
          p.className = 'xhs-p xhs-block';
          p.innerHTML = flowBlockContentHtml(info);
          replacements = [p];
        }
      } else {
        replacements = buildFlowBlocksFromContent(targetType, targetLevel, info);
      }
      const replacement = replaceFlowBlock(info, replacements);
      if (!replacement) return false;
      selection?.removeAllRanges();
      focusFlowBlock(replacement);
      if (activeFlowBlockAt(replacement)) selectFlowBlock(replacement);
      else clearSelectedFlowBlock();
      normalizeNestedFlowBlocks(stageScale);
      saveCurrentPage();
      scheduleOverflowReflow(true);
      return true;
    }
    function makeHeadingBlock(level = '1') {
      const targetLevel = String(level) === '2' ? '2' : '1';
      const editable = stageScale.querySelector('.xhs-body-card .xhs-body-frame') ||
        stageScale.querySelector('.xhs-cover-tail-frame');
      if (!editable) return;
      if (tryToggleOrSwitchFlowBlock('heading', targetLevel)) return;
      const item = getStageSelection();
      const heading = makeNewHeadingBlock(targetLevel === '1' ? nextAutoHeadingNumber() : '', '', targetLevel);
      if (item && !item.range.collapsed) {
        const parent = item.range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? item.range.commonAncestorContainer
          : item.range.commonAncestorContainer.parentElement;
        const fragment = item.range.extractContents();
        const holder = document.createElement('div');
        holder.appendChild(fragment);
        const titleText = stripHeadingNumberPrefix(textWithBreaks(holder), '00');
        heading.querySelector('.xhs-heading-title').innerHTML = escWithBreaks(titleText);
        const sourceBlock = parent?.closest?.('.xhs-p, .xhs-rich');
        if (sourceBlock && stageScale.contains(sourceBlock) && rangeCoversEntireBlock(item.range, sourceBlock)) {
          sourceBlock.replaceWith(heading);
        } else {
          item.range.insertNode(heading);
        }
        item.selection.removeAllRanges();
      } else {
        insertNodesAtSelection([heading], editable);
      }
      ensureEditorCaretAnchors(stageScale);
      const title = heading.querySelector('.xhs-heading-title');
      if (title) setCaretInside(title);
      saveCurrentPage();
      scheduleOverflowReflow(true);
    }
    function makeKeypointBlock() {
      if (tryToggleOrSwitchFlowBlock('card')) return;
      const item = getStageSelection();
      if (!item) {
        alert('请先选中要放进卡片的文字。');
        return;
      }
      const parent = item.range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? item.range.commonAncestorContainer
        : item.range.commonAncestorContainer.parentElement;
      if (blockNestHost(parent)) {
        alert('这里已经是卡片/引用/序列内容，请用加粗、有色字或下划线强调，不要再套卡片。');
        return;
      }
      const fragment = item.range.extractContents();
      const holder = document.createElement('div');
      holder.appendChild(fragment);
      const block = document.createElement('section');
      const plainBody = cleanText(holder.textContent || '');
      const label = inferCardLabel(plainBody);
      block.className = 'xhs-callout xhs-block' + (currentCardStyle === 'frame' ? ' xhs-card-frame' : '');
      block.innerHTML = '<div class="xhs-callout-label">' + esc(label) + '</div><div class="xhs-callout-body">' + cleanCalloutBodyHtml(holder.innerHTML) + '</div>';
      const sourceBlock = parent?.closest?.('.xhs-p, .xhs-rich');
      if (sourceBlock && stageScale.contains(sourceBlock) && rangeCoversEntireBlock(item.range, sourceBlock)) {
        sourceBlock.replaceWith(block);
      } else {
        item.range.insertNode(block);
      }
      item.selection.removeAllRanges();
      normalizeNestedFlowBlocks(stageScale);
      saveCurrentPage();
      scheduleOverflowReflow(true);
    }
    function boldSelection() {
      const selection = window.getSelection();
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        const title = parent?.closest?.('.cover-title');
        if (title) {
          toggleCoverTitleBold(selection, range, title);
          return;
        }
        const subtitle = parent?.closest?.('.cover-subtitle');
        if (subtitle) {
          toggleCoverSubtitleBold(selection, range, subtitle);
          return;
        }
      }
      document.execCommand('bold', false, null);
      saveCurrentPage();
    }
    function italicSelection() {
      if (tryToggleOrSwitchFlowBlock('quote')) return;
      const item = getStageSelection();
      if (!item) {
        alert('请先选中要变成引用块的文字。');
        return;
      }
      const parent = item.range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? item.range.commonAncestorContainer
        : item.range.commonAncestorContainer.parentElement;
      if (blockNestHost(parent)) {
        alert('卡片/序列内不能再套引用块，请用加粗、有色字或下划线强调。');
        return;
      }
      const sourceBlock = parent?.closest?.('.xhs-p, .xhs-rich');
      const block = document.createElement('section');
      block.className = 'xhs-quote xhs-block';
      if (sourceBlock && stageScale.contains(sourceBlock) && rangeCoversEntireBlock(item.range, sourceBlock)) {
        block.innerHTML = normalizeInlineHtml(sourceBlock.innerHTML || sourceBlock.textContent);
        sourceBlock.replaceWith(block);
      } else {
        const fragment = item.range.extractContents();
        const holder = document.createElement('div');
        holder.appendChild(fragment);
        if (!cleanText(holder.textContent)) {
          alert('请先选中有效文字。');
          return;
        }
        block.innerHTML = normalizeInlineHtml(holder.innerHTML);
        item.range.insertNode(block);
      }
      item.selection.removeAllRanges();
      normalizeNestedFlowBlocks(stageScale);
      saveCurrentPage();
      scheduleOverflowReflow(true);
    }
    function collectListItemsFromSelection(item) {
      const frame = item.range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? item.range.commonAncestorContainer.closest?.('.xhs-body-frame, .xhs-cover-tail-frame')
        : item.range.commonAncestorContainer.parentElement?.closest?.('.xhs-body-frame, .xhs-cover-tail-frame');
      const intersected = frame
        ? Array.from(frame.querySelectorAll('.xhs-p, .xhs-rich')).filter((block) => {
            try { return item.range.intersectsNode(block); } catch (_) { return false; }
          })
        : [];
      if (intersected.length >= 2) {
        return {
          mode: 'blocks',
          blocks: intersected,
          items: intersected.map((block) => ({
            html: stripListMarkerFromHtml(normalizeInlineHtml(block.innerHTML || block.textContent)),
            plain: stripLeadingListMarkerText(cleanText(block.textContent)),
          })).filter((entry) => entry.plain),
        };
      }
      const fragment = item.range.cloneContents();
      const holder = document.createElement('div');
      holder.appendChild(fragment);
      holder.querySelectorAll('br').forEach((br) => br.replaceWith('\\n'));
      const childBlocks = Array.from(holder.children).filter((node) => cleanText(node.textContent));
      if (childBlocks.length >= 2) {
        return {
          mode: 'items',
          items: childBlocks.map((node) => ({
            html: stripListMarkerFromHtml(normalizeInlineHtml(node.innerHTML || node.textContent)),
            plain: stripLeadingListMarkerText(cleanText(node.textContent)),
          })).filter((entry) => entry.plain),
        };
      }
      const text = textWithBreaks(holder);
      const lines = text.split(/\\n+/).map((line) => cleanText(line)).filter(Boolean);
      if (lines.length >= 2) {
        return {
          mode: 'items',
          items: lines.map((line) => ({
            html: normalizeInlineHtml(stripLeadingListMarkerText(line)),
            plain: stripLeadingListMarkerText(line),
          })),
        };
      }
      const plain = cleanText(holder.textContent);
      if (!plain) return { mode: 'items', items: [] };
      return {
        mode: 'items',
        items: [{ html: normalizeInlineHtml(holder.innerHTML || plain), plain }],
      };
    }
    function inferListTypeFromItems() {
      return 'unordered';
    }
    function insertListLines(lines, item, parent) {
      if (!lines.length) return;
      const frag = document.createDocumentFragment();
      lines.forEach((line) => frag.appendChild(line));
      if (item.mode === 'blocks') {
        const first = item.blocks[0];
        first.before(frag);
        item.blocks.forEach((block) => block.remove());
        return;
      }
      const sourceBlock = parent?.closest?.('.xhs-p, .xhs-rich, .xhs-list-line');
      if (sourceBlock && stageScale.contains(sourceBlock) && rangeCoversEntireBlock(item.range, sourceBlock)) {
        sourceBlock.replaceWith(frag);
        return;
      }
      item.range.deleteContents();
      item.range.insertNode(frag);
    }
    function makeListBlock() {
      if (tryToggleOrSwitchFlowBlock('list')) return;
      const item = getStageSelection();
      if (!item) {
        alert('请先选中要变成序列的文字。');
        return;
      }
      const parent = item.range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? item.range.commonAncestorContainer
        : item.range.commonAncestorContainer.parentElement;
      const collected = collectListItemsFromSelection(item);
      if (!collected.items.length) {
        alert('请先选中至少一行文字。多段/多行会拆成多条序列。');
        return;
      }
      const lines = buildListLines(collected.items);
      insertListLines(lines, collected, parent);
      item.selection.removeAllRanges();
      saveCurrentPage();
      scheduleOverflowReflow(true);
    }
    function replaceImage() {
      if (!selectedFrame) {
        alert('请先点选封面图或正文图片。');
        return;
      }
      imageInput.click();
    }
    function deleteImage() {
      if (!selectedFrame) {
        alert('请先点选要删除的图片。');
        return;
      }
      if (selectedFrame.classList.contains('cover-image-frame')) {
        selectedFrame.innerHTML = '<div class="cover-placeholder">点击替换封面图</div>';
        selectedFrame.dataset.fit = 'cover';
        selectedFrame.classList.remove('selected-image-frame');
        selectedFrame = null;
        saveCurrentPage();
        syncImageTools();
        renderImageList();
        return;
      }
      const block = frameBlock();
      const grid = selectedFrame.closest('.xhs-image-grid');
      if (!block) return;
      block.remove();
      if (grid) {
        const items = Array.from(grid.children).filter((child) => child.classList?.contains('xhs-image-block'));
        if (!items.length) {
          grid.remove();
        } else if (items.length === 1) {
          const only = items[0];
          only.classList.remove('xhs-image-cell');
          only.style.width = only.style.width || '100%';
          grid.replaceWith(only);
        } else {
          updateGridClass(grid);
        }
      }
      selectedFrame = null;
      saveCurrentPage();
      reflow();
    }
    function moveSelectedImageBlock(direction) {
      const selectedId = ensureImageId(frameBlock());
      if (!selectedId || selectedFrame?.classList.contains('cover-image-frame')) return;
      const holder = collectBodyFlowHolder();
      const selectedBlock = findImageBlockById(holder, selectedId);
      const node = selectedBlock?.closest('.xhs-image-grid') || selectedBlock;
      if (!node) return;
      const sibling = direction < 0 ? node.previousElementSibling : node.nextElementSibling;
      if (!sibling) return;
      if (direction < 0) holder.insertBefore(node, sibling);
      else holder.insertBefore(sibling, node);
      repaginateBodyBlocks(Array.from(holder.children), selectedId);
    }
    function pairSelectedImage(direction) {
      const selectedId = ensureImageId(frameBlock());
      if (!selectedId || selectedFrame?.classList.contains('cover-image-frame')) return;
      const holder = collectBodyFlowHolder();
      const block = findImageBlockById(holder, selectedId);
      if (!block) return;
      if (block.closest('.xhs-image-grid')) {
        alert('这张图已经在并排组里了。需要先拆成上下排列。');
        return;
      }
      const sibling = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
      if (!sibling || !sibling.classList.contains('xhs-image-block')) {
        alert(direction < 0 ? '前面没有可并排的图片。' : '后面没有可并排的图片。');
        return;
      }
      const parent = block.parentNode;
      const marker = document.createComment('xhs-image-grid-marker');
      parent.insertBefore(marker, direction < 0 ? sibling : block);
      delete block.dataset.noAutoGrid;
      delete sibling.dataset.noAutoGrid;
      const grid = imageGridFromBlocks(direction < 0 ? [sibling, block] : [block, sibling]);
      parent.insertBefore(grid, marker);
      marker.remove();
      repaginateBodyBlocks(Array.from(holder.children), selectedId);
    }
    function splitSelectedImageGrid() {
      const selectedId = ensureImageId(frameBlock());
      if (!selectedId) return;
      const holder = collectBodyFlowHolder();
      const selectedBlock = findImageBlockById(holder, selectedId);
      const grid = selectedBlock?.closest('.xhs-image-grid');
      if (!grid) return;
      const parent = grid.parentNode;
      const items = Array.from(grid.children).filter((child) => child.classList?.contains('xhs-image-block'));
      items.forEach((item) => {
        item.classList.remove('xhs-image-cell');
        item.dataset.noAutoGrid = '1';
        item.style.width = '100%';
        parent.insertBefore(item, grid);
      });
      grid.remove();
      repaginateBodyBlocks(Array.from(holder.children), selectedId);
    }
    imageInput.addEventListener('change', () => {
      const file = imageInput.files && imageInput.files[0];
      if (!file || !selectedFrame) return;
      const reader = new FileReader();
      reader.onload = () => {
        const nextSrc = String(reader.result || '');
        let img = selectedImage();
        if (!img) {
          img = document.createElement('img');
          img.draggable = false;
          img.style.objectFit = selectedFrame.dataset.fit || 'cover';
          img.style.objectPosition = '50% 50%';
          img.dataset.offsetX = '0';
          img.dataset.offsetY = '0';
          img.style.transform = 'translate(0px, 0px) scale(1)';
          selectedFrame.innerHTML = '';
          selectedFrame.appendChild(img);
        }
        img.src = nextSrc;
        const dims = imageDimensionsFromSrc(nextSrc);
        if (dims) {
          selectedFrame.dataset.naturalWidth = String(dims.width);
          selectedFrame.dataset.naturalHeight = String(dims.height);
          if (!selectedFrame.classList.contains('cover-image-frame') && !selectedFrame.dataset.userHeight) {
            selectedFrame.style.height = defaultImageHeight(dims, selectedFrame.getBoundingClientRect().width || config.bodyContentWidth) + 'px';
          }
        }
        saveCurrentPage();
        syncImageTools();
        renderImageList();
        imageInput.value = '';
      };
      reader.readAsDataURL(file);
    });
    function applyFit(fit) {
      if (!selectedFrame) return;
      selectedFrame.dataset.fit = fit;
      const img = selectedImage();
      if (img) img.style.objectFit = fit;
      syncImageTools();
      saveCurrentPage();
    }
    function scheduleImageLayoutReflow(delay = 520) {
      window.clearTimeout(imageReflowTimer);
      imageReflowTimer = window.setTimeout(() => {
        saveCurrentPage();
        reflow();
      }, delay);
    }
    function applyImageStyle(event) {
      if (!selectedFrame) return;
      const block = frameBlock();
      const img = selectedImage();
      if (block) block.style.width = imageWidthRange.value + '%';
      if (!selectedFrame.classList.contains('cover-image-frame')) {
        selectedFrame.style.height = imageHeightRange.value + 'px';
        selectedFrame.dataset.userHeight = '1';
      }
      if (img) {
        const offsets = imageOffset(img);
        setImageTransform(img, Number(imageZoomRange.value) / 100, offsets.x, offsets.y);
        img.style.objectPosition = imageXRange.value + '% ' + imageYRange.value + '%';
      }
      saveCurrentPage();
      if (event?.target === imageWidthRange || event?.target === imageHeightRange) {
        scheduleImageLayoutReflow();
      }
    }
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    let restoringState = false;
    function showRuntimeNotice(message) {
      if (!runtimeNotice || !message) return;
      runtimeNotice.textContent = message;
      runtimeNotice.hidden = false;
    }
    function draftStorageKey() {
      return 'rabbitQ-lark-xhs-draft:' + config.title + ':' + config.width + 'x' + config.height + ':' +
        (config.sourceFingerprint || config.version || 'default');
    }
    function draftCheckpointKey() {
      return draftStorageKey() + ':checkpoint';
    }
    function serializeStudioState() {
      return {
        generator: 'rabbitQ-skill-lark-xhs',
        version: config.version,
        savedAt: new Date().toISOString(),
        sourceFingerprint: config.sourceFingerprint || '',
        pageIndex,
        pages: pages.map((page) => ({ type: page.type, html: page.html, tailHtml: page.tailHtml || '' })),
        currentBgTheme,
        currentAccentTheme,
        currentCoverTheme,
        currentPaperPattern,
        currentCardStyle,
        coverImageEnabled,
        controls: {
          coverTitle: coverTitleRange.value,
          bodyFont: bodyFontRange.value,
          bodyLine: bodyLineRange.value,
          bodyPadX: bodyPadXRange.value,
          bodyPadY: bodyPadYRange.value,
        },
      };
    }
    function persistDraft() {
      if (restoringState || !pages.length) return;
      try {
        localStorage.setItem(draftStorageKey(), JSON.stringify(serializeStudioState()));
      } catch (_) {}
    }
    function persistDraftCheckpoint() {
      if (restoringState || !pages.length) return;
      try {
        localStorage.setItem(draftCheckpointKey(), JSON.stringify(serializeStudioState()));
      } catch (_) {}
    }
    function resetStudioToInitial() {
      if (!window.confirm('确定恢复初始状态吗？当前文字、图片、主题和排版修改都会被清除。')) return;
      restoringState = true;
      try {
        localStorage.removeItem(draftStorageKey());
        localStorage.removeItem(draftCheckpointKey());
        pageIndex = 0;
        selectedFrame = null;
        selectedFlowBlock = null;
        coverImageEnabled = true;
        coverTitleRange.value = String(initialLayout.coverTitleSize);
        bodyFontRange.value = String(initialLayout.bodyFontSize);
        bodyLineRange.value = String(Math.round(initialLayout.bodyLineHeight * 100));
        bodyPadXRange.value = String(initialLayout.bodyPadX);
        bodyPadYRange.value = String(initialLayout.bodyPadTop);
        applyBackgroundTheme(DEFAULT_BG_THEME, false);
        applyAccentTheme(DEFAULT_ACCENT_THEME, false);
        applyCoverTheme('background', false);
        applyPaperPattern('none', false);
        applyCardStyle('bar', false);
        applyLayout(false);
        paginate();
      } finally {
        restoringState = false;
      }
      persistDraft();
    }
    function studioPlainTextFromPages(pageList) {
      const holder = document.createElement('div');
      (pageList || []).forEach((page) => {
        if (!page || page.type === 'cover') {
          if (page?.tailHtml) holder.insertAdjacentHTML('beforeend', page.tailHtml);
          return;
        }
        if (page.html) holder.insertAdjacentHTML('beforeend', page.html);
      });
      return (holder.textContent || '').replace(/\s+/g, '');
    }
    function studioFlowIntegritySignature(pageList) {
      const merged = document.createElement('div');
      (pageList || []).forEach((page) => {
        if (!page) return;
        const htmlParts = page.type === 'cover' ? [page.tailHtml || ''] : [page.html || ''];
        htmlParts.forEach((html) => {
          if (!html) return;
          const holder = document.createElement('div');
          holder.innerHTML = '<div class="xhs-body-frame">' + html + '</div>';
          stripReflowArtifacts(holder);
          Array.from(holder.querySelector('.xhs-body-frame')?.children || []).forEach((node) => merged.appendChild(node));
        });
      });
      const blocks = mergeSplitBlocks(sanitizeMergedFlowBlocks(Array.from(merged.children)));
      return blocks.map((block) => {
        if (block.classList?.contains('xhs-manual-blank')) return '⟦BLANK⟧';
        if (block.dataset?.xhsPageBreak === '1' || block.classList?.contains('xhs-page-break')) return '⟦BREAK⟧';
        const text = (block.textContent || '').replace(/\s+/g, '');
        const images = Array.from(block.querySelectorAll?.('img') || []).map((img) => {
          const src = img.getAttribute('src') || '';
          return '⟦IMG:' + src.slice(-160) + '⟧';
        }).join('');
        return text + images;
      }).join('');
    }
    function templatePlainText() {
      return extractBlocksFromTemplate()
        .map((node) => node.textContent || '')
        .join('')
        .replace(/\s+/g, '');
    }
    function hasOrphanSplitBlocks(pageList) {
      const blocks = [];
      (pageList || []).forEach((page) => {
        if (!page) return;
        if (page.type === 'cover' && page.tailHtml) {
          const holder = document.createElement('div');
          holder.innerHTML = page.tailHtml;
          holder.querySelectorAll('[data-split]').forEach((node) => blocks.push(node));
        }
        if (page.type === 'body' && page.html) {
          const holder = document.createElement('div');
          holder.innerHTML = page.html;
          holder.querySelectorAll('[data-split]').forEach((node) => blocks.push(node));
        }
      });
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const kind = block.dataset?.split;
        const flowId = block.dataset?.flowId;
        if (!kind || !flowId) continue;
        const next = blocks[i + 1];
        if (kind === 'head' && (!next || next.dataset?.flowId !== flowId)) return true;
        if (kind === 'tail' && (!blocks[i - 1] || blocks[i - 1].dataset?.flowId !== flowId)) return true;
      }
      return false;
    }
    function isDraftCorrupted(state) {
      if (!state || !Array.isArray(state.pages) || !state.pages.length) return false;
      if (hasOrphanSplitBlocks(state.pages)) return true;
      const templateText = templatePlainText();
      const draftText = studioPlainTextFromPages(state.pages);
      if (!templateText || !draftText) return false;
      if (draftText.length < templateText.length * 0.9) return true;
      const sentinels = ['持续debug', '快速开始', '先在飞书云文档导出'];
      return sentinels.some((phrase) => templateText.includes(phrase) && !draftText.includes(phrase));
    }
    function applyStudioState(state, options = {}) {
      if (!state || !Array.isArray(state.pages) || !state.pages.length) return false;
      restoringState = true;
      try {
        let shouldReflowSavedDraft = Boolean(options.forceReflow) || state.version !== config.version;
        function sanitizeStoredHtml(html) {
          const holder = document.createElement('div');
          holder.innerHTML = String(html || '');
          if (holder.querySelector('br[data-xhs-wrap="1"]')) shouldReflowSavedDraft = true;
          removeAutoLineBreaks(holder);
          normalizeUnderlineDecorations(holder);
          return holder.innerHTML;
        }
        pages = state.pages
          .filter((page) => page && (page.type === 'cover' || page.type === 'body'))
          .map((page) => ({ type: page.type, html: sanitizeStoredHtml(page.html), tailHtml: sanitizeStoredHtml(page.tailHtml || '') }));
        if (!pages.length) return false;
        pageIndex = Math.max(0, Math.min(Number(state.pageIndex || 0), pages.length - 1));
        if (state.controls) {
          if (state.controls.coverTitle) coverTitleRange.value = state.controls.coverTitle;
          if (state.controls.bodyFont) bodyFontRange.value = state.controls.bodyFont;
          if (state.controls.bodyLine) bodyLineRange.value = state.controls.bodyLine;
          if (state.controls.bodyPadX) bodyPadXRange.value = state.controls.bodyPadX;
          if (state.controls.bodyPadY) bodyPadYRange.value = state.controls.bodyPadY;
        }
        applyBackgroundTheme(state.currentBgTheme || DEFAULT_BG_THEME, false);
        applyAccentTheme(state.currentAccentTheme || DEFAULT_ACCENT_THEME, false);
        applyCoverTheme(state.currentCoverTheme || 'background', false);
        applyPaperPattern(state.currentPaperPattern || 'none', false);
        applyCardStyle(state.currentCardStyle || 'bar', false);
        coverImageEnabled = state.coverImageEnabled !== false;
        syncPaperPatternUi();
        applyLayout(false);
        renderAll();
        if (shouldReflowSavedDraft && pages.some((page) => page.type === 'body')) {
          window.setTimeout(() => reflow(), 120);
        }
        return true;
      } finally {
        restoringState = false;
      }
    }
    function restoreSavedStudioState() {
      if (embeddedState) {
        if (isDraftCorrupted(embeddedState)) {
          showRuntimeNotice('检测到“保存编辑 HTML”中的正文不完整，已回退到源稿重新分页。');
        } else if (applyStudioState(embeddedState, { forceReflow: true })) {
          return true;
        }
      }
      try {
        const raw = localStorage.getItem(draftStorageKey());
        if (!raw) return false;
        const state = JSON.parse(raw);
        if (config.sourceFingerprint && state.sourceFingerprint && state.sourceFingerprint !== config.sourceFingerprint) {
          return false;
        }
        if (isDraftCorrupted(state)) {
          localStorage.removeItem(draftStorageKey());
          const checkpointRaw = localStorage.getItem(draftCheckpointKey());
          if (checkpointRaw) {
            const checkpoint = JSON.parse(checkpointRaw);
            if (!isDraftCorrupted(checkpoint) && applyStudioState(checkpoint, { forceReflow: true })) {
              showRuntimeNotice('检测到本地草稿正文不完整，已恢复到上一次安全编辑状态。');
              return true;
            }
          }
          showRuntimeNotice('检测到本地草稿正文不完整，已清除损坏草稿并回退到源稿。');
          return false;
        }
        return applyStudioState(state, { forceReflow: true });
      } catch (_) {}
      return false;
    }
    function jsonForInlineScript(value) {
      return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\\u2028/g, '\\u2028')
        .replace(/\\u2029/g, '\\u2029');
    }
    function saveEditedHtml() {
      saveCurrentPage();
      const state = serializeStudioState();
      let html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
      const replacement = 'const embeddedState = /* XHS_EMBEDDED_STATE */ ' + jsonForInlineScript(state) + ';\\n    let pages = [];';
      html = html.replace(/const embeddedState = \\/\\* XHS_EMBEDDED_STATE \\*\\/ [\\s\\S]*?\\n    let pages = \\[\\];/, replacement);
      if (!html.includes('XHS_EMBEDDED_STATE')) {
        alert('保存失败：没有找到可写入编辑状态的位置。');
        return;
      }
      const filename = config.title.replace(/[\\\\/:*?"<>|]/g, '') + '-xhs-studio-edited.html';
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
    }
    function waitForImages(root) {
      const imgs = Array.from(root.querySelectorAll('img'));
      return Promise.all(imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));
    }
    function currentThemeSnapshot() {
      const styles = getComputedStyle(document.documentElement);
      return {
        cardBg: styles.getPropertyValue('--xhs-card-bg').trim() || '#ffffff',
        coverBg: styles.getPropertyValue('--xhs-cover-bg').trim() || styles.getPropertyValue('--xhs-card-bg').trim() || '#ffffff',
        coverBorder: styles.getPropertyValue('--xhs-cover-border').trim() || styles.getPropertyValue('--xhs-underline').trim() || '#b8cbee',
        coverPlaceholder: styles.getPropertyValue('--xhs-cover-placeholder').trim() || '#8f948d',
        accent: styles.getPropertyValue('--xhs-accent').trim() || '#4d7fd2',
        accentStrong: styles.getPropertyValue('--xhs-accent-strong').trim() || '#2e5fb2',
        accentSoft: styles.getPropertyValue('--xhs-accent-soft').trim() || 'rgba(77,127,210,.16)',
        accentPale: styles.getPropertyValue('--xhs-accent-pale').trim() || '#f5faff',
        underline: styles.getPropertyValue('--xhs-underline').trim() || '#b8cbee',
      };
    }
    function prepareCardForExport(card) {
      if (!card) return currentThemeSnapshot();
      const theme = currentThemeSnapshot();
      normalizeUnderlineDecorations(card);
      normalizeCalloutBodyLabels(card);
      Object.entries({
        '--xhs-card-bg': theme.cardBg,
        '--xhs-cover-bg': theme.coverBg,
        '--xhs-cover-border': theme.coverBorder,
        '--xhs-cover-placeholder': theme.coverPlaceholder,
        '--xhs-accent': theme.accent,
        '--xhs-accent-strong': theme.accentStrong,
        '--xhs-accent-soft': theme.accentSoft,
        '--xhs-accent-pale': theme.accentPale,
        '--xhs-underline': theme.underline,
      }).forEach(([key, value]) => card.style.setProperty(key, value));
      card.style.backgroundColor = theme.cardBg;
      card.style.boxShadow = 'none';
      const bodyFrame = card.querySelector('.xhs-body-frame');
      if (bodyFrame) bodyFrame.style.backgroundColor = 'transparent';
      const coverText = card.querySelector('.cover-text');
      if (coverText) coverText.style.backgroundColor = theme.cardBg;
      card.querySelectorAll('.cover-media, .cover-image-frame').forEach((node) => {
        node.style.backgroundColor = theme.coverBg;
      });
      card.querySelectorAll('.cover-placeholder').forEach((node) => {
        node.style.color = theme.coverPlaceholder;
        node.style.borderColor = theme.coverBorder;
      });
      return theme;
    }
    function flattenImagesForExport(card) {
      card.querySelectorAll('.cover-image-frame img, .xhs-image-frame img').forEach((img) => {
        const frame = img.closest('.cover-image-frame, .xhs-image-frame');
        if (!frame) return;
        const frameWidth = frame.clientWidth || parseFloat(getComputedStyle(frame).width || '0');
        const frameHeight = frame.clientHeight || parseFloat(getComputedStyle(frame).height || '0');
        const naturalWidth = Number(frame.dataset.naturalWidth || img.naturalWidth || 0);
        const naturalHeight = Number(frame.dataset.naturalHeight || img.naturalHeight || 0);
        if (!frameWidth || !frameHeight || !naturalWidth || !naturalHeight) return;
        const fit = img.style.objectFit || frame.dataset.fit || 'contain';
        const scale = fit === 'cover'
          ? Math.max(frameWidth / naturalWidth, frameHeight / naturalHeight)
          : Math.min(frameWidth / naturalWidth, frameHeight / naturalHeight);
        const baseWidth = naturalWidth * scale;
        const baseHeight = naturalHeight * scale;
        const position = (img.style.objectPosition || getComputedStyle(img).objectPosition || '50% 50%').split(' ');
        const posX = parsePercent(position[0], 50) / 100;
        const posY = parsePercent(position[1], 50) / 100;
        const userScale = parseScale(img.style.transform) / 100;
        const offsetX = Number(img.dataset.offsetX || 0);
        const offsetY = Number(img.dataset.offsetY || 0);
        const finalWidth = baseWidth * userScale;
        const finalHeight = baseHeight * userScale;
        const left = (frameWidth - baseWidth) * posX + offsetX - (finalWidth - baseWidth) / 2;
        const top = (frameHeight - baseHeight) * posY + offsetY - (finalHeight - baseHeight) / 2;
        frame.style.position = 'relative';
        frame.style.overflow = 'hidden';
        img.style.position = 'absolute';
        img.style.left = left + 'px';
        img.style.top = top + 'px';
        img.style.width = finalWidth + 'px';
        img.style.height = finalHeight + 'px';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        img.style.objectFit = 'fill';
        img.style.objectPosition = '50% 50%';
        img.style.transform = 'none';
        img.style.transformOrigin = 'top left';
      });
    }
    async function exportZip() {
      saveCurrentPage();
      const button = document.getElementById('exportBtn');
      button.disabled = true;
      button.textContent = '导出中...';
      try {
        const zip = new JSZip();
        for (let i = 0; i < pages.length; i++) {
          exportRoot.innerHTML = cardHtml(pages[i]);
          const card = exportRoot.querySelector('.xhs-card');
          const theme = prepareCardForExport(card);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          balanceCoverSubtitle(exportRoot, { exportMode: true });
          fitHeadingTitles(exportRoot);
          await waitForImages(card);
          flattenImagesForExport(card);
          const underlineRects = stabilizeExportInlineStyles(card, theme);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const canvas = await html2canvas(card, {
            width: config.width,
            height: config.height,
            windowWidth: config.width,
            windowHeight: config.height,
            scale: 1,
            backgroundColor: theme.cardBg,
            useCORS: true,
            allowTaint: true,
            logging: false,
          });
          paintExportUnderlineRects(canvas, underlineRects);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          zip.file(String(i + 1).padStart(2, '0') + '.png', blob);
        }
        const out = await zip.generateAsync({ type: 'blob' });
        downloadBlob(out, config.title.replace(/[\\\\/:*?"<>|]/g, '') + '-xhs-cards.zip');
      } finally {
        exportRoot.innerHTML = '';
        button.disabled = false;
        button.textContent = '批量导出 PNG ZIP';
      }
    }
    function stripReflowArtifacts(holder) {
      removeAutoLineBreaks(holder);
      stripCaretAnchors(holder);
      holder.querySelectorAll?.('.xhs-caret-marker').forEach((node) => node.remove());
    }
    function reflow(preferredImageId = '') {
      const caretMarkerId = insertReflowCaretMarker();
      const rememberedImageId = preferredImageId || (selectedFrame?.classList.contains('cover-image-frame') ? '' : ensureImageId(frameBlock()));
      saveCurrentPage({ skipNormalize: true });
      persistDraftCheckpoint();
      const previousPages = pages.map((page) => ({ ...page }));
      const previousPageIndex = pageIndex;
      const beforeIntegrity = studioFlowIntegritySignature(previousPages);
      const cover = pages.find((page) => page.type === 'cover') || { type: 'cover', html: initialCoverHtml(), tailHtml: '' };
      if (!cover.tailHtml) cover.tailHtml = '';
      const merged = document.createElement('div');
      if (cover.tailHtml) {
        const tailHolder = document.createElement('div');
        tailHolder.innerHTML = '<div class="xhs-body-frame">' + cover.tailHtml + '</div>';
        stripReflowArtifacts(tailHolder);
        Array.from(tailHolder.querySelector('.xhs-body-frame')?.children || []).forEach((node) => merged.appendChild(node));
      }
      pages.filter((page) => page.type === 'body').forEach((page) => {
        const holder = document.createElement('div');
        holder.innerHTML = '<div class="xhs-body-frame">' + page.html + '</div>';
        stripReflowArtifacts(holder);
        const frame = holder.querySelector('.xhs-body-frame');
        Array.from(frame?.children || []).forEach((node) => merged.appendChild(node));
      });
      const blocks = sanitizeMergedFlowBlocks(Array.from(merged.children));
      const baseBlocks = blocks.length ? mergeSplitBlocks(blocks) : extractBlocksFromTemplate();
      const flowBlocks = pairAdjacentPortraitImages(baseBlocks);
      if (!coverImageEnabled) {
        pages = [cover].concat(paginateBlocksWithCoverTail(flowBlocks, cover));
      } else {
        cover.tailHtml = '';
        pages = [cover].concat(paginateBlocks(flowBlocks));
      }
      const afterIntegrity = studioFlowIntegritySignature(pages);
      if (beforeIntegrity !== afterIntegrity) {
        pages = previousPages;
        pageIndex = Math.min(previousPageIndex, Math.max(0, pages.length - 1));
        selectedFrame = null;
        renderAll();
        showRuntimeNotice('检测到本次重排会改变正文、图片或空行顺序，已自动撤回重排并保留原内容。');
        return false;
      }
      const caretPageIndex = pageIndexForCaretMarker(caretMarkerId);
      const nextIndex = pageIndexForImageId(rememberedImageId);
      pageIndex = caretPageIndex >= 0
        ? caretPageIndex
        : (nextIndex >= 0 ? nextIndex : Math.min(pageIndex, Math.max(0, pages.length - 1)));
      selectedFrame = null;
      renderAll();
      restoreReflowCaretMarker(caretMarkerId);
      const rememberedBlock = findImageBlockById(stageScale, rememberedImageId);
      const frame = rememberedBlock?.querySelector('.xhs-image-frame');
      if (frame) selectFrame(frame);
      return true;
    }
    [document.getElementById('boldBtn'), italicBtn, headingBtn1, headingBtn2, greenTextBtn, greenUnderlineBtn, keypointBtn, listBtn].forEach((button) => {
      button?.addEventListener('mousedown', (event) => event.preventDefault());
    });
    document.getElementById('boldBtn').addEventListener('click', boldSelection);
    headingBtn1.addEventListener('click', () => makeHeadingBlock('1'));
    headingBtn2.addEventListener('click', () => makeHeadingBlock('2'));
    italicBtn.addEventListener('click', italicSelection);
    greenTextBtn.addEventListener('click', applyGreenText);
    greenUnderlineBtn.addEventListener('click', applyGreenUnderline);
    keypointBtn.addEventListener('click', makeKeypointBlock);
    listBtn?.addEventListener('click', makeListBlock);
    coverImageOnBtn?.addEventListener('click', () => applyCoverImageMode(true));
    coverImageOffBtn?.addEventListener('click', () => applyCoverImageMode(false));
    fontWechatBtn.addEventListener('click', () => setFontMode('wechat'));
    fontSongtiBtn.addEventListener('click', () => setFontMode('songti'));
    bgThemeButtons.forEach((button) => button.addEventListener('click', () => applyBackgroundTheme(button.dataset.bgTheme)));
    accentThemeButtons.forEach((button) => button.addEventListener('click', () => applyAccentTheme(button.dataset.accentTheme)));
    coverThemeButtons.forEach((button) => button.addEventListener('click', () => applyCoverTheme(button.dataset.coverTheme)));
    paperPatternButtons.forEach((button) => button.addEventListener('click', () => applyPaperPattern(button.dataset.paperPattern)));
    cardStyleButtons.forEach((button) => button.addEventListener('click', () => applyCardStyle(button.dataset.cardStyle)));
    coverTitleRange.addEventListener('input', () => {
      applyLayout(false);
      balanceCoverTitle();
      saveCurrentPage();
    });
    [bodyFontRange, bodyLineRange, bodyPadXRange, bodyPadYRange].forEach((input) => {
      input.addEventListener('input', () => applyLayout(true));
    });
    document.getElementById('saveHtmlBtn').addEventListener('click', saveEditedHtml);
    document.getElementById('exportBtn').addEventListener('click', exportZip);
    document.getElementById('resetBtn').addEventListener('click', resetStudioToInitial);
    fitContainBtn.addEventListener('click', () => applyFit('contain'));
    fitCoverBtn.addEventListener('click', () => applyFit('cover'));
    imageMoveUpBtn.addEventListener('click', () => moveSelectedImageBlock(-1));
    imageMoveDownBtn.addEventListener('click', () => moveSelectedImageBlock(1));
    imagePairPrevBtn.addEventListener('click', () => pairSelectedImage(-1));
    imagePairNextBtn.addEventListener('click', () => pairSelectedImage(1));
    imageSplitGridBtn.addEventListener('click', splitSelectedImageGrid);
    [imageWidthRange, imageHeightRange, imageZoomRange, imageXRange, imageYRange].forEach((input) => {
      input.addEventListener('input', applyImageStyle);
    });
    document.addEventListener('selectionchange', () => {
      if (!stageScale?.isConnected) return;
      syncPanelTools();
    });
    document.addEventListener('keydown', (event) => {
      if (isHistoryShortcut(event)) cancelPendingReflow();
    });
    document.addEventListener('keydown', (event) => {
      if (!selectedFrame) return;
      const target = event.target;
      const withinSelectedFrame = target === selectedFrame || selectedFrame.contains(target);
      if (!withinSelectedFrame) {
        if (target?.closest?.('input, textarea, select')) return;
        if (target?.isContentEditable || target?.closest?.('[contenteditable="true"]')) return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        deleteImage();
        return;
      }
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelectedImageBlock(-1);
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelectedImageBlock(1);
      }
    });
    window.addEventListener('resize', fitStage);
    if (!restoreSavedStudioState()) {
      applyBackgroundTheme(DEFAULT_BG_THEME, false);
      applyAccentTheme(DEFAULT_ACCENT_THEME, false);
      applyPaperPattern('none', false);
      applyCardStyle('bar', false);
      applyLayout(false);
      paginate();
    }
  </script>
</body>
</html>`;
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const resolved = resolveInput(opts.input);
  try {
    const markdown = fs.readFileSync(resolved.markdownFile, "utf8");
    const { frontmatter, chineseMeta } = prepareMarkdownBody(markdown);
    const title = opts.title || extractTitle(markdown) || path.basename(resolved.markdownFile, path.extname(resolved.markdownFile));
    const subtitle = opts.subtitle || frontmatter.subtitle || chineseMeta.subtitle || "";
    const base = slugify(title);
    const outDir = path.resolve(opts.outputDir || path.join(path.dirname(resolved.markdownFile), `${base}-xhs`));
    fs.mkdirSync(outDir, { recursive: true });

    const coverTitleExplicit = isCoverTitleExplicit(markdown, opts.title);
    const sourceHtml = renderNativeXhsSourceHtml(resolved.markdownFile, markdown, title, { coverTitleExplicit });
    const extracted = extractWechatContent(sourceHtml);
    const markdownVideoWarnings = extractMarkdownVideoWarnings(markdown);
    const seenWarningSrc = new Set();
    const mediaWarnings = [];
    for (const warning of [...extracted.warnings, ...markdownVideoWarnings]) {
      const key = warning.label || warning.src;
      if (seenWarningSrc.has(key)) continue;
      seenWarningSrc.add(key);
      mediaWarnings.push(warning);
    }
    const scaleX = opts.width / DEFAULT_WIDTH;
    const scaleY = opts.height / DEFAULT_HEIGHT;
    const bodyPadX = Math.round(BODY_PAD_X * scaleX);
    const bodyPadTop = Math.round(BODY_PAD_TOP * scaleY);
    const bodyPadBottom = Math.round(BODY_PAD_BOTTOM * scaleY);
    const stat = fs.statSync(resolved.markdownFile);
    const sourceFingerprint = `${stat.mtimeMs}:${stat.size}:${VERSION}`;
    const payload = {
      title: extracted.title || title,
      subtitle,
      contentHtml: extracted.contentHtml,
      warnings: mediaWarnings,
      width: opts.width,
      height: opts.height,
      coverSplitY: Math.round(opts.height * 0.5),
      bodyPadX,
      bodyPadTop,
      bodyPadBottom,
      bodyContentWidth: opts.width - bodyPadX * 2,
      bodyContentHeight: opts.height - bodyPadTop - bodyPadBottom,
      bodyFontSize: Math.round(36 * scaleX),
      bodyLineHeight: 1.74,
      bodyCharsPerLine: 21,
      headingNumberSize: Math.round(87 * scaleX),
      headingTitleSize: Math.round(48 * scaleX),
      sourceFingerprint,
      sourcePath: resolved.markdownFile,
    };

    const libs = {
      html2canvas: readBrowserDependency("html2canvas/dist/html2canvas.min.js"),
      jszip: readBrowserDependency("jszip/dist/jszip.min.js"),
    };
    const studioPath = path.join(outDir, "xhs-studio.html");
    const manifestPath = path.join(outDir, "manifest.json");
    fs.writeFileSync(studioPath, studioHtmlV2(payload, libs));
    writeJson(manifestPath, {
      generator: "rabbitQ-skill-lark-xhs",
      version: VERSION,
      mode: "lark-xhs-fixed-pages",
      title: payload.title,
      width: opts.width,
      height: opts.height,
      layout: {
        coverSplitY: payload.coverSplitY,
        bodyPadX: payload.bodyPadX,
        bodyPadTop: payload.bodyPadTop,
        bodyPadBottom: payload.bodyPadBottom,
        bodyContentWidth: payload.bodyContentWidth,
        bodyContentHeight: payload.bodyContentHeight,
        bodyFontSize: payload.bodyFontSize,
        bodyCharsPerLine: payload.bodyCharsPerLine,
      },
      studio: studioPath,
      studioUrl: pathToFileURL(studioPath).href,
      source: resolved.markdownFile,
      mediaWarnings,
      validation: "passed",
    });

    console.log(JSON.stringify({
      ok: true,
      outputDir: outDir,
      width: opts.width,
      height: opts.height,
      mode: "lark-xhs-fixed-pages",
      mediaWarnings: mediaWarnings.length,
      studio: studioPath,
      studioUrl: pathToFileURL(studioPath).href,
    }, null, 2));
  } finally {
    if (resolved.cleanup) resolved.cleanup();
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
