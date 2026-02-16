import { useEffect, useState } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

import { vscode } from "../../../../src/webview/vscodeApi"

function SunIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }) {
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
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    const state = vscode.getState() as Record<string, unknown> | undefined
    if (state?.themeOverride != null) {
      return state.themeOverride === "dark"
    }
    return document.documentElement.classList.contains("dark")
  })

  const [hasOverride, setHasOverride] = useState(() => {
    const state = vscode.getState() as Record<string, unknown> | undefined
    return state?.themeOverride != null
  })

  useEffect(() => {
    if (hasOverride) {
      document.documentElement.classList.toggle("dark", isDark)
      document.documentElement.dataset.themeOverride = isDark ? "dark" : "light"
    }
  }, [isDark, hasOverride])

  const toggle = () => {
    setHasOverride(true)
    setIsDark((prev) => {
      const next = !prev
      const state = (vscode.getState() as Record<string, unknown>) || {}
      vscode.setState({ ...state, themeOverride: next ? "dark" : "light" })
      return next
    })
  }

  return (
    <Button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      tooltip={isDark ? "Light mode" : "Dark mode"}
      data-style="ghost"
    >
      {isDark ? (
        <SunIcon className="tiptap-button-icon" />
      ) : (
        <MoonIcon className="tiptap-button-icon" />
      )}
    </Button>
  )
}
