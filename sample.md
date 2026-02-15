---
title: Marksense Sample
author: Your Name
tags: [markdown, editor, demo]
---

# Welcome to Marksense

Marksense is a Notion-like rich-text editor for Markdown files, built with Tiptap. Open this file to explore what's possible.

## Rich Text Formatting

**Bold**, *italic*, ~~strikethrough~~, and `inline code` all work as expected. You can also combine them: ***bold italic***, ~~**bold strikethrough**~~.

==Highlighted text== stands out for emphasis.

[Links](https://github.com) are clickable, and smart typography turns quotes into "curly quotes" and dashes into — em dashes automatically.

## Lists

### Unordered

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

### Ordered

1. Step one
2. Step two
3. Step three

### Task List

Tasks support nesting — check them off as you go:

- [ ] Type `/` to open the slash command menu
- [ ] Select text to reveal the floating toolbar
- [ ] Try drag-and-drop to reorder blocks
- [ ] Upload an image via drag-and-drop or the slash menu
- [x] Open this file in Marksense

## Blockquote

> The best way to predict the future is to invent it.
> — Alan Kay

## Code Block

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}

console.log(greet("Marksense"));
```

## Table

Tables are fully resizable — drag column borders to adjust widths.

| Feature            | Status |
| ------------------ | ------ |
| Rich text editing  | Done   |
| Markdown sync      | Done   |
| Image upload       | Done   |
| Table of Contents  | Done   |
| Frontmatter panel  | Done   |
| Diff view          | Done   |
| Math (LaTeX)       | Done   |
| Typewise AI        | Opt-in |

## Mathematics

Inline math: $E = mc^2$

Block math:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## Images

Drag and drop an image onto the editor, or type `/image` to upload one. Images are saved next to your Markdown file in an `images/` folder.

![Marksense](icon.png)

![Marksense editor screenshot](screenshot.png)

## Emoji

Type `:` followed by a name to insert emoji inline — for example `:rocket:` or `:wave:`.

---

## Editor Features

Here are a few things to try beyond basic formatting:

- **Slash commands** — Type `/` at the start of a line to insert headings, lists, code blocks, tables, images, and more.
- **Floating toolbar** — Select any text to access formatting options.
- **Table of Contents** — Insert one via the slash menu; it updates as you edit.
- **Frontmatter panel** — This file's YAML frontmatter appears as editable fields above the editor.
- **Diff view** — Toggle it from the header to see your uncommitted changes highlighted inline.
- **Raw mode** — Switch to a plain textarea to edit the raw Markdown directly.
- **Keyboard shortcuts** — `Ctrl+Z` / `Ctrl+Shift+Z` for undo/redo, `Ctrl+B` for bold, `Ctrl+I` for italic, and more.

---

*Edit this file freely — it's yours to experiment with.*
