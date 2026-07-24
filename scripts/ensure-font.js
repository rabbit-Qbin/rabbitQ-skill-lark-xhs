#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const FONT_FAMILY = "Noto Serif SC";
const HOMEBREW_CASK = "font-noto-serif-sc";
const checkOnly = process.argv.includes("--check");

function commandExists(command) {
  const result = childProcess.spawnSync("/usr/bin/env", ["sh", "-lc", `command -v ${command}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function fontFilesExist() {
  const dirs = [
    path.join(os.homedir(), "Library", "Fonts"),
    "/Library/Fonts",
    "/System/Library/Fonts",
  ];
  return dirs.some((dir) => {
    try {
      return fs.readdirSync(dir).some((name) => /^NotoSerifSC.*\.(?:otf|ttf|ttc)$/i.test(name));
    } catch {
      return false;
    }
  });
}

function fontconfigHasFamily() {
  if (!commandExists("fc-list")) return false;
  try {
    const families = childProcess.execFileSync("fc-list", ["-f", "%{family}\n"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return families.split(/\r?\n/).some((line) =>
      line.split(",").some((family) => family.trim() === FONT_FAMILY)
    );
  } catch {
    return false;
  }
}

function hasFont() {
  return fontFilesExist() || fontconfigHasFamily();
}

function installOnMac() {
  if (!commandExists("brew")) {
    console.error(`缺少 ${FONT_FAMILY}，且未找到 Homebrew。请先安装 Homebrew，再运行：`);
    console.error(`brew install --cask ${HOMEBREW_CASK}`);
    process.exit(1);
  }
  console.log(`未检测到 ${FONT_FAMILY}，正在通过 Homebrew 安装…`);
  const result = childProcess.spawnSync("brew", ["install", "--cask", HOMEBREW_CASK], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
  if (commandExists("fc-cache")) {
    childProcess.spawnSync("fc-cache", ["-f"], { stdio: "ignore" });
  }
}

if (hasFont()) {
  console.log(`${FONT_FAMILY} 已安装。`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`${FONT_FAMILY} 未安装。`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  console.error(`缺少 ${FONT_FAMILY}。当前自动安装仅支持 macOS + Homebrew，请先安装该字体后再转换。`);
  process.exit(1);
}

installOnMac();

if (!hasFont()) {
  console.error(`${FONT_FAMILY} 安装完成，但系统尚未识别。请重新登录或重启浏览器后再试。`);
  process.exit(1);
}

console.log(`${FONT_FAMILY} 安装并验证成功。`);
