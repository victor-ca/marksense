import { useCallback, useEffect, useRef, useState } from "react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import { TextSelection } from "@tiptap/pm/state"
import { createPortal } from "react-dom"

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { Mention } from "@tiptap/extension-mention"
import { TaskList, TaskItem } from "@tiptap/extension-list"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { Placeholder, Selection } from "@tiptap/extensions"
import { Typography } from "@tiptap/extension-typography"
import { Highlight } from "@tiptap/extension-highlight"
import { Superscript } from "@tiptap/extension-superscript"
import { Subscript } from "@tiptap/extension-subscript"
import { TextAlign } from "@tiptap/extension-text-align"
import { Mathematics } from "@tiptap/extension-mathematics"

import { UniqueID } from "@tiptap/extension-unique-id"
import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji"
import {
  getHierarchicalIndexes,
  TableOfContents,
} from "@tiptap/extension-table-of-contents"

// --- Hooks ---
import { useUiEditorState } from "@/hooks/use-ui-editor-state"
import { useScrollToHash } from "@/components/tiptap-ui/copy-anchor-link-button/use-scroll-to-hash"
import { useToc } from "@/components/tiptap-node/toc-node/context/toc-context"

// --- Custom Extensions ---
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"
import { UiState } from "@/components/tiptap-extension/ui-state-extension"
import { Image } from "@/components/tiptap-node/image-node/image-node-extension"
import { NodeBackground } from "@/components/tiptap-extension/node-background-extension"
import { NodeAlignment } from "@/components/tiptap-extension/node-alignment-extension"
import { TocNode } from "@/components/tiptap-node/toc-node/extensions/toc-node-extension"
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension"
import { ListNormalizationExtension } from "@/components/tiptap-extension/list-normalization-extension"

// --- Table ---
import { TableKit } from "@/components/tiptap-node/table-node/extensions/table-node-extension"
import { TableHandleExtension } from "@/components/tiptap-node/table-node/extensions/table-handle"
import { TableHandle } from "@/components/tiptap-node/table-node/ui/table-handle/table-handle"
import { TableSelectionOverlay } from "@/components/tiptap-node/table-node/ui/table-selection-overlay"
import { TableCellHandleMenu } from "@/components/tiptap-node/table-node/ui/table-cell-handle-menu"
import { TableExtendRowColumnButtons } from "@/components/tiptap-node/table-node/ui/table-extend-row-column-button"
import "@/components/tiptap-node/table-node/styles/prosemirror-table.scss"
import "@/components/tiptap-node/table-node/styles/table-node.scss"

// --- Node Styles ---
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss"
import "@/components/tiptap-node/code-block-node/code-block-node.scss"
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss"
import "@/components/tiptap-node/list-node/list-node.scss"
import "@/components/tiptap-node/image-node/image-node.scss"
import "@/components/tiptap-node/heading-node/heading-node.scss"
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { EmojiDropdownMenu } from "@/components/tiptap-ui/emoji-dropdown-menu"
import { MentionDropdownMenu } from "@/components/tiptap-ui/mention-dropdown-menu"
import { SlashDropdownMenu } from "@/components/tiptap-ui/slash-dropdown-menu"
import { DragContextMenu } from "@/components/tiptap-ui/drag-context-menu"


// --- Template components ---
import { NotionEditorHeader } from "@/components/tiptap-templates/notion-like/notion-like-editor-header"
import { MobileToolbar } from "@/components/tiptap-templates/notion-like/notion-like-editor-mobile-toolbar"
import { NotionToolbarFloating } from "@/components/tiptap-templates/notion-like/notion-like-editor-toolbar-floating"
import { TocSidebar } from "@/components/tiptap-node/toc-node"

// --- Lib ---
import { handleImageUpload, MAX_FILE_SIZE } from "@/lib/tiptap-utils"


// --- Styles ---
import "@/components/tiptap-templates/notion-like/notion-like-editor.scss"

// --- Typewise ---
import { TypewiseIntegration } from "./extensions/TypewiseIntegration"
import { CorrectionPopup } from "./components/CorrectionPopup"

// --- VS Code bridge ---
import { vscode } from "./vscodeApi"

// --- Diff ---
import { DiffProvider, useDiff } from "./DiffContext"
import { DiffView } from "./components/DiffView"

/**
 * Content area that renders the editor with all menus and toolbars.
 * Expects to be inside an EditorContext.Provider.
 */
function MarkdownEditorContent({ editor }: { editor: any }) {
  const {
    isDragging,
  } = useUiEditorState(editor)

  useScrollToHash()

  if (!editor) return null

  return (
    <EditorContent
      editor={editor}
      role="presentation"
      className="notion-like-editor-content"
      style={{ cursor: isDragging ? "grabbing" : "auto" }}
    >
      <DragContextMenu />
      <EmojiDropdownMenu />
      <MentionDropdownMenu />
      <SlashDropdownMenu />
      <NotionToolbarFloating />
      {createPortal(<MobileToolbar />, document.body)}
    </EditorContent>
  )
}

