# rabbitQ-skill-lark-xhs

**小兔Q彬 · 飞书 Markdown 转小红书图文**

把飞书云文档导出的 Markdown 与全部附件，自动转成可编辑的小红书 3:4 图文 Studio，支持分页编辑、样式组合与 PNG ZIP 批量导出。

## 功能

- 飞书导出包解析（Markdown + 图片附件）
- 3:4 固定版心自动分页
- 本地可编辑 Studio（封面、卡片、序列、引用块、图片等）
- 图纸 / 背景 / 强调色自由组合
- 批量导出 PNG ZIP

## 快速开始

```bash
npm install
node scripts/convert.js path/to/article.md
```

浏览器打开输出目录中的 `xhs-studio.html` 即可编辑与导出。

## 输出

```text
article-xhs/
├── xhs-studio.html
└── manifest.json
```

## 作者

小兔Q彬 / [rabbitQ](https://github.com/rabbit-Qbin)
