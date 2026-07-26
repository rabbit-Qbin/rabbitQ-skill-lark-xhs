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
  if (!data || typeof data.markdown !== "string") {
    throw new Error("docs +fetch 返回中缺少 markdown 字段");
  }
  return { auth: true, title: data.title || "", markdown: data.markdown };
}

function prefixBlockquote(content) {
  return String(content || "")
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trim()}` : ">"))
    .join("\n");
}

function cleanLarkMarkdown(markdown) {
  const imageTokens = [];
  let body = String(markdown || "");

  // 图片：记录 token，引用指向本地 assets 路径（下载后可能修正扩展名）。
  body = body.replace(/<image\b[^>]*?token="([^"]+)"[^>]*?\/?>/g, (_, token) => {
    imageTokens.push(token);
    const name = `img_${String(imageTokens.length).padStart(3, "0")}_${token.slice(0, 8)}`;
    return `![图片 ${imageTokens.length}](assets/${name}.png)`;
  });

  // 画板无法导出为图片，保留占位说明。
  body = body.replace(/<whiteboard\b[^>]*?token="([^"]+)"[^>]*?\/?>/g, "*(画板: $1)*");

  // 附件（含视频）不下载，标注名称。
  body = body.replace(/<view\b[^>]*>[\s\S]*?<file\b[^>]*?name="([^"]*)"[^>]*?\/?>[\s\S]*?<\/view>/g, "**[附件: $1]**");
  body = body.replace(/<file\b[^>]*?name="([^"]*)"[^>]*?\/?>/g, "**[附件: $1]**");

  // 引用类容器统一成 Markdown 引用块。
  body = body.replace(/<callout\b[^>]*>([\s\S]*?)<\/callout>/g, (_, inner) => prefixBlockquote(inner));
  body = body.replace(/<quote-container\b[^>]*>([\s\S]*?)<\/quote-container>/g, (_, inner) => prefixBlockquote(inner));

  // 分栏布局展平为顺序内容（栏与栏之间保留段落分隔）。
  body = body.replace(/<\/column>\s*<column\b[^>]*>/g, "\n\n");
  body = body.replace(/<\/?(?:grid|column)\b[^>]*>/g, "");

  // 行内样式标签只留文字。
  body = body.replace(/<text\b[^>]*>([\s\S]*?)<\/text>/g, "$1");

  // lark-table 等其余私有标签：保留文本，去掉标签本身。
  body = body.replace(/<\/?lark-table\b[^>]*>/g, "");
  body = body.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/g, (tag) => (/^<\/?(?:p|br|strong|em|code|a|img|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|blockquote|pre|span|div|section)\b/i.test(tag) ? tag : ""));

  // 收敛多余空行。
  body = body.replace(/\n{3,}/g, "\n\n");
  return { body: `${body.trim()}\n`, imageTokens };
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
    title = data.title || "";
    rawMarkdown = data.markdown || "";
  } else {
    const fetchResult = fetchDocument(opts.url);
    if (!fetchResult.auth) {
      printAuthGuidance();
      process.exit(2);
    }
    title = fetchResult.title;
    rawMarkdown = fetchResult.markdown;
  }

  const { body, imageTokens } = cleanLarkMarkdown(rawMarkdown);
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
  console.log(JSON.stringify({ ok: true, markdownFile, images: downloaded, totalImages: imageTokens.length }));
}

try {
  main();
} catch (error) {
  console.error(`[lark-export] ${error.message}`);
  process.exit(1);
}
