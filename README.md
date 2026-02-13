# Marksense

A VS Code / Cursor extension that lets you view and edit Markdown files in a rich, Notion-like editor powered by [Tiptap](https://tiptap.dev).

## Features

- **Notion-like editing** — full block-based editor with slash commands, drag & drop, floating toolbars, and rich formatting
- **Markdown round-trip** — opens `.md` / `.mdx` files, edits in rich text, saves back as clean Markdown
- **Instant auto-save** — every edit syncs to the file automatically (configurable debounce)
- **Inline predictions** — sentence completion powered by [Typewise](https://www.typewise.ai) (requires API token)
- **Spellcheck & grammar** — autocorrect and grammar correction powered by [Typewise](https://www.typewise.ai)
- **Dark / light mode** — follows your VS Code theme
- **Emoji, mentions, tables, task lists, code blocks, math, and more**

## Installation

### From `.vsix` file

1. Download the latest `marksense-x.x.x.vsix` from the [Releases](https://github.com/janisberneker/marksense/releases) page
2. In VS Code / Cursor, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run **Extensions: Install from VSIX…** and select the downloaded file

### From source

```bash
git clone https://github.com/janisberneker/marksense.git
cd marksense
npm install
npm run build
```

Then press **F5** to launch the Extension Development Host.

## Usage

Open any `.md` or `.mdx` file, then right-click the editor tab and choose **Reopen Editor With… > Marksense Editor**.

### Making Marksense the default editor

#### For a single file

Right-click the editor tab → **Reopen Editor With…** → **Marksense Editor** → click **Configure default editor for '*.md'…** at the bottom of the picker and select **Marksense Editor**. This writes the preference to your workspace settings.

#### For a project

Add to `.vscode/settings.json` in your project:

```json
{
  "workbench.editorAssociations": {
    "*.md": "marksense.editor"
  }
}
```

#### Globally (all projects)

Open your **User** settings (`Ctrl+Shift+P` / `Cmd+Shift+P` → **Preferences: Open User Settings (JSON)**) and add:

```json
{
  "workbench.editorAssociations": {
    "*.md": "marksense.editor"
  }
}
```

> To revert back to the built-in text editor, change the value to `"default"` or remove the entry.

## Configuration

| Setting                   | Default | Description                              |
| ------------------------- | ------- | ---------------------------------------- |
| `marksense.autoSaveDelay` | `300`   | Debounce delay (ms) before syncing edits |

### Typewise AI setup (optional)

Marksense can use [Typewise](https://www.typewise.ai) for autocorrect, grammar correction, and sentence completion. To enable it, add your API token to a `.env` file in the project root (or in the extension directory):

```
TYPEWISE_TOKEN=your-typewise-api-token
```

## Packaging

To build a shareable `.vsix` package:

```bash
npm run package
```

This produces `marksense-0.1.0.vsix` which you can share and install via **Extensions: Install from VSIX…**.

## Development

Watch mode rebuilds on file changes:

```bash
npm run watch
```

## How it works

The extension uses VS Code's `CustomEditorProvider` API:

1. When you open a `.md` file with Marksense, the extension reads the file content
2. The Markdown is parsed into the Tiptap editor using `@tiptap/markdown`
3. As you edit, changes are serialized back to Markdown and written to the document
4. VS Code's built-in auto-save writes the file to disk

This gives you native undo/redo, hot exit, and file save integration for free.

## License

MIT
