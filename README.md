# rabbitQ-skill-lark-xhs

**小兔Q彬 · 把飞书 Markdown 变成可继续编辑的小红书 3:4 图文。**

输入飞书云文档链接、Markdown、图片附件或导出 ZIP，得到一个本地可编辑的 `xhs-studio.html`。先在浏览器里调文字、图片和分页；确认后再按需导出 1080 × 1440 PNG ZIP。

![rabbitQ 飞书 Markdown 转小红书 3:4 图文工作流](assets/rabbitq-xhs-workflow.svg)

## 它解决什么

飞书适合写长文，小红书需要逐页图文。这个项目把中间最耗时的「整理内容 → 做版式 → 逐页出图」变成一个可编辑的本地工作台：

```text
飞书文档 / Markdown + 图片
→ 转成连续的 3:4 图文页面
→ 在本地 Studio 继续调整
→ 需要时导出 PNG ZIP
```

内容、图片和草稿都在本机处理；不会自动上传或发布到小红书。

## 你会得到什么

- **直接可编辑**：不是一次性图片。文字、列表、引用、卡片、代码块、表格和图片都能继续改。
- **飞书可直达**：可直接给 `/wiki/` 或 `/docx/` 链接，脚本会通过 `lark-cli` 导出为标准 Markdown 包。
- **AI 两遍整理**：先照实保留 Markdown 样式，再逐段逐句检查标题、卡片、引用、列表、代码块和行内强调是否匹配；只在合适时应用，不按数量硬塞样式。
- **适合长文**：正文会连续分页；标题、图片和短表格保持完整，列表等内容可自然续到下一页。
- **封面不绑死**：全封面、半封面、无封面可以切换，也支持嵌入你已有的封面图；无封面正文从 662px 开始，标题区更紧凑。
- **按最终版导出**：确认预览后再导 PNG ZIP，避免反复改图、重新排版。

## 快速开始

```bash
git clone https://github.com/rabbit-Qbin/rabbitQ-skill-lark-xhs.git
cd rabbitQ-skill-lark-xhs
npm ci

# 从 Markdown、文章目录或 ZIP 生成 Studio
node scripts/convert.js "/path/to/article"
```

直接从飞书云文档开始：

```bash
node scripts/lark-export.js "https://xxx.feishu.cn/wiki/文档token" -o "/path/to/article"
node scripts/convert.js "/path/to/article"
```

打开输出目录的 `xhs-studio.html` 即可编辑。默认不会导出图片；需要成图时，在 Studio 中点击“批量导出 PNG ZIP”。

## 常用场景

| 你手里有什么 | 怎么开始 |
| --- | --- |
| 飞书文档链接 | 运行 `lark-export.js`，再运行 `convert.js` |
| 本地 Markdown 和配图 | 把 Markdown 文件或所在目录交给 `convert.js` |
| 飞书导出的 ZIP | 直接把 ZIP 交给 `convert.js` |
| 已做好封面 | 加 `--cover-mode full --cover-image "/path/to/cover.png"` |

封面字段也可以写进原稿：

```yaml
---
title: 飞书云文档转 3:4 图文
subtitle: 写完直接转，还能继续编辑
---
```

## 作为 Agent Skill 使用

将仓库目录安装到 Agent 的 `skills` 目录，并保持名称为 `rabbitQ-skill-lark-xhs`。当用户给出飞书链接、Markdown、导出目录或 ZIP，并要求生成/修复/验证小红书图文时即可调用。

具体的输入约定、自动样式判断、封面决策、编辑规则与验收流程都在 [SKILL.md](SKILL.md) 中，避免 README 变成一份面向 Agent 的行为规范。

## 项目文档

- [输入与 Markdown 约定](references/markdown-patterns.md)
- [Studio 编辑说明](docs/xhs-tool-intro.md)
- [版式与分页约定](references/layout-spec.md)

## 边界

- 不自动发布到小红书。
- 视频不会进入图文；需要另行上传或先截帧。
- 导出效果以当前 Chrome / Chromium 预览为准。

## 开发验证

```bash
npm test
node --check scripts/convert.js
```

## 作者

小兔Q彬 / [rabbitQ](https://github.com/rabbit-Qbin)
