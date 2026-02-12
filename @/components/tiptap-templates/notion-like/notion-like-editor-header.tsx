import { ThemeToggle } from "@/components/tiptap-templates/notion-like/notion-like-editor-theme-toggle"

// --- Tiptap UI ---
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button"

// --- UI Primitives ---
import { Spacer } from "@/components/tiptap-ui-primitive/spacer"
import { Separator } from "@/components/tiptap-ui-primitive/separator"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"

// --- Diff ---
import { useDiff } from "../../../../src/webview/DiffContext"

// --- Styles ---
import "@/components/tiptap-templates/notion-like/notion-like-editor-header.scss"

// ─── Source-view icon (code brackets) ────────────────────────────────────────

function SourceViewIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

/** Git-diff style icon: file with +/- indicators */
function DiffToggleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M2 3.5A1.5 1.5 0 013.5 2h5.586a1.5 1.5 0 011.06.44l2.415 2.414A1.5 1.5 0 0113 5.914V12.5a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 012 12.5v-9zm1.5-.5a.5.5 0 00-.5.5v9a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V6H9.5A1.5 1.5 0 018 4.5V2H3.5zM9 2.707V4.5a.5.5 0 00.5.5h1.793L9 2.707z" />
      <path d="M5.5 7a.5.5 0 01.5.5V8h.5a.5.5 0 010 1H6v.5a.5.5 0 01-1 0V9h-.5a.5.5 0 010-1H5v-.5a.5.5 0 01.5-.5z" />
      <path d="M9 9.5a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5z" />
    </svg>
  )
}

interface NotionEditorHeaderProps {
  rawMode?: boolean
  onToggleRawMode?: () => void
}

export function NotionEditorHeader({ rawMode, onToggleRawMode }: NotionEditorHeaderProps) {
  const { isDiffMode, toggleDiffMode } = useDiff()

  return (
    <header className="notion-like-editor-header">
      <Spacer />
      <div className="notion-like-editor-header-actions">
        <ButtonGroup orientation="horizontal">
          <UndoRedoButton action="undo" />
          <UndoRedoButton action="redo" />
        </ButtonGroup>

        <Separator />

        <Button
          onClick={toggleDiffMode}
          tooltip="Show Changes"
          data-style="ghost"
          data-active-state={isDiffMode ? "on" : undefined}
          aria-label="Toggle diff view"
        >
          <DiffToggleIcon />
        </Button>

        {onToggleRawMode && (
          <Button
            type="button"
            data-style="ghost"
            aria-label={rawMode ? "Switch to rich editor" : "View raw markdown"}
            tooltip={rawMode ? "Switch to rich editor" : "View raw markdown"}
            onClick={onToggleRawMode}
            data-active={rawMode ? "" : undefined}
            className={rawMode ? "raw-mode-active" : ""}
          >
            <SourceViewIcon className="tiptap-button-icon" />
          </Button>
        )}

        <Separator />

        <ThemeToggle />
      </div>
    </header>
  )
}
