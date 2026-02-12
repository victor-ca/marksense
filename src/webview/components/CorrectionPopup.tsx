/**
 * Correction suggestion popup.
 *
 * - For "auto" (blue underline): accepted value, revert, never correct, + alternatives (max 5).
 * - For "manual" (red underline): suggestions (max 4), keep original, never correct.
 * - "Never correct" adds word to user dictionary and skips future corrections.
 * - Positioned below the underlined word using its DOM rect.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/core"
import {
  typewisePluginKey,
  addToDictionary,
  type CorrectionEntry,
  type TypewisePluginState,
} from "../extensions/TypewiseIntegration"

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_AUTO_SUGGESTIONS = 5
const MAX_MANUAL_SUGGESTIONS = 4

// ─── Inline SVG icons (Tabler-style) ──────────────────────────────────────────

const IconThumbUp = () => (
  <svg className="tw-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3" />
  </svg>
)

const IconArrowBackUp = () => (
  <svg className="tw-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14l-4 -4l4 -4" />
    <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
  </svg>
)

const IconBook = () => (
  <svg className="tw-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
    <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
    <path d="M3 6l0 13" /><path d="M12 6l0 13" /><path d="M21 6l0 13" />
  </svg>
)

const IconReturn = () => (
  <svg className="tw-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l-6 -6l6 -6" />
    <path d="M3 12h16v-7" />
  </svg>
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface CorrectionPopupProps {
  editor: Editor
}

type MenuAction = "accept" | "revert" | "suggestion" | "neverCorrect"

interface MenuItem {
  action: MenuAction
  label: React.ReactNode
  value: string
  icon?: React.ReactNode
  shortcut?: number
  isHighlighted?: boolean
  title?: string
}

interface DividerItem {
  action: "divider"
}

type PopupItem = MenuItem | DividerItem

function isDivider(item: PopupItem): item is DividerItem {
  return item.action === "divider"
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CorrectionPopup({ editor }: CorrectionPopupProps) {
  const [activeCorrection, setActiveCorrection] = useState<CorrectionEntry | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Subscribe to plugin state changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const handleUpdate = () => {
      const ps = typewisePluginKey.getState(editor.state) as TypewisePluginState | undefined
      const corr = ps?.activeCorrection || null
      setActiveCorrection(corr)

      if (corr) {
        const el = editor.view.dom.querySelector(
          `[data-tw-correction-id="${corr.id}"]`
        )
        if (el) {
          const rect = el.getBoundingClientRect()
          setPosition({ top: rect.bottom + 4, left: rect.left })
        } else {
          setPosition(null)
        }
      } else {
        setPosition(null)
      }
    }

    editor.on("transaction", handleUpdate)
    return () => {
      editor.off("transaction", handleUpdate)
    }
  }, [editor])

  // Close popup on click outside
  useEffect(() => {
    if (!activeCorrection) return

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        editor.view.dispatch(
          editor.state.tr.setMeta(typewisePluginKey, { type: "close-popup" })
        )
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 50)

    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [activeCorrection, editor])

  // ── Build menu items ──

  const buildMenuItems = useCallback((corr: CorrectionEntry): PopupItem[] => {
    if (corr.type === "auto") {
      // Blue underline: accepted → revert → never correct → [divider] → alternatives
      const items: PopupItem[] = [
        {
          action: "accept",
          label: corr.currentValue,
          value: corr.currentValue,
          icon: <IconThumbUp />,
          isHighlighted: true,
        },
        {
          action: "revert",
          label: <>Revert to &quot;<em>{corr.originalValue}</em>&quot;</>,
          value: corr.originalValue,
          icon: <IconArrowBackUp />,
        },
        {
          action: "neverCorrect",
          label: <>Never correct &quot;<em>{corr.originalValue}</em>&quot;</>,
          value: corr.originalValue,
          icon: <IconBook />,
        },
      ]

      const alternatives = corr.suggestions
        .slice(0, MAX_AUTO_SUGGESTIONS)
        .filter(s => s.correction !== corr.currentValue && s.correction !== corr.originalValue)

      if (alternatives.length > 0) {
        items.push({ action: "divider" })
        alternatives.forEach((s, i) => {
          items.push({
            action: "suggestion",
            label: s.correction,
            value: s.correction,
            shortcut: i + 1,
          })
        })
      }

      return items
    } else {
      // Red underline: suggestions → [divider] → keep original → never correct
      const items: PopupItem[] = []

      const suggestions = corr.suggestions
        .slice(0, MAX_MANUAL_SUGGESTIONS)
        .filter(s => s.correction !== corr.originalValue)

      suggestions.forEach((s, i) => {
        items.push({
          action: "suggestion",
          label: s.correction,
          value: s.correction,
          shortcut: i + 1,
          title: i === 0 ? "Recommended spelling" : undefined,
        })
      })

      if (suggestions.length > 0) {
        items.push({ action: "divider" })
      }

      items.push({
        action: "accept",
        label: corr.originalValue,
        value: corr.originalValue,
        icon: <IconThumbUp />,
        isHighlighted: suggestions.length === 0, // highlight when there are no suggestions
      })

      items.push({
        action: "neverCorrect",
        label: <>Never correct &quot;<em>{corr.originalValue}</em>&quot;</>,
        value: corr.originalValue,
        icon: <IconBook />,
      })

      return items
    }
  }, [])

  // ── Apply an item ──

  const applyItem = useCallback(
    (item: MenuItem) => {
      if (!activeCorrection || editor.isDestroyed) return

      // Always read the latest correction positions from plugin state
      // (React state may be stale if the document changed since last render)
      const ps = typewisePluginKey.getState(editor.state) as TypewisePluginState | undefined
      const corr = ps?.corrections.find(c => c.id === activeCorrection.id) ?? activeCorrection

      if (item.action === "neverCorrect") {
        addToDictionary(item.value)
        if (corr.type === "auto") {
          const { tr } = editor.state
          tr.insertText(corr.originalValue, corr.from, corr.to)
          tr.setMeta(typewisePluginKey, { type: "apply-suggestion", id: corr.id })
          editor.view.dispatch(tr)
        } else {
          editor.view.dispatch(
            editor.state.tr.setMeta(typewisePluginKey, { type: "remove-correction", id: corr.id })
          )
        }
        editor.view.focus()
        return
      }

      // accept / revert / suggestion → replace text + remove correction
      const { tr } = editor.state
      tr.insertText(item.value, corr.from, corr.to)
      tr.setMeta(typewisePluginKey, { type: "apply-suggestion", id: corr.id })
      editor.view.dispatch(tr)
      editor.view.focus()
    },
    [activeCorrection, editor]
  )

  // ── Computed values ──

  const menuItems = useMemo(
    () => (activeCorrection ? buildMenuItems(activeCorrection) : []),
    [activeCorrection, buildMenuItems]
  )

  const actionableItems = useMemo(
    () => menuItems.filter((item): item is MenuItem => !isDivider(item)),
    [menuItems]
  )

  // ── Keyboard shortcuts ──

  useEffect(() => {
    if (!activeCorrection || actionableItems.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Number keys 1-9 for shortcut selection
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        const item = actionableItems.find(i => i.shortcut === num)
        if (item) {
          e.preventDefault()
          e.stopPropagation()
          applyItem(item)
          return
        }
      }

      // Enter to accept first item
      if (e.key === "Enter") {
        const first = actionableItems[0]
        if (first) {
          e.preventDefault()
          e.stopPropagation()
          applyItem(first)
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [activeCorrection, actionableItems, applyItem])

  // ── Render ──

  if (!activeCorrection || !position || menuItems.length === 0) return null

  return createPortal(
    <div
      ref={popupRef}
      className="typewise-popup"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => {
        // Stop propagation so the document-level click-outside handler
        // doesn't close the popup before onClick fires on buttons
        e.stopPropagation()
      }}
    >
      <div className="typewise-popup-items">
        {menuItems.map((item, i) => {
          if (isDivider(item)) {
            return <div key={`div-${i}`} className="typewise-popup-divider" />
          }

          return (
            <button
              key={`${item.value}-${item.action}-${i}`}
              className={`typewise-popup-item${item.isHighlighted ? " is-highlighted" : ""}`}
              onMouseDown={(e) => {
                // Prevent editor focus loss so the click completes reliably
                e.preventDefault()
              }}
              onClick={() => applyItem(item)}
            >
              {item.icon && (
                <span className="typewise-popup-item-icon">{item.icon}</span>
              )}
              <span className="typewise-popup-item-content">
                {item.title && (
                  <span className="typewise-popup-item-title">{item.title}</span>
                )}
                <span className="typewise-popup-item-label">{item.label}</span>
              </span>
              {item.shortcut != null && (
                <span className="typewise-popup-item-shortcut">{item.shortcut}</span>
              )}
              {item.isHighlighted && (
                <span className="typewise-popup-item-enter"><IconReturn /></span>
              )}
            </button>
          )
        })}
      </div>
      <div className="typewise-popup-footer">
        <span className="typewise-popup-footer-brand">
          <span className="typewise-popup-footer-logo">
            <svg viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill="#1D58E2" d="M32.038 75.798a238.057 238.057 0 0 0 29.672-8.16 9.697 9.697 0 0 0 6.008-6.008 247.641 247.641 0 0 0 8.112-29.68 9.368 9.368 0 0 0-2.056-8A235.386 235.386 0 0 0 52.006 2.222a9.192 9.192 0 0 0-8-2 235.951 235.951 0 0 0-29.68 8.168 9.663 9.663 0 0 0-6.008 6.008A244.152 244.152 0 0 0 .198 44.07a9.36 9.36 0 0 0 2.048 8 236.358 236.358 0 0 0 21.768 21.72 9.503 9.503 0 0 0 8 2"/>
              <path fill="#fff" d="M34.19 39.294a2.201 2.201 0 0 0-2.672 1.6l-1.72 7.488a4.951 4.951 0 0 1-9.056 1.488 5.104 5.104 0 0 1-.616-3.744l4.512-24.336a2.247 2.247 0 1 0-4.416-.8l-1.624 8.704-5.952 2a2.201 2.201 0 0 0-1.392 2.824 2.272 2.272 0 0 0 2.208 1.544c.21-.01.416-.045.616-.104l3.6-1.184-1.952 10.4a9.472 9.472 0 0 0 9.6 11.504 9.552 9.552 0 0 0 4.472-1.368 9.24 9.24 0 0 0 4.208-5.848l1.744-7.448a2.175 2.175 0 0 0-1.56-2.72Z"/>
              <path fill="#fff" d="M31.006 27.894a2.199 2.199 0 0 0-2.808-1.384l-2.047.664-.88 4.984 4.311-1.44a2.24 2.24 0 0 0 1.424-2.824ZM41.07 52.486a8.352 8.352 0 0 1-2.567-.216 9.226 9.226 0 0 1-5.856-4.208 9.12 9.12 0 0 1-1.128-7.088 2.217 2.217 0 1 1 4.312 1.032 4.951 4.951 0 0 0 3.696 5.952 4.952 4.952 0 0 0 5.96-3.696l1.744-7.44a2.218 2.218 0 0 1 2.67-1.657 2.217 2.217 0 0 1 1.642 2.68l-1.744 7.409a9.264 9.264 0 0 1-4.208 5.848 8.801 8.801 0 0 1-4.52 1.384Z"/>
              <path fill="#fff" d="M56.783 48.334a9.521 9.521 0 0 1-8.424-4.472 9.11 9.11 0 0 1-1.128-7.08 2.216 2.216 0 1 1 4.312 1.024 4.944 4.944 0 0 0 3.696 5.952 4.992 4.992 0 0 0 5.96-3.64l1.744-7.448a2.217 2.217 0 0 1 4.312 1.032l-1.744 7.44a9.393 9.393 0 0 1-8.728 7.192Z"/>
            </svg>
          </span>
          Typewise
        </span>
        <span className="typewise-popup-footer-hint">
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </div>,
    document.body
  )
}
