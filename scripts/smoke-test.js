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
    "**注意：这是注意卡片需要保留的正文，开头标签不应该重复显示。**",
    "",
    "**结论：这是结论卡片需要保留的正文，开头标签不应该重复显示。**",
    "",
    "**划重点：这是重点卡片需要保留的正文，开头标签不应该重复显示。**",
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
    const content = { quotes: [], callouts: [], labels: [], lists: [] };
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
        lists: Array.from(document.querySelectorAll("#stageScale .xhs-reason-text")).map((node) => node.textContent.trim()),
      }));
      if (calloutPageIndex < 0 && pageContent.callouts.length) calloutPageIndex = index;
      if (multiCalloutPageIndex < 0 && pageContent.callouts.length >= 2) multiCalloutPageIndex = index;
      if (headingPageIndex < 0 && pageContent.headingCount) headingPageIndex = index;
      content.quotes.push(...pageContent.quotes);
      content.callouts.push(...pageContent.callouts);
      content.labels.push(...pageContent.labels);
      content.lists.push(...pageContent.lists);
    }

    assert.ok(content.quotes.some((text) => text.includes("仍然应该是引用")));
    assert.ok(content.callouts.some((text) => text.includes("这是明确的卡片")));
    assert.ok(!content.callouts.some((text) => /^\s*(?:金句|注意|结论|划重点)\s*[：:]/.test(text)));
    assert.ok(["金句", "注意", "结论", "划重点"].every((label) => content.labels.includes(label)));
    assert.ok(content.lists.some((text) => text.includes("Alt + 拖动")));
    assert.ok(!content.callouts.some((text) => text.includes("Alt + 拖动")));
    assert.ok(!content.callouts.some((text) => text.includes("rabbitQ-skill-lark-xhs（GitHub）")));
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
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
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

    assert.ok(multiCalloutPageIndex >= 0);
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

    assert.ok(calloutPageIndex >= 0);
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
    const caretState = await page.evaluate(() => {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const block = element?.closest?.('.xhs-p, .xhs-rich, .xhs-callout-body');
      return {
        blockText: block?.textContent || '',
        markerCount: document.querySelectorAll('[data-xhs-caret-marker]').length,
      };
    });
    assert.ok(caretState.blockText.includes("光标终点"), `caret moved away from typed text: ${JSON.stringify(caretState)}`);
    assert.strictEqual(caretState.markerCount, 0);
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
    assert.strictEqual(await page.locator('[data-bg-theme="paper"]').evaluate((node) => node.classList.contains("active")), true);
    assert.strictEqual(await page.locator('[data-paper-pattern="none"]').evaluate((node) => node.classList.contains("active")), true);
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
