#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright-core");

function findBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rabbitq-xhs-smoke-"));
  const sourceDir = path.join(root, "source");
  const outputDir = path.join(root, "output");
  fs.mkdirSync(sourceDir, { recursive: true });
  const markdown = [
    "# 回归测试",
    "",
    "## 01 结构识别",
    "",
    "- Alt + 拖动：卡片和图片整块移动",
    "- 重新分页：改完内容一键重排",
    "",
    "> 引用块适合放金句：这仍然应该是引用，不是卡片。",
    "",
    "**金句：这是明确的卡片。**",
    "",
    "**注意：这是注意卡片需要保留的正文，开头标签不应该重复显示。**",
    "",
    "**结论：这是结论卡片需要保留的正文，开头标签不应该重复显示。**",
    "",
    "**划重点：这是重点卡片需要保留的正文，开头标签不应该重复显示。**",
    "",
    "**时间价值**",
    "",
    "这件事花的时间 \\< 你本人核心时间的价值",
    "",
    "| 模式 | 适合 | 页数 |",
    "| --- | --- | ---: |",
    "| 有封面图 | 视觉强、产品感 | 6 |",
    "| 无封面图 | 干货长文、教程 | 8 |",
    "| 半页封面 | 标题 + 首段同页 | 5 |",
    ...Array.from({ length: 18 }, (_, index) => `| 长表第 ${index + 1} 行 | 跨页时保持完整数据行 | ${index + 9} |`),
    "",
    "![回归测试图片](fixture.png)",
    "",
    "---",
    "",
    "### 二级小标题回归",
    "",
    "**项目**：rabbitQ-skill-lark-xhs（GitHub）",
  ].join("\n");
  fs.writeFileSync(path.join(sourceDir, "article.md"), markdown, "utf8");
  const fixturePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(path.join(sourceDir, "fixture.png"), fixturePng);

  const convert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), sourceDir, "-o", outputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(convert.status, 0, convert.stderr || convert.stdout);

  const explicitSourceDir = path.join(root, "explicit-cover-source");
  const explicitOutputDir = path.join(root, "explicit-cover-output");
  fs.mkdirSync(explicitSourceDir, { recursive: true });
  const explicitMarkdown = [
    "---",
    "title: 封面大标题（frontmatter）",
    "subtitle: 封面副标题",
    "---",
    "",
    "# 正文里的一级标题",
    "",
    "## 01 章节",
    "",
    "段落正文。",
  ].join("\n");
  fs.writeFileSync(path.join(explicitSourceDir, "article.md"), explicitMarkdown, "utf8");
  const explicitConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), explicitSourceDir, "-o", explicitOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(explicitConvert.status, 0, explicitConvert.stderr || explicitConvert.stdout);
  const explicitHtml = fs.readFileSync(path.join(explicitOutputDir, "xhs-studio.html"), "utf8");
  assert.match(explicitHtml, /封面大标题（frontmatter）/);
  assert.match(explicitHtml, /<section data-xhs-heading-level="1"[\s\S]*?<strong>章节<\/strong>/);
  assert.doesNotMatch(explicitHtml, /<section data-xhs-heading-level="1"[\s\S]*?正文里的一级标题/);
  assert.match(explicitHtml, /<section><strong>正文里的一级标题<\/strong><\/section>/);
  const explicitLevel1Blocks = [...explicitHtml.matchAll(/<section data-xhs-heading-level="1"[\s\S]*?<\/section>/g)].map((match) => match[0]);
  assert.ok(explicitLevel1Blocks.length >= 1);
  assert.ok(explicitLevel1Blocks.every((block) => !block.includes("封面大标题")));

  const chineseSourceDir = path.join(root, "chinese-cover-source");
  const chineseOutputDir = path.join(root, "chinese-cover-output");
  fs.mkdirSync(chineseSourceDir, { recursive: true });
  const chineseMarkdown = [
    "标题：中文标签大标题",
    "副标题：中文标签副标题，写完就能批量出图",
    "",
    "# 正文一级章节",
    "",
    "## 01 小节",
    "",
    "段落正文。",
  ].join("\n");
  fs.writeFileSync(path.join(chineseSourceDir, "article.md"), chineseMarkdown, "utf8");
  const chineseConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), chineseSourceDir, "-o", chineseOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(chineseConvert.status, 0, chineseConvert.stderr || chineseConvert.stdout);
  const chineseHtml = fs.readFileSync(path.join(chineseOutputDir, "xhs-studio.html"), "utf8");
  assert.match(chineseHtml, /"title":"中文标签大标题"/);
  assert.match(chineseHtml, /"subtitle":"中文标签副标题，写完就能批量出图"/);
  assert.doesNotMatch(chineseHtml, /标题：中文标签大标题/);
  assert.match(chineseHtml, /<section data-xhs-heading-level="1"[\s\S]*?<strong>小节<\/strong>/);
  assert.match(chineseHtml, /<section><strong>正文一级章节<\/strong><\/section>/);

  const boldListSourceDir = path.join(root, "bold-list-source");
  const boldListOutputDir = path.join(root, "bold-list-output");
  fs.mkdirSync(boldListSourceDir, { recursive: true });
  const boldListMarkdown = [
    "## 封面模式",
    "",
    "1. **有封面图**：上图下文",
    "",
    "2. **关封面图**：标题占上半页",
  ].join("\n");
  fs.writeFileSync(path.join(boldListSourceDir, "article.md"), boldListMarkdown, "utf8");
  const boldListConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), boldListSourceDir, "-o", boldListOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(boldListConvert.status, 0, boldListConvert.stderr || boldListConvert.stdout);
  const boldListHtml = fs.readFileSync(path.join(boldListOutputDir, "xhs-studio.html"), "utf8");
  assert.match(boldListHtml, /data-list-type="ordered"/);
  assert.doesNotMatch(boldListHtml, /XHSCoverLatin|Times New Roman/);
  assert.match(boldListHtml, /<strong[^>]*>有封面图<\/strong>/);
  assert.match(boldListHtml, /<strong[^>]*>关封面图<\/strong>/);
  assert.doesNotMatch(boldListHtml, /有封面图\*\*/);

  const blankSourceDir = path.join(root, "flow-blank-source");
  const blankOutputDir = path.join(root, "flow-blank-output");
  fs.mkdirSync(blankSourceDir, { recursive: true });
  const blankMarkdown = [
    "# 空行回归",
    "",
    "**金句：卡片和正文之间要留一空行。**",
    "",
    "这是下一段正文。",
  ].join("\n");
  fs.writeFileSync(path.join(blankSourceDir, "article.md"), blankMarkdown, "utf8");
  const blankConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), blankSourceDir, "-o", blankOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(blankConvert.status, 0, blankConvert.stderr || blankConvert.stdout);
  const blankHtml = fs.readFileSync(path.join(blankOutputDir, "xhs-studio.html"), "utf8");
  assert.match(blankHtml, /data-xhs-flow-blank="1"/);
  assert.match(blankHtml, /<p><strong>金句：卡片和正文之间要留一空行。<\/strong><\/p>\s*<p data-xhs-flow-blank="1"[\s\S]*?<p>这是下一段正文/);

  const tightSourceDir = path.join(root, "tight-spacing-source");
  const tightOutputDir = path.join(root, "tight-spacing-output");
  fs.mkdirSync(tightSourceDir, { recursive: true });
  const tightMarkdown = [
    "## 01 间距回归",
    "",
    "**结论：卡片后只跟正文，不额外撑开。**",
    "",
    "正文段落。",
    "",
    "![示意图](fixture.png)",
    "",
    "图片后的正文。",
  ].join("\n");
  fs.writeFileSync(path.join(tightSourceDir, "article.md"), tightMarkdown, "utf8");
  fs.writeFileSync(path.join(tightSourceDir, "fixture.png"), fixturePng);
  const tightConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), tightSourceDir, "-o", tightOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(tightConvert.status, 0, tightConvert.stderr || tightConvert.stdout);
  const tightHtml = fs.readFileSync(path.join(tightOutputDir, "xhs-studio.html"), "utf8");
  const tightTemplate = tightHtml.match(/<template id="wechatTemplate">([\s\S]*?)<\/template>/)?.[1] || "";
  assert.ok(tightTemplate.length > 0);
  assert.match(tightTemplate, /<p>正文段落。<\/p>\s*<section><img/);
  assert.match(tightTemplate, /<section><img[\s\S]*?<\/section>\s*<p>图片后的正文。<\/p>/);

  const flowSourceDir = path.join(root, "flow-continuity-source");
  const flowOutputDir = path.join(root, "flow-continuity-output");
  fs.mkdirSync(flowSourceDir, { recursive: true });
  const flowMarkdown = [
    "# 连续流回归",
    "",
    "**结论：一句话：写完就能发，不用一张张拼图。**",
    "",
    "此工具为本兔自用工具、持续debug中…符合本人写作及编辑图文习惯和审美，如果有其他可以跟Codex交互修改skills哦！比如样式或者对于一些子标题的识别规则等等……",
    "",
    "## 快速开始",
    "",
    "先在飞书云文档导出 markdown（包括附件！）",
  ].join("\n");
  fs.writeFileSync(path.join(flowSourceDir, "article.md"), flowMarkdown, "utf8");
  const flowConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), flowSourceDir, "-o", flowOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(flowConvert.status, 0, flowConvert.stderr || flowConvert.stdout);
  const flowHtmlPath = path.join(flowOutputDir, "xhs-studio.html");

  const htmlPath = path.join(outputDir, "xhs-studio.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /data-xhs-block-type="quote"/);
  assert.match(html, /data-xhs-block-type="table"/);
  assert.match(html, /<th>模式<\/th>/);
  assert.match(html, /border-top: 1\.5px solid var\(--xhs-accent\)/);
  assert.match(html, /border-bottom: 1\.5px solid var\(--xhs-accent\)/);
  assert.match(html, /tbody tr:last-child td \{ border-bottom: 2px solid var\(--xhs-underline\)/);
  assert.doesNotMatch(html, /&lt;br&gt;/);
  assert.match(html, /data-xhs-heading-level="1"/);
  assert.match(html, /data-xhs-heading-level="2"/);
  assert.doesNotMatch(html, /data-xhs-heading-level="1"[^>]*>.*回归测试/);
  assert.match(html, /data-xhs-page-break="1"/);
  assert.match(html, /<button id="headingBtn1">一级标题<\/button>/);
  assert.match(html, /<button id="headingBtn2">二级标题<\/button>/);
  assert.doesNotMatch(html, /id="headingBtn"/);
  assert.doesNotMatch(html, /id="replaceImageBtn"/);
  assert.doesNotMatch(html, /id="deleteImageBtn"/);
  assert.match(html, /这件事花的时间 &lt; 你本人核心时间的价值/);
  assert.doesNotMatch(html, /这件事花的时间 \\&lt;/);

  const executablePath = findBrowser();
  assert.ok(executablePath, "No Chromium browser found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE");
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const orderedPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await orderedPage.addInitScript(() => localStorage.clear());
    await orderedPage.goto(`file://${path.join(boldListOutputDir, "xhs-studio.html")}`);
    await orderedPage.waitForTimeout(500);
    const orderedListPageIndex = await orderedPage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("#pageTabs button"));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (document.querySelector('#stageScale .xhs-list-line[data-list-type="ordered"]')) return index;
      }
      return -1;
    });
    assert.ok(orderedListPageIndex >= 0, "expected ordered list page in Studio runtime");
    await orderedPage.locator("#pageTabs button").nth(orderedListPageIndex).click();
    await orderedPage.waitForTimeout(100);
    assert.strictEqual(
      await orderedPage.locator('#stageScale .xhs-list-line[data-list-type="ordered"]').count(),
      2,
      "ordered Markdown lists must remain ordered in the Studio runtime",
    );
    const orderedFirstBody = orderedPage.locator('#stageScale .xhs-list-line[data-list-type="ordered"] .xhs-list-body').first();
    const orderedFirstText = (await orderedFirstBody.textContent()) || "";
    await orderedFirstBody.evaluate((body) => {
      const selection = window.getSelection();
      const range = document.createRange();
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let remaining = Math.max(1, (body.textContent || "").indexOf("：") + 1);
      while (node && remaining > node.textContent.length) {
        remaining -= node.textContent.length;
        node = walker.nextNode();
      }
      if (!node) throw new Error("missing ordered-list caret node");
      range.setStart(node, Math.min(remaining, node.textContent.length));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      body.closest('[contenteditable="true"]')?.focus();
    });
    await orderedPage.keyboard.press("Enter");
    await orderedPage.waitForTimeout(250);
    await orderedPage.evaluate(() => reflow());
    await orderedPage.waitForTimeout(350);
    const orderedAfterEnter = await orderedPage.locator("#stageScale .xhs-list-line").evaluateAll((lines) => ({
      types: lines.map((line) => line.dataset.listType || ""),
      text: lines.map((line) => line.querySelector(".xhs-list-body")?.textContent || "").join(""),
      boldCount: lines.reduce((total, line) => total + line.querySelectorAll(".xhs-list-body strong").length, 0),
    }));
    assert.ok(orderedAfterEnter.types.length >= 3);
    assert.ok(orderedAfterEnter.types.every((type) => type === "ordered"));
    assert.ok(orderedAfterEnter.text.includes(orderedFirstText), "list text after caret must survive Enter and reflow");
    assert.ok(orderedAfterEnter.boldCount >= 2, "bold markup in ordered lists must survive Enter and reflow");
    const orderedSpacing = await orderedPage.locator('#stageScale .xhs-list-line[data-list-type="ordered"]').first().evaluate((line) => {
      const marker = line.querySelector(".xhs-list-marker");
      const lineStyles = getComputedStyle(line);
      const markerStyles = getComputedStyle(marker);
      return {
        gap: parseFloat(lineStyles.columnGap || lineStyles.gap),
        markerWidth: parseFloat(markerStyles.width),
        markerFontSize: parseFloat(markerStyles.fontSize),
        markerHeight: parseFloat(markerStyles.height),
        bodyFontSize: parseFloat(lineStyles.fontSize),
        bodyLineHeight: parseFloat(lineStyles.lineHeight),
      };
    });
    assert.ok(orderedSpacing.gap <= 8, "sequence marker gap should stay visually close to its body");
    assert.ok(orderedSpacing.markerWidth <= 44, "ordered marker slot should not create a wide indent");
    assert.ok(orderedSpacing.markerFontSize < orderedSpacing.bodyFontSize, "ordered sequence marker should be visibly smaller than its body text");
    assert.ok(Math.abs(orderedSpacing.markerHeight - orderedSpacing.bodyLineHeight) < 0.2, "ordered marker should occupy the body line box for vertical centering");
    assert.ok(Math.abs(orderedSpacing.markerFontSize - (orderedSpacing.bodyFontSize * 0.8 + 2)) < 0.2, "ordered marker should be two pixels larger than the 80% baseline");

    // Regression: Chinese IME composition must not trigger save, normalization, or reflow
    // until the candidate text has been committed.
    const compositionState = await orderedPage.evaluate(async () => {
      const frame = document.querySelector('#stageScale .xhs-body-frame');
      const body = frame?.querySelector('.xhs-list-body');
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!frame || !body || !node) throw new Error('missing list text for IME composition test');
      const committedText = '组合输入回归';
      const pageBeforeComposition = pages[pageIndex].html;
      frame.focus();
      frame.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.textContent += committedText;
      frame.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: committedText,
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 260));
      const unchangedWhileComposing = pages[pageIndex].html === pageBeforeComposition;
      frame.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: committedText }));
      frame.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: committedText,
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 260));
      const savedAfterComposition = pages[pageIndex].html.includes(committedText);
      node.textContent = node.textContent.slice(0, -committedText.length);
      saveCurrentPage({ skipNormalize: true });
      return {
        unchangedWhileComposing,
        savedAfterComposition,
      };
    });
    assert.strictEqual(compositionState.unchangedWhileComposing, true, "IME composition must not save or rewrite the current page before commit");
    assert.strictEqual(compositionState.savedAfterComposition, true, "committed IME text must save after compositionend");

    // Regression: Backspace from a paragraph directly below a sequence should
    // continue that sequence instead of leaving behind an orphan marker.
    const sequenceContinuationTarget = orderedPage.locator('#stageScale .xhs-body-frame').first();
    await sequenceContinuationTarget.evaluate((frame) => {
      const lastLine = Array.from(frame.querySelectorAll('.xhs-list-line')).at(-1);
      const paragraph = document.createElement('p');
      paragraph.className = 'xhs-p xhs-block';
      paragraph.textContent = '接回序列的正文';
      lastLine.after(paragraph);
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      frame.focus();
    });
    await orderedPage.keyboard.press('Backspace');
    const sequenceContinuationState = await sequenceContinuationTarget.evaluate((frame) => ({
      listText: Array.from(frame.querySelectorAll('.xhs-list-line')).map((line) => line.querySelector('.xhs-list-body')?.textContent || ''),
      plainText: Array.from(frame.querySelectorAll('.xhs-p:not(.xhs-list-line)')).map((node) => node.textContent || ''),
    }));
    assert.ok(sequenceContinuationState.listText.includes('接回序列的正文'), 'Backspace should continue the previous sequence');
    assert.ok(!sequenceContinuationState.plainText.includes('接回序列的正文'), 'continued text must not remain as a plain paragraph');
    await orderedPage.keyboard.press('Control+z');
    await orderedPage.waitForTimeout(120);
    assert.strictEqual(await orderedPage.locator('#stageScale .xhs-list-body').filter({ hasText: '接回序列的正文' }).count(), 0, 'sequence continuation test should restore its fixture state');

    // Regression: Studio-owned undo/redo must restore a toolbar formatting action
    // even after the editor serializes its page state.
    const undoPhrase = '撤回样式';
    await orderedPage.locator('#stageScale .xhs-list-line .xhs-list-body').first().evaluate((body, phrase) => {
      const text = document.createTextNode(phrase);
      body.append(text);
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      body.closest('[contenteditable="true"]')?.focus();
    }, undoPhrase);
    await orderedPage.locator('#greenTextBtn').click();
    assert.strictEqual(await orderedPage.locator('.xhs-green-text').filter({ hasText: undoPhrase }).count(), 1);
    await orderedPage.locator('#stageScale .xhs-list-line .xhs-list-body').first().evaluate((body) => {
      body.closest('[contenteditable="true"]')?.focus();
    });
    await orderedPage.keyboard.press('Control+z');
    await orderedPage.waitForTimeout(120);
    assert.strictEqual(await orderedPage.locator('.xhs-green-text').filter({ hasText: undoPhrase }).count(), 0, 'Ctrl+Z should undo a Studio toolbar action');
    await orderedPage.keyboard.press('Control+y');
    await orderedPage.waitForTimeout(120);
    assert.strictEqual(await orderedPage.locator('.xhs-green-text').filter({ hasText: undoPhrase }).count(), 1, 'Ctrl+Y should redo a Studio toolbar action');
    await orderedPage.locator('#stageScale .xhs-list-line .xhs-list-body').first().evaluate((body, phrase) => {
      const styled = Array.from(body.querySelectorAll('.xhs-green-text')).find((node) => node.textContent === phrase);
      styled?.remove();
      saveCurrentPage({ skipNormalize: true });
    }, undoPhrase);

    // Inline styles only affect the selected phrase inside a sequence body.
    // They can stack with each other, while each individual style toggles off.
    const inlineListState = await orderedPage.evaluate(() => {
      const line = Array.from(document.querySelectorAll('#stageScale .xhs-list-line[data-list-type="ordered"]'))
        .find((item) => (item.querySelector('.xhs-list-body')?.textContent || '').trim());
      if (!line) throw new Error('missing non-empty ordered list body for inline-style test');
      const body = line.querySelector('.xhs-list-body');
      const firstText = (() => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let offset = 0;
        while (node) {
          if ((node.textContent || '').trim() && !node.parentElement?.closest('.xhs-green-text, .xhs-green-underline')) {
            return { text: node.textContent || '', offset };
          }
          offset += (node.textContent || '').length;
          node = walker.nextNode();
        }
        return null;
      })();
      const selectedText = (firstText?.text || '').slice(0, 3);
      const selectPhrase = () => {
        const boundary = (offset, preferNextNode) => {
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          let remaining = offset;
          while (node) {
            const length = (node.textContent || '').length;
            if (remaining < length || (!preferNextNode && remaining === length)) return { node, offset: remaining };
            remaining -= length;
            node = walker.nextNode();
          }
          throw new Error('missing list phrase boundary');
        };
        const range = document.createRange();
        const start = boundary(firstText.offset, true);
        const end = boundary(firstText.offset + selectedText.length, false);
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      };
      const initialUnderlineCount = body.querySelectorAll('.xhs-green-underline').length;
      selectPhrase();
      document.getElementById("greenUnderlineBtn").click();
      const underlineText = Array.from(body.querySelectorAll('.xhs-green-underline')).find((node) => node.textContent === selectedText)?.textContent || '';
      const afterUnderlineHtml = body.innerHTML;
      selectPhrase();
      document.getElementById("greenTextBtn").click();
      const afterStack = {
        underlineCount: body.querySelectorAll(".xhs-green-underline").length,
        greenCount: body.querySelectorAll(".xhs-green-text").length,
      };
      selectPhrase();
      document.getElementById("greenTextBtn").click();
      const afterGreenToggle = body.querySelectorAll(".xhs-green-text").length;
      selectPhrase();
      document.getElementById("greenUnderlineBtn").click();
      const afterUnderlineToggle = body.querySelectorAll(".xhs-green-underline").length;
      return {
        childClasses: Array.from(line.children).map((child) => child.className),
        selectedText,
        underlineText,
        initialUnderlineCount,
        afterUnderlineHtml,
        afterStack,
        afterUnderlineToggle,
        afterUnderlineToggleHtml: body.innerHTML,
        afterGreenToggle,
        bodyText: body.textContent || "",
        lineText: line.textContent || "",
      };
    });
    assert.deepStrictEqual(inlineListState.childClasses.length, 2, "a sequence line must retain exactly marker and body children");
    assert.ok(inlineListState.childClasses.includes("xhs-list-marker xhs-list-marker-ordered"));
    assert.ok(inlineListState.childClasses.includes("xhs-list-body"));
    assert.strictEqual(inlineListState.underlineText, inlineListState.selectedText, "underline must apply only to the selected sequence phrase: " + JSON.stringify(inlineListState));
    assert.strictEqual(inlineListState.afterStack.underlineCount, inlineListState.initialUnderlineCount + 1, "underline should remain when green text is added");
    assert.strictEqual(inlineListState.afterStack.greenCount, 1, "green text should stack with underline on the selected phrase");
    assert.strictEqual(inlineListState.afterGreenToggle, 0, "clicking green text twice must cancel only the green text: " + JSON.stringify(inlineListState));
    assert.strictEqual(inlineListState.afterUnderlineToggle, inlineListState.initialUnderlineCount, "clicking underline twice must cancel only the underline: " + JSON.stringify(inlineListState));
    assert.ok(inlineListState.lineText.endsWith(inlineListState.bodyText), "sequence body text must not be split into a separate flex column");

    // Switching a style from any item converts the complete contiguous sequence.
    await orderedPage.locator('#stageScale .xhs-list-line[data-list-type="ordered"] .xhs-list-body').nth(1).evaluate((body) => {
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("keypointBtn").click();
    });
    await orderedPage.waitForTimeout(900);
    const sequenceCardState = await orderedPage.evaluate(() => {
      for (const tab of Array.from(document.querySelectorAll("#pageTabs button"))) {
        tab.click();
        const card = document.querySelector("#stageScale .xhs-callout");
        if (!card) continue;
        const body = card.querySelector(".xhs-callout-body");
        const styles = getComputedStyle(body);
        return {
          text: body.textContent || "",
          fontSize: styles.fontSize,
          fontFamily: styles.fontFamily,
          listCount: document.querySelectorAll("#stageScale .xhs-list-line").length,
        };
      }
      return null;
    });
    assert.ok(sequenceCardState, "sequence should switch to a card");
    assert.ok(
      orderedAfterEnter.text.split(/\s+/).filter(Boolean).every((part) => sequenceCardState.text.includes(part)),
      'sequence conversion lost list text: ' + JSON.stringify({ before: orderedAfterEnter.text, after: sequenceCardState.text }),
    );
    assert.strictEqual(sequenceCardState.listCount, 0);
    assert.strictEqual(sequenceCardState.fontSize, "34px");
    const cardInlineState = await orderedPage.locator("#stageScale .xhs-callout-body").first().evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && (!(text.textContent || "").trim() || text.parentElement?.closest(".xhs-green-text, .xhs-green-underline"))) text = walker.nextNode();
      if (!text) throw new Error("missing card text for inline-style test");
      const phrase = text.textContent.slice(0, 2);
      const selectPhrase = (node = text) => {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, Math.min(node.textContent.length, phrase.length));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      };
      selectPhrase(); document.getElementById("greenUnderlineBtn").click();
      const underline = Array.from(body.querySelectorAll(".xhs-green-underline")).find((node) => node.textContent === phrase);
      const underlineBorder = underline ? getComputedStyle(underline).borderBottomWidth : "";
      const underlineText = Array.from(body.querySelectorAll(".xhs-green-underline")).find((node) => node.textContent === phrase)?.textContent || "";
      selectPhrase(underline?.firstChild || text); document.getElementById("greenTextBtn").click();
      return {
        phrase,
        underlineText,
        underlineBorder,
        greenText: Array.from(body.querySelectorAll(".xhs-green-text")).find((node) => node.textContent === phrase)?.textContent || "",
      };
    });
    assert.strictEqual(cardInlineState.underlineText, cardInlineState.phrase, "card underline must apply only to the selected phrase");
    assert.strictEqual(cardInlineState.greenText, cardInlineState.phrase, "card green text must apply only to the selected phrase");
    assert.notStrictEqual(cardInlineState.underlineBorder, "0px", "card underline must remain visible");
    await orderedPage.locator("#stageScale .xhs-callout-body").first().evaluate((body) => {
      body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      body.closest('[contenteditable="true"]')?.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("italicBtn").click();
    });
    await orderedPage.waitForTimeout(900);
    const sequenceQuoteStyle = await orderedPage.evaluate(() => {
      for (const tab of Array.from(document.querySelectorAll("#pageTabs button"))) {
        tab.click();
        const quote = document.querySelector("#stageScale .xhs-quote");
        if (!quote) continue;
        const styles = getComputedStyle(quote);
        return { fontSize: styles.fontSize, fontFamily: styles.fontFamily };
      }
      return null;
    });
    assert.ok(sequenceQuoteStyle, "sequence card should switch to a quote");
    assert.strictEqual(sequenceQuoteStyle.fontSize, "34px");
    assert.strictEqual(sequenceQuoteStyle.fontFamily, sequenceCardState.fontFamily);
    await orderedPage.close();

    // Regression: the same list-backspace rule must work when an environment
    // emits only beforeinput (for example, some IMEs and virtual keyboards).
    const beforeInputPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await beforeInputPage.addInitScript(() => localStorage.clear());
    await beforeInputPage.goto(`file://${path.join(boldListOutputDir, "xhs-studio.html")}`);
    await beforeInputPage.waitForTimeout(300);
    const beforeInputListPageIndex = await beforeInputPage.evaluate(() => {
      for (const [index, tab] of Array.from(document.querySelectorAll('#pageTabs button')).entries()) {
        tab.click();
        if (document.querySelector('#stageScale .xhs-list-line .xhs-list-body')) return index;
      }
      return -1;
    });
    await beforeInputPage.locator('#pageTabs button').nth(beforeInputListPageIndex).click();
    const beforeInputListState = await beforeInputPage.evaluate(() => {
      const body = document.querySelector('#stageScale .xhs-list-line .xhs-list-body');
      const frame = body.closest('[contenteditable="true"]');
      const sample = body.textContent || '';
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      frame.focus();
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward',
      });
      const allowed = frame.dispatchEvent(event);
      return {
        allowed,
        plainText: Array.from(frame.querySelectorAll('.xhs-p:not(.xhs-list-line)')).map((node) => node.textContent || ''),
        sample,
      };
    });
    assert.strictEqual(beforeInputListState.allowed, false, 'list beforeinput should be handled by the Studio command chain');
    assert.ok(beforeInputListState.plainText.some((text) => text.includes(beforeInputListState.sample.slice(0, 4))), 'beforeinput list backspace should unlist into a paragraph');
    await beforeInputPage.locator('#pageTabs button').first().click();
    const coverUndoState = await beforeInputPage.evaluate(async () => {
      const title = document.querySelector('.cover-title');
      const suffix = '封面撤回';
      title.focus();
      title.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: suffix }));
      title.append(document.createTextNode(suffix));
      title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: suffix }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { suffix, withSuffix: title.textContent.includes(suffix) };
    });
    assert.strictEqual(coverUndoState.withSuffix, true);
    await beforeInputPage.keyboard.press('Control+z');
    await beforeInputPage.waitForTimeout(100);
    assert.strictEqual(await beforeInputPage.locator('.cover-title').innerText().then((text) => text.includes(coverUndoState.suffix)), false, 'cover text should also use Studio undo history');
    await beforeInputPage.close();

    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(500);
    const draftIdentity = await page.evaluate(() => ({
      key: draftStorageKey(),
      fingerprint: config.sourceFingerprint,
      version: config.version,
    }));
    assert.ok(draftIdentity.key.includes(draftIdentity.fingerprint));
    assert.ok(draftIdentity.fingerprint.endsWith(`:${draftIdentity.version}`));

    async function collectFlowOrder() {
      const count = await page.locator("#pageTabs button").count();
      const order = [];
      for (let index = 1; index < count; index += 1) {
        await page.locator("#pageTabs button").nth(index).click();
        await page.waitForTimeout(50);
        const blocks = await page.locator("#stageScale .xhs-body-frame > :not(.xhs-caret-anchor)").evaluateAll((nodes) => nodes.flatMap((node) => {
          if (node.classList.contains("xhs-table-block")) {
            return Array.from(node.querySelectorAll("tbody tr")).map((row) => ({
              className: "xhs-table-row",
              text: row.textContent.replace(/\s+/g, " ").trim(),
              imageCount: row.querySelectorAll("img").length,
            }));
          }
          return [{
            className: node.className,
            text: node.textContent.replace(/\s+/g, " ").trim(),
            imageCount: node.querySelectorAll("img").length,
          }];
        }));
        order.push(...blocks);
      }
      return order;
    }

    const flowOrderBeforeCoverToggle = await collectFlowOrder();
    await page.locator("#pageTabs button").first().click();
    assert.strictEqual(await page.locator("#coverThemeTools").isVisible(), true);
    await page.click("#coverImageOffBtn");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator("#coverThemeTools").isVisible(), false);
    assert.match(await page.locator("#pageInfo").innerText(), /正文已接入封面下半区/);
    assert.ok(await page.locator("#stageScale .xhs-cover-tail-frame").count());
    assert.ok(await page.locator("#stageScale .xhs-cover-tail-frame").evaluate((node) => node.children.length >= 2));
    await page.click("#coverImageOnBtn");
    await page.waitForTimeout(500);
    const flowOrderAfterCoverToggle = await collectFlowOrder();
    assert.deepStrictEqual(flowOrderAfterCoverToggle, flowOrderBeforeCoverToggle);

    // Regression: deleting a leading manual-blank line inside the cover's
    // tail frame (shown when the cover image is off) must actually remove
    // it instead of leaving behind a phantom empty caret-anchor paragraph.
    await page.locator("#pageTabs button").first().click();
    await page.click("#coverImageOffBtn");
    await page.waitForTimeout(500);
    const tailFrameHeadingCount = await page.locator("#stageScale .xhs-cover-tail-frame .xhs-heading").count();
    assert.ok(tailFrameHeadingCount > 0, "expected a heading to flow into the cover tail frame");
    const tailFrameBaseline = await page.locator("#stageScale .xhs-cover-tail-frame").first().evaluate((frame) => ({
      manualBlankCount: frame.querySelectorAll(".xhs-manual-blank").length,
      caretAnchorCount: frame.querySelectorAll(".xhs-caret-anchor").length,
      firstChildIsHeading: frame.firstElementChild?.classList.contains("xhs-heading") || false,
    }));
    await page.locator("#stageScale .xhs-cover-tail-frame .xhs-heading").first().evaluate((heading) => {
      const blank = document.createElement("p");
      blank.className = "xhs-p xhs-block xhs-manual-blank";
      blank.innerHTML = "<br>";
      heading.before(blank);
      const frame = heading.closest('[contenteditable="true"]');
      frame?.focus();
      const range = document.createRange();
      range.selectNodeContents(blank);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
    const tailFrameBlankState = await page.locator("#stageScale .xhs-cover-tail-frame").first().evaluate((frame) => ({
      manualBlankCount: frame.querySelectorAll(".xhs-manual-blank").length,
      caretAnchorCount: frame.querySelectorAll(".xhs-caret-anchor").length,
      firstChildIsHeading: frame.firstElementChild?.classList.contains("xhs-heading") || false,
    }));
    assert.strictEqual(tailFrameBlankState.manualBlankCount, tailFrameBaseline.manualBlankCount);
    assert.strictEqual(tailFrameBlankState.caretAnchorCount, 0);
    assert.strictEqual(tailFrameBlankState.firstChildIsHeading, tailFrameBaseline.firstChildIsHeading);
    // Persisted state (survives switching pages away and back) must stay clean too.
    await page.locator("#pageTabs button").nth(1).click();
    await page.waitForTimeout(100);
    await page.locator("#pageTabs button").first().click();
    await page.waitForTimeout(100);
    assert.strictEqual(await page.locator("#stageScale .xhs-cover-tail-frame").first().evaluate((frame) => (
      frame.querySelectorAll(".xhs-caret-anchor").length
    )), 0);
    assert.strictEqual(await page.locator("#stageScale .xhs-cover-tail-frame").first().evaluate((frame) => (
      frame.querySelectorAll(".xhs-manual-blank").length
    )), tailFrameBaseline.manualBlankCount);
    await page.click("#coverImageOnBtn");
    await page.waitForTimeout(500);

    // Regression: deleting a leading manual-blank on body page 2 must not leave a phantom blank below.
    if (await page.locator("#pageTabs button").count() > 2) {
      await page.locator("#pageTabs button").nth(2).click();
      await page.waitForTimeout(100);
      const bodyPageFrame = page.locator("#stageScale .xhs-body-card .xhs-body-frame").first();
      const bodyPageBaseline = await bodyPageFrame.evaluate((frame) => ({
        manualBlankCount: frame.querySelectorAll(".xhs-manual-blank").length,
        leadingIsBlank: Boolean(
          frame.firstElementChild?.classList.contains("xhs-manual-blank") ||
          ((frame.firstElementChild?.classList.contains("xhs-p") || frame.firstElementChild?.classList.contains("xhs-rich")) &&
            !frame.firstElementChild?.textContent?.replace(/\s+/g, "").length),
        ),
        firstText: frame.firstElementChild?.textContent?.replace(/\s+/g, " ").trim() || "",
      }));
      await bodyPageFrame.evaluate((frame) => {
        const blank = document.createElement("p");
        blank.className = "xhs-p xhs-block xhs-manual-blank";
        blank.innerHTML = "<br>";
        const first = frame.firstElementChild;
        if (first) first.before(blank);
        else frame.appendChild(blank);
        frame.focus();
        const range = document.createRange();
        range.selectNodeContents(blank);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(800);
      const bodyPageBlankState = await bodyPageFrame.evaluate((frame) => ({
        manualBlankCount: frame.querySelectorAll(".xhs-manual-blank").length,
        leadingIsBlank: Boolean(
          frame.firstElementChild?.classList.contains("xhs-manual-blank") ||
          ((frame.firstElementChild?.classList.contains("xhs-p") || frame.firstElementChild?.classList.contains("xhs-rich")) &&
            !frame.firstElementChild?.textContent?.replace(/\s+/g, "").length),
        ),
        firstText: frame.firstElementChild?.textContent?.replace(/\s+/g, " ").trim() || "",
      }));
      assert.strictEqual(bodyPageBlankState.manualBlankCount, bodyPageBaseline.manualBlankCount);
      assert.strictEqual(bodyPageBlankState.leadingIsBlank, bodyPageBaseline.leadingIsBlank);
      assert.strictEqual(bodyPageBlankState.firstText, bodyPageBaseline.firstText);
    }

    // Regression: deleting a mid-page manual-blank must not resurrect phantom blanks after reflow.
    await page.locator("#pageTabs button").nth(1).click();
    await page.waitForTimeout(100);
    const midPageFrame = page.locator("#stageScale .xhs-body-card .xhs-body-frame").first();
    const midPageBaseline = await midPageFrame.evaluate((frame) => ({
      manualBlankCount: frame.querySelectorAll(".xhs-manual-blank").length,
      emptyParagraphCount: Array.from(frame.querySelectorAll(".xhs-p, .xhs-rich")).filter((node) => (
        !node.classList.contains("xhs-manual-blank") &&
        !node.classList.contains("xhs-caret-anchor") &&
        !node.textContent?.replace(/\s+/g, "").length
      )).length,
    }));
    await midPageFrame.evaluate((frame) => {
      const blocks = Array.from(frame.querySelectorAll(".xhs-p, .xhs-rich, .xhs-heading")).filter((node) => (
        node.textContent?.replace(/\s+/g, " ").trim().length > 0
      ));
      const anchor = blocks[1] || blocks[0];
      if (!anchor) return;
      const blank = document.createElement("p");
      blank.className = "xhs-p xhs-block xhs-manual-blank";
      blank.innerHTML = "<br>";
      anchor.before(blank);
      frame.focus();
      const range = document.createRange();
      range.selectNodeContents(blank);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(900);
    const midPageBlankState = await midPageFrame.evaluate((frame) => ({
      manualBlankCount: frame.querySelectorAll(".xhs-manual-blank").length,
      emptyParagraphCount: Array.from(frame.querySelectorAll(".xhs-p, .xhs-rich")).filter((node) => (
        !node.classList.contains("xhs-manual-blank") &&
        !node.classList.contains("xhs-caret-anchor") &&
        !node.textContent?.replace(/\s+/g, "").length
      )).length,
    }));
    assert.strictEqual(midPageBlankState.manualBlankCount, midPageBaseline.manualBlankCount);
    assert.strictEqual(midPageBlankState.emptyParagraphCount, midPageBaseline.emptyParagraphCount);

    const pageCount = await page.locator("#pageTabs button").count();
    const content = { quotes: [], callouts: [], labels: [], lists: [], tables: [] };
    let calloutPageIndex = -1;
    let multiCalloutPageIndex = -1;
    let headingPageIndex = -1;
    for (let index = 0; index < pageCount; index += 1) {
      await page.locator("#pageTabs button").nth(index).click();
      await page.waitForTimeout(80);
      const pageContent = await page.evaluate(() => ({
        quotes: Array.from(document.querySelectorAll("#stageScale .xhs-quote")).map((node) => node.textContent.trim()),
        callouts: Array.from(document.querySelectorAll("#stageScale .xhs-callout-body")).map((node) => node.textContent.trim()),
        labels: Array.from(document.querySelectorAll("#stageScale .xhs-callout-label")).map((node) => node.textContent.trim()),
        headingCount: document.querySelectorAll("#stageScale .xhs-heading").length,
        lists: Array.from(document.querySelectorAll("#stageScale .xhs-list-body")).map((node) => node.textContent.trim()),
        tables: Array.from(document.querySelectorAll("#stageScale .xhs-table")).map((node) => ({
          text: node.textContent.replace(/\s+/g, " ").trim(),
          headers: Array.from(node.querySelectorAll("thead th")).map((cell) => cell.textContent.trim()),
          rows: node.querySelectorAll("tbody tr").length,
        })),
      }));
      if (calloutPageIndex < 0 && pageContent.callouts.length) calloutPageIndex = index;
      if (multiCalloutPageIndex < 0 && pageContent.callouts.length >= 2) multiCalloutPageIndex = index;
      if (headingPageIndex < 0 && pageContent.headingCount) headingPageIndex = index;
      content.quotes.push(...pageContent.quotes);
      content.callouts.push(...pageContent.callouts);
      content.labels.push(...pageContent.labels);
      content.lists.push(...pageContent.lists);
      content.tables.push(...pageContent.tables);
    }

    assert.ok(content.quotes.some((text) => text.includes("仍然应该是引用")));
    assert.ok(content.callouts.some((text) => text.includes("这是明确的卡片")));
    assert.ok(!content.callouts.some((text) => /^\s*(?:金句|注意|结论|划重点)\s*[：:]/.test(text)));
    assert.ok(["金句", "注意", "结论", "划重点"].every((label) => content.labels.includes(label)));
    assert.ok(content.lists.some((text) => text.includes("Alt + 拖动")));
    assert.ok(!content.callouts.some((text) => text.includes("Alt + 拖动")));
    // Regression: backspace at the start of a list line should unlist it into plain body text.
    const listPageIndex = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("#pageTabs button"));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (document.querySelector("#stageScale .xhs-list-line .xhs-list-body")) return index;
      }
      return -1;
    });
    assert.ok(listPageIndex >= 0, "expected at least one list line in studio output");
    await page.locator("#pageTabs button").nth(listPageIndex).click();
    await page.waitForTimeout(100);
    const unlistState = await page.locator("#stageScale .xhs-list-line .xhs-list-body").first().evaluate((body) => {
      const line = body.closest(".xhs-list-line");
      const sample = body.textContent || "";
      const editable = body.closest('[contenteditable="true"]');
      editable?.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { sample, lineClass: line?.className || "" };
    });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    const afterUnlist = await page.locator("#stageScale .xhs-body-card .xhs-body-frame").first().evaluate((frame, sample) => ({
      listLineCount: frame.querySelectorAll(".xhs-list-line").length,
      plainCount: Array.from(frame.querySelectorAll(".xhs-p")).filter((node) => (
        !node.classList.contains("xhs-manual-blank") &&
        !node.classList.contains("xhs-caret-anchor") &&
        (node.textContent || "").includes(sample.slice(0, Math.min(6, sample.length)))
      )).length,
    }), unlistState.sample);
    assert.ok(afterUnlist.plainCount >= 1, "list line should become plain paragraph after backspace at line start");

    await page.locator("#pageTabs button").nth(listPageIndex).click();
    await page.waitForTimeout(100);
    const listBodyWithContent = page.locator("#stageScale .xhs-list-line .xhs-list-body").filter({ hasText: "重新分页" });
    await listBodyWithContent.first().evaluate((body) => {
      const editable = body.closest('[contenteditable="true"]');
      editable?.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const listLineCountBeforeEnter = await page.locator("#stageScale .xhs-list-line").count();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const listEnterState = await listBodyWithContent.first().evaluate((body, beforeCount) => {
      const line = body.closest(".xhs-list-line");
      return {
        lineCount: document.querySelectorAll("#stageScale .xhs-list-line").length,
        currentBody: body.textContent.trim(),
        previousBody: line?.previousElementSibling?.querySelector?.(".xhs-list-body")?.textContent.trim() || "",
        beforeCount,
      };
    }, listLineCountBeforeEnter);
    assert.strictEqual(listEnterState.lineCount, listLineCountBeforeEnter + 1);
    assert.ok(listEnterState.currentBody.includes("重新分页"));
    assert.strictEqual(listEnterState.previousBody, "");

    const paragraphHaloState = await page.locator("#stageScale .xhs-p").first().evaluate((paragraph) => {
      paragraph.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return {
        haloVisible: document.querySelector("#blockHalo")?.style.display === "block",
        isParagraph: paragraph.classList.contains("xhs-p"),
      };
    });
    assert.strictEqual(paragraphHaloState.isParagraph, true);
    assert.strictEqual(paragraphHaloState.haloVisible, false);

    let enterTestPageIndex = -1;
    const enterPageTabCount = await page.locator("#pageTabs button").count();
    for (let index = 0; index < enterPageTabCount; index += 1) {
      await page.locator("#pageTabs button").nth(index).click();
      await page.waitForTimeout(50);
      if (await page.locator("#stageScale .xhs-p").filter({ hasText: "这件事花的时间" }).count() > 0) {
        enterTestPageIndex = index;
        break;
      }
    }
    assert.ok(enterTestPageIndex >= 0, "expected paragraph for Enter regression");
    const valueParagraph = page.locator("#stageScale .xhs-p").filter({ hasText: "这件事花的时间" }).first();
    await valueParagraph.click();
    await valueParagraph.evaluate((el) => {
      const editable = el.closest('[contenteditable="true"]');
      editable?.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode) return;
      const offset = Math.min(4, textNode.textContent.length);
      range.setStart(textNode, offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const headingCountBeforeEnter = await page.locator("#stageScale .xhs-heading").count();
    const fullParagraphTextBefore = ((await valueParagraph.textContent()) || "").replace(/\s+/g, "");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").count(), headingCountBeforeEnter);
    const allParagraphTexts = await page.evaluate(() => {
      const texts = [];
      Array.from(document.querySelectorAll("#pageTabs button")).forEach((tab) => {
        tab.click();
        document.querySelectorAll("#stageScale .xhs-p").forEach((node) => texts.push(node.textContent || ""));
      });
      return texts.map((text) => text.replace(/\s+/g, ""));
    });
    const mergedParagraphText = allParagraphTexts.join("");
    assert.ok(
      mergedParagraphText.includes(fullParagraphTextBefore),
      "paragraph text should survive Enter split",
    );
    const beforeCaret = fullParagraphTextBefore.slice(0, 4);
    const afterCaret = fullParagraphTextBefore.slice(4, 8);
    const beforeIndex = allParagraphTexts.findIndex((text) => text.includes(beforeCaret));
    const afterIndex = allParagraphTexts.findIndex((text) => text.includes(afterCaret));
    assert.ok(beforeIndex >= 0 && afterIndex >= 0 && beforeIndex !== afterIndex, "Enter should split the paragraph across two flow blocks");

    assert.ok(!content.callouts.some((text) => text.includes("rabbitQ-skill-lark-xhs（GitHub）")));
    assert.ok(content.tables.length >= 1);
    assert.ok(content.tables.length >= 2, "long table should split across pages instead of clipping");
    assert.ok(content.tables.every((table) => JSON.stringify(table.headers) === JSON.stringify(["模式", "适合", "页数"])));
    assert.strictEqual(content.tables.reduce((total, table) => total + table.rows, 0), 21);
    assert.ok(content.tables.some((table) => table.text.includes("无封面图")));
    assert.ok(headingPageIndex >= 0);
    await page.locator("#pageTabs button").nth(headingPageIndex).click();
    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      for (let index = 0; index < 3; index += 1) {
        const blank = document.createElement("p");
        blank.className = "xhs-p xhs-block xhs-manual-blank";
        blank.innerHTML = "<br>";
        heading.before(blank);
      }
      const title = heading.querySelector(".xhs-heading-title");
      const editable = heading.closest('[contenteditable="true"]');
      editable?.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(800);
    await page.locator("#pageTabs button").nth(headingPageIndex).click();
    await page.waitForTimeout(100);
    const leadingBlankState = await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => ({
      hasManualBlankBefore: heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false,
      title: heading.querySelector(".xhs-heading-title")?.textContent.trim() || "",
    }));
    assert.strictEqual(leadingBlankState.hasManualBlankBefore, false);
    assert.ok(leadingBlankState.title.includes("结构识别"));
    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      const blank = document.createElement("p");
      blank.className = "xhs-p xhs-block xhs-manual-blank";
      blank.innerHTML = "<br>";
      heading.before(blank);
      const title = heading.querySelector(".xhs-heading-title");
      const frame = heading.closest('[contenteditable="true"]');
      frame?.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      frame.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      }));
    });
    await page.waitForTimeout(800);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => (
      heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false
    )), false);

    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      const blank = document.createElement("p");
      blank.className = "xhs-p xhs-block xhs-manual-blank";
      blank.innerHTML = "<br>";
      heading.before(blank);
      const frame = heading.closest('[contenteditable="true"]');
      frame?.focus();
      const headingOffset = Array.prototype.indexOf.call(frame.childNodes, heading);
      const range = document.createRange();
      range.setStart(frame, headingOffset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => (
      heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false
    )), false);

    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      const blank = document.createElement("p");
      blank.className = "xhs-p xhs-block xhs-manual-blank";
      blank.innerHTML = "<br>";
      heading.before(blank);
      const frame = heading.closest('[contenteditable="true"]');
      frame?.focus();
      const headingOffset = Array.prototype.indexOf.call(frame.childNodes, heading);
      const range = document.createRange();
      range.setStart(frame, headingOffset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      frame.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      }));
    });
    await page.waitForTimeout(800);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => (
      heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false
    )), false);

    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      heading.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const addBefore = document.querySelector("#blockHalo .halo-before.halo-add");
      addBefore.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(100);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => (
      heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false
    )), true);
    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      const number = heading.querySelector(".xhs-heading-number");
      number.focus();
      const range = document.createRange();
      range.selectNodeContents(number);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
    const haloBlankUndoState = await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => ({
      hasManualBlankBefore: heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false,
      number: heading.querySelector(".xhs-heading-number")?.textContent.trim() || "",
    }));
    assert.strictEqual(haloBlankUndoState.hasManualBlankBefore, false);
    assert.strictEqual(haloBlankUndoState.number, "01");

    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      heading.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const addBefore = document.querySelector("#blockHalo .halo-before.halo-add");
      addBefore.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(100);
    const blankControlState = await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => ({
      hasManualBlankBefore: heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false,
      addButtonCount: document.querySelectorAll("#blockHalo .halo-before.halo-add").length,
      removeButtonCount: document.querySelectorAll("#blockHalo .halo-before.halo-remove").length,
      removeVisible: document.querySelector("#blockHalo .halo-before.halo-remove")?.style.display !== "none",
    }));
    assert.strictEqual(blankControlState.hasManualBlankBefore, true);
    assert.strictEqual(blankControlState.addButtonCount, 1);
    assert.strictEqual(blankControlState.removeButtonCount, 1);
    assert.strictEqual(blankControlState.removeVisible, true);
    await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => {
      heading.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const removeBefore = document.querySelector("#blockHalo .halo-before.halo-remove");
      removeBefore.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(800);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").first().evaluate((heading) => (
      heading.previousElementSibling?.classList.contains("xhs-manual-blank") || false
    )), false);

    assert.ok(multiCalloutPageIndex >= 0 || pageCount > 0);
    for (let index = 0; index < pageCount; index += 1) {
      await page.locator("#pageTabs button").nth(index).click();
      await page.waitForTimeout(80);
      const calloutCount = await page.locator("#stageScale .xhs-callout").count();
      if (calloutCount >= 2) {
        multiCalloutPageIndex = index;
        break;
      }
    }
    assert.ok(multiCalloutPageIndex >= 0, "expected a page with at least two callouts after reflow");
    await page.locator("#pageTabs button").nth(multiCalloutPageIndex).click();
    const styleTestCallouts = page.locator("#stageScale .xhs-callout");
    const styleTestCalloutCount = await styleTestCallouts.count();
    assert.ok(styleTestCalloutCount >= 2);
    await styleTestCallouts.nth(0).click();
    await page.click('[data-card-style="frame"]');
    assert.strictEqual(await styleTestCallouts.nth(0).evaluate((node) => node.classList.contains("xhs-card-frame")), true);
    assert.strictEqual(await styleTestCallouts.nth(1).evaluate((node) => node.classList.contains("xhs-card-frame")), false);
    await page.locator("#pageTabs button").nth(0).click();
    await page.locator("#pageTabs button").nth(multiCalloutPageIndex).click();
    const restoredStyleCallouts = page.locator("#stageScale .xhs-callout");
    assert.strictEqual(await restoredStyleCallouts.nth(0).evaluate((node) => node.classList.contains("xhs-card-frame")), true);
    assert.strictEqual(await restoredStyleCallouts.nth(1).evaluate((node) => node.classList.contains("xhs-card-frame")), false);

    assert.ok(calloutPageIndex >= 0 || pageCount > 0);
    for (let index = 0; index < pageCount; index += 1) {
      await page.locator("#pageTabs button").nth(index).click();
      await page.waitForTimeout(80);
      const hasTargetCallout = await page.locator("#stageScale .xhs-callout-body").filter({ hasText: "这是明确的卡片" }).count();
      if (hasTargetCallout > 0) {
        calloutPageIndex = index;
        break;
      }
    }
    assert.ok(calloutPageIndex >= 0, "expected a page with the target callout after reflow");
    await page.locator("#pageTabs button").nth(calloutPageIndex).click();
    const calloutCountBeforeToggle = await page.locator("#stageScale .xhs-callout").count();
    await page.locator("#stageScale .xhs-callout-body").first().click();
    await page.click("#keypointBtn");
    const calloutCountAfterToggle = await page.locator("#stageScale .xhs-callout").count();
    assert.strictEqual(calloutCountAfterToggle, calloutCountBeforeToggle - 1);

    const restoredParagraph = page.locator("#stageScale .xhs-p").filter({ hasText: "这是明确的卡片" });
    assert.strictEqual(await restoredParagraph.count(), 1);
    await restoredParagraph.evaluate((node) => {
      const editable = node.closest('[contenteditable="true"]');
      editable?.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const caretText = "连续输入".repeat(180) + "光标终点";
    await page.evaluate((text) => document.execCommand("insertText", false, text), caretText);
    await page.waitForTimeout(1200);
    assert.ok(await page.locator("#stageScale .xhs-p").filter({ hasText: "光标终点" }).count() >= 1, "typed paragraph should survive reflow");
    assert.strictEqual(await page.locator('[data-xhs-caret-marker]').count(), 0);
    const anchorHeights = await page.locator("#stageScale .xhs-caret-anchor").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    assert.ok(anchorHeights.every((height) => height <= 1.1));

    // Regression: 一级标题 button toggles a numbered heading back to a paragraph.
    // Image double-click / Backspace deletion also live here, after page-index
    // dependent assertions, because these mutations can reflow content.
    assert.ok(headingPageIndex >= 0);
    await page.locator("#pageTabs button").nth(headingPageIndex).click();
    const level1Heading = page.locator('#stageScale .xhs-heading').filter({ hasText: "结构识别" }).first();
    await level1Heading.evaluate((heading) => {
      const title = heading.querySelector(".xhs-heading-title") || heading;
      title.focus?.();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("headingBtn1").click();
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").filter({ hasText: "结构识别" }).count(), 0, "clicking 一级标题 again should convert the heading back to a paragraph");
    assert.strictEqual(await page.locator("#stageScale .xhs-p").filter({ hasText: "结构识别" }).count(), 1);

    // Regression: 二级标题 button creates a thin-underline heading and toggles off.
    const bodyFrame = page.locator("#stageScale .xhs-body-frame, #stageScale .xhs-cover-tail-frame").first();
    await bodyFrame.evaluate((frame) => {
      const p = document.createElement("p");
      p.className = "xhs-p xhs-block";
      p.textContent = "临时二级标题";
      frame.appendChild(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("headingBtn2").click();
    });
    await page.waitForTimeout(200);
    const level2Count = await page.locator('#stageScale .xhs-heading[data-level="2"]').filter({ hasText: "临时二级标题" }).count();
    assert.strictEqual(level2Count, 1, "二级标题 button should create a level-2 heading");
    const level2Style = await page.locator('#stageScale .xhs-heading[data-level="2"]').filter({ hasText: "临时二级标题" }).first().evaluate((heading) => {
      const title = heading.querySelector(".xhs-heading-title");
      const styles = getComputedStyle(title);
      return {
        color: styles.color,
        fontSize: styles.fontSize,
        borderBottomWidth: styles.borderBottomWidth,
        borderBottomColor: styles.borderBottomColor,
      };
    });
    assert.strictEqual(level2Style.fontSize, "40px");
    assert.strictEqual(level2Style.borderBottomWidth, "2px");
    assert.notStrictEqual(level2Style.color, "rgb(17, 17, 17)");
    await page.locator('#stageScale .xhs-heading[data-level="2"]').filter({ hasText: "临时二级标题" }).first().evaluate((heading) => {
      const title = heading.querySelector(".xhs-heading-title") || heading;
      title.focus?.();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("headingBtn2").click();
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").filter({ hasText: "临时二级标题" }).count(), 0);

    // Regression: block styles can cross-switch (二级 → 卡片 → 引用) and cancel.
    await bodyFrame.evaluate((frame) => {
      const p = document.createElement("p");
      p.className = "xhs-p xhs-block";
      p.textContent = "互切样式测试";
      frame.appendChild(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("headingBtn2").click();
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('#stageScale .xhs-heading[data-level="2"]').filter({ hasText: "互切样式测试" }).count(), 1);
    await page.locator('#stageScale .xhs-heading[data-level="2"]').filter({ hasText: "互切样式测试" }).first().evaluate((heading) => {
      const title = heading.querySelector(".xhs-heading-title") || heading;
      title.focus?.();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("keypointBtn").click();
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator("#stageScale .xhs-heading").filter({ hasText: "互切样式测试" }).count(), 0);
    assert.strictEqual(await page.locator("#stageScale .xhs-callout").filter({ hasText: "互切样式测试" }).count(), 1, "二级标题 should cross-switch into a card");
    await page.locator("#stageScale .xhs-callout").filter({ hasText: "互切样式测试" }).first().evaluate((callout) => {
      const body = callout.querySelector(".xhs-callout-body") || callout;
      body.focus?.();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("italicBtn").click();
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator("#stageScale .xhs-callout").filter({ hasText: "互切样式测试" }).count(), 0);
    assert.strictEqual(await page.locator("#stageScale .xhs-quote").filter({ hasText: "互切样式测试" }).count(), 1, "card should cross-switch into a quote");
    await page.locator("#stageScale .xhs-quote").filter({ hasText: "互切样式测试" }).first().evaluate((quote) => {
      quote.focus?.();
      const range = document.createRange();
      range.selectNodeContents(quote);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById("italicBtn").click();
    });
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator("#stageScale .xhs-quote").filter({ hasText: "互切样式测试" }).count(), 0);
    assert.strictEqual(await page.locator("#stageScale .xhs-p").filter({ hasText: "互切样式测试" }).count(), 1, "clicking the same style again should cancel back to paragraph");

    // Regression: images no longer have dedicated replace/delete buttons.
    // Double-click must open the native file chooser to replace locally,
    // and Backspace/Delete must remove the selected image block.
    const pageTabCount = await page.locator("#pageTabs button").count();
    let imagePageIndex = -1;
    for (let index = 0; index < pageTabCount; index += 1) {
      await page.locator("#pageTabs button").nth(index).click();
      if (await page.locator("#stageScale .xhs-image-frame").count()) {
        imagePageIndex = index;
        break;
      }
    }
    assert.ok(imagePageIndex >= 0, "expected to find a page containing the fixture image");
    const imageFrame = page.locator("#stageScale .xhs-image-frame").first();
    assert.strictEqual(await imageFrame.count(), 1, "expected the fixture image to render as an image block");
    const filechooserPromise = page.waitForEvent("filechooser", { timeout: 3000 }).then(() => true).catch(() => false);
    await imageFrame.dblclick();
    assert.strictEqual(await filechooserPromise, true, "double-clicking an image should open the local file chooser to replace it");
    await imageFrame.click();
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    assert.strictEqual(await page.locator("#stageScale .xhs-image-frame").count(), 0, "Backspace should delete the selected image block");

    await page.locator("#pageTabs button").first().click();
    const coverSubtitle = page.locator(".cover-subtitle");
    await coverSubtitle.fill("");
    await coverSubtitle.click();
    await coverSubtitle.type("一行副标题");
    assert.strictEqual((await coverSubtitle.innerText()).trim(), "一行副标题");
    const oneLineGeometry = await coverSubtitle.evaluate((node) => {
      const marker = getComputedStyle(node, "::before");
      return {
        display: getComputedStyle(node).display,
        height: node.offsetHeight,
        markerTop: parseFloat(marker.top),
        markerTransform: marker.transform,
      };
    });
    assert.strictEqual(oneLineGeometry.display, "block");
    assert.ok(
      Math.abs(oneLineGeometry.markerTop - oneLineGeometry.height / 2) <= 1,
      `one-line subtitle marker is not centered: ${JSON.stringify(oneLineGeometry)}`,
    );
    assert.notStrictEqual(oneLineGeometry.markerTransform, "none");

    await coverSubtitle.fill("这是第一行需要继续填写的副标题，这是第二行仍然可以正常编辑的内容");
    assert.ok((await coverSubtitle.innerText()).includes("第二行"));
    const twoLineGeometry = await coverSubtitle.evaluate((node) => {
      const marker = getComputedStyle(node, "::before");
      return {
        height: node.offsetHeight,
        markerTop: parseFloat(marker.top),
      };
    });
    assert.ok(twoLineGeometry.height > oneLineGeometry.height);
    assert.ok(
      Math.abs(twoLineGeometry.markerTop - twoLineGeometry.height / 2) <= 1,
      `two-line subtitle marker is not centered: ${JSON.stringify(twoLineGeometry)}`,
    );

    await page.click('[data-paper-pattern="grid"]');
    const coverPattern = await page.evaluate(() => {
      const card = document.querySelector('#stageScale .xhs-cover-card');
      const coverText = card?.querySelector('.cover-text');
      const coverMedia = card?.querySelector('.cover-media');
      const coverFrame = card?.querySelector('.cover-image-frame');
      return {
        card: card ? getComputedStyle(card).backgroundImage : 'none',
        coverText: coverText ? getComputedStyle(coverText).backgroundImage : 'none',
        coverMedia: coverMedia ? getComputedStyle(coverMedia).backgroundImage : 'none',
        coverFrame: coverFrame ? getComputedStyle(coverFrame).backgroundImage : 'none',
      };
    });
    assert.notStrictEqual(coverPattern.card, 'none');
    assert.strictEqual(coverPattern.coverText, coverPattern.card);
    assert.strictEqual(coverPattern.coverMedia, coverPattern.card);
    assert.strictEqual(coverPattern.coverFrame, coverPattern.card);

    await page.click('[data-cover-theme="accent"]');
    const lightAccentCover = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        coverBg: styles.getPropertyValue('--xhs-cover-bg').trim(),
        coverBorder: styles.getPropertyValue('--xhs-cover-border').trim(),
        coverPlaceholder: styles.getPropertyValue('--xhs-cover-placeholder').trim(),
        accent: styles.getPropertyValue('--xhs-accent').trim(),
        accentStrong: styles.getPropertyValue('--xhs-accent-strong').trim(),
        underline: styles.getPropertyValue('--xhs-underline').trim(),
      };
    });
    assert.strictEqual(lightAccentCover.coverBg, lightAccentCover.underline);
    assert.strictEqual(lightAccentCover.coverBorder, lightAccentCover.accent);
    assert.strictEqual(lightAccentCover.coverPlaceholder, lightAccentCover.accentStrong);

    await page.locator(".cover-title").fill("已修改标题");
    await page.click('[data-bg-theme="blue"]');
    await page.locator("#bodyFontRange").evaluate((node) => {
      node.value = "46";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#resetBtn");
    await page.waitForTimeout(500);
    assert.strictEqual((await page.locator(".cover-title").innerText()).trim(), "回归测试");
    assert.strictEqual(await page.locator('[data-bg-theme="white"]').evaluate((node) => node.classList.contains("active")), true);
    assert.strictEqual(await page.locator('[data-paper-pattern="none"]').evaluate((node) => node.classList.contains("active")), true);
    assert.strictEqual(await page.locator("#coverImageOnBtn").evaluate((node) => node.classList.contains("active")), true);
    assert.strictEqual(await page.locator("#bodyFontRange").inputValue(), "36");

    const flowPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await flowPage.addInitScript(() => {
      if (sessionStorage.getItem("rabbitq-flow-test-initialized")) return;
      localStorage.clear();
      sessionStorage.setItem("rabbitq-flow-test-initialized", "1");
    });
    await flowPage.goto(`file://${flowHtmlPath}`);
    await flowPage.waitForTimeout(500);

    async function collectAllBodyTextFrom(targetPage) {
      const count = await targetPage.locator("#pageTabs button").count();
      const chunks = [];
      for (let index = 0; index < count; index += 1) {
        await targetPage.locator("#pageTabs button").nth(index).click();
        await targetPage.waitForTimeout(40);
        const bodyLocator = targetPage.locator("#stageScale .xhs-body-frame");
        const coverTailLocator = targetPage.locator("#stageScale .xhs-cover-tail-frame");
        const bodyText = (await bodyLocator.count()) ? (await bodyLocator.innerText()).trim() : "";
        const coverTailText = (await coverTailLocator.count()) ? (await coverTailLocator.innerText()).trim() : "";
        chunks.push([bodyText, coverTailText].filter(Boolean).join("\n"));
      }
      return chunks.join("\n");
    }

    const flowBodyText = await collectAllBodyTextFrom(flowPage);
    assert.match(flowBodyText, /持续debug/);
    assert.match(flowBodyText, /快速开始/);
    assert.match(flowBodyText, /先在飞书云文档导出 markdown/);

    const flowSentence = "此工具为本兔自用工具、持续debug中…符合本人写作及编辑图文习惯和审美，如果有其他可以跟Codex交互修改skills哦！比如样式或者对于一些子标题的识别规则等等……";
    const flowSentencePageIndex = await flowPage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("#pageTabs button"));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (Array.from(document.querySelectorAll("#stageScale .xhs-p")).some((node) => (node.textContent || "").includes("此工具为本兔自用工具"))) return index;
      }
      return -1;
    });
    assert.ok(flowSentencePageIndex >= 0, "expected the long flow paragraph for punctuation Enter regression");
    await flowPage.locator("#pageTabs button").nth(flowSentencePageIndex).click();
    await flowPage.waitForTimeout(100);
    const flowSentenceParagraph = flowPage.locator("#stageScale .xhs-p").filter({ hasText: "此工具为本兔自用工具" }).first();
    await flowSentenceParagraph.evaluate((paragraph) => {
      const targetOffset = (paragraph.textContent || "").indexOf("、") + 1;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let remaining = targetOffset;
      while (node && remaining > node.textContent.length) {
        remaining -= node.textContent.length;
        node = walker.nextNode();
      }
      if (!node) throw new Error("missing punctuation caret node");
      const range = document.createRange();
      range.setStart(node, Math.min(remaining, node.textContent.length));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.closest('[contenteditable="true"]')?.focus();
    });
    await flowPage.keyboard.press("Enter");
    await flowPage.waitForTimeout(900);
    const flowAfterPunctuationEnter = (await collectAllBodyTextFrom(flowPage)).replace(/\s+/g, "");
    assert.ok(flowAfterPunctuationEnter.includes(flowSentence.replace(/\s+/g, "")), "paragraph tail after 、 must survive Enter and automatic reflow");
    await flowPage.evaluate(() => reflow());
    await flowPage.waitForTimeout(400);
    const flowAfterExplicitReflow = (await collectAllBodyTextFrom(flowPage)).replace(/\s+/g, "");
    assert.ok(flowAfterExplicitReflow.includes(flowSentence.replace(/\s+/g, "")), "paragraph tail after 、 must survive explicit reflow");

    await flowPage.locator("#pageTabs button").first().click();
    await flowPage.waitForTimeout(120);
    await flowPage.click("#coverImageOffBtn");
    await flowPage.waitForTimeout(300);
    const flowAfterCoverToggle = await collectAllBodyTextFrom(flowPage);
    assert.match(flowAfterCoverToggle, /持续debug/, "cover toggle reflow should keep full paragraph");

    await flowPage.evaluate(() => {
      const state = JSON.parse(localStorage.getItem(draftStorageKey()));
      let corrupted = false;
      for (const page of state.pages) {
        for (const field of ["html", "tailHtml"]) {
          if (!page[field] || !/持续debug/.test(page[field])) continue;
          const nextHtml = page[field].replace(/持续debug[\s\S]*?规则等等……/g, "");
          if (nextHtml !== page[field]) {
            page[field] = nextHtml;
            corrupted = true;
          }
        }
      }
      if (!corrupted) throw new Error("missing target page for corruption test");
      localStorage.setItem(draftStorageKey(), JSON.stringify(state));
    });
    await flowPage.reload();
    await flowPage.waitForTimeout(500);
    const healedFlowText = await collectAllBodyTextFrom(flowPage);
    assert.match(healedFlowText, /持续debug/, "corrupted draft should be discarded on reload");
    assert.strictEqual(await flowPage.locator("#runtimeNotice").isVisible(), true, "draft self-heal must be visible to the user");
    assert.match(await flowPage.locator("#runtimeNotice").innerText(), /正文不完整/);

    const corruptedEmbeddedState = await flowPage.evaluate(() => serializeStudioState());
    let embeddedWasCorrupted = false;
    for (const savedPage of corruptedEmbeddedState.pages) {
      for (const field of ["html", "tailHtml"]) {
        if (!savedPage[field] || !/持续debug/.test(savedPage[field])) continue;
        const nextHtml = savedPage[field].replace(/持续debug[\s\S]*?规则等等……/g, "");
        if (nextHtml !== savedPage[field]) {
          savedPage[field] = nextHtml;
          embeddedWasCorrupted = true;
        }
      }
    }
    assert.strictEqual(embeddedWasCorrupted, true, "missing target page for embedded-state corruption test");
    const embeddedHtmlPath = path.join(flowOutputDir, "xhs-studio-corrupted-embedded.html");
    const embeddedPayload = JSON.stringify(corruptedEmbeddedState)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
    const embeddedHtml = fs.readFileSync(flowHtmlPath, "utf8").replace(
      "const embeddedState = /* XHS_EMBEDDED_STATE */ null;",
      `const embeddedState = /* XHS_EMBEDDED_STATE */ ${embeddedPayload};`,
    );
    fs.writeFileSync(embeddedHtmlPath, embeddedHtml, "utf8");
    const embeddedPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await embeddedPage.addInitScript(() => localStorage.clear());
    await embeddedPage.goto(`file://${embeddedHtmlPath}`);
    await embeddedPage.waitForTimeout(600);
    const healedEmbeddedText = await collectAllBodyTextFrom(embeddedPage);
    assert.match(healedEmbeddedText, /持续debug/, "corrupted embeddedState should fall back to the source template");
    assert.strictEqual(await embeddedPage.locator("#runtimeNotice").isVisible(), true, "embeddedState self-heal must be visible to the user");
    assert.match(await embeddedPage.locator("#runtimeNotice").innerText(), /保存编辑 HTML.*正文不完整/);
    await embeddedPage.close();
    await flowPage.close();
  } finally {
    await browser.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(
  () => console.log("rabbitQ XHS smoke test passed"),
  (error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  },
);
