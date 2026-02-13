/**
 * Frontmatter parsing / serialisation and MDX JSX-tag splitting.
 *
 * Frontmatter is the YAML block between two `---` lines at the very top of a
 * markdown / MDX file.  We separate it from the body so TipTap never sees it
 * and we can render a dedicated UI for it.
 *
 * JSX tags (lines starting with an uppercase component name, e.g. `<Steps>`,
 * `</Step>`) are replaced with HTML `<div>` markers that TipTap's custom
 * MdxTag atom node can parse and render as non-editable chips.  The markdown
 * content *between* JSX tags passes through untouched so TipTap renders it
 * as normal editable content.
 */

// ─── Frontmatter ────────────────────────────────────────────────────────────

export interface FrontmatterEntry {
  key: string
  value: string
}

export interface ParsedContent {
  /** null when the file has no frontmatter block */
  frontmatter: FrontmatterEntry[] | null
  /** The raw YAML text between the `---` delimiters (preserves original formatting) */
  rawFrontmatter: string | null
  /** Everything after the closing `---` */
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Split raw file content into frontmatter + body.
 */
export function parseFrontmatter(raw: string): ParsedContent {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    return { frontmatter: null, rawFrontmatter: null, body: raw }
  }

  const yamlText = match[1]
  const body = raw.slice(match[0].length)

  const entries: FrontmatterEntry[] = []
  for (const line of yamlText.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value = trimmed.slice(colonIdx + 1).trim()
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    entries.push({ key, value })
  }

  return { frontmatter: entries, rawFrontmatter: yamlText, body }
}

/**
 * Re-serialise frontmatter entries + body into a full file string.
 *
 * When `rawYaml` is provided (and non-null), it is used verbatim between the
 * `---` delimiters so that the original formatting (quote style, comments,
 * spacing) is preserved.  Pass `null` to force re-serialisation from entries
 * (e.g. when the user has edited a value in the frontmatter panel).
 */
export function serializeFrontmatter(
  frontmatter: FrontmatterEntry[] | null,
  body: string,
  rawYaml?: string | null
): string {
  if (!frontmatter || frontmatter.length === 0) return body

  let yaml: string
  if (rawYaml != null) {
    // Preserve the original YAML verbatim
    yaml = rawYaml
  } else {
    // Re-serialise from entries
    yaml = frontmatter
      .map(({ key, value }) => {
        const needsQuotes =
          value.includes(":") ||
          value.includes("#") ||
          value.includes('"') ||
          value.includes("'") ||
          value.startsWith(" ") ||
          value.endsWith(" ")
        const escaped = needsQuotes
          ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
          : `"${value}"`
        return `${key}: ${escaped}`
      })
      .join("\n")
  }

  // Always include a blank line between frontmatter and body so TipTap's
  // leading-whitespace trimming doesn't collapse the gap.
  const separator = body.startsWith("\n") ? "" : "\n"
  return `---\n${yaml}\n---\n${separator}${body}`
}

// ─── MDX JSX tag splitting ──────────────────────────────────────────────────
//
// Instead of wrapping entire JSX blocks, we split them into individual tag
// lines.  Each tag becomes a `<div data-type="mdx-tag">` that TipTap's
// MdxTag atom node can parse.  The markdown content *between* tags passes
// through untouched so TipTap renders it as normal editable content.

/**
 * Matches a single JSX tag line (opening, closing, or self-closing) where the
 * component name starts with an uppercase letter.
 *
 * Captures (on a single line, possibly with leading whitespace):
 *   - Opening:      <Component ...>
 *   - Closing:      </Component>
 *   - Self-closing: <Component ... />
 */
const JSX_TAG_LINE_RE =
  /^([ \t]*<\/?[A-Z][A-Za-z0-9.]*(?:\s[^>]*)?>[ \t]*|[ \t]*<[A-Z][A-Za-z0-9.]*(?:\s[^>]*)?\/\s*>[ \t]*)$/gm

/** HTML-encode a string for safe use in an attribute value. */
function htmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Decode HTML entities back to their original characters. */
function htmlDecode(str: string): string {
  return str
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
}

/**
 * Replace individual JSX tag lines with `<div data-type="mdx-tag">` markers
 * that TipTap's MdxTag atom node will parse.
 *
 * Content between tags is left as-is (normal markdown).
 */
export function wrapJsxComponents(markdown: string): string {
  return markdown.replace(JSX_TAG_LINE_RE, (match) => {
    const trimmed = match.trim()
    const encoded = htmlEncode(trimmed)
    return `<div data-type="mdx-tag" data-tag="${encoded}"></div>`
  })
}

/**
 * Pattern matching the `<div data-type="mdx-tag" ...>` markers in the
 * serialised markdown output from TipTap.
 */
const MDX_DIV_RE =
  /<div data-type="mdx-tag" data-tag="([^"]*)">\s*<\/div>/g

/**
 * Restore JSX tag lines from the `<div data-type="mdx-tag">` markers that
 * TipTap's markdown serialiser produces.
 */
export function unwrapJsxComponents(markdown: string): string {
  return markdown.replace(MDX_DIV_RE, (_match, encoded: string) => {
    return htmlDecode(encoded)
  })
}
