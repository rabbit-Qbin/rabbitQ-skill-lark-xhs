#!/usr/bin/env node
"use strict";

/**
 * rabbitQ lark-export — 飞书云文档导出为标准 Markdown 包。
 *
 * 用法：
 *   node scripts/lark-export.js <飞书URL> -o <输出目录> [--slug 文件名]
 *   node scripts/lark-export.js --fetch-json <fetch结果.json> -o <输出目录> [--slug 文件名]
 *
 * 流程：lark-cli docs +fetch → 清洗飞书私有标签 → docs +media-download 逐张下图。
 * 产出：<输出目录>/<slug>.md + assets/img_NNN_<token前8位>.<ext>
 * 退出码：0 成功；2 需要用户授权（会打印引导）；1 其他失败。
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const AUTH_SCOPE = "wiki:wiki:readonly docx:document:readonly";

function parseArgs(argv) {
  const opts = { url: "", outputDir: "", slug: "", fetchJson: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "-o" || arg === "--output-dir") && argv[i + 1]) opts.outputDir = argv[++i];
    else if (arg === "--slug" && argv[i + 1]) opts.slug = argv[++i];
    else if (arg === "--fetch-json" && argv[i + 1]) opts.fetchJson = argv[++i];
    else if (!arg.startsWith("-") && !opts.url) opts.url = arg;
  }
  return opts;
}

function runLarkCli(args, options = {}) {
  const res = childProcess.spawnSync("lark-cli", args, {
    encoding: "utf8",
    cwd: options.cwd || process.cwd(),
    shell: process.platform === "win32",
  });
  const text = `${res.stdout || ""}${res.stderr || ""}`;
  return { status: res.status, text };
}

function needsAuthorization(text) {
  return /need_user_authorization|user authorization|未授权|授权后重试/i.test(text);
}

function printAuthGuidance() {
  console.error("[lark-export] 当前账号尚未授权读取飞书文档。请按以下步骤授权后重试：");
  console.error(`  1. 运行：lark-cli auth login --scope "${AUTH_SCOPE}"`);
  console.error("  2. 把命令输出的授权链接发给用户，用户在浏览器里完成授权");
  console.error("  3. 重新运行本命令");
}

function fetchDocument(url) {
  const { status, text } = runLarkCli(["docs", "+fetch", "--doc", url, "--as", "user"]);
  if (needsAuthorization(text)) return { auth: false };
  if (status !== 0) throw new Error(`docs +fetch 失败：${text.slice(0, 400)}`);
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`docs +fetch 返回不是 JSON：${text.slice(0, 400)}`);
  const payload = JSON.parse(text.slice(start));
  const data = payload.data || payload;
  // 新版 lark-cli 返回 data.document.content（XML-ish），旧版返回 data.markdown。
  const content = data?.document?.content ?? data?.markdown;
  if (typeof content !== "string") {
    throw new Error("docs +fetch 返回中缺少文档内容字段（document.content / markdown）");
  }
  return { auth: true, title: data?.document?.title || data?.title || "", markdown: content };
}

function prefixBlockquote(content) {
  return String(content || "")
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trim()}` : ">"))
    .join("\n");
}

function stripTags(value) {
  return String(value || "").replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/gi, "").trim();
}

/**
 * 清洗 docs +fetch 返回的文档内容为标准 Markdown。
 * 兼容两种返回形态：
 * - 新版 lark-cli：data.document.content（XML-ish，含 <title>/<h3>/<p>/<b>/<u>/<img src="token"/>）
 * - 旧版：data.markdown（飞书自定义标签，如 <image token>、<grid>）
 */
