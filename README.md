# rabbitQ-skill-lark-xhs

**小兔Q彬 · 飞书 Markdown 转可编辑小红书 3:4 图文 Studio**

把飞书云文档导出的 Markdown 和图片附件，直接转换成一个本地可编辑的 `xhs-studio.html`。在浏览器里修改文字、封面、图片和样式，最后批量导出 1080 × 1440 PNG ZIP。

![飞书 Markdown 转小红书图文工作流](assets/rabbitq-xhs-workflow.svg)

## 为什么做这个 Skill

飞书适合写长文，小红书适合用图片阅读。真正耗时的是把文章拆页、保留层级、安排图片，再逐张调整。

这个 Skill 把中间过程变成一个连续工作流：

1. 飞书导出 Markdown 与附件。
2. 独立解析标题、正文、引用、列表和图片。
3. 按 3:4 页面连续分页。
4. 在本地 Studio 中继续编辑。
5. 保存编辑后的 HTML，或导出全部 PNG。

它是独立 Skill，不依赖公众号 HTML Skill，也不需要先生成微信公众号 HTML。

## 核心能力

- **飞书导出包解析**：支持 `.md`、包含 Markdown 与附件的目录、飞书导出 ZIP。
- **结构化转换**：识别 H1/H2、普通正文、加粗、引用、无序列表、有序列表和本地图片。
- **连续分页**：正文可按行跨页；子标题、引用、卡片、列表和图片保持完整块。
- **封面两种模式**：上图下文，或关闭封面图后用上半页标题、下半页接续正文。
- **可编辑 Studio**：修改文字、加粗、有色字、下划线、卡片、引用和序列。
- **图片编辑**：替换、删除、拖动裁剪、滚轮缩放、拖拽尺寸、上下移动和左右并排。
- **主题组合**：图纸纹理、背景主题、强调色和封面占位色可组合。
- **本地草稿**：编辑自动保存在浏览器；“保存编辑 HTML”可把状态写回独立文件。
- **一键复原**：确认后清除当前文章草稿，恢复生成时的内容、图片、主题和布局。
- **批量导出**：一次导出全部 3:4 PNG，并打包为 ZIP。

## 快速开始

### 1. 安装

```bash
git clone https://github.com/rabbit-Qbin/rabbitQ-skill-lark-xhs.git
cd rabbitQ-skill-lark-xhs
npm ci
```

作为 Codex Skill 安装时，将仓库放到：

```text
~/.codex/skills/rabbitQ-skill-lark-xhs/
```

### 2. 准备飞书导出包

```text
文章目录/
├── 文章.md
└── 图片和附件/
    ├── image.png
    └── image 1.png
```

Markdown 文件里的图片路径应指向附件目录。路径中包含空格或中文没有关系。

### 3. 生成 Studio

```bash
node scripts/convert.js "/path/to/文章目录"
```

也可以直接传 Markdown 或 ZIP：

```bash
node scripts/convert.js article.md
node scripts/convert.js lark-export.zip
node scripts/convert.js article.md -o "/path/to/output-xhs"
```

### 4. 编辑与导出

打开输出目录中的 `xhs-studio.html`。它可以直接通过 `file://` 运行，不需要启动本地服务器。

## 输入映射

| Markdown / 飞书结构 | Studio 结果 |
|---|---|
| `# 标题` 或 frontmatter `title` | 封面主标题 |
| frontmatter `subtitle` | 封面副标题 |
| `## 01 小节` | 01 / 02 编号子标题 |
| 普通段落 | 可跨页正文 |
| 整段加粗或明确的“金句/结论/注意” | 卡片块 |
| `> 引用` | 斜体引用块 |
| `- 项目` / `1. 项目` | 无序 / 有序序列 |
| `![说明](图片路径)` | 可编辑图片块 |
| 视频链接或视频附件 | 跳过，并在 Studio 顶部提示 |

转换器会优先尊重 Markdown 的结构，不会因为引用里出现“金句”、列表里出现“卡片”等词就误判类型。

## Studio 操作

### 文字

- `B 加粗`：切换选中文字的粗体。
- `子标题`：把当前段落转成编号标题。
- `引用块`：只转换选中的文字。
- `有色字` / `下划线`：使用当前强调色。
- `卡片`：生成“划重点 / 注意 / 金句 / 结论”卡片。
- `序列`：把多段或多行转换为列表。

### 图片

- 点击图片后可替换或删除。
- 拖动图片调整裁剪中心，滚轮控制缩放。
- 蓝色边框控制图片框宽度和高度。
- 支持块级上移、下移、与前后图片并排、拆成上下排列。
- 连续竖图会在初次转换和重新布局时自动并排。

### 保存、复原和导出

- 浏览器会自动保存当前文章草稿。
- `保存编辑 HTML` 会下载包含当前编辑状态的新 HTML。
- `一键复原` 会清除当前文章的本地修改并恢复初始状态。
- `批量导出 PNG ZIP` 会按当前预览导出所有页面。

## 分页原则

- 画布默认是 `1080 × 1440`，比例固定为 `3:4`。
- 内容按一个连续长文流排列，再切成多页。
- 普通正文可按行拆分，避免整段被推到下一页。
- 子标题、引用、卡片、列表和图片默认不从中间截断。
- 关闭封面图时，正文只会按原顺序填入封面下半页，不会跳过放不下的块。
- 图片和卡片后的光标锚点不占版面高度，但仍可点击插入文字。

## 命令参数

```text
-o, --output-dir <dir>   指定输出目录
--title <text>           覆盖封面标题
--subtitle <text>        指定封面副标题
--size <WxH>             指定 3:4 画布，默认 1080x1440
--width <px>             指定宽度
--height <px>            指定高度
--help                   查看帮助
```

## 输出

```text
文章-xhs/
├── xhs-studio.html
└── manifest.json
```

PNG 导出文件名为 `01.png`、`02.png`……，所有页面尺寸一致。

## 隐私与限制

- Markdown、图片、编辑草稿和导出过程都在本机完成。
- Studio 不会自动上传内容到小红书。
- 小红书图文只使用图片；视频会被跳过并提示用户另行上传或先截帧。
- 副标题最多按 48 个中文字符权重处理，最多显示两行。
- “一键复原”会删除当前文章的本地编辑草稿，操作前会确认。

## 开发与验证

```bash
npm ci
npm test
node --check scripts/convert.js
```

发布前应再用真实飞书导出包验证：引用识别、封面开关、页面溢出、图片编辑，以及 PNG ZIP 与预览的一致性。

更详细的编辑说明见 [docs/xhs-tool-intro.md](docs/xhs-tool-intro.md)，输入约定见 [references/markdown-patterns.md](references/markdown-patterns.md)，布局约定见 [references/layout-spec.md](references/layout-spec.md)。

## 作者

小兔Q彬 / [rabbitQ](https://github.com/rabbit-Qbin)
