# Markdown Patterns For rabbitQ-skill-lark-xhs

这份约定用于 `rabbitQ-skill-lark-xhs`。目标是把飞书云文档导出的 Markdown 稿件（含附件图片）拆成小红书 3:4 图文笔记，并生成可编辑的本地 Studio。

## Recommended Shape

```markdown
---
title: "AI 视频一眼假怎么破？"
subtitle: "这次不是讲概念，是一次真实踩坑复盘。"
topic: "AI 视频 / Seedance / 实战"
author: "小兔Q彬"
tags: "AI视频,Seedance,Prompt"
---

# AI 视频一眼假怎么破？

这次的核心结论是：不是模型不行，而是 **提示词太完美**。

## 1. 问题长什么样

- 皮肤过于平滑
- 动作太稳定
- 表情没有真实人的小瑕疵

## 2. 我怎么改

把「完美真人」改成「有轻微瑕疵的真实拍摄」。

<!-- xhs-page -->

## 3. 最后记住这句话

小红书不是论文，用户先看懂、愿意停下来，才有后面的转化。
```

## Output

```text
article-xhs/
├── xhs-studio.html
└── manifest.json
```