function cleanLarkMarkdown(markdown) {
  const imageTokens = [];
  let title = "";
  let body = String(markdown || "");

  body = body.replace(/<title>([\s\S]*?)<\/title>/, (_, inner) => {
    title = stripTags(inner);
    return "";
  });

  // 图片：新版 <img src="token"/> 与旧版 <image token="..."/> 都记录 token。
  body = body.replace(/<img\b[^>]*?src="([^"]+)"[^>]*?\/?>/g, (_, token) => {
    imageTokens.push(token);
    const name = `img_${String(imageTokens.length).padStart(3, "0")}_${token.slice(0, 8)}`;
    return `\n\n![图片 ${imageTokens.length}](assets/${name}.png)\n\n`;
  });
  body = body.replace(/<image\b[^>]*?token="([^"]+)"[^>]*?\/?>/g, (_, token) => {
    imageTokens.push(token);
    const name = `img_${String(imageTokens.length).padStart(3, "0")}_${token.slice(0, 8)}`;
    return `\n\n![图片 ${imageTokens.length}](assets/${name}.png)\n\n`;
  });

  // 画板无法导出为图片，保留占位说明。
  body = body.replace(/<whiteboard\b[^>]*?token="([^"]+)"[^>]*?\/?>/g, "*(画板: $1)*");

  // 附件（含视频）不下载，标注名称。
  body = body.replace(/<view\b[^>]*>[\s\S]*?<file\b[^>]*?name="([^"]*)"[^>]*?\/?>[\s\S]*?<\/view>/g, "**[附件: $1]**");
  body = body.replace(/<file\b[^>]*?name="([^"]*)"[^>]*?\/?>/g, "**[附件: $1]**");

  // 引用类容器统一成 Markdown 引用块。
  body = body.replace(/<callout\b[^>]*>([\s\S]*?)<\/callout>/g, (_, inner) => `\n\n${prefixBlockquote(stripTags(inner))}\n\n`);
  body = body.replace(/<quote-container\b[^>]*>([\s\S]*?)<\/quote-container>/g, (_, inner) => `\n\n${prefixBlockquote(stripTags(inner))}\n\n`);

  // 标题层级照原样映射。
  body = body.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, depth, inner) => `\n\n${"#".repeat(Number(depth))} ${stripTags(inner)}\n\n`);

  // 行内样式。飞书常把一句话拆成多个连续 <u>/<b> 段，先合并再转换，
  // 否则会得到 ++a++++b++ 这类断裂标记。
  body = body.replace(/<\/u>\s*<u\b[^>]*>/g, "");
  body = body.replace(/<\/b>\s*<b\b[^>]*>/g, "");
  body = body.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/g, "**$1**");
  body = body.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/g, "**$1**");
  body = body.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/g, "++$1++");
  body = body.replace(/<text\b[^>]*>([\s\S]*?)<\/text>/g, "$1");

  // 列表。
  body = body.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/g, (_, inner) => `\n- ${stripTags(inner)}`);
  body = body.replace(/<\/?(?:ul|ol)\b[^>]*>/g, "\n");

  // 段落。
  body = body.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (_, inner) => (inner.trim() ? `\n\n${inner.trim()}\n\n` : "\n\n"));
  body = body.replace(/<p\b[^>]*\/?>/g, "\n\n");

  // 分栏布局展平为顺序内容（栏与栏之间保留段落分隔）。
  body = body.replace(/<\/column>\s*<column\b[^>]*>/g, "\n\n");
  body = body.replace(/<\/?(?:grid|column)\b[^>]*>/g, "");

  // lark-table 等其余私有标签：保留文本，去掉标签本身。
  body = body.replace(/<\/?lark-table\b[^>]*>/g, "");
  body = body.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/g, (tag) => (/^<\/?(?:p|br|strong|em|code|a|img|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|blockquote|pre|span|div|section)\b/i.test(tag) ? tag : ""));

  // 收敛多余空行。
  body = body.replace(/\n{3,}/g, "\n\n");
  return { title, body: `${body.trim()}\n`, imageTokens };
}

