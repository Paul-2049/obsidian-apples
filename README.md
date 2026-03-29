# Apples!

**Obsidian plugin for nutrition and calorie tracking.**

Keeps a daily food journal in your vault with automatic calorie and macro totals.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/paul2049)

---

## Features

- **Daily food log** — one `.md` file per day with meal sections (Breakfast / Snack / Lunch / Dinner)
- **Auto-calculated totals** — calories, protein, fat, carbs recalculated on every edit
- **Product cards** — simple `.md` files with frontmatter per 100 g; lookup by name or aliases
- **EN / RU** — full bilingual support (headers, labels, meal names)

---

## Installation

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/Paul-2049/obsidian-apples/releases/latest)
2. Copy them into `.obsidian/plugins/Apples!/` inside your vault
3. Enable the plugin in **Settings → Community plugins**

### Optional: snippet for table styling

Copy `styles.css` into `.obsidian/snippets/` and enable it in **Settings → Appearance → CSS snippets**.

---

## Setup

### Folders

| Setting | Default |
|---|---|
| Products folder | `Apples!/Products` |
| Journal folder | `Apples!/Journal` |

### Product card format

Create a file in your Products folder, e.g. `Apples!/Products/Apple.md`:

```yaml
---
aliases: [apple, яблоко]
calories: 52
protein: 0.3
fat: 0.2
carbs: 14
---
```

Values are **per 100 g**.

### Food entry format

Inside any meal section, add lines like:

```
- Apple 150
- Chicken breast 200
```

The plugin recalculates the Daily Total table automatically on save.

---

## Commands

| Command | Description |
|---|---|
| **Show Product Summary** | Recalculate and update the daily total table |
| **Create today's food log** | Create a new dated journal file |
| **New Product Card** | Open a modal to create a new product card |

---

## Settings

| Setting | Description |
|---|---|
| Products folder | Path to product cards (relative to vault root) |
| Journal folder | Path to daily log files |
| Language | `English` or `Русский` |
| OpenAI API key | Used for product name translation |

---

## Support

If this plugin saves you time, consider buying me a coffee:

[![Buy Me a Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/paul2049)

---

## License

MIT
