---
name: rabbitQ-skill-lark-xhs
description: 小兔Q彬 · 将飞书云文档导出的 Markdown、图片附件或完整 ZIP 包，独立解析为可编辑的小红书 3:4 图文 Studio。支持连续分页、封面开关、主题组合、引用/卡片/序列、图片裁剪与并排、草稿保存、一键复原及 PNG ZIP 批量导出。
version: 0.7.6
metadata:
  author: 小兔Q彬 / rabbitQ
  category: xiaohongshu
  platform: xiaohongshu
  input: lark-markdown-package
  requires:
    runtime: node
    npm: ["cheerio", "html2canvas", "jszip"]
  output: "{slug}-xhs/xhs-studio.html"
---

# rabbitQ-skill-lark-xhs · 飞书 Markdown 转小红书图文

将飞书云文档导出的 Markdown 与图片附件，直接生成本地可编辑的 `xhs-studio.html`，并批量导出标准 3:4 PNG。

## 定位与边界

- 这是一个**独立转换 Skill**，不依赖公众号 HTML Skill，也不需要先生成微信公众号 HTML。
- 输入是飞书导出的 Markdown 文件、包含 Markdown 与附件的目录，或完整 ZIP。
- 输出是本地 Studio 和 manifest，不会自动发布到小红书。
- 小红书图文只放图片。视频链接和视频附件必须移除，并向用户明确提示“视频未放入图文，需要另行上传或先截帧”。

## 触发条件

- 用户调用 `/rabbitQ-skill-lark-xhs`、`/rabbitq-xhs`、`/xhs-studio`。
- 用户提供飞书 Markdown、导出目录或 ZIP，要求生成小红书 3:4 图文、编辑 HTML 或 PNG 图组。
- 用户要求重新运行、修复或验证由本 Skill 生成的 `xhs-studio.html`。

## 输入契约

接受以下任一输入：

1. 单个 `.md` 文件。
2. 顶层包含一个 `.md` 文件和附件目录的飞书导出包。
3. 包含上述结构的 `.zip`。

典型目录：

```text
文章目录/
├── 文章.md
└── 图片和附件/
    ├── image.png
    └── image 1.png
```

规则：

- 目录输入优先读取顶层 Markdown；ZIP 会解压到临时目录后递归定位 Markdown。
- 图片路径可包含中文、空格和 URL 编码字符。
- 标题优先级：CLI `--title` > frontmatter `title` > 第一个 H1 > 文件名。
- 副标题优先级：CLI `--subtitle` > frontmatter `subtitle` > Studio 可编辑占位符。
- 所有输出画布必须接近 3:4，否则转换器应报错而不是静默拉伸。

## 执行流程

1. 完整读取本 `SKILL.md`。
2. 确认输入路径存在，并判断是 Markdown、目录还是 ZIP。
3. 若 `node_modules` 不存在，在 Skill 根目录运行 `npm ci`。
4. 调用 `scripts/convert.js` 生成 Studio。
5. 返回可点击的 `xhs-studio.html` 绝对路径。
6. 若有视频警告，必须在结果中说明视频已跳过。
7. 对真实页面进行视觉验证；不能只报告脚本退出码。

基本命令：

```bash
node "scripts/convert.js" article.md
node "scripts/convert.js" "/path/to/lark-export-package"
node "scripts/convert.js" article.md -o "/path/to/output-xhs"
```

完整参数：

```text
-o, --output-dir <dir>   输出目录，默认在源 Markdown 旁生成 <slug>-xhs
--title <text>           覆盖标题
--subtitle <text>        指定封面副标题
--keywords <a,b,c>       兼容保留的关键词元数据
--size <WxH>             3:4 画布，默认 1080x1440
--width <px>             画布宽度
--height <px>            画布高度
--help                   查看帮助
```

## Markdown 到 Studio 的映射

| 输入结构 | 输出结构 |
|---|---|
| H1 / frontmatter title | 封面主标题 |
| frontmatter subtitle | 封面副标题 |
| H2-H6 | 01 / 02 编号子标题 |
| 普通段落 | 可编辑、可按行跨页正文 |
| 整段加粗或明确卡片标签开头 | 卡片块 |
| `> 引用` / 飞书原生引用 | 斜体引用块 |
| `-` / `*` / `+` | 无序序列 |
| `1.` / `1)` / `1、` | 有序序列 |
| Markdown 图片 | 可编辑图片块 |
| 视频链接或附件 | 移除并记录警告 |