function downloadImages(imageTokens, assetsDir, body) {
  if (!imageTokens.length) return { body, downloaded: 0 };
  fs.mkdirSync(assetsDir, { recursive: true });
  let nextBody = body;
  let downloaded = 0;
  imageTokens.forEach((token, index) => {
    const name = `img_${String(index + 1).padStart(3, "0")}_${token.slice(0, 8)}`;
    const existing = fs.readdirSync(assetsDir).find((file) => file.startsWith(`${name}.`));
    if (existing) {
      if (existing !== `${name}.png`) nextBody = nextBody.replace(`assets/${name}.png`, `assets/${existing}`);
      downloaded += 1;
      return;
    }
    const { status, text } = runLarkCli(["docs", "+media-download", "--token", token, "--output", name, "--as", "user"], { cwd: assetsDir });
    if (needsAuthorization(text)) throw Object.assign(new Error("need_user_authorization"), { code: "AUTH" });
    if (status !== 0) throw new Error(`media-download 失败（${name}）：${text.slice(0, 300)}`);
    const produced = fs.readdirSync(assetsDir).find((file) => file.startsWith(`${name}.`));
    if (!produced) throw new Error(`media-download 未产出文件（${name}）`);
    if (produced !== `${name}.png`) nextBody = nextBody.replace(`assets/${name}.png`, `assets/${produced}`);
    downloaded += 1;
  });
  return { body: nextBody, downloaded };
}

function pruneOrphanAssets(assetsDir, body) {
  // 重跑同一文档时，清理不再被 Markdown 引用的旧图（如文档里换过的图）。
  // 注意：assets 目录里只有文件；用 unlinkSync 而不是 rmSync——
  // Node 24 在含全角字符的路径上调用 fs.rmSync 会让进程直接崩溃。
  if (!fs.existsSync(assetsDir)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(assetsDir)) {
    if (!String(body).includes(`assets/${file}`)) {
      fs.unlinkSync(path.join(assetsDir, file));
      removed += 1;
    }
  }
  return removed;
}

function slugify(value) {
  const cleaned = String(value || "lark-doc")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "lark-doc";
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if ((!opts.url && !opts.fetchJson) || !opts.outputDir) {
    console.error("用法：node scripts/lark-export.js <飞书URL> -o <输出目录> [--slug 文件名]");
    console.error("     node scripts/lark-export.js --fetch-json <fetch结果.json> -o <输出目录> [--slug 文件名]");
    process.exit(1);
  }
  fs.mkdirSync(opts.outputDir, { recursive: true });

  let title = "";
  let rawMarkdown = "";
  if (opts.fetchJson) {
    const payload = JSON.parse(fs.readFileSync(opts.fetchJson, "utf8"));
    const data = payload.data || payload;
    title = data?.document?.title || data?.title || "";
    rawMarkdown = data?.document?.content ?? data?.markdown ?? "";
  } else {
    const fetchResult = fetchDocument(opts.url);
    if (!fetchResult.auth) {
      printAuthGuidance();
      process.exit(2);
    }
    title = fetchResult.title;
    rawMarkdown = fetchResult.markdown;
  }

  const cleaned = cleanLarkMarkdown(rawMarkdown);
  if (!title) title = cleaned.title;
  const { body, imageTokens } = cleaned;
  let finalBody = body;
  let downloaded = 0;
  if (opts.fetchJson) {
    // 离线模式只验证清洗逻辑，不下载图片。
  } else {
    try {
      const result = downloadImages(imageTokens, path.join(opts.outputDir, "assets"), body);
      finalBody = result.body;
      downloaded = result.downloaded;
    } catch (error) {
      if (error && error.code === "AUTH") {
        printAuthGuidance();
        process.exit(2);
      }
      throw error;
    }
  }

  const slug = slugify(opts.slug || title || "lark-doc");
  const pruned = pruneOrphanAssets(path.join(opts.outputDir, "assets"), finalBody);
  const markdownFile = path.join(opts.outputDir, `${slug}.md`);
  const frontmatter = [
    "---",
    `title: ${title || slug}`,
    opts.url ? `source: ${opts.url}` : "",
    "---",
    "",
    "",
  ].filter((line, index) => line !== "" || index > 2);
  fs.writeFileSync(markdownFile, `${frontmatter.join("\n")}${finalBody}`);
  fs.writeFileSync(path.join(opts.outputDir, "_image_tokens.json"), `${JSON.stringify(imageTokens, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, markdownFile, images: downloaded, totalImages: imageTokens.length, prunedAssets: pruned }));
}

try {
  main();
} catch (error) {
  console.error(`[lark-export] ${error.message}`);
  process.exit(1);
}
