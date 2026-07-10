---
name: rabbitQ-skill-lark-xhs
description: 小兔Q彬 · 飞书云文档导出的 Markdown 与全部附件，自动转成可编辑的小红书 3:4 图文 Studio。图纸/背景/强调色自由组合；封面可开关；卡片角标自动推断；序列与引用块；Alt 拖动重排；PNG ZIP 批量导出。
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

> 小兔Q彬 · 飞书云文档 Markdown + 附件 → 可编辑小红书 3:4 图文 Studio

## 触发条件

- 用户调用 `/rabbitQ-skill-lark-xhs`、`/rabbitq-xhs`、`/xhs-studio`
- 用户提供飞书云文档导出的 Markdown 文件或完整导出包（含图片附件），要求生成小红书图文

## 核心能力

- 解析飞书导出的 Markdown 包（正文 + 全部附件图片）
- 输出本地可编辑 `xhs-studio.html`
- **样式组合**：图纸、背景色、强调色、封面占位色可单独切换
- **封面**：标题区自动缩放；可关闭封面图（标题上移占上半页，下半页接续正文）
- **卡片**：选中卡片后出现「竖边 / 细框」；角标由内容自动推断（划重点 / 注意 / 金句 / 结论，≤3 字）
- **序列**：Markdown `-` / `1.` 自动识别；工具栏「序列」支持多段/多行各变一条
- **块拖动**：按住 Alt 拖动可上下移动卡片、引用块、序列、图片等
- **引用块**：选中部分文字只转换选中内容，不会整段误变
- **飞书引用识别**：飞书原生引用与 Markdown `>` 会保留为引用块，不会因正文包含“金句”等词误判成卡片
- **封面设置联动**：关闭封面图后隐藏封面占位色，仅在显示封面图时提供该设置
- **副标题**：最多 48 字、两行显示
- **草稿**：localStorage 草稿带源文件指纹，重新生成后不会覆盖新内容
- **一键复原**：确认后清除当前文章的本地编辑草稿，恢复生成时的初始内容、图片、主题与布局

## CLI 用法

```bash
node "scripts/convert.js" article.md
node "scripts/convert.js" "/path/to/lark-export-package"
node "scripts/convert.js" article.md -o "/path/to/output-xhs"
```

## 输出结构

```text
article-xhs/
├── xhs-studio.html
└── manifest.json
```
