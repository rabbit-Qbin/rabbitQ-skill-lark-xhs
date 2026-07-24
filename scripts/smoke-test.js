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

async function activateStudioPage(page, index) {
  await page.evaluate((targetIndex) => {
    document.querySelectorAll('#pageTabs button')[targetIndex]?.click();
  }, index);
  await page.waitForTimeout(80);
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
    "序列前的普通正文。",
    "",
    "- Alt + 拖动：卡片和图片整块移动",
    "- 重新分页：改完内容一键重排",
    "- 序列续写测试：保留后一项",
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
    "```JavaScript",
    "const studio = 'rabbitQ';",
    "console.log(studio);",
    "```",
    "",
    "![回归测试图片](fixture.png)",
    "",
    "---",
    "",
    "### 二级小标题回归",
    "",
    "**项目**：rabbitQ-skill-lark-xhs（GitHub）",
    "",
    "> （注：部分内容可能由 AI 生成）",
  ].join("\n");
  fs.writeFileSync(path.join(sourceDir, "article.md"), markdown, "utf8");
  const fixturePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(path.join(sourceDir, "fixture.png"), fixturePng);

  const convert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), sourceDir, "-o", outputDir, "--cover-image", "fixture.png"],
    { encoding: "utf8" },
  );
  assert.strictEqual(convert.status, 0, convert.stderr || convert.stdout);
  const coverHtml = fs.readFileSync(path.join(outputDir, "xhs-studio.html"), "utf8");
  assert.match(coverHtml, /"coverImageSrc":"data:image\/png;base64,/);
  assert.match(coverHtml, /alt="封面图"/);

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
    "**金句：卡片和正文之间的单个空行只负责分段。**",
    "",
    "这是下一段正文。",
    "",
    "",
    "这是明确多留一行后的正文。",
  ].join("\n");
  fs.writeFileSync(path.join(blankSourceDir, "article.md"), blankMarkdown, "utf8");
  const blankConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), blankSourceDir, "-o", blankOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(blankConvert.status, 0, blankConvert.stderr || blankConvert.stdout);
  const blankHtml = fs.readFileSync(path.join(blankOutputDir, "xhs-studio.html"), "utf8");
  const blankTemplate = blankHtml.match(/<template id="wechatTemplate">([\s\S]*?)<\/template>/)?.[1] || "";
  assert.match(blankTemplate, /卡片和正文之间的单个空行只负责分段。[\s\S]*?<p>这是下一段正文。<\/p>/);
  assert.doesNotMatch(blankTemplate, /卡片和正文之间的单个空行只负责分段。[\s\S]*?data-xhs-flow-blank="1"[\s\S]*?<p>这是下一段正文。<\/p>/);
  assert.match(blankTemplate, /<p>这是下一段正文。<\/p>\s*<p data-xhs-flow-blank="1"><br\s*\/?><\/p>\s*<p>这是明确多留一行后的正文。<\/p>/);
  assert.strictEqual((blankTemplate.match(/data-xhs-flow-blank="1"/g) || []).length, 1);

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

  const continuousSourceDir = path.join(root, "continuous-flow-source");
  const continuousOutputDir = path.join(root, "continuous-flow-output");
  fs.mkdirSync(continuousSourceDir, { recursive: true });
  const continuousParagraph = Array.from(
    { length: 260 },
    (_, index) => `连续片段${String(index + 1).padStart(3, "0")}保持前后顺序`,
  ).join("，") + "。";
  const continuousMarkdown = [
    "# 连续分页回归",
    "",
    "## 01 正文应该跨页连续",
    "",
    continuousParagraph,
    "",
    "> 引用块跨页时必须保持完整，不能消失。",
  ].join("\n");
  fs.writeFileSync(path.join(continuousSourceDir, "article.md"), continuousMarkdown, "utf8");
  const continuousConvert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), continuousSourceDir, "-o", continuousOutputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(continuousConvert.status, 0, continuousConvert.stderr || continuousConvert.stdout);

  const htmlPath = path.join(outputDir, "xhs-studio.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /"version":"0\.9\.2"/);
  assert.match(html, /xhs-block-drag-handle/);
  assert.doesNotMatch(html, /xhs-block-drop-preview/);
  assert.match(html, /xhs-overview-drop-indicator/);
  assert.match(html, /按住 Alt 拖动/);
  assert.match(html, /data-xhs-block-type="quote"/);
  assert.match(html, /data-xhs-block-type="table"/);
  assert.match(html, /<th>模式<\/th>/);
  assert.match(html, /border-top: 1\.5px solid var\(--xhs-accent\)/);
  assert.match(html, /border-bottom: 1\.5px solid var\(--xhs-accent\)/);
  assert.match(html, /tbody tr:last-child td \{ border-bottom: 2px solid var\(--xhs-underline\)/);
  assert.match(html, /\.xhs-table \{[^}]*font-size: 36px;/);
  assert.match(html, /--body-pad-x: 72px;/);
  assert.match(html, /--body-pad-top: 72px;/);
  assert.match(html, /--body-pad-bottom: 72px;/);
  assert.match(html, /--body-paragraph-gap: 40px;/);
  assert.match(html, /--body-list-item-gap: 20px;/);
  assert.match(html, /\.xhs-list-line:not\(:has\(\+ \.xhs-list-line\)\) \{ margin-bottom: var\(--body-paragraph-gap\); \}/);
  assert.match(html, /--body-line-px: 58px;/);
  assert.match(html, /--body-regular-weight: 720;/);
  assert.match(html, /--body-bold-weight: 720;/);
  assert.match(html, /--body-unbold-weight: 700;/);
  assert.doesNotMatch(html, /RabbitQ Songti SC|STSongti-SC-/);
  assert.match(html, /--xhs-font: "Noto Serif SC", "Source Han Serif SC"/);
  assert.match(html, /\.xhs-callout-label \{[^}]*font-weight: var\(--body-bold-weight\)/);
  assert.match(html, /\.xhs-table thead th \{[^}]*font-weight: var\(--body-bold-weight\)/);
  assert.match(html, /\.xhs-heading\[data-level="2"\] \.xhs-heading-title \{[^}]*font-weight: var\(--body-bold-weight\)/);
  assert.match(html, /\.xhs-heading \{[^}]*grid-template-columns: 129px minmax\(0, 1fr\);[^}]*column-gap: 18px;/, 'level-one headings should reserve one consistent two-digit number slot');
  assert.match(html, /\.xhs-heading-number \{[^}]*justify-content: center;[^}]*font-variant-numeric: tabular-nums;/);
  assert.match(html, /data-xhs-block-type="code" data-code-language="JavaScript"/);
  assert.match(html, /\.xhs-code-block \{[^}]*background: #17191f;/);
  assert.match(html, /id="codeBtn"[^>]*aria-label="代码块"/);
  assert.doesNotMatch(html, /部分内容可能由 AI 生成/);
  const mainTemplate = html.match(/<template id="wechatTemplate">([\s\S]*?)<\/template>/)?.[1] || '';
  assert.doesNotMatch(mainTemplate, /data-xhs-auto-underline/, 'Markdown bold must not silently receive an underline style');
  assert.match(html, /const EXPORT_RENDER_SCALE = 2;/);
  assert.match(html, /scale: EXPORT_RENDER_SCALE/);
  assert.match(html, /imageSmoothingQuality = 'high'/);
  assert.match(html, /data-paper-pattern="linen">细麻纸<\/button>/);
  assert.match(html, /data-bg-theme="yellow">浅黄<\/button>/);
  assert.match(html, /data-bg-theme="pink">浅粉<\/button>/);
  assert.match(html, /data-bg-theme="purple">浅紫<\/button>/);
  assert.doesNotMatch(html, /fontWechatBtn|fontSongtiBtn|经典宋体/);
  assert.match(html, /\.xhs-p \{[^}]*font-weight: var\(--body-regular-weight\)/);
  assert.match(html, /\.xhs-p span,[^}]*\.xhs-table span \{[^}]*font-weight: inherit !important;/);
  assert.match(html, /\.xhs-card \.xhs-text-regular, \.xhs-card \.xhs-text-regular \* \{ font-weight: var\(--body-unbold-weight\) !important; \}/);
  assert.match(html, /size: line \+ 'px ' \+ line \+ 'px'/);
  assert.match(html, /headingUnderline \/ 4/);
  assert.match(html, /\.xhs-heading\[data-level="2"\] \{[\s\S]*?margin: 0 0 40px;/, "二级标题只保留下间距，避免与前一结构块叠加");
  assert.doesNotMatch(html, /\.xhs-heading\[data-level="1"\] \+ \.xhs-heading\[data-level="2"\]/, "标题间距应使用统一的单向节奏规则");
  assert.match(html, /\.xhs-body-frame > \.xhs-page-end \{ margin-bottom: 0 !important; \}/);
  assert.doesNotMatch(html, /&lt;br&gt;/);
  assert.match(html, /data-xhs-heading-level="1"/);
  assert.match(html, /data-xhs-heading-level="2"/);
  assert.doesNotMatch(html, /data-xhs-heading-level="1"[^>]*>.*回归测试/);
  assert.match(html, /data-xhs-page-break="1"/);
  assert.match(html, /<button id="headingBtn1"[^>]*>H1<\/button>/);
  assert.match(html, /<button id="headingBtn2"[^>]*>H2<\/button>/);
  assert.match(html, /id="listUnorderedBtn"[^>]*aria-label="无序列表"[^>]*><svg class="toolbar-icon"/);
  assert.match(html, /id="listOrderedBtn"[^>]*aria-label="有序列表"[^>]*><svg class="toolbar-icon"/);
  assert.match(html, /id="insertImageBtn"[^>]*aria-label="插入图片"[^>]*><svg class="toolbar-icon"/);
  assert.match(html, /id="overviewRail" class="overview-rail"/);
  assert.doesNotMatch(html, /id="overviewModeBtn"|id="editModeBtn"|单页编辑/);
  assert.match(html, /\.xhs-quote \{[^}]*background: transparent;/);
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
    const overviewState = await orderedPage.evaluate(() => {
      const rail = document.querySelector('#overviewRail');
      const items = Array.from(rail?.querySelectorAll('.overview-item') || []);
      const active = rail?.querySelector('.overview-item.active');
      const editable = active?.querySelector('[contenteditable="true"]');
      return {
        activeOwnsStage: Boolean(active?.querySelector('#stageScale')),
        editable: Boolean(editable),
        visibleSlots: items.length < 3 || rail.clientWidth / items[0].getBoundingClientRect().width > 2.8,
      };
    });
    assert.strictEqual(overviewState.activeOwnsStage, true, 'overview active page should own the real editor stage');
    assert.strictEqual(overviewState.editable, true, 'overview active page should remain editable');
    assert.strictEqual(overviewState.visibleSlots, true, 'desktop overview should display three 3:4 pages');
    const overviewSubtitle = orderedPage.locator('#overviewRail .overview-item.active .cover-subtitle');
    if (await overviewSubtitle.count()) {
      await overviewSubtitle.fill('第一行');
      await overviewSubtitle.click();
      await orderedPage.keyboard.press('Shift+Enter');
      await orderedPage.keyboard.type('第二行');
      assert.strictEqual(await orderedPage.locator('#editModeBtn').count(), 0, 'Studio should expose only the overview editor');
      assert.match(await overviewSubtitle.innerText(), /第一行\r?\n+第二行/, 'overview subtitle should keep the inserted line break');
      await overviewSubtitle.dblclick();
      assert.strictEqual(await orderedPage.locator('#editModeBtn').count(), 0, 'double-clicking text must stay in overview');
    }
    const overviewItems = orderedPage.locator('#overviewRail .overview-item');
    if (await overviewItems.count() > 1) {
      await overviewItems.nth(1).click();
      await orderedPage.waitForTimeout(350);
      assert.match(await orderedPage.locator('#pageInfo').innerText(), /当前第 2 \/ /, 'clicking a page should activate it in overview');
    }
    const orderedListPageIndex = await orderedPage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("#pageTabs button"));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (document.querySelector('#stageScale .xhs-list-line[data-list-type="ordered"]')) return index;
      }
      return -1;
    });
    assert.ok(orderedListPageIndex >= 0, "expected ordered list page in Studio runtime");
    await orderedPage.evaluate((index) => document.querySelectorAll("#pageTabs button")[index]?.click(), orderedListPageIndex);
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
    await orderedPage.waitForTimeout(40);
    assert.strictEqual(await orderedPage.locator('#boldBtn').evaluate((button) => button.classList.contains('active')), true, 'default 720 body text should light the bold control');
    assert.strictEqual(await orderedPage.locator('#listOrderedBtn').evaluate((button) => button.classList.contains('active')), true, 'ordered-list control should reflect the current block');
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
        lineWeight: lineStyles.fontWeight,
        markerWidth: parseFloat(markerStyles.width),
        markerFontSize: parseFloat(markerStyles.fontSize),
        markerHeight: parseFloat(markerStyles.height),
        markerAlign: markerStyles.textAlign,
        markerJustify: markerStyles.justifyContent,
        bodyFontSize: parseFloat(lineStyles.fontSize),
        bodyLineHeight: parseFloat(lineStyles.lineHeight),
      };
    });
    assert.ok(Math.abs(orderedSpacing.gap - 9) < 0.2, "sequence marker gap should equal 9px");
    assert.strictEqual(orderedSpacing.lineWeight, "720", "sequence body should use the unified 720 weight");
    assert.ok(orderedSpacing.markerWidth <= 44, "ordered marker slot should not create a wide indent");
    assert.strictEqual(orderedSpacing.markerFontSize, orderedSpacing.bodyFontSize, "ordered sequence marker should match its body text size");
    assert.ok(Math.abs(orderedSpacing.markerHeight - orderedSpacing.bodyLineHeight) < 0.2, "ordered marker should occupy the body line box for vertical centering");
    assert.strictEqual(orderedSpacing.markerAlign, "center", "ordered marker text should be centered in its slot");
    assert.strictEqual(orderedSpacing.markerJustify, "center", "ordered marker flex content should be centered in its slot");
    assert.ok(
      Math.abs(parseFloat(await orderedPage.locator('#stageScale .xhs-list-line[data-list-type="ordered"]').first().evaluate((line) => getComputedStyle(line).marginBottom)) - 20) < 0.2,
      "items inside one sequence should use the compact 20px gap",
    );

    const bodyWeights = await orderedPage.evaluate(() => {
      const normal = document.querySelector('#stageScale .xhs-list-body');
      const bold = document.querySelector('#stageScale .xhs-list-body strong');
      return {
        normal: normal ? getComputedStyle(normal).fontWeight : '',
        bold: bold ? getComputedStyle(bold).fontWeight : '',
      };
    });
    assert.strictEqual(bodyWeights.normal, "720", "body text should use the unified default weight 720");
    assert.strictEqual(bodyWeights.bold, "720", "bold body text should use weight 720");

    // Regression: body text starts at 720, but the B control must be a real
    // two-state toggle: 720 default -> 700 unbold -> 720 default.
    const boldToggleBody = orderedPage.locator('#stageScale .xhs-list-body').first();
    await boldToggleBody.evaluate((body) => {
      const range = document.createRange();
      range.selectNodeContents(body);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      body.closest('[contenteditable="true"]')?.focus();
    });
    await orderedPage.waitForTimeout(80);
    assert.strictEqual(
      await orderedPage.locator('#boldBtn').evaluate((button) => button.classList.contains('active')),
      true,
      'default 720 selection should light the B control',
    );
    await orderedPage.click('#boldBtn');
    await orderedPage.waitForTimeout(120);
    const unboldState = await boldToggleBody.evaluate((body) => ({
      weight: getComputedStyle(body.querySelector('.xhs-text-regular') || body).fontWeight,
      regularMarks: body.querySelectorAll('.xhs-text-regular').length,
    }));
    assert.strictEqual(unboldState.weight, '700', 'first B click should change selected default text to weight 700');
    assert.ok(unboldState.regularMarks >= 1, 'first B click should persist an explicit unbold mark');
    assert.strictEqual(
      await orderedPage.evaluate(() => pages[pageIndex].html.includes('xhs-text-regular')),
      true,
      '700 unbold formatting should be saved into the current page state',
    );
    assert.strictEqual(
      await orderedPage.locator('#boldBtn').evaluate((button) => button.classList.contains('active')),
      false,
      '700 unbold selection should turn off the B control',
    );
    await orderedPage.click('#boldBtn');
    await orderedPage.waitForTimeout(120);
    const restoredBoldState = await boldToggleBody.evaluate((body) => ({
      weight: getComputedStyle(body).fontWeight,
      regularMarks: body.querySelectorAll('.xhs-text-regular').length,
    }));
    assert.strictEqual(restoredBoldState.weight, '720', 'second B click should restore selected text to weight 720');
    assert.strictEqual(restoredBoldState.regularMarks, 0, 'second B click should remove the explicit unbold mark');
    assert.strictEqual(
      await orderedPage.evaluate(() => pages[pageIndex].html.includes('xhs-text-regular')),
      false,
      'restoring 720 should remove the saved unbold mark from page state',
    );
    assert.strictEqual(
      await orderedPage.locator('#boldBtn').evaluate((button) => button.classList.contains('active')),
      true,
      'restored 720 selection should light the B control again',
    );

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
    // merge into the previous item's body instead of creating another bullet.
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
    assert.ok(sequenceContinuationState.listText.some((text) => text.endsWith('接回序列的正文')), 'Backspace should merge into the previous sequence item');
    assert.ok(!sequenceContinuationState.listText.includes('接回序列的正文'), 'merged text must not become a standalone sequence item');
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
    assert.strictEqual(await orderedPage.locator('#stageScale .xhs-green-text').filter({ hasText: undoPhrase }).count(), 1);
    await orderedPage.locator('#stageScale .xhs-list-line .xhs-list-body').first().evaluate((body) => {
      body.closest('[contenteditable="true"]')?.focus();
    });
    await orderedPage.keyboard.press('Control+z');
    await orderedPage.waitForTimeout(120);
    assert.strictEqual(await orderedPage.locator('#stageScale .xhs-green-text').filter({ hasText: undoPhrase }).count(), 0, 'Ctrl+Z should undo a Studio toolbar action');
    await orderedPage.keyboard.press('Control+y');
    await orderedPage.waitForTimeout(120);
    assert.strictEqual(await orderedPage.locator('#stageScale .xhs-green-text').filter({ hasText: undoPhrase }).count(), 1, 'Ctrl+Y should redo a Studio toolbar action');
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
    assert.strictEqual(sequenceCardState.fontSize, "36px");
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

    // Regression: pagination is only a 3:4 view over one continuous text
    // stream. Backspace before the first character of a split tail must delete
    // the previous-page character and keep the caret at the new boundary.
    const continuousBackspacePage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await continuousBackspacePage.addInitScript(() => localStorage.clear());
    await continuousBackspacePage.goto(`file://${path.join(continuousOutputDir, "xhs-studio.html")}`);
    await continuousBackspacePage.waitForTimeout(350);
    const splitTailState = await continuousBackspacePage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pageTabs button'));
      for (let index = 1; index < tabs.length; index += 1) {
        tabs[index].click();
        const tail = document.querySelector('#stageScale .xhs-p.xhs-split-tail, #stageScale .xhs-rich.xhs-split-tail');
        if (!tail) continue;
        const node = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT).nextNode();
        if (!node) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        tail.closest('[contenteditable="true"]')?.focus();
        const allText = pages.map((page) => {
          const holder = document.createElement('div');
          holder.innerHTML = page.type === 'cover' ? (page.tailHtml || '') : (page.html || '');
          return holder.textContent || '';
        }).join('');
        const frame = tail.closest('.xhs-body-frame');
        const firstBlock = Array.from(frame?.children || []).find((item) =>
          !item.classList?.contains('xhs-caret-anchor') && item.dataset?.xhsPageBreak !== '1'
        );
        return {
          index,
          allText,
          firstCharacter: Array.from(node.textContent || '')[0] || '',
          tailClass: tail.className,
          firstBlockClass: firstBlock?.className || '',
          tailIsFirst: firstBlock === tail,
          runtimePageIndex: pageIndex,
        };
      }
      return null;
    });
    assert.ok(splitTailState, 'continuous-flow fixture should contain a split paragraph tail');
    await continuousBackspacePage.keyboard.press('Backspace');
    await continuousBackspacePage.waitForTimeout(350);
    const crossPageBackspaceResult = await continuousBackspacePage.evaluate(() => {
      const allText = pages.map((page) => {
        const holder = document.createElement('div');
        holder.innerHTML = page.type === 'cover' ? (page.tailHtml || '') : (page.html || '');
        return holder.textContent || '';
      }).join('');
      const selection = window.getSelection();
      return {
        allText,
        pageIndex,
        caretOffset: selection?.anchorOffset ?? -1,
        caretText: selection?.anchorNode?.textContent || '',
        notice: document.querySelector('#runtimeNotice')?.textContent || '',
      };
    });
    assert.strictEqual(
      crossPageBackspaceResult.allText.length,
      splitTailState.allText.length - 1,
      'page-start Backspace should delete exactly one previous-page character: ' + JSON.stringify(splitTailState),
    );
    assert.ok(crossPageBackspaceResult.allText.includes(splitTailState.firstCharacter), 'the first character on the current page must survive backward deletion');
    assert.strictEqual(crossPageBackspaceResult.caretOffset, 0, 'caret should stay at the continuous split boundary');
    assert.strictEqual(crossPageBackspaceResult.notice, '', 'valid cross-page deletion should not trigger an integrity rollback');
    await continuousBackspacePage.close();

    // Regression: Enter at the start of an atomic quote inserts one real blank.
    // When that blank pushes the quote to the next page, the quote remains once
    // and the caret stays in the blank on the previous page.
    const continuousQuotePage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await continuousQuotePage.addInitScript(() => localStorage.clear());
    await continuousQuotePage.goto(`file://${path.join(continuousOutputDir, "xhs-studio.html")}`);
    await continuousQuotePage.waitForTimeout(350);
    const quoteThreshold = await continuousQuotePage.evaluate(() => {
      const snapshot = pages.map((page) => ({ ...page }));
      const quotePageIndex = () => pages.findIndex((page) => {
        const holder = document.createElement('div');
        holder.innerHTML = page.type === 'cover' ? (page.tailHtml || '') : (page.html || '');
        return Boolean(holder.querySelector('.xhs-quote'));
      });
      const initial = quotePageIndex();
      let keepOnPage = 0;
      for (let count = 1; count <= 30; count += 1) {
        pages = snapshot.map((page) => ({ ...page }));
        pageIndex = initial;
        renderAll();
        const quote = document.querySelector('#stageScale .xhs-quote');
        if (!quote) break;
        for (let index = 0; index < count; index += 1) quote.before(makeEmptyParagraph());
        saveCurrentPage({ skipNormalize: true });
        reflow();
        if (quotePageIndex() !== initial) break;
        keepOnPage = count;
      }
      pages = snapshot.map((page) => ({ ...page }));
      pageIndex = initial;
      renderAll();
      const quote = document.querySelector('#stageScale .xhs-quote');
      for (let index = 0; index < keepOnPage; index += 1) quote.before(makeEmptyParagraph());
      saveCurrentPage({ skipNormalize: true });
      reflow();
      return { initial, keepOnPage };
    });
    assert.ok(quoteThreshold.initial > 0, 'continuous-flow fixture should place its quote on a body page');
    await activateStudioPage(continuousQuotePage, quoteThreshold.initial);
    await continuousQuotePage.locator('#stageScale .xhs-quote').evaluate((quote) => {
      const node = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT).nextNode();
      if (!node) throw new Error('quote text node missing');
      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      quote.closest('[contenteditable="true"]')?.focus();
    });
    await continuousQuotePage.keyboard.press('Enter');
    await continuousQuotePage.waitForTimeout(900);
    const quoteFlowResult = await continuousQuotePage.evaluate(() => {
      let quoteCount = 0;
      let quotePage = -1;
      pages.forEach((page, index) => {
        const holder = document.createElement('div');
        holder.innerHTML = page.type === 'cover' ? (page.tailHtml || '') : (page.html || '');
        const count = holder.querySelectorAll('.xhs-quote').length;
        quoteCount += count;
        if (count) quotePage = index;
      });
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
      return {
        quoteCount,
        quotePage,
        pageIndex,
        caretInBlank: Boolean(element?.closest?.('.xhs-manual-blank')),
        notice: document.querySelector('#runtimeNotice')?.textContent || '',
      };
    });
    assert.strictEqual(quoteFlowResult.quoteCount, 1, 'quote must remain exactly once after being pushed across a page boundary');
    assert.ok(quoteFlowResult.quotePage > quoteThreshold.initial, 'one structural Enter at the threshold should move the quote to the next page');
    assert.strictEqual(quoteFlowResult.pageIndex, quoteFlowResult.quotePage - 1, 'caret should remain on the previous page after the quote moves');
    assert.strictEqual(quoteFlowResult.caretInBlank, true, 'caret should remain inside the inserted manual blank');
    assert.strictEqual(quoteFlowResult.notice, '', 'valid structural Enter should not trigger an integrity rollback');
    await continuousQuotePage.close();

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
    await activateStudioPage(beforeInputPage, beforeInputListPageIndex);
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
    await activateStudioPage(beforeInputPage, 0);
    const coverUndoState = await beforeInputPage.evaluate(async () => {
      const title = document.querySelector('#stageScale .cover-title');
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
    assert.strictEqual(await beforeInputPage.locator('#stageScale .cover-title').innerText().then((text) => text.includes(coverUndoState.suffix)), false, 'cover text should also use Studio undo history');
    await beforeInputPage.close();

    const insertImagePage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await insertImagePage.addInitScript(() => localStorage.clear());
    await insertImagePage.goto(`file://${htmlPath}`);
    await insertImagePage.waitForTimeout(350);
    const insertBodyPageIndex = await insertImagePage.evaluate(() => {
      for (const [index, tab] of Array.from(document.querySelectorAll('#pageTabs button')).entries()) {
        tab.click();
        if (document.querySelector('#stageScale .xhs-body-frame .xhs-p:not(.xhs-manual-blank)')) return index;
      }
      return -1;
    });
    assert.ok(insertBodyPageIndex > 0, 'insert-image fixture should contain editable body prose');
    await activateStudioPage(insertImagePage, insertBodyPageIndex);
    const imageInsertBefore = await insertImagePage.evaluate(() => {
      const paragraph = document.querySelector('#stageScale .xhs-body-frame .xhs-p:not(.xhs-manual-blank)');
      const text = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(text, Math.min(2, text.textContent.length));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.closest('[contenteditable="true"]')?.focus();
      const state = serializeStudioState();
      const holder = document.createElement('div');
      holder.innerHTML = state.flowHtml || '';
      return {
        imageCount: holder.querySelectorAll('.xhs-image-block img').length,
        hasFlowHtml: Boolean(state.flowHtml),
      };
    });
    assert.strictEqual(imageInsertBefore.hasFlowHtml, true, 'saved Studio state should include one canonical continuous flow');
    const [imageChooser] = await Promise.all([
      insertImagePage.waitForEvent('filechooser'),
      insertImagePage.click('#insertImageBtn'),
    ]);
    await imageChooser.setFiles(path.join(sourceDir, 'fixture.png'));
    await insertImagePage.waitForTimeout(700);
    const imageInsertAfter = await insertImagePage.evaluate(() => {
      const state = serializeStudioState();
      const holder = document.createElement('div');
      holder.innerHTML = state.flowHtml || '';
      return {
        imageCount: holder.querySelectorAll('.xhs-image-block img').length,
        pageImageCount: pages.reduce((total, savedPage) => {
          const pageHolder = document.createElement('div');
          pageHolder.innerHTML = savedPage.type === 'cover' ? (savedPage.tailHtml || '') : (savedPage.html || '');
          return total + pageHolder.querySelectorAll('.xhs-image-block img').length;
        }, 0),
      };
    });
    assert.strictEqual(imageInsertAfter.imageCount, imageInsertBefore.imageCount + 1, 'toolbar image insertion should add one image to the continuous document');
    assert.strictEqual(imageInsertAfter.pageImageCount, imageInsertAfter.imageCount, 'paginated views must derive every image from the canonical flow exactly once');
    await insertImagePage.close();

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

    // A body page with no prose exposes one real editable line. Clicking lower
    // empty canvas moves the selection to that line; it must not manufacture
    // a stack of persistent paragraphs just to draw the caret.
    const emptyPageState = await page.evaluate(() => {
      window.__virtualRowOriginalPages = pages.map((savedPage) => ({ ...savedPage }));
      saveCurrentPage({ skipNormalize: true });
      const originalPageCount = pages.length;
      pages.push({ type: 'body', html: '' });
      pageIndex = pages.length - 1;
      renderAll();
      const frame = document.querySelector('#stageScale .xhs-body-frame');
      const blanks = Array.from(frame?.querySelectorAll(':scope > .xhs-manual-blank') || []);
      return {
        originalPageCount,
        blankCount: blanks.length,
        blankHeights: blanks.map((blank) => blank.offsetHeight),
        emptyFrame: frame?.classList.contains('xhs-empty-flow-frame') || false,
      };
    });
    assert.strictEqual(emptyPageState.blankCount, 1, 'an empty body page should automatically expose one editable blank line');
    assert.strictEqual(emptyPageState.emptyFrame, true, 'an empty body page should enter blank-line editing mode');
    assert.ok(emptyPageState.blankHeights.every((height) => height >= 50), 'the empty-page caret line must not collapse to zero height');
    const emptyFrameBox = await page.locator('#stageScale .xhs-body-frame').boundingBox();
    assert.ok(emptyFrameBox, 'expected visible empty body frame');
    await page.mouse.click(emptyFrameBox.x + emptyFrameBox.width / 2, emptyFrameBox.y + emptyFrameBox.height * 0.7);
    const emptyFrameCaret = await page.evaluate(() => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const blank = anchor?.closest?.('.xhs-manual-blank');
      const blanks = Array.from(document.querySelectorAll('#stageScale .xhs-body-frame > .xhs-manual-blank'));
      return {
        caretInBlank: Boolean(blank),
        blankIndex: blanks.indexOf(blank),
        blankCount: blanks.length,
        gapCursorCount: document.querySelectorAll('#stageScale .xhs-gap-cursor').length,
      };
    });
    assert.strictEqual(emptyFrameCaret.caretInBlank, true, 'clicking unused space on an empty page should focus a real blank line');
    assert.strictEqual(emptyFrameCaret.blankIndex, 0, 'empty-canvas clicks should reuse the single editable line');
    assert.strictEqual(emptyFrameCaret.blankCount, 1, 'selection-only clicks must not add document paragraphs');
    assert.strictEqual(emptyFrameCaret.gapCursorCount, 0, 'the real empty paragraph does not need an extra gap cursor');
    await page.evaluate(() => {
      cancelPendingReflow();
      const frame = document.querySelector('#stageScale .xhs-body-frame');
      frame.replaceChildren(makeManualBlank(), makeManualBlank(), makeManualBlank());
      saveCurrentPage({ skipNormalize: true });
      renderAll();
    });
    const visibleBlankState = await page.evaluate(() => {
      const frame = document.querySelector('#stageScale .xhs-body-frame');
      const blanks = Array.from(frame?.querySelectorAll(':scope > .xhs-manual-blank') || []);
      return {
        count: blanks.length,
        heights: blanks.map((blank) => blank.offsetHeight),
        emptyFrame: frame?.classList.contains('xhs-empty-flow-frame') || false,
      };
    });
    assert.strictEqual(visibleBlankState.count, 3, 'all explicit blank lines should survive rendering on an otherwise empty page');
    assert.strictEqual(visibleBlankState.emptyFrame, true);
    assert.ok(visibleBlankState.heights.every((height) => height >= 50), 'every explicit blank must remain a full editable line');
    await page.locator('#stageScale .xhs-manual-blank').nth(1).click({ position: { x: 8, y: 8 } });
    const focusedBlankIndex = await page.evaluate(() => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const blank = anchor?.closest?.('.xhs-manual-blank');
      return Array.from(document.querySelectorAll('#stageScale .xhs-manual-blank')).indexOf(blank);
    });
    assert.strictEqual(focusedBlankIndex, 1, 'each visible blank line should receive its own caret');
    await page.keyboard.type('空白行可以直接输入');
    await page.waitForTimeout(260);
    const filledBlankState = await page.evaluate(() => ({
      text: document.querySelector('#stageScale .xhs-body-frame')?.textContent || '',
      manualBlankCount: document.querySelectorAll('#stageScale .xhs-manual-blank').length,
    }));
    assert.match(filledBlankState.text, /空白行可以直接输入/);
    assert.strictEqual(filledBlankState.manualBlankCount, 2, 'typing should promote only the focused blank into normal prose');

    await page.evaluate(() => {
      cancelPendingReflow();
      const cover = window.__virtualRowOriginalPages.find((savedPage) => savedPage.type === 'cover');
      pages = [{ ...cover }, { type: 'body', html: '<p class="xhs-p xhs-block">正文锚点</p>' }];
      pageIndex = 1;
      renderAll();
    });
    const proseVirtualFrame = await page.locator('#stageScale .xhs-body-frame').boundingBox();
    assert.ok(proseVirtualFrame, 'non-empty body page should expose its remaining blank area');
    await page.mouse.click(proseVirtualFrame.x + proseVirtualFrame.width / 2, proseVirtualFrame.y + proseVirtualFrame.height * 0.35);
    const proseVirtualClick = await page.evaluate(() => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      return {
        caretInGapCursor: Boolean(anchor?.closest?.('.xhs-gap-cursor')),
        gapCursorCount: document.querySelectorAll('#stageScale .xhs-gap-cursor').length,
        manualBlankCount: document.querySelectorAll('#stageScale .xhs-manual-blank').length,
      };
    });
    assert.strictEqual(proseVirtualClick.caretInGapCursor, true, 'clicking unused space below prose should focus a temporary gap cursor');
    assert.strictEqual(proseVirtualClick.gapCursorCount, 1, 'blank canvas needs only one selection decoration');
    assert.strictEqual(proseVirtualClick.manualBlankCount, 0, 'a gap cursor must not mutate the document into empty paragraphs');
    await page.evaluate(() => reflow());
    await page.waitForTimeout(120);
    const proseGapAfterReflow = await page.evaluate(() => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      return {
        caretInGapCursor: Boolean(anchor?.closest?.('.xhs-gap-cursor')),
        gapCursorCount: document.querySelectorAll('#stageScale .xhs-gap-cursor').length,
        manualBlankCount: document.querySelectorAll('#stageScale .xhs-manual-blank').length,
      };
    });
    assert.strictEqual(proseGapAfterReflow.caretInGapCursor, true, 'automatic repagination must restore the temporary tail caret');
    assert.strictEqual(proseGapAfterReflow.gapCursorCount, 1, 'repagination must not make the tail caret blink away');
    assert.strictEqual(proseGapAfterReflow.manualBlankCount, 0, 'restoring a temporary caret must not create a document blank');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const proseGapAfterEnter = await page.evaluate(() => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const state = serializeStudioState();
      const flow = document.createElement('div');
      flow.innerHTML = state.flowHtml || '';
      return {
        caretInBlank: Boolean(anchor?.closest?.('.xhs-manual-blank')),
        gapCursorCount: document.querySelectorAll('#stageScale .xhs-gap-cursor').length,
        manualBlankCount: document.querySelectorAll('#stageScale .xhs-manual-blank').length,
        flowBlankCount: flow.querySelectorAll('.xhs-manual-blank').length,
      };
    });
    assert.strictEqual(proseGapAfterEnter.caretInBlank, true, 'Enter on a temporary tail caret should create and keep one real editable blank');
    assert.strictEqual(proseGapAfterEnter.gapCursorCount, 0, 'the temporary cursor must be consumed after Enter');
    assert.strictEqual(proseGapAfterEnter.manualBlankCount, 1, 'one Enter should create exactly one blank line');
    assert.strictEqual(proseGapAfterEnter.flowBlankCount, 1, 'the new blank line must persist in the canonical flow');

    // A drop cursor in empty visual space is only feedback. Dropping moves the
    // block to the end-of-page document position without writing blank rows.
    await page.evaluate(() => {
      cancelPendingReflow();
      const source = extractBlocksFromTemplate().find((node) => node.classList?.contains('xhs-callout'));
      if (!source) throw new Error('callout fixture missing for virtual-row drag');
      const probe = source.cloneNode(true);
      probe.dataset.virtualRowDragProbe = '1';
      probe.dataset.xhsBlockId = 'virtual-row-drag-probe';
      const cover = window.__virtualRowOriginalPages.find((savedPage) => savedPage.type === 'cover');
      pages = [{ ...cover }, { type: 'body', html: probe.outerHTML + '<p class="xhs-p xhs-block">正文保留</p>' }];
      pageIndex = 1;
      renderAll();
    });
    await page.waitForTimeout(100);
    const virtualDragBlock = page.locator('#stageScale [data-virtual-row-drag-probe="1"]');
    await virtualDragBlock.hover();
    await page.waitForTimeout(80);
    const virtualDragHandle = page.locator('#blockHalo .xhs-block-drag-handle');
    const virtualHandleBox = await virtualDragHandle.boundingBox();
    const virtualFrameBox = await page.locator('#stageScale .xhs-body-frame').boundingBox();
    assert.ok(virtualHandleBox && virtualFrameBox, 'virtual-row drag fixture should expose its block handle and body frame');
    await page.mouse.move(virtualHandleBox.x + virtualHandleBox.width / 2, virtualHandleBox.y + virtualHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(virtualFrameBox.x + virtualFrameBox.width / 2, virtualFrameBox.y + virtualFrameBox.height * 0.42, { steps: 8 });
    const virtualDragFeedback = await page.evaluate(() => {
      const indicator = document.querySelector('.xhs-drop-indicator:not([hidden])');
      const frame = document.querySelector('#stageScale .xhs-body-frame');
      const indicatorRect = indicator?.getBoundingClientRect();
      const frameRect = frame?.getBoundingClientRect();
      const scale = frame ? stageLocalScale(frame) : 1;
      return {
        hasDropTarget: Boolean(blockReorderDrag?.hasDropTarget),
        indicatorVisible: Boolean(indicator),
        logicalTop: indicatorRect && frameRect ? (indicatorRect.top - frameRect.top) / scale : -1,
        expectedTop: frameRect ? (dropInsertionTop(frame, flowBlocksInBody(frame).filter((node) => !node.classList.contains('reorder-dragging')), flowBlocksInBody(frame).filter((node) => !node.classList.contains('reorder-dragging')).length) - frameRect.top) / scale : -1,
      };
    });
    assert.strictEqual(virtualDragFeedback.hasDropTarget, true, 'blank-area drag should resolve to the document tail');
    assert.strictEqual(virtualDragFeedback.indicatorVisible, true, 'blank-area drag should show the insertion line');
    assert.ok(Math.abs(virtualDragFeedback.logicalTop - virtualDragFeedback.expectedTop) <= 2, 'drop cursor should show the actual end-of-content insertion point');
    await page.mouse.up();
    await page.waitForTimeout(850);
    const virtualDragCommitted = await page.evaluate(() => {
      const { holder } = collectBodyFlowHolderWithPageNodes();
      const probe = holder.querySelector('[data-virtual-row-drag-probe="1"]');
      return {
        probeCount: holder.querySelectorAll('[data-virtual-row-drag-probe="1"]').length,
        previousText: (probe?.previousElementSibling?.textContent || '').trim(),
        manualBlankCount: holder.querySelectorAll('.xhs-manual-blank').length,
        selected: Boolean(document.querySelector('#stageScale [data-virtual-row-drag-probe="1"].selected-flow-block')),
      };
    });
    assert.strictEqual(virtualDragCommitted.probeCount, 1, 'blank-area drag must keep the moved block exactly once');
    assert.strictEqual(virtualDragCommitted.previousText, '正文保留', 'dropping in blank canvas should move the block after existing page content');
    assert.strictEqual(virtualDragCommitted.manualBlankCount, 0, 'drop feedback must not persist as blank paragraphs');
    assert.strictEqual(virtualDragCommitted.selected, true, 'moved block should remain selected after repagination');

    const imageTailFitState = await page.evaluate(() => {
      const image = extractBlocksFromTemplate().find((node) => node.classList?.contains('xhs-image-block'))?.cloneNode(true);
      if (!image) return null;
      const beforeHeight = parseFloat(image.querySelector('.xhs-image-frame')?.style.height || '0');
      const beforeFit = measureBlockMetrics(image).fit;
      const available = beforeFit - 24;
      const changed = fitImageBlockIntoTailSpace(image, available);
      return {
        changed,
        available,
        beforeHeight,
        afterHeight: parseFloat(image.querySelector('.xhs-image-frame')?.style.height || '0'),
        afterFit: measureBlockMetrics(image).fit,
        userHeight: image.querySelector('.xhs-image-frame')?.dataset.userHeight || '',
      };
    });
    assert.ok(imageTailFitState, 'expected an image fixture for tail-space fitting');
    assert.strictEqual(imageTailFitState.changed, true, 'an image that narrowly misses the target page should shrink to the tail space');
    assert.ok(imageTailFitState.afterHeight < imageTailFitState.beforeHeight, 'tail fitting must adjust only the image frame height');
    assert.ok(imageTailFitState.afterFit <= imageTailFitState.available + 1, 'the adjusted image must fit the target tail');
    assert.strictEqual(imageTailFitState.userHeight, '1', 'tail-fitted image height must survive later repagination');

    await page.evaluate(() => {
      cancelPendingReflow();
      pages = window.__virtualRowOriginalPages.map((savedPage) => ({ ...savedPage }));
      delete window.__virtualRowOriginalPages;
      pageIndex = Math.min(1, pages.length - 1);
      persistDraft();
      renderAll();
    });
    await page.waitForTimeout(120);

  const sourceCodeProbe = await page.evaluate(() => {
    const code = extractBlocksFromTemplate().find((node) => node.classList?.contains('xhs-code-block'));
    if (!code) return null;
    const rendered = code.cloneNode(true);
    rendered.style.position = 'fixed';
    rendered.style.left = '0';
    rendered.style.top = '0';
    rendered.style.width = '936px';
    rendered.style.zIndex = '-1';
    document.body.appendChild(rendered);
    const renderedDots = Array.from(rendered.querySelectorAll('.xhs-code-dot'));
    const dotCenters = renderedDots.map((dot) => {
      const rect = dot.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    const dotSizes = renderedDots.map((dot) => getComputedStyle(dot).width);
    const toolbarStyle = getComputedStyle(rendered.querySelector('.xhs-code-toolbar'));
    const codeStyle = getComputedStyle(rendered.querySelector('.xhs-code-content'));
    const languageStyle = getComputedStyle(rendered.querySelector('.xhs-code-language'));
    const toolbarBorder = toolbarStyle.borderBottomWidth;
    const toolbarHeight = toolbarStyle.height;
    const codeFontSize = codeStyle.fontSize;
    const codeLineHeight = codeStyle.lineHeight;
    const languageFontSize = languageStyle.fontSize;
    rendered.remove();
    return code ? {
      language: code.querySelector('.xhs-code-language')?.textContent || '',
      text: code.querySelector('.xhs-code-content')?.textContent || '',
      editable: code.querySelector('.xhs-code-content')?.getAttribute('contenteditable') || '',
      dots: code.querySelectorAll('.xhs-code-dot').length,
      dotCenters,
      dotSizes,
      toolbarBorder,
      toolbarHeight,
      codeFontSize,
      codeLineHeight,
      languageFontSize,
    } : null;
  });
  assert.strictEqual(sourceCodeProbe?.language, 'JavaScript');
  assert.strictEqual(sourceCodeProbe?.text, "const studio = 'rabbitQ';\nconsole.log(studio);");
  assert.strictEqual(sourceCodeProbe?.editable, 'true');
  assert.strictEqual(sourceCodeProbe?.dots, 3, 'fenced code should render three macOS dots');
  assert.ok(Math.max(...sourceCodeProbe.dotCenters) - Math.min(...sourceCodeProbe.dotCenters) < 0.1, 'macOS dots should share one horizontal center line');
  assert.deepStrictEqual(sourceCodeProbe.dotSizes, ['12px', '12px', '12px'], 'macOS dots should retain the original 12px size');
  assert.strictEqual(sourceCodeProbe?.toolbarBorder, '1px', 'code toolbar should keep its horizontal divider');
  assert.strictEqual(sourceCodeProbe?.toolbarHeight, '46px', 'code toolbar should retain its original height');
  assert.strictEqual(sourceCodeProbe?.codeFontSize, '32px', 'code content should use 32px text');
  assert.ok(Math.abs(parseFloat(sourceCodeProbe?.codeLineHeight) - 49.6) < 0.2, '32px code text should use a 1.55 line height');
  assert.strictEqual(sourceCodeProbe?.languageFontSize, '19px', 'code language label should retain its original size');

  const codeSelectionGuard = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('#pageTabs button'));
    let frame = null;
    let paragraphs = [];
    for (const tab of tabs) {
      tab.click();
      const candidate = document.querySelector('#stageScale .xhs-body-frame');
      const prose = Array.from(candidate?.querySelectorAll(':scope > .xhs-p:not(.xhs-caret-anchor), :scope > .xhs-rich') || [])
        .filter((node) => cleanText(node.textContent));
      if (candidate && prose.length >= 2) {
        frame = candidate;
        paragraphs = prose;
        break;
      }
    }
    if (!frame || paragraphs.length < 2) throw new Error('missing two prose blocks for code selection guard');
    clearSelectedFlowBlock();
    const beforeText = frame.textContent;
    const beforeCodeCount = frame.querySelectorAll('.xhs-code-block').length;
    const firstText = paragraphs[0].firstChild || paragraphs[0];
    const secondText = paragraphs[1].lastChild || paragraphs[1];
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(secondText, secondText.nodeType === Node.TEXT_NODE ? secondText.textContent.length : secondText.childNodes.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startProse = startElement?.closest?.('.xhs-p, .xhs-rich') || null;
    const endProse = endElement?.closest?.('.xhs-p, .xhs-rich') || null;
    const selectionProbe = {
      collapsed: range.collapsed,
      sameProse: startProse === endProse,
      helperFoundProse: Boolean(proseBlockForRange(range)),
      startText: cleanText(startProse?.textContent || ''),
      endText: cleanText(endProse?.textContent || ''),
    };
    let alertText = '';
    const originalAlert = window.alert;
    window.alert = (message) => { alertText = String(message || ''); };
    document.getElementById('codeBtn').click();
    window.alert = originalAlert;
    return {
      alertText,
      textUnchanged: frame.textContent === beforeText,
      codeCountUnchanged: frame.querySelectorAll('.xhs-code-block').length === beforeCodeCount,
      selectionProbe,
    };
  });
  assert.match(codeSelectionGuard.alertText, /跨段或整页/, `multi-block code conversion should explain why it was rejected: ${JSON.stringify(codeSelectionGuard)}`);
  assert.strictEqual(codeSelectionGuard.textUnchanged, true, 'multi-block code conversion must preserve the whole page text');
  assert.strictEqual(codeSelectionGuard.codeCountUnchanged, true, 'multi-block code conversion must not create a page-sized code block');

    const pageEndSpacingProbe = await page.evaluate(() => {
      const image = document.createElement('section');
      image.className = 'xhs-image-block xhs-block';
      image.innerHTML = '<div class="xhs-image-frame" style="height:180px"></div>';
      const imageMetrics = measureBlockMetrics(image);
      const leadMargin = 40;
      const spare = 10;
      const lead = document.createElement('section');
      lead.className = 'xhs-block';
      lead.style.height = Math.max(1, config.pageLimit - imageMetrics.fit - leadMargin - spare) + 'px';
      lead.style.margin = '0 0 ' + leadMargin + 'px';
      const result = paginateBlocks([lead, image]);
      const holder = document.createElement('div');
      holder.innerHTML = result[0]?.html || '';
      return {
        pageCount: result.length,
        imageIsPageEnd: holder.lastElementChild?.classList.contains('xhs-page-end') || false,
      };
    });
    assert.strictEqual(pageEndSpacingProbe.pageCount, 1, 'a final image should fit when only its trailing inter-block gap crosses the page limit');
    assert.strictEqual(pageEndSpacingProbe.imageIsPageEnd, true, 'the final block should suppress its unused trailing gap');

    const listImageFitProbe = await page.evaluate(() => {
      const lines = Array.from({ length: 4 }, (_, index) => {
        const line = document.createElement('p');
        line.className = 'xhs-p xhs-block xhs-list-line';
        line.innerHTML = '<span class="xhs-list-marker xhs-list-marker-dot"></span><span class="xhs-list-body">列表项目 ' + (index + 1) + '</span>';
        return line;
      });
      const image = document.createElement('section');
      image.className = 'xhs-image-block xhs-block';
      image.innerHTML = '<div class="xhs-image-frame" style="height:360px"></div>';
      const correctListHeight = lines.reduce((total, line, index) => {
        return total + measureBlockMetrics(line, lines[index + 1] || image).outer;
      }, 0);
      const imageMetrics = measureBlockMetrics(image);
      const spare = 10;
      const lead = document.createElement('section');
      lead.className = 'xhs-block';
      lead.style.height = Math.max(1, config.pageLimit - correctListHeight - imageMetrics.fit - spare) + 'px';
      const result = paginateBlocks([lead, ...lines, image]);
      return {
        pageCount: result.length,
        continuedMargin: measureBlockMetrics(lines[0], lines[1]).outer,
        terminalMargin: measureBlockMetrics(lines[0], image).outer,
      };
    });
    assert.ok(listImageFitProbe.continuedMargin < listImageFitProbe.terminalMargin, 'continued list items should keep their compact item gap while measuring pagination');
    assert.strictEqual(listImageFitProbe.pageCount, 1, 'list item gaps must not be over-counted and push a fitting image to the next page');

    const flowingListProbe = await page.evaluate(() => {
      const lines = Array.from({ length: 4 }, (_, index) => {
        const line = document.createElement('p');
        line.className = 'xhs-p xhs-block xhs-list-line';
        line.dataset.listType = 'ordered';
        line.innerHTML = '<span class="xhs-list-marker xhs-list-marker-ordered">' + (index + 1) + '.</span><span class="xhs-list-body">整组换页测试 ' + (index + 1) + '</span>';
        return line;
      });
      const firstHeight = measureBlockMetrics(lines[0], lines[1]).outer;
      const secondHeight = measureBlockMetrics(lines[1], lines[2]).outer;
      const lead = document.createElement('section');
      lead.className = 'xhs-block';
      lead.style.height = Math.max(1, config.pageLimit - firstHeight - secondHeight - 10) + 'px';
      const result = paginateBlocks([lead, ...lines]);
      return result.map((item) => {
        const holder = document.createElement('div');
        holder.innerHTML = item.html;
        return holder.querySelectorAll('.xhs-list-line').length;
      });
    });
    assert.deepStrictEqual(flowingListProbe, [2, 2], 'a sequence should flow across pages between complete list items');

    const atomicCalloutProbe = await page.evaluate(() => {
      const callout = document.createElement('section');
      callout.className = 'xhs-callout xhs-block';
      callout.innerHTML = '<div class="xhs-callout-label">划重点</div><div class="xhs-callout-body">' +
        '卡片内容保持完整，空间不足时整块进入下一页。'.repeat(7) + '</div>';
      const fit = measureBlockMetrics(callout).fit;
      const lead = document.createElement('section');
      lead.className = 'xhs-block';
      lead.style.height = Math.max(1, config.pageLimit - fit + 20) + 'px';
      const result = paginateBlocks([lead, callout]);
      return result.map((item) => {
        const holder = document.createElement('div');
        holder.innerHTML = item.html;
        return {
          callouts: holder.querySelectorAll('.xhs-callout').length,
          splitCallouts: holder.querySelectorAll('.xhs-callout[data-split]').length,
        };
      });
    });
    assert.deepStrictEqual(atomicCalloutProbe, [
      { callouts: 0, splitCallouts: 0 },
      { callouts: 1, splitCallouts: 0 },
    ], 'a card must never be split to fill the previous page remainder');

    const atomicShortTableProbe = await page.evaluate(() => {
      const table = document.createElement('section');
      table.className = 'xhs-table-block xhs-block';
      table.innerHTML = '<table class="xhs-table"><thead><tr><th>项目</th><th>说明</th></tr></thead><tbody>' +
        Array.from({ length: 4 }, (_, index) => '<tr><td>' + (index + 1) + '</td><td>短表整块换页</td></tr>').join('') +
        '</tbody></table>';
      const fit = measureBlockMetrics(table).fit;
      const lead = document.createElement('section');
      lead.className = 'xhs-block';
      lead.style.height = Math.max(1, config.pageLimit - fit + 20) + 'px';
      const result = paginateBlocks([lead, table]);
      return result.map((item) => {
        const holder = document.createElement('div');
        holder.innerHTML = item.html;
        return {
          tables: holder.querySelectorAll('.xhs-table-block').length,
          rows: holder.querySelectorAll('.xhs-table-block tbody > tr').length,
          splitTables: holder.querySelectorAll('.xhs-table-block[data-split]').length,
        };
      });
    });
    assert.deepStrictEqual(atomicShortTableProbe, [
      { tables: 0, rows: 0, splitTables: 0 },
      { tables: 1, rows: 4, splitTables: 0 },
    ], 'a short table must move whole; only a table taller than a full page may split by rows');

    const headingKeepWithNextProbe = await page.evaluate(() => {
      const sourceBlocks = extractBlocksFromTemplate();
      const sourceHeading = sourceBlocks.find((node) => node.classList?.contains('xhs-heading'));
      const sourceQuote = sourceBlocks.find((node) => node.classList?.contains('xhs-quote'));
      if (!sourceHeading || !sourceQuote) return { supported: false };
      const heading = sourceHeading.cloneNode(true);
      heading.dataset.level = '2';
      const quote = sourceQuote.cloneNode(true);
      const headingOuter = measureBlockMetrics(heading, quote).outer;
      const quoteFit = measureBlockMetrics(quote).fit;
      const lead = document.createElement('section');
      lead.className = 'xhs-block';
      lead.style.height = Math.max(1, config.pageLimit - headingOuter - quoteFit + 8) + 'px';
      const result = paginateBlocks([lead, heading, quote]);
      const first = document.createElement('div');
      first.innerHTML = result[0]?.html || '';
      const second = document.createElement('div');
      second.innerHTML = result[1]?.html || '';
      return {
        supported: true,
        pageCount: result.length,
        firstHasHeading: Boolean(first.querySelector('.xhs-heading')),
        secondStartsWithHeading: Boolean(second.firstElementChild?.classList.contains('xhs-heading')),
        secondHasQuote: Boolean(second.querySelector('.xhs-quote')),
      };
    });
    assert.strictEqual(headingKeepWithNextProbe.supported, true);
    assert.strictEqual(headingKeepWithNextProbe.pageCount, 2);
    assert.strictEqual(headingKeepWithNextProbe.firstHasHeading, false, 'a heading must not be stranded at the bottom of the previous page');
    assert.strictEqual(headingKeepWithNextProbe.secondStartsWithHeading, true, 'a heading should move to the next page with its following block');
    assert.strictEqual(headingKeepWithNextProbe.secondHasQuote, true, 'the following structural block should remain with its heading');

    const savedOrphanHeadingProbe = await page.evaluate(() => {
      const previousPages = pages;
      try {
        pages = [
          { type: 'cover', html: '', tailHtml: '' },
          { type: 'body', html: '<section class="xhs-heading xhs-block" data-level="2">引用</section>' },
          { type: 'body', html: '<section class="xhs-quote xhs-block">我是引用</section>' },
        ];
        return savedPagesContainOrphanHeading();
      } finally {
        pages = previousPages;
      }
    });
    assert.strictEqual(savedOrphanHeadingProbe, true, 'saved drafts with a heading at the page end should trigger one corrective reflow on load');

    const emptyParagraphPaginationProbe = await page.evaluate(() => {
      const blank = makeEmptyParagraph();
      const following = document.createElement('p');
      following.className = 'xhs-p xhs-block';
      following.textContent = '空行后的正文';
      const boundaryLead = document.createElement('section');
      boundaryLead.className = 'xhs-block';
      boundaryLead.style.height = Math.max(1, config.pageLimit - 10) + 'px';
      const result = paginateBlocks([boundaryLead, blank, following]);
      const refillLead = document.createElement('section');
      refillLead.className = 'xhs-block';
      refillLead.style.height = Math.max(1, config.pageLimit - measureBlockMetrics(following).fit - 8) + 'px';
      const refillWithBlank = paginateBlocks([refillLead, blank, following]);
      const afterDelete = paginateBlocks([refillLead, following]);
      const first = document.createElement('div');
      first.innerHTML = result[0]?.html || '';
      const second = document.createElement('div');
      second.className = 'xhs-body-frame';
      second.style.position = 'fixed';
      second.style.left = '-10000px';
      second.style.top = '0';
      second.innerHTML = result[1]?.html || '';
      document.body.appendChild(second);
      const firstBoundaryBlank = first.querySelector('.xhs-manual-blank');
      const secondFirst = second.firstElementChild;
      const secondFirstOffset = secondFirst ? secondFirst.getBoundingClientRect().top - second.getBoundingClientRect().top : -1;
      second.remove();
      return {
        pageCount: result.length,
        firstHasBlank: Boolean(firstBoundaryBlank),
        firstBlankAtEnd: Boolean(firstBoundaryBlank?.classList.contains('xhs-page-end')),
        secondStartsWithBlank: Boolean(secondFirst?.classList.contains('xhs-manual-blank')),
        secondText: second.textContent?.trim() || '',
        secondFirstOffset,
        refillPageCountWithBlank: refillWithBlank.length,
        pageCountAfterDelete: afterDelete.length,
        firstPageTextAfterDelete: afterDelete[0]?.html || '',
      };
    });
    assert.strictEqual(emptyParagraphPaginationProbe.pageCount, 2, 'an empty paragraph near a page edge should continue in normal document flow');
    assert.strictEqual(emptyParagraphPaginationProbe.firstHasBlank, true, 'a boundary blank belongs to the preceding page position');
    assert.strictEqual(emptyParagraphPaginationProbe.firstBlankAtEnd, true, 'the boundary blank should close the preceding page');
    assert.strictEqual(emptyParagraphPaginationProbe.secondStartsWithBlank, false, 'the next visible page must start with real content, not a hidden blank');
    assert.strictEqual(emptyParagraphPaginationProbe.secondText, '空行后的正文');
    assert.ok(emptyParagraphPaginationProbe.secondFirstOffset <= 0.1, 'text after a boundary blank should start at the first visible line');
    assert.strictEqual(emptyParagraphPaginationProbe.refillPageCountWithBlank, 2, 'an intentional blank may push the following paragraph to a new page');
    assert.strictEqual(emptyParagraphPaginationProbe.pageCountAfterDelete, 1, 'deleting the boundary blank should let the following paragraph flow back to the previous page');
    assert.match(emptyParagraphPaginationProbe.firstPageTextAfterDelete, /空行后的正文/);

    const paragraphInteractionProbe = await page.evaluate(() => {
      const frame = document.createElement('div');
      frame.contentEditable = 'true';
      frame.style.position = 'fixed';
      frame.style.left = '-10000px';
      document.body.appendChild(frame);
      const setCaret = (node, offset) => {
        frame.focus();
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return range;
      };
      const reset = (text) => {
        frame.innerHTML = '';
        const paragraph = document.createElement('p');
        paragraph.className = 'xhs-p xhs-block';
        paragraph.textContent = text;
        frame.appendChild(paragraph);
        return paragraph;
      };

      const middle = reset('甲乙');
      performParagraphEnter(frame, setCaret(middle.firstChild, 1));
      const middleState = Array.from(frame.children).map((node) => ({
        text: node.textContent || '',
        blank: node.classList.contains('xhs-manual-blank'),
      }));

      const end = reset('正文');
      performParagraphEnter(frame, setCaret(end.firstChild, end.firstChild.textContent.length));
      const firstEmptyParagraph = frame.lastElementChild;
      performParagraphEnter(frame, setCaret(firstEmptyParagraph, 0));
      const activeParagraph = frame.lastElementChild;
      activeParagraph.textContent = '下一段';
      normalizeFilledManualBlanks(frame);
      const doubleEnterState = Array.from(frame.children).map((node) => ({
        text: node.textContent || '',
        blank: node.classList.contains('xhs-manual-blank'),
      }));

      const soft = reset('甲乙');
      const softRange = setCaret(soft.firstChild, 1);
      const lineBreak = document.createElement('br');
      softRange.insertNode(lineBreak);
      softRange.setStartAfter(lineBreak);
      softRange.collapse(true);
      const softState = {
        blockCount: frame.children.length,
        lineBreakCount: soft.querySelectorAll('br').length,
        text: soft.textContent || '',
      };
      frame.remove();
      return { middleState, doubleEnterState, softState };
    });
    assert.deepStrictEqual(paragraphInteractionProbe.middleState, [
      { text: '甲', blank: false },
      { text: '乙', blank: false },
    ], 'Enter in the middle of body text should split one paragraph into two paragraphs');
    assert.deepStrictEqual(paragraphInteractionProbe.doubleEnterState, [
      { text: '正文', blank: false },
      { text: '', blank: true },
      { text: '下一段', blank: false },
    ], 'two Enter presses followed by typing should leave exactly one editable empty paragraph');
    assert.deepStrictEqual(paragraphInteractionProbe.softState, {
      blockCount: 1,
      lineBreakCount: 1,
      text: '甲乙',
    }, 'Shift+Enter semantics should keep a soft line break inside the same paragraph block');

    await activateStudioPage(page, 1);
    await page.waitForTimeout(100);
    const plainParagraphBlankDeleteProbe = await page.evaluate(() => {
      const frame = document.querySelector('#stageScale .xhs-body-frame');
      if (!frame) return { supported: false };
      const blank = makeEmptyParagraph();
      const paragraph = document.createElement('p');
      paragraph.className = 'xhs-p xhs-block';
      paragraph.textContent = '普通正文空行删除回归';
      frame.prepend(paragraph);
      frame.prepend(blank);
      frame.focus();
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      const blankRemoved = !blank.isConnected;
      paragraph.remove();
      cancelPendingReflow();
      return { supported: true, blankRemoved };
    });
    assert.strictEqual(plainParagraphBlankDeleteProbe.supported, true);
    assert.strictEqual(plainParagraphBlankDeleteProbe.blankRemoved, true, 'Backspace at the start of plain body text should remove a leading manual blank');

    async function collectFlowOrder() {
      const count = await page.locator("#pageTabs button").count();
      const order = [];
      for (let index = 1; index < count; index += 1) {
        await activateStudioPage(page, index);
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
            className: Array.from(node.classList).filter((name) => name !== "xhs-page-end" && name !== "xhs-page-start").join(" "),
            text: node.textContent.replace(/\s+/g, " ").trim(),
            imageCount: node.querySelectorAll("img").length,
          }];
        }));
        order.push(...blocks);
      }
      return order;
    }

    const flowOrderBeforeCoverToggle = await collectFlowOrder();
    await activateStudioPage(page, 0);
    assert.strictEqual(await page.locator("#coverThemeTools").isVisible(), true);
    await page.click("#coverImageOffBtn");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator("#coverThemeTools").isVisible(), false);
    assert.match(await page.locator("#pageInfo").innerText(), /正文已接入封面下半区/);
    assert.ok(await page.locator("#stageScale .xhs-cover-tail-frame").count());
    assert.ok(await page.locator("#stageScale .xhs-cover-tail-frame").evaluate((node) => node.children.length >= 2));
    const coverTailRepaginationState = await page.evaluate(() => {
      const before = studioFlowIntegritySignature(pages);
      const beforeTailText = (document.querySelector('#stageScale .xhs-cover-tail-frame')?.textContent || '').replace(/\s+/g, '');
      const holder = collectBodyFlowHolder();
      repaginateBodyBlocks(Array.from(holder.children));
      const after = studioFlowIntegritySignature(pages);
      const afterTailText = (document.querySelector('#stageScale .xhs-cover-tail-frame')?.textContent || '').replace(/\s+/g, '');
      return { before, after, beforeTailText, afterTailText };
    });
    assert.strictEqual(coverTailRepaginationState.after, coverTailRepaginationState.before, 'image/block repagination with the cover disabled must preserve the complete continuous flow');
    assert.strictEqual(coverTailRepaginationState.afterTailText, coverTailRepaginationState.beforeTailText, 'cover-tail content must survive image/block repagination');
    await page.click("#coverImageOnBtn");
    await page.waitForTimeout(500);
    const flowOrderAfterCoverToggle = await collectFlowOrder();
    assert.deepStrictEqual(flowOrderAfterCoverToggle, flowOrderBeforeCoverToggle);

    // Regression: deleting a leading manual-blank line inside the cover's
    // tail frame (shown when the cover image is off) must actually remove
    // it instead of leaving behind a phantom empty caret-anchor paragraph.
    await activateStudioPage(page, 0);
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
    await activateStudioPage(page, 1);
    await page.waitForTimeout(100);
    await activateStudioPage(page, 0);
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
      await activateStudioPage(page, 2);
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
      assert.ok(!bodyPageBlankState.firstText.includes('xhs-caret'), 'caret marker must never leak into visible page text');
    }

    // Regression: deleting a mid-page manual-blank must not resurrect phantom blanks after reflow.
    await activateStudioPage(page, 1);
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
      await activateStudioPage(page, index);
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
    // In overview mode, Alt-drag an image into the middle of prose on another
    // page. The text caret under the pointer is the document insertion point:
    // prose must split around the image instead of collapsing to a block edge.
    const crossDragImagePageIndex = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pageTabs button'));
      for (let index = 1; index < tabs.length; index += 1) {
        tabs[index].click();
        if (document.querySelector('#stageScale .xhs-image-block')) return index;
      }
      return -1;
    });
    assert.ok(crossDragImagePageIndex > 0, 'expected an image on a body page for cross-page drag');
    await activateStudioPage(page, crossDragImagePageIndex);
    await page.waitForTimeout(160);
    const crossPageTargetIndex = await page.evaluate((sourceIndex) => {
      const target = Array.from(document.querySelectorAll('.overview-item')).find((item) => {
        const index = Number(item.dataset.index);
        const paragraph = Array.from(item.querySelectorAll('.xhs-p, .xhs-rich')).find((node) =>
          !node.classList.contains('xhs-manual-blank') && (node.textContent || '').trim().length >= 6
        );
        return index > 0 && index !== sourceIndex && paragraph;
      });
      return Number(target?.dataset?.index ?? -1);
    }, crossDragImagePageIndex);
    assert.ok(crossPageTargetIndex > 0 && crossPageTargetIndex !== crossDragImagePageIndex, 'expected prose on another body page for image drag target');
    const sourceImageFrame = page.locator('#stageScale .xhs-image-frame').first();
    const targetOverviewCard = page.locator(`.overview-item[data-index="${crossPageTargetIndex}"] .overview-card-frame`);
    await targetOverviewCard.scrollIntoViewIfNeeded();
    const targetParagraph = targetOverviewCard.locator('.xhs-p:not(.xhs-manual-blank), .xhs-rich:not(.xhs-manual-blank)').filter({ hasText: /\S/ }).first();
    const targetParagraphText = (await targetParagraph.textContent()).trim();
    await sourceImageFrame.hover();
    await page.waitForTimeout(80);
    const sourceHandle = page.locator('#blockHalo .xhs-block-drag-handle');
    assert.strictEqual(await sourceHandle.getAttribute('aria-label'), '拖动区块');
    const handleStyle = await sourceHandle.evaluate((node) => {
      const style = getComputedStyle(node);
      const dot = node.querySelector('.xhs-block-drag-handle-dot');
      return {
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        dotCount: node.querySelectorAll('.xhs-block-drag-handle-dot').length,
        dotWidth: parseFloat(getComputedStyle(dot).width),
      };
    });
    assert.ok(handleStyle.width <= 18 && handleStyle.height <= 28, 'drag handle should stay compact and Feishu-like');
    assert.strictEqual(handleStyle.dotCount, 6, 'drag handle should contain six subtle dots');
    assert.ok(handleStyle.dotWidth <= 3, 'drag handle dots must stay visually light');
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetOverviewCard.boundingBox();
    const targetParagraphBox = await targetParagraph.boundingBox();
    assert.ok(sourceBox && targetBox && targetParagraphBox, 'expected visible image handle and target prose');
    const sourceDragImageId = await sourceImageFrame.evaluate((frame) => ensureImageId(frame.closest('.xhs-image-block')));
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      targetParagraphBox.x + Math.min(150, targetParagraphBox.width * 0.25),
      targetParagraphBox.y + targetParagraphBox.height / 2,
      { steps: 8 },
    );
    const dragFeedbackState = await page.evaluate((targetIndex) => {
      const indicator = document.querySelector('.xhs-overview-drop-indicator');
      const target = document.querySelector('.overview-item[data-index="' + targetIndex + '"] .overview-card-frame');
      const indicatorRect = indicator?.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      return {
        previewExists: Boolean(document.querySelector('.xhs-block-drop-preview')),
        indicatorVisible: Boolean(indicator && !indicator.hidden),
        indicatorHeight: indicatorRect?.height || 0,
        indicatorInsideTarget: Boolean(indicatorRect && targetRect && indicatorRect.top >= targetRect.top && indicatorRect.top <= targetRect.bottom),
        textOffset: blockReorderDrag?.crossPage?.textOffset,
      };
    }, crossPageTargetIndex);
    assert.strictEqual(dragFeedbackState.previewExists, false, 'dragging must not create a transparent destination clone');
    assert.ok(dragFeedbackState.indicatorVisible, 'dragging should show the exact cross-page insertion line');
    assert.ok(dragFeedbackState.indicatorHeight <= 3, 'cross-page feedback should stay a lightweight insertion line');
    assert.ok(dragFeedbackState.indicatorInsideTarget, 'insertion line should stay inside the target page');
    assert.ok(Number.isInteger(dragFeedbackState.textOffset) && dragFeedbackState.textOffset > 0 && dragFeedbackState.textOffset < targetParagraphText.length, 'cross-page prose drop should resolve to a character offset inside the paragraph: ' + JSON.stringify({ dragFeedbackState, targetParagraphText }));
    await page.mouse.up();
    await page.waitForTimeout(850);
    const imageDragState = await page.evaluate(({ imageId }) => {
      const holder = collectBodyFlowHolder();
      const image = findImageBlockById(holder, imageId);
      const previousText = (image?.previousElementSibling?.textContent || '').trim();
      const nextText = (image?.nextElementSibling?.textContent || '').trim();
      return {
      activeIndex: Number(document.querySelector('.overview-item.active')?.dataset?.index),
      imagePageIndex: pageIndexForImageId(imageId),
      selectedImageCount: document.querySelectorAll('#stageScale .xhs-image-block .selected-image-frame').length,
      targetOutlineCount: document.querySelectorAll('.overview-item.reorder-drop-page').length,
      draggingClassCount: document.querySelectorAll('#stageScale .reorder-dragging').length,
      indicatorVisible: Boolean(document.querySelector('.xhs-overview-drop-indicator:not([hidden])')),
      previousText,
      nextText,
      };
    }, { imageId: sourceDragImageId });
    assert.strictEqual(imageDragState.activeIndex, imageDragState.imagePageIndex, 'cross-page image drag should activate the image page after repagination');
    assert.ok(imageDragState.previousText && imageDragState.nextText, 'the target paragraph should be split into text before and after the image');
    assert.strictEqual(imageDragState.previousText + imageDragState.nextText, targetParagraphText, 'dropping inside prose must preserve every target-paragraph character');
    assert.strictEqual(imageDragState.selectedImageCount, 1, 'moved image should remain selected after cross-page repagination');
    assert.strictEqual(imageDragState.targetOutlineCount, 0, 'cross-page drop highlight should clear after drop');
    assert.strictEqual(imageDragState.draggingClassCount, 0, 'cross-page image drag must not persist its temporary dragging style');
    assert.strictEqual(imageDragState.indicatorVisible, false, 'cross-page insertion line should clear after drop');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    const paragraphRestoredAfterDragUndo = await page.evaluate((text) => {
      const holder = collectBodyFlowHolder();
      return Array.from(holder.querySelectorAll('.xhs-p, .xhs-rich')).some((node) => (node.textContent || '').trim() === text);
    }, targetParagraphText);
    assert.strictEqual(paragraphRestoredAfterDragUndo, true, 'undo after a prose drop should restore the original unsplit paragraph');
    await page.waitForTimeout(100);

    // Feishu treats headings, cards, quotes, code blocks and lists as movable
    // blocks too. The Studio must not reserve cross-page drag for images only.
    const structuralDragSourceIndex = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pageTabs button'));
      for (let index = 1; index < tabs.length; index += 1) {
        tabs[index].click();
        if (document.querySelector('#stageScale .xhs-callout')) return index;
      }
      return -1;
    });
    const structuralPageCount = await page.locator('#pageTabs button').count();
    assert.ok(structuralDragSourceIndex > 0, 'expected a card on a body page for structural cross-page drag');
    const structuralDragTargetIndex = structuralDragSourceIndex + 1 < structuralPageCount
      ? structuralDragSourceIndex + 1
      : structuralDragSourceIndex - 1;
    assert.ok(structuralDragTargetIndex > 0 && structuralDragTargetIndex !== structuralDragSourceIndex, 'expected another body page for structural drag target');
    await activateStudioPage(page, structuralDragSourceIndex);
    const structuralFlowBefore = await page.evaluate(() => Array.from(studioFlowIntegritySignature(pages)).sort().join(''));
    await page.waitForTimeout(160);
    const sourceCallout = page.locator('#stageScale .xhs-callout').first();
    const structuralTargetCard = page.locator(`.overview-item[data-index="${structuralDragTargetIndex}"] .overview-card-frame`);
    await structuralTargetCard.scrollIntoViewIfNeeded();
    const calloutBox = await sourceCallout.boundingBox();
    const structuralTargetBox = await structuralTargetCard.boundingBox();
    assert.ok(calloutBox && structuralTargetBox, 'expected visible card block and structural target page');
    const structuralBlockId = await sourceCallout.evaluate((callout) => ensureFlowBlockId(callout));
    await page.mouse.move(calloutBox.x + calloutBox.width / 2, calloutBox.y + calloutBox.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(structuralTargetBox.x + structuralTargetBox.width / 2, structuralTargetBox.y + Math.min(structuralTargetBox.height * 0.25, 110), { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(850);
    const structuralDragState = await page.evaluate((blockId) => ({
      activeIndex: Number(document.querySelector('.overview-item.active')?.dataset?.index),
      blockPageIndex: pageIndexForFlowBlockId(blockId),
      selectedCardCount: document.querySelectorAll('#stageScale .xhs-callout.selected-flow-block').length,
      integrity: Array.from(studioFlowIntegritySignature(pages)).sort().join(''),
      targetOutlineCount: document.querySelectorAll('.overview-item.reorder-drop-page').length,
      draggingClassCount: document.querySelectorAll('#stageScale .reorder-dragging').length,
    }), structuralBlockId);
    assert.strictEqual(structuralDragState.activeIndex, structuralDragState.blockPageIndex, 'cross-page structural drag should activate the moved block page');
    assert.strictEqual(structuralDragState.selectedCardCount, 1, 'moved card should remain selected after cross-page repagination');
    assert.strictEqual(structuralDragState.integrity, structuralFlowBefore, 'cross-page structural drag must preserve all text, images, blanks and page breaks');
    assert.strictEqual(structuralDragState.targetOutlineCount, 0, 'structural cross-page drop highlight should clear after drop');
    assert.strictEqual(structuralDragState.draggingClassCount, 0, 'structural cross-page drag must not persist its temporary dragging style');
    await page.waitForTimeout(100);

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
    await activateStudioPage(page, listPageIndex);
    await page.waitForTimeout(100);
    const firstListLine = page.locator('#stageScale .xhs-list-line').first();
    await firstListLine.scrollIntoViewIfNeeded();
    const firstListBox = await firstListLine.boundingBox();
    assert.ok(firstListBox, 'expected a visible list item for Alt-drag scope regression');
    await page.mouse.move(firstListBox.x + firstListBox.width / 2, firstListBox.y + firstListBox.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    const listDragStartState = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return {
        count: document.querySelectorAll('#stageScale .xhs-list-line.reorder-dragging').length,
        hit: hit ? [hit.tagName, hit.id, hit.className].join('.') : '',
        dragging: Boolean(blockReorderDrag),
        activeIndex: Number(document.querySelector('.overview-item.active')?.dataset?.index),
      };
    }, { x: firstListBox.x + firstListBox.width / 2, y: firstListBox.y + firstListBox.height / 2 });
    assert.strictEqual(listDragStartState.count, 1, `Alt-drag must select only the current list item: ${JSON.stringify(listDragStartState)}`);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(100);
    const listDragScope = await page.locator('#stageScale .xhs-list-line').first().evaluate((line) => ({
      contiguous: collectContiguousListLines(line).length,
      moving: reorderGroupNodes(line).length,
    }));
    assert.ok(listDragScope.contiguous > 1, 'expected a multi-item list for drag scope regression');
    assert.strictEqual(listDragScope.moving, 1, 'Alt-dragging a list item must move only that item');
    // Same-page movement must commit the new document order, not merely move
    // a visual placeholder and then snap back during automatic repagination.
    const samePageMove = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('#stageScale .xhs-list-line'));
      if (lines.length < 3) return null;
      const anchor = lines[0];
      const source = lines[lines.length - 1];
      ensureFlowBlockId(anchor);
      ensureFlowBlockId(source);
      saveCurrentPage({ skipNormalize: true });
      return {
        sourceId: source.dataset.xhsBlockId,
        anchorId: anchor.dataset.xhsBlockId,
      };
    });
    assert.ok(samePageMove, 'expected at least three list items for same-page reorder');
    const samePageSource = page.locator('#stageScale .xhs-list-line').last();
    const samePageAnchor = page.locator('#stageScale .xhs-list-line').first();
    const samePageSourceBox = await samePageSource.boundingBox();
    const samePageAnchorBox = await samePageAnchor.boundingBox();
    assert.ok(samePageSourceBox && samePageAnchorBox, 'expected visible source and anchor list items');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(140);
    await samePageSource.evaluate((node) => {
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await page.waitForTimeout(80);
    const samePageHandleBox = await page.locator('#blockHalo .xhs-block-drag-handle').boundingBox();
    assert.ok(samePageHandleBox, 'expected the compact drag handle for the source list item');
    await page.mouse.move(samePageHandleBox.x + samePageHandleBox.width / 2, samePageHandleBox.y + samePageHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      samePageAnchorBox.x + samePageAnchorBox.width / 2,
      samePageAnchorBox.y + 1,
      { steps: 8 },
    );
    const samePageFeedback = await page.evaluate(() => ({
      lineVisible: Boolean(document.querySelector('.xhs-drop-indicator:not([hidden])')),
      previewExists: Boolean(document.querySelector('.xhs-block-drop-preview')),
      dragActive: Boolean(blockReorderDrag),
      hasDropTarget: Boolean(blockReorderDrag?.hasDropTarget),
      indicatorExists: Boolean(document.querySelector('.xhs-drop-indicator')),
      indicatorHidden: document.querySelector('.xhs-drop-indicator')?.hidden,
      overviewLineVisible: Boolean(document.querySelector('.xhs-overview-drop-indicator:not([hidden])')),
      viewMode,
      insertBeforeId: blockReorderDrag?.insertBefore?.dataset?.xhsBlockId || '',
      sourceId: blockReorderDrag?.node?.dataset?.xhsBlockId || '',
    }));
    assert.strictEqual(samePageFeedback.lineVisible, true, 'same-page drag should expose its exact insertion line: ' + JSON.stringify(samePageFeedback));
    assert.strictEqual(samePageFeedback.previewExists, false, 'same-page drag must not create a transparent destination clone');
    await page.mouse.up();
    await page.waitForTimeout(350);
    const samePageCommitted = await page.evaluate(({ sourceId, anchorId }) => {
      const ids = [];
      pages.forEach((savedPage) => {
        const html = savedPage.type === 'cover' ? (savedPage.tailHtml || '') : (savedPage.html || '');
        if (!html) return;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        Array.from(holder.children).forEach((node) => {
          if (node.dataset?.xhsBlockId) ids.push(node.dataset.xhsBlockId);
        });
      });
      return {
        sourceIndex: ids.indexOf(sourceId),
        anchorIndex: ids.indexOf(anchorId),
        selectedListCount: document.querySelectorAll('#stageScale .xhs-list-line.selected-flow-block').length,
        lineVisible: Boolean(document.querySelector('.xhs-drop-indicator:not([hidden])')),
      };
    }, samePageMove);
    assert.ok(samePageCommitted.sourceIndex >= 0 && samePageCommitted.anchorIndex >= 0, 'moved list item and anchor must survive repagination');
    assert.ok(samePageCommitted.sourceIndex < samePageCommitted.anchorIndex, `same-page drop must commit the new list-item order: ${JSON.stringify({ samePageFeedback, samePageCommitted })}`);
    assert.strictEqual(samePageCommitted.selectedListCount, 1, 'same-page moved list item should remain selected');
    assert.strictEqual(samePageCommitted.lineVisible, false, 'same-page insertion line should clear after drop');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(350);
    const restoredListPageIndex = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pageTabs button'));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (Array.from(document.querySelectorAll('#stageScale .xhs-list-body')).some((node) => (node.textContent || '').includes('重新分页'))) return index;
      }
      return -1;
    });
    assert.ok(restoredListPageIndex >= 0, 'undo after drag should restore the original list for later editing regressions');
    await activateStudioPage(page, restoredListPageIndex);
    await page.waitForTimeout(100);
    // Feishu interaction: unlist the second item, then Backspace again. The
    // plain paragraph must merge into the first item's body, not become a new
    // list item or remain behind an invisible list boundary.
    const secondListBody = page.locator("#stageScale .xhs-list-line .xhs-list-body").filter({ hasText: "重新分页" }).first();
    await secondListBody.evaluate((body) => {
      body.closest('[contenteditable="true"]')?.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(120);
    const secondUnlistedState = await page.evaluate(() => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const start = range?.startContainer?.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range?.startContainer?.parentElement;
      const paragraph = start?.closest?.('.xhs-p');
      return {
        paragraphText: paragraph?.textContent || '',
        listLineCount: document.querySelectorAll('#stageScale .xhs-list-line').length,
      };
    });
    assert.ok(secondUnlistedState.paragraphText.includes("重新分页"), "second list item should first become plain prose");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(700);
    const secondMergedIntoFirst = await page.evaluate(() => {
      const bodies = Array.from(document.querySelectorAll('#stageScale .xhs-list-body'));
      const merged = bodies.find((body) => (body.textContent || '').includes('Alt + 拖动'));
      return {
        mergedText: merged?.textContent || '',
        listLineCount: document.querySelectorAll('#stageScale .xhs-list-line').length,
        leftoverParagraphs: Array.from(document.querySelectorAll('#stageScale .xhs-p:not(.xhs-list-line)')).filter((node) => (node.textContent || '').includes('重新分页')).length,
      };
    });
    assert.ok(secondMergedIntoFirst.mergedText.includes("Alt + 拖动：卡片和图片整块移动重新分页：改完内容一键重排"), "second Backspace should merge unlisted text into the previous list item");
    assert.strictEqual(secondMergedIntoFirst.listLineCount, 2, "merging into the previous item should not create another bullet");
    assert.strictEqual(secondMergedIntoFirst.leftoverParagraphs, 0, "merged list text should not remain as a plain paragraph");

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
    await page.waitForTimeout(120);
    const afterUnlist = await page.evaluate((sample) => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const startElement = range?.startContainer?.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range?.startContainer?.parentElement;
      const paragraph = startElement?.closest?.(".xhs-p");
      const before = document.createRange();
      if (paragraph && range) {
        before.selectNodeContents(paragraph);
        before.setEnd(range.startContainer, range.startOffset);
      }
      return {
        listLineCount: document.querySelectorAll("#stageScale .xhs-list-line").length,
        plainCount: Array.from(document.querySelectorAll("#stageScale .xhs-p")).filter((node) => (
          !node.classList.contains("xhs-manual-blank") &&
          !node.classList.contains("xhs-caret-anchor") &&
          (node.textContent || "").includes(sample.slice(0, Math.min(6, sample.length)))
        )).length,
        caretParagraphText: paragraph?.textContent || "",
        caretPrefix: paragraph && range ? before.toString() : "missing",
      };
    }, unlistState.sample);
    assert.ok(afterUnlist.plainCount >= 1, "list line should become plain paragraph after backspace at line start");
    assert.ok(afterUnlist.caretParagraphText.includes(unlistState.sample.slice(0, 6)), "caret should stay in the unlisted paragraph after immediate reflow: " + JSON.stringify(afterUnlist));
    assert.strictEqual(afterUnlist.caretPrefix, "", "caret should remain at the start of the unlisted paragraph");

    // Regression: a second Backspace must use normal prose flow instead of
    // leaving an invisible list boundary behind.
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(700);
    const afterSecondBackspace = await page.evaluate((sample) => {
      const paragraphs = Array.from(document.querySelectorAll("#stageScale .xhs-p"));
      const merged = paragraphs.find((node) => (
        (node.textContent || "").includes("序列前的普通正文。") &&
        (node.textContent || "").includes(sample.slice(0, Math.min(6, sample.length)))
      ));
      return {
        mergedText: merged?.textContent || "",
        plainSampleCount: paragraphs.filter((node) => (node.textContent || "").includes(sample.slice(0, 6))).length,
      };
    }, unlistState.sample);
    assert.ok(afterSecondBackspace.mergedText.includes("序列前的普通正文。" + unlistState.sample), "second Backspace should merge the unlisted paragraph into preceding prose");
    assert.strictEqual(afterSecondBackspace.plainSampleCount, 1, "unlisted prose should not retain a duplicate or hidden list boundary");

    const remainingListPageIndex = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("#pageTabs button"));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (Array.from(document.querySelectorAll("#stageScale .xhs-list-body")).some((node) => (node.textContent || "").includes("序列续写测试"))) return index;
      }
      return -1;
    });
    assert.ok(remainingListPageIndex >= 0, "expected remaining list item after unlisting the first item");
    await activateStudioPage(page, remainingListPageIndex);
    await page.waitForTimeout(100);
    const listBodyWithContent = page.locator("#stageScale .xhs-list-line .xhs-list-body").filter({ hasText: "序列续写测试" });
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
    assert.ok(listEnterState.currentBody.includes("序列续写测试"));
    assert.strictEqual(listEnterState.previousBody, "");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const emptyListExitState = await page.evaluate(() => ({
      listLineCount: document.querySelectorAll("#stageScale .xhs-list-line").length,
      manualBlankCount: document.querySelectorAll("#stageScale .xhs-manual-blank").length,
    }));
    assert.strictEqual(emptyListExitState.listLineCount, listLineCountBeforeEnter, "Enter on an empty list item should exit the list instead of creating another bullet");
    assert.ok(emptyListExitState.manualBlankCount >= 1, "exiting an empty list item should leave an editable plain paragraph");

    // A paragraph immediately after a card should merge into the card body at
    // its caret boundary. The browser must not object-select/delete the card.
    const cardPageForMerge = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pageTabs button'));
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index].click();
        if (document.querySelector('#stageScale .xhs-callout')) return index;
      }
      return -1;
    });
    assert.ok(cardPageForMerge >= 0, "expected a card for paragraph continuation regression");
    await activateStudioPage(page, cardPageForMerge);
    await page.waitForTimeout(100);
    const cardMergeSetup = await page.evaluate(() => {
      const card = document.querySelector('#stageScale .xhs-callout');
      const body = card?.querySelector('.xhs-callout-body');
      const paragraph = document.createElement('p');
      paragraph.className = 'xhs-p xhs-block';
      paragraph.dataset.cardMergeProbe = '1';
      paragraph.textContent = '并入卡片的正文';
      card.after(paragraph);
      body?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      paragraph.closest('[contenteditable="true"]')?.focus();
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { before: body?.textContent || '' };
    });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(700);
    const cardMergeState = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#stageScale .xhs-callout')).find((node) => (node.textContent || '').includes('并入卡片的正文'));
      return {
        cardText: card?.querySelector('.xhs-callout-body')?.textContent || '',
        probeCount: document.querySelectorAll('[data-card-merge-probe="1"]').length,
      };
    });
    assert.ok(cardMergeState.cardText.includes(cardMergeSetup.before + '并入卡片的正文'), "paragraph after a card should merge into the card body");
    assert.strictEqual(cardMergeState.probeCount, 0, "card continuation paragraph should be consumed instead of deleting the card");

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
      await activateStudioPage(page, index);
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
    assert.ok(
      beforeIndex >= 0 && afterIndex >= 0 && beforeIndex !== afterIndex,
      `Enter should split the paragraph across two flow blocks: ${JSON.stringify({ beforeCaret, afterCaret, beforeIndex, afterIndex, allParagraphTexts })}`,
    );

    assert.ok(!content.callouts.some((text) => text.includes("rabbitQ-skill-lark-xhs（GitHub）")));
    assert.ok(content.tables.length >= 1);
    assert.ok(content.tables.length >= 2, "long table should split across pages instead of clipping");
    assert.ok(content.tables.every((table) => JSON.stringify(table.headers) === JSON.stringify(["模式", "适合", "页数"])));
    assert.strictEqual(content.tables.reduce((total, table) => total + table.rows, 0), 21);
    assert.ok(content.tables.some((table) => table.text.includes("无封面图")));
    assert.ok(headingPageIndex >= 0);
    await activateStudioPage(page, headingPageIndex);
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
    await activateStudioPage(page, headingPageIndex);
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
      await activateStudioPage(page, index);
      await page.waitForTimeout(80);
      const calloutCount = await page.locator("#stageScale .xhs-callout").count();
      if (calloutCount >= 2) {
        multiCalloutPageIndex = index;
        break;
      }
    }
    assert.ok(multiCalloutPageIndex >= 0, "expected a page with at least two callouts after reflow");
    await activateStudioPage(page, multiCalloutPageIndex);
    const styleTestCallouts = page.locator("#stageScale .xhs-callout");
    const styleTestCalloutCount = await styleTestCallouts.count();
    assert.ok(styleTestCalloutCount >= 2);
    await styleTestCallouts.nth(0).click();
    await page.click('[data-card-style="frame"]');
    assert.strictEqual(await styleTestCallouts.nth(0).evaluate((node) => node.classList.contains("xhs-card-frame")), true);
    assert.strictEqual(await styleTestCallouts.nth(1).evaluate((node) => node.classList.contains("xhs-card-frame")), false);
    await activateStudioPage(page, 0);
    await activateStudioPage(page, multiCalloutPageIndex);
    const restoredStyleCallouts = page.locator("#stageScale .xhs-callout");
    assert.strictEqual(await restoredStyleCallouts.nth(0).evaluate((node) => node.classList.contains("xhs-card-frame")), true);
    assert.strictEqual(await restoredStyleCallouts.nth(1).evaluate((node) => node.classList.contains("xhs-card-frame")), false);

    assert.ok(calloutPageIndex >= 0 || pageCount > 0);
    for (let index = 0; index < pageCount; index += 1) {
      await activateStudioPage(page, index);
      await page.waitForTimeout(80);
      const hasTargetCallout = await page.locator("#stageScale .xhs-callout-body").filter({ hasText: "这是明确的卡片" }).count();
      if (hasTargetCallout > 0) {
        calloutPageIndex = index;
        break;
      }
    }
    assert.ok(calloutPageIndex >= 0, "expected a page with the target callout after reflow");
    await activateStudioPage(page, calloutPageIndex);
    const calloutCountBeforeToggle = await page.locator("#stageScale .xhs-callout").count();
    await page.locator("#stageScale .xhs-callout-body").filter({ hasText: "这是明确的卡片" }).first().click();
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
    await page.waitForTimeout(2200);
    const typedParagraphCount = await page.locator("#stageScale .xhs-p").filter({ hasText: "光标终点" }).count();
    const typedParagraphDebug = await page.evaluate(() => ({
      pageIndex,
      matchingPages: pages.map((savedPage, index) => ({
        index,
        hasText: String(savedPage.html || savedPage.tailHtml || '').includes('光标终点'),
      })).filter((item) => item.hasText),
      notice: document.querySelector('#runtimeNotice')?.textContent || '',
    }));
    assert.ok(typedParagraphCount >= 1, `typed paragraph should survive reflow: ${JSON.stringify(typedParagraphDebug)}`);
    assert.strictEqual(await page.locator('[data-xhs-caret-marker]').count(), 0);
    const restoredCaret = await page.evaluate(() => {
      const selection = window.getSelection();
      const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const paragraph = anchorElement?.closest?.('.xhs-p');
      return {
        focused: document.activeElement?.matches?.('.xhs-body-frame, .xhs-cover-tail-frame') || false,
        collapsed: Boolean(selection?.isCollapsed),
        insideStage: Boolean(selection?.anchorNode && stageScale.contains(selection.anchorNode)),
        atTypedEnd: Boolean(paragraph?.textContent?.endsWith('光标终点')),
      };
    });
    assert.deepStrictEqual(restoredCaret, {
      focused: true,
      collapsed: true,
      insideStage: true,
      atTypedEnd: true,
    }, 'reflow should keep focus and restore the caret to the end of the typed text');
    const anchorHeights = await page.locator("#stageScale .xhs-caret-anchor").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    assert.ok(anchorHeights.every((height) => height <= 1.1));

    // Regression: 一级标题 button toggles a numbered heading back to a paragraph.
    // Image double-click / Backspace deletion also live here, after page-index
    // dependent assertions, because these mutations can reflow content.
    assert.ok(headingPageIndex >= 0);
    await activateStudioPage(page, headingPageIndex);
    const level1Heading = page.locator('#stageScale .xhs-heading').filter({ hasText: "结构识别" }).first();
    const level1Gap = await level1Heading.evaluate((heading) => {
      const number = heading.querySelector('.xhs-heading-number')?.getBoundingClientRect();
      const title = heading.querySelector('.xhs-heading-title')?.getBoundingClientRect();
      return number && title ? title.left - number.right : -1;
    });
    assert.ok(level1Gap >= 6, `level-one number slot overlaps its title: ${level1Gap}`);
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
    const level2Debug = await page.evaluate(() => ({
      pageIndex,
      stageHasText: document.querySelector('#stageScale')?.innerText.includes('临时二级标题') || false,
      matchingPages: pages.map((savedPage, index) => ({
        index,
        hasText: String(savedPage.html || savedPage.tailHtml || '').includes('临时二级标题'),
        hasLevel2: String(savedPage.html || savedPage.tailHtml || '').includes('data-level="2"'),
      })).filter((item) => item.hasText),
    }));
    assert.strictEqual(level2Count, 1, `二级标题 button should create a level-2 heading: ${JSON.stringify(level2Debug)}`);
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
    assert.strictEqual(level2Style.fontSize, "36px");
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
      await activateStudioPage(page, index);
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

    await activateStudioPage(page, 0);
    const coverSubtitle = page.locator("#stageScale .cover-subtitle");
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
    await page.click('[data-paper-pattern="linen"]');
    assert.match(await page.locator('#stageScale .xhs-card').evaluate((card) => getComputedStyle(card).backgroundImage), /linear-gradient/);
    await page.click('[data-bg-theme="pink"]');
    assert.strictEqual(await page.locator('[data-bg-theme="pink"]').evaluate((button) => button.classList.contains('active')), true);

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

    await page.locator("#stageScale .cover-title").fill("已修改标题");
    await page.click('[data-bg-theme="blue"]');
    await page.locator("#bodyFontRange").evaluate((node) => {
      node.value = "46";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#resetBtn");
    await page.waitForTimeout(500);
    assert.strictEqual((await page.locator("#stageScale .cover-title").innerText()).trim(), "回归测试");
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
        await activateStudioPage(targetPage, index);
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
    await activateStudioPage(flowPage, flowSentencePageIndex);
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

    await activateStudioPage(flowPage, 0);
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
