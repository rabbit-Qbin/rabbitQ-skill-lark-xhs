# Xiaohongshu Layout Spec

## Canvas

Default canvas:

- `width`: 1080
- `height`: 1440
- `ratio`: 3:4

Supported alternatives:

- `900x1200`
- `1080x1440`
- `1242x1656`
- `1242x1660`

Use one size for every page in the same note.

## Element Types

### text

```json
{
  "type": "text",
  "text": "标题",
  "x": 72,
  "y": 220,
  "w": 920,
  "h": 240,
  "fontSize": 72,
  "lineHeight": 1.1,
  "weight": 900,
  "align": "left",
  "color": "#171717"
}
```

### image

```json
{
  "type": "image",
  "src": "data:image/png;base64,...",
  "x": 72,
  "y": 600,
  "w": 936,
  "h": 520,
  "fit": "cover",
  "radius": 36
}
```

### rect

```json
{
  "type": "rect",
  "x": 48,
  "y": 48,
  "w": 984,
  "h": 1344,
  "bg": "#ffffff",
  "radius": 56
}
```

## Editor Controls

`xhs-editor.html` edits the same JSON model. It intentionally keeps all layout values in pixels so adjustments are predictable before PNG export.

Recommended adjustments:

- move cramped text with `y`
- make a long line fit with `fontSize` or manual line breaks
- tune paragraph density with `lineHeight`
- keep key text inside the safe area: left/right 72 px, top 80 px, bottom 96 px