// ─── Loading Spinner ─────────────────────────────────────────────────────────

function LoadingSpinner({ text = "Loading editor..." }: { text?: string }) {
  return (
    <div className="spinner-container">
      <div className="spinner-content">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <div className="spinner-loading-text">{text}</div>
      </div>
    </div>
  )
}

// ─── Main Editor ─────────────────────────────────────────────────────────────

export function MarkdownEditor() {
  return (
    <DiffProvider>
      <MarkdownEditorInner />
    </DiffProvider>
  )
}

function MarkdownEditorInner() {
  const isExternalUpdate = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setTocContent } = useToc()
  const { isDiffMode, headContent, setHeadContent } = useDiff()
  const [currentMarkdown, setCurrentMarkdown] = useState(
    window.__INITIAL_CONTENT__ || ""
  )
  const [rawMode, setRawMode] = useState(false)
  const [rawContent, setRawContent] = useState("")
  const rawContentOriginal = useRef("")

  const typewiseToken = window.__SETTINGS__?.typewiseToken || ""

  const editor = useEditor({
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "notion-like-editor",
        spellcheck: "true",
        autocorrect: "on",
      },
    },
    extensions: [
      StarterKit.configure({
        // Keep undo/redo enabled (template disables it for collab)
        horizontalRule: false,
        dropcursor: { width: 2 },
        link: { openOnClick: false },
      }),
      // --- Markdown bidirectional support ---
      Markdown,
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder: 'Type "/" for commands...',
        emptyNodeClass: "is-empty with-slash",
      }),
      Mention,
      Emoji.configure({
        emojis: gitHubEmojis.filter(
          (emoji) => !emoji.name.includes("regional")
        ),
        forceFallbackImages: true,
      }),
      TableKit.configure({
        table: { resizable: true, cellMinWidth: 120 },
      }),
      NodeBackground.configure({
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "taskList",
          "bulletList",
          "orderedList",
          "tableCell",
          "tableHeader",
          "tocNode",
        ],
      }),
      NodeAlignment,
      TextStyle,
      Mathematics,
      Superscript,
      Subscript,
      Color,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Selection,
      Image,
      TableOfContents.configure({
        getIndex: getHierarchicalIndexes,
        onUpdate(content) {
          setTocContent(content)
        },
      }),
      TableHandleExtension,
      ListNormalizationExtension,
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: (error: Error) => console.error("Upload failed:", error),
      }),
      UniqueID.configure({
        types: [
          "table",
          "paragraph",
          "bulletList",
          "orderedList",
          "taskList",
          "heading",
          "blockquote",
          "codeBlock",
          "tocNode",
        ],
      }),
      Typography,
      UiState,
      TocNode.configure({ topOffset: 48 }),
      // --- Typewise: autocorrection + inline predictions ---
      TypewiseIntegration.configure({
        apiToken: typewiseToken,
        languages: ["en", "de", "fr"],
        autocorrect: true,
        predictions: true,
      }),
    ],
    // --- Initial content from the markdown file ---
    content: window.__INITIAL_CONTENT__ || "",
    // @ts-ignore — contentType available via @tiptap/markdown
    contentType: "markdown",
    // --- Sync edits back to VS Code ---
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return

      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        // @ts-ignore — getMarkdown available via @tiptap/markdown
        const md = ed.getMarkdown()
        setCurrentMarkdown(md)
        vscode.postMessage({ type: "edit", content: md })
      }, 150)
    },
  })

  // --- Triple-click to select block (DOM-level handler) ----
  // ProseMirror tracks its own click counter on mousedown, but React
  // re-renders between clicks can disrupt it. This handler runs in the
  // capture phase before ProseMirror sees the event, tracks clicks
  // manually, and forces the block selection on the third click.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    let clickCount = 0
    let lastTime = 0
    let lastX = 0
    let lastY = 0

    const onMouseDown = (e: MouseEvent) => {
      const now = Date.now()
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      const isNear = dx * dx + dy * dy < 100

      if (now - lastTime < 500 && isNear && e.button === 0) {
        clickCount++
      } else {
        clickCount = 1
      }
      lastTime = now
      lastX = e.clientX
      lastY = e.clientY

      if (clickCount >= 3) {
        // Prevent ProseMirror from processing this as a single click
        e.stopPropagation()
        e.preventDefault()

        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
        if (pos) {
          const $pos = editor.state.doc.resolve(pos.pos)
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, $pos.start(), $pos.end())
            )
          )
        }
        // Reset counter so further rapid clicks don't keep firing
        clickCount = 0
      }
    }

    // Capture phase so we run BEFORE ProseMirror's bubble-phase listener
    dom.addEventListener("mousedown", onMouseDown, { capture: true })
    return () => dom.removeEventListener("mousedown", onMouseDown, { capture: true })
  }, [editor])

  // --- Avoid selecting non-text nodes (e.g. horizontal rule) on init ---
  useEffect(() => {
    if (!editor) return
    // Defer to allow the editor to fully render
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      try {
        editor.commands.focus("start", { scrollIntoView: false })
      } catch {
        // fallback: focus end if start isn't a valid text position
        try {
          editor.commands.focus("end", { scrollIntoView: false })
        } catch {
          // ignore — editor may not have focusable content
        }
      }
    })
  }, [editor])

  // --- Listen for external content updates from VS Code ---
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const message = event.data
      if (message.type === "update" && editor && !editor.isDestroyed) {
        isExternalUpdate.current = true
        // Temporarily wrap dispatch so the setContent transaction is
        // marked as non-undoable (external syncs shouldn't pollute undo stack)
        const origDispatch = editor.view.dispatch.bind(editor.view)
        editor.view.dispatch = (tr: any) => {
          tr.setMeta("addToHistory", false)
          origDispatch(tr)
        }
        // @ts-ignore — contentType option provided by @tiptap/markdown
        editor.commands.setContent(message.content, {
          contentType: "markdown",
          emitUpdate: false,
        })
        setCurrentMarkdown(message.content)
        editor.view.dispatch = origDispatch
        requestAnimationFrame(() => {
          isExternalUpdate.current = false
        })
      }

      // --- Diff: receive HEAD content from extension host ---
      if (message.type === "diffContent") {
        setHeadContent(message.content ?? null)
      }
    },
    [editor, setHeadContent]
  )

  // --- Request diff content when diff mode is toggled on ---
  useEffect(() => {
    if (isDiffMode) {
      vscode.postMessage({ type: "requestDiff" })
    }
  }, [isDiffMode])

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  // ── Raw markdown toggle ────────────────────────────────────────────
  const handleToggleRawMode = useCallback(() => {
    if (!editor || editor.isDestroyed) return

    if (!rawMode) {
      // Entering raw mode: capture current markdown
      // @ts-ignore — getMarkdown available via @tiptap/markdown
      const md = editor.getMarkdown()
      setRawContent(md)
      rawContentOriginal.current = md
    } else {
      // Leaving raw mode: only re-parse if the user actually edited the markdown
      if (rawContent !== rawContentOriginal.current) {
        isExternalUpdate.current = true
        // @ts-ignore — contentType option provided by @tiptap/markdown
        editor.commands.setContent(rawContent, {
          contentType: "markdown",
          emitUpdate: false,
        })
        requestAnimationFrame(() => {
          isExternalUpdate.current = false
        })
      }
    }
    setRawMode((prev) => !prev)
  }, [editor, rawMode, rawContent])

  if (!editor) {
    return <LoadingSpinner />
  }

  // Determine which special mode is active (diff takes precedence)
  const showDiff = isDiffMode && headContent !== null
  const showRaw = rawMode && !showDiff
  const showEditor = !showDiff && !showRaw

  return (
    <div className="notion-like-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        <NotionEditorHeader rawMode={rawMode} onToggleRawMode={handleToggleRawMode} />

        {showDiff && (
          <div className="notion-like-editor-layout">
            <div className="notion-like-editor-content">
              <div className="tiptap ProseMirror notion-like-editor" style={{ flex: 1, padding: "3rem 3rem 30vh" }}>
                <DiffView
                  currentContent={currentMarkdown}
                  headContent={headContent}
                />
              </div>
            </div>
          </div>
        )}

        {showRaw && (
          <div className="raw-markdown-container">
            <textarea
              className="raw-markdown-editor"
              value={rawContent}
              onChange={(e) => {
                const val = e.target.value
                setRawContent(val)

                // Sync back to VS Code with debounce
                if (debounceTimer.current) clearTimeout(debounceTimer.current)
                debounceTimer.current = setTimeout(() => {
                  vscode.postMessage({ type: "edit", content: val })
                }, 150)
              }}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
        )}

        {showEditor && (
          <>
            <div className="notion-like-editor-layout">
              <MarkdownEditorContent editor={editor} />
              <TocSidebar topOffset={48} />
            </div>

            <TableExtendRowColumnButtons />
            <TableHandle />
            <TableSelectionOverlay
              showResizeHandles={true}
              cellMenu={(props: any) => (
                <TableCellHandleMenu
                  editor={props.editor}
                  onMouseDown={(e: any) => props.onResizeStart?.("br")(e)}
                />
              )}
            />
          </>
        )}
      </EditorContext.Provider>
      {!isDiffMode && !rawMode && <CorrectionPopup editor={editor} />}
    </div>
  )
}