结构优先级必须高于关键词推断：引用里出现“金句”、列表里出现“卡片”时，仍保持引用和列表。

## 连续分页原则

- 所有正文先组成一个连续内容流，再按 3:4 画布实际高度分页。
- 普通正文可以按浏览器真实测量结果拆成多行并跨页。
- 子标题、引用、卡片、序列、图片和图片组默认作为完整块，不从中间截断。
- 封面关闭后，正文只按源顺序填入封面下半页。遇到第一个放不下的块后，后续块全部顺延到下一页。
- 图片和结构块后的光标锚点不得占用分页高度，但必须允许点击后继续输入。
- 连续竖图可自动组成双图或三图布局；用户拆分后应尊重用户设置。
- 编辑后需要重排时由 Studio 内部自动执行，不向用户暴露含义不清的“重新分页”按钮。

## Studio 能力

### 封面

- 默认上半页封面图、下半页标题和副标题。
- 标题按最多三行自动缩放。
- 副标题按中文字符权重最多 48 字、最多两行。
- 可关闭封面图；关闭后隐藏封面占位色设置。
- 封面图可点击替换、拖动裁剪和缩放。

### 文字与结构

- 加粗、编号子标题、引用块、有色字、下划线、卡片、序列。
- 样式按钮必须可切换；第二次点击应能取消对应行内样式。
- 卡片可切换竖边或细框，角标自动推断为“划重点 / 注意 / 金句 / 结论”。
- 引用只转换选中内容，不把整段误变成引用。

### 图片

- 替换、删除、裁剪填满、完整显示。
- 鼠标拖动裁剪中心、滚轮缩放。
- 拖动蓝色控制点改变图片框宽高。
- 块级上移、下移、与前图/后图并排、拆回上下排列。
- Delete / Backspace 可删除已选图片。

### 状态与输出

- localStorage 自动保存当前文章草稿，并使用源文件指纹避免旧草稿覆盖新源文件。
- “保存编辑 HTML”把当前状态嵌入新 HTML，重新打开仍保持编辑结果。
- “一键复原”确认后清除当前文章草稿并恢复初始内容、图片、主题和布局。
- PNG ZIP 导出必须与预览一致，每页尺寸相同，默认 1080 × 1440。

## 输出结构

```text
<slug>-xhs/
├── xhs-studio.html
└── manifest.json
```

`manifest.json` 至少包含生成器、版本、标题、画布尺寸、布局参数、源文件路径、媒体警告和验证状态。

## 必做验证

代码或生成逻辑有改动时：

```bash
npm test
node --check scripts/convert.js
```

真实文章验收必须检查：

1. 打开实际生成的 `xhs-studio.html`，不是只检查源码。
2. 逐页确认没有文字、图片和子标题溢出边界。
3. 飞书引用显示为引用块，不被关键词误判为卡片。
4. 封面关闭再打开后，页数和内容顺序稳定。
5. 图片、卡片后能点击插入光标，且光标锚点不制造额外空行。
6. 一键复原能恢复标题、正文、图片、主题、字号和边距。
7. 实际导出 PNG ZIP，检查文件数量和每张尺寸。
8. 至少抽查封面、引用页、图片页，确认导出与预览一致。

## 故障处理

- **找不到 Markdown**：要求用户提供完整导出包，或确认目录顶层存在 `.md`。
- **图片空白**：检查 Markdown 相对路径、URL 解码和附件是否仍在原目录。
- **视频未出现**：这是预期行为；向用户说明图文只放图片。
- **旧编辑状态覆盖新内容**：检查 `sourceFingerprint`，必要时使用“一键复原”。
- **页面溢出**：先检查结构块是否被误包进普通段落，再检查图片框高度和分页测量。
- **预览与导出不一致**：对比真实 PNG，检查 `html2canvas` 导出副本中的图片 transform、主题变量和下划线稳定化。

## 不在范围内

- 不负责把图文发布到小红书账号。
- 不负责视频转 GIF、视频上传或视频笔记发布。
- 不负责把飞书在线文档直接下载为 Markdown；本 Skill 从已导出的本地包开始。
- 不承诺所有浏览器渲染一致；开发与验收优先使用当前版 Chrome / Chromium。
