# Embed Widget

Embed a shared portfolio on any site with an iframe:

```html
<iframe
  src="https://<your-host>/embed/portfolio/<share-id>?size=medium&theme=dark"
  width="400"
  height="300"
  style="border: 0"
></iframe>
```

## Query parameters

| Parameter | Allowed values | Default | Description |
|---|---|---|---|
| `size` | `small`, `medium`, `large` | `medium` | Controls text, chart, and legend sizing. |
| `theme` | `light`, `dark` | see below | Controls widget colors. |

Values are case-insensitive. Missing or invalid values fall back to the defaults and never break rendering.

## Theme resolution

When `theme` is missing or invalid, the widget uses, in order:

1. The theme the viewer last chose with the in-widget toggle (saved in `localStorage` under `embedWidgetTheme`).
2. The viewer's system preference (`prefers-color-scheme`).

A valid `theme` query parameter always takes precedence.
