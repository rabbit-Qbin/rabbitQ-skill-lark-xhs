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
    "**项目**：rabbitQ-skill-lark-xhs（GitHub）",
  ].join("\n");
  fs.writeFileSync(path.join(sourceDir, "article.md"), markdown, "utf8");

  const convert = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "convert.js"), sourceDir, "-o", outputDir],
    { encoding: "utf8" },
  );
  assert.strictEqual(convert.status, 0, convert.stderr || convert.stdout);

  const htmlPath = path.join(outputDir, "xhs-studio.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /data-xhs-block-type="quote"/);
  assert.doesNotMatch(html, /&lt;br&gt;/);

  const executablePath = findBrowser();
  assert.ok(executablePath, "No Chromium browser found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE");
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(500);

    async function collectFlowOrder() {
      const count = await page.locator("#pageTabs button").count();
      const order = [];
      for (let index = 1; index < count; index += 1) {
        await page.locator("#pageTabs button").nth(index).click();
        await page.waitForTimeout(50);
        const blocks = await page.locator("#stageScale .xhs-body-frame > :not(.xhs-caret-anchor)").evaluateAll((nodes) => nodes.map((node) => ({
          className: node.className,
          text: node.textContent.replace(/\s+/g, " ").trim(),
          imageCount: node.querySelectorAll("img").length,
        })));
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
    assert.ok(await page.locator("#stageScale .xhs-cover-tail-frame").count());
    assert.ok(await page.locator("#stageScale .xhs-cover-tail-frame").evaluate((node) => node.children.length >= 2));
    await page.click("#coverImageOnBtn");
    await page.waitForTimeout(500);
    const flowOrderAfterCoverToggle = await collectFlowOrder();
    assert.deepStrictEqual(flowOrderAfterCoverToggle, flowOrderBeforeCoverToggle);

    const pageCount = await page.locator("#pageTabs button").count();
    const content = { quotes: [], callouts: [], lists: [] };
    for (let index = 0; index < pageCount; index += 1) {
      await page.locator("#pageTabs button").nth(index).click();
      await page.waitForTimeout(80);
      const pageContent = await page.evaluate(() => ({
        quotes: Array.from(document.querySelectorAll("#stageScale .xhs-quote")).map((node) => node.textContent.trim()),
        callouts: Array.from(document.querySelectorAll("#stageScale .xhs-callout-body")).map((node) => node.textContent.trim()),
        lists: Array.from(document.querySelectorAll("#stageScale .xhs-reason-text")).map((node) => node.textContent.trim()),
      }));
      content.quotes.push(...pageContent.quotes);
      content.callouts.push(...pageContent.callouts);
      content.lists.push(...pageContent.lists);
    }

    assert.ok(content.quotes.some((text) => text.includes("仍然应该是引用")));
    assert.ok(content.callouts.some((text) => text.includes("这是明确的卡片")));
    assert.ok(content.lists.some((text) => text.includes("Alt + 拖动")));
    assert.ok(!content.callouts.some((text) => text.includes("Alt + 拖动")));
    assert.ok(!content.callouts.some((text) => text.includes("rabbitQ-skill-lark-xhs（GitHub）")));
    const anchorHeights = await page.locator("#stageScale .xhs-caret-anchor").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    assert.ok(anchorHeights.every((height) => height <= 1.1));

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
    assert.strictEqual(await page.locator('[data-bg-theme="paper"]').evaluate((node) => node.classList.contains("active")), true);
    assert.strictEqual(await page.locator("#coverImageOnBtn").evaluate((node) => node.classList.contains("active")), true);
    assert.strictEqual(await page.locator("#bodyFontRange").inputValue(), "36");
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
