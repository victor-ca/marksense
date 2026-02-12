/**
 * Typewise AI integration for Tiptap.
 *
 * Corrections:
 *   - On word boundary (space/punctuation), calls POST /correction/final_word.
 *   - "auto" → replace word (preserving formatting) + blue underline (click to revert).
 *   - "manual" → red underline (click for suggestions).
 *   - Click/hover on underline opens a CorrectionPopup (managed externally in React).
 *
 * Predictions:
 *   - On typing pause, calls POST /completion/sentence_complete.
 *   - Shows ghost text at cursor.
 *   - If typed chars match prediction prefix → advance overlap, skip API call.
 *   - Tab to accept, Esc to dismiss.
 */

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"

// ─── Public types (shared with CorrectionPopup) ─────────────────────────────

export interface CorrectionSuggestion {
  correction: string
  score: number
}

export interface CorrectionEntry {
  id: string
  from: number
  to: number
  type: "auto" | "manual"
  originalValue: string
  currentValue: string
  suggestions: CorrectionSuggestion[]
}

export interface TypewisePluginState {
  corrections: CorrectionEntry[]
  activeCorrection: CorrectionEntry | null
  prediction: { fullText: string; ghostText: string; cursorPos: number } | null
  decorations: DecorationSet
}

// ─── Options ─────────────────────────────────────────────────────────────────

interface TypewiseOptions {
  apiBaseUrl: string
  apiToken: string
  languages: string[]
  predictionDebounce: number
  autocorrect: boolean
  predictions: boolean
}

// ─── Plugin key (exported for external access) ──────────────────────────────

export const typewisePluginKey = new PluginKey<TypewisePluginState>("typewise")

// ─── API helper ──────────────────────────────────────────────────────────────

async function typewisePost(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token?: string
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Typewise API ${path}: ${res.status}`)
  return res.json()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let correctionIdCounter = 0
function nextCorrectionId(): string {
  return `tw-c-${++correctionIdCounter}`
}

function getTextBeforeCursor(state: EditorState): { text: string; blockStart: number } {
  const { $from } = state.selection
  const blockStart = $from.start()
  return { text: state.doc.textBetween(blockStart, $from.pos, ""), blockStart }
}

/**
 * Extract the plain text that was inserted by a transaction.
 * Returns null if the transaction wasn't a simple text insertion.
 */
function getInsertedText(tr: Transaction): string | null {
  if (!tr.docChanged) return null
  let insertedText = ""
  // Iterate steps to find ReplaceSteps with text content
  tr.steps.forEach((step: any) => {
    const slice = step.slice
    if (slice && slice.content && slice.content.childCount === 1) {
      const child = slice.content.firstChild
      if (child && child.isText) {
        insertedText += child.text
      }
    }
  })
  return insertedText || null
}

// ─── Extension ───────────────────────────────────────────────────────────────

export const TypewiseIntegration = Extension.create<TypewiseOptions>({
  name: "typewise",

  addOptions() {
    return {
      apiBaseUrl: "https://api.typewise.ai/v0",
      apiToken: "",
      languages: ["en", "de", "fr"],
      predictionDebounce: 400,
      autocorrect: true,
      predictions: true,
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const ps = typewisePluginKey.getState(editor.state)
        if (ps?.prediction) {
          const { ghostText, cursorPos } = ps.prediction
          // Use insertText to preserve formatting context
          const { tr } = editor.state
          tr.insertText(ghostText, cursorPos)
          tr.setMeta(typewisePluginKey, { type: "clear-prediction" })
          editor.view.dispatch(tr)
          return true
        }
        return false
      },
      Escape: ({ editor }) => {
        const ps = typewisePluginKey.getState(editor.state)
        if (ps?.activeCorrection || ps?.prediction) {
          editor.view.dispatch(
            editor.state.tr
              .setMeta(typewisePluginKey, { type: "dismiss" })
          )
          return true
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    const tiptapEditor = this.editor

    let predictionTimer: ReturnType<typeof setTimeout> | null = null
    let predictionRequestId = 0
    let correctionAbort: AbortController | null = null

    // ── Cached ghost text DOM element (reused to avoid flicker) ──────
    let cachedGhostWrapper: HTMLSpanElement | null = null
    let cachedGhostTextSpan: HTMLSpanElement | null = null

    function getOrCreateGhostElement(ghostText: string): HTMLSpanElement {
      if (!cachedGhostWrapper) {
        cachedGhostWrapper = document.createElement("span")
        cachedGhostWrapper.className = "typewise-ghost-wrapper"

        cachedGhostTextSpan = document.createElement("span")
        cachedGhostTextSpan.className = "typewise-ghost-text"
        cachedGhostWrapper.appendChild(cachedGhostTextSpan)
      }
      cachedGhostTextSpan!.textContent = ghostText
      return cachedGhostWrapper
    }

    function clearCachedGhostElement() {
      cachedGhostWrapper = null
      cachedGhostTextSpan = null
    }

    // ── API: final word correction ────────────────────────────────────

    async function checkFinalWord(sentenceText: string, blockStart: number) {
      if (!opts.autocorrect) return

      // Abort any in-flight correction request
      if (correctionAbort) correctionAbort.abort()
      correctionAbort = new AbortController()
      const signal = correctionAbort.signal

      try {
        const data = await typewisePost(
          opts.apiBaseUrl,
          "/correction/final_word",
          { text: sentenceText, languages: opts.languages },
          opts.apiToken || undefined
        )
        if (signal.aborted || !data || tiptapEditor.isDestroyed) return

        const view = tiptapEditor.view
        const curState = view.state

        // Use start_index_relative_to_end + chars_to_replace from the API
        // to pinpoint exactly which characters to replace (only the final word).
        // Note: the API returns start_index_relative_to_end as a negative number
        // (e.g. -5 means "5 chars before the end"), so we use Math.abs().
        const charsToReplace = data.chars_to_replace || 0
        const relToEnd = Math.abs(data.start_index_relative_to_end) || charsToReplace
        const sentenceEnd = blockStart + sentenceText.length

        // Position of the word to correct in the document
        let wordFrom = sentenceEnd - relToEnd
        let wordTo = wordFrom + charsToReplace

        // Re-validate: check that the original word is still at the expected position
        // in the current document (the user may have typed more since the request)
        const originalWord = data.original_word || ""
        if (originalWord && wordFrom >= 0 && wordTo <= curState.doc.content.size) {
          const currentText = curState.doc.textBetween(wordFrom, wordTo, "")
          if (currentText !== originalWord) {
            // Word has moved or changed — try to find it near the expected position
            const { $from } = curState.selection
            const curBlockStart = $from.start()
            const curBlockEnd = $from.end()
            const blockText = curState.doc.textBetween(curBlockStart, curBlockEnd, "")
            const idx = blockText.lastIndexOf(originalWord)
            if (idx === -1) return // word no longer present
            wordFrom = curBlockStart + idx
            wordTo = wordFrom + originalWord.length
          }
        }

        if (data.correctionType === "auto" && data.corrected_text && data.corrected_text !== data.original_text && charsToReplace > 0) {
          // Use the first suggestion for the replacement word
          const replacementWord = data.suggestions?.[0]?.correction || ""
          if (!replacementWord) return

          const correction: CorrectionEntry = {
            id: nextCorrectionId(),
            from: wordFrom,
            to: wordFrom + replacementWord.length,
            type: "auto",
            originalValue: originalWord,
            currentValue: replacementWord,
            suggestions: data.suggestions || [],
          }

          const { tr } = curState
          tr.insertText(replacementWord, wordFrom, wordTo)
          tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
          view.dispatch(tr)
        } else if (
          data.correctionType === "manual" &&
          data.suggestions?.length > 0 &&
          !data.is_in_dictionary &&
          charsToReplace > 0
        ) {
          if (wordFrom >= 0 && wordFrom < wordTo) {
            const correction: CorrectionEntry = {
              id: nextCorrectionId(),
              from: wordFrom,
              to: wordTo,
              type: "manual",
              originalValue: originalWord,
              currentValue: originalWord,
              suggestions: data.suggestions || [],
            }
            view.dispatch(
              curState.tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
            )
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || signal.aborted) return
        console.debug("[Typewise] correction error:", err)
      }
    }

    // ── API: sentence completion ──────────────────────────────────────

    async function fetchPrediction(text: string, cursorPos: number, requestId: number) {
      if (!opts.predictions || text.trim().length < 3) return

      try {
        const data = await typewisePost(
          opts.apiBaseUrl,
          "/completion/sentence_complete",
          { text, languages: opts.languages },
          opts.apiToken || undefined
        )
        // Discard stale responses
        if (requestId !== predictionRequestId) return
        if (!data || tiptapEditor.isDestroyed) return

        // Verify cursor hasn't moved since the request was made
        const currentPos = tiptapEditor.view.state.selection.$from.pos
        if (currentPos !== cursorPos) return

        const pred = data.predictions?.[0]
        if (!pred?.text) return

        // Use the API's completionStartingIndex directly to compute ghost text
        const startIdx = pred.completionStartingIndex || 0
        const lastRow = data.text?.split("\n").pop() || ""

        // basePredictionText = what the user already typed that the prediction builds on
        // When startIdx === 0, the prediction covers the entire line
        const basePredictionText = startIdx === 0 ? lastRow : lastRow.slice(0, startIdx)
        const fullPrediction = basePredictionText + pred.text

        // Ghost text = the part of the full prediction the user hasn't typed yet
        const ghostText = fullPrediction.slice(lastRow.length)
        if (!ghostText || ghostText.length === 0) return

        tiptapEditor.view.dispatch(
          tiptapEditor.state.tr.setMeta(typewisePluginKey, {
            type: "set-prediction",
            fullText: fullPrediction,
            ghostText,
            cursorPos,
          })
        )
      } catch (err) {
        console.debug("[Typewise] prediction error:", err)
      }
    }

    function schedulePrediction(view: EditorView) {
      if (predictionTimer) clearTimeout(predictionTimer)
      predictionTimer = setTimeout(() => {
        const { text } = getTextBeforeCursor(view.state)
        const cursorPos = view.state.selection.$from.pos
        if (text.trim().length >= 3) {
          predictionRequestId++
          fetchPrediction(text, cursorPos, predictionRequestId)
        }
      }, opts.predictionDebounce)
    }

    // ── Build decorations from state ─────────────────────────────────

    function buildDecorations(
      doc: any,
      corrections: CorrectionEntry[],
      prediction: TypewisePluginState["prediction"]
    ): DecorationSet {
      const decos: Decoration[] = []

      for (const c of corrections) {
        if (c.from >= 0 && c.to <= doc.content.size && c.from < c.to) {
          decos.push(
            Decoration.inline(c.from, c.to, {
              class: c.type === "auto" ? "typewise-underline-blue" : "typewise-underline-red",
              "data-tw-correction-id": c.id,
            })
          )
        }
      }

      if (prediction && prediction.cursorPos <= doc.content.size) {
        // Update the cached DOM element's text BEFORE creating the decoration.
        // ProseMirror may reuse the existing DOM node via the "key" without
        // calling the factory again, so the content must already be current.
        getOrCreateGhostElement(prediction.ghostText)
        decos.push(
          Decoration.widget(
            prediction.cursorPos,
            () => cachedGhostWrapper!,
            { side: 1, key: "tw-prediction" }
          )
        )
      } else {
        // No prediction — clear the cached element so it can be GC'd
        clearCachedGhostElement()
      }

      return DecorationSet.create(doc, decos)
    }

    // ── The ProseMirror Plugin ────────────────────────────────────────

    const plugin = new Plugin<TypewisePluginState>({
      key: typewisePluginKey,

      state: {
        init(_, state): TypewisePluginState {
          return {
            corrections: [],
            activeCorrection: null,
            prediction: null,
            decorations: DecorationSet.empty,
          }
        },

        apply(tr, prev, _oldState, newState): TypewisePluginState {
          const meta = tr.getMeta(typewisePluginKey)

          // Map correction positions through the transaction
          let corrections = prev.corrections
            .map((c) => ({
              ...c,
              from: tr.mapping.map(c.from),
              to: tr.mapping.map(c.to),
            }))
            .filter((c) => c.from < c.to)

          let activeCorrection = prev.activeCorrection
          let prediction = prev.prediction

          // ── Handle meta actions ──
          if (meta) {
            switch (meta.type) {
              case "add-correction":
                corrections = [...corrections, meta.correction]
                break
              case "remove-correction":
                corrections = corrections.filter((c) => c.id !== meta.id)
                activeCorrection =
                  activeCorrection?.id === meta.id ? null : activeCorrection
                break
              case "set-active-correction":
                activeCorrection =
                  corrections.find((c) => c.id === meta.id) || null
                break
              case "close-popup":
                activeCorrection = null
                break
              case "set-prediction":
                prediction = {
                  fullText: meta.fullText,
                  ghostText: meta.ghostText,
                  cursorPos: meta.cursorPos,
                }
                break
              case "clear-prediction":
                prediction = null
                break
              case "dismiss":
                activeCorrection = null
                prediction = null
                break
              case "apply-suggestion": {
                // Replace correction text preserving formatting
                // This is dispatched from the popup component
                const corr = corrections.find((c) => c.id === meta.id)
                if (corr) {
                  corrections = corrections.filter((c) => c.id !== meta.id)
                  activeCorrection = null
                }
                break
              }
            }
          }

          // ── Handle prediction overlap on doc changes ──
          if (tr.docChanged && !meta && prediction) {
            const inserted = getInsertedText(tr)
            if (inserted && prediction.ghostText.startsWith(inserted)) {
              // Typed chars match prediction → advance overlap
              const newGhost = prediction.ghostText.slice(inserted.length)
              const newCursorPos = tr.mapping.map(prediction.cursorPos)
              if (newGhost.length > 0) {
                prediction = {
                  fullText: prediction.fullText,
                  ghostText: newGhost,
                  cursorPos: newCursorPos,
                }
              } else {
                // Entire prediction was typed out
                prediction = null
              }
            } else {
              // Mismatch → clear prediction (new fetch will be triggered by view.update)
              prediction = null
            }
          }

          // ── Only remove corrections if the edit is INSIDE the correction ──
          // (not just adjacent — typing after a corrected word should not remove it)
          if (tr.docChanged && !meta) {
            tr.steps.forEach((step: any) => {
              if (step.from != null && step.to != null) {
                // Map the step's original positions to the OLD state
                const editFrom = step.from
                const editTo = step.to
                // Only remove corrections where the edit is strictly inside
                corrections = corrections.filter((c) => {
                  // Check if edit range overlaps INSIDE the correction (not at boundaries)
                  const editInsideCorrection =
                    editFrom < c.to && editTo > c.from &&
                    !(editFrom >= c.to) && !(editTo <= c.from)
                  // But allow edits right at the boundary (cursor after correction)
                  const isAtBoundary = editFrom === c.to || editTo === c.from
                  return !editInsideCorrection || isAtBoundary
                })
              }
            })
            if (
              activeCorrection &&
              !corrections.find((c) => c.id === activeCorrection!.id)
            ) {
              activeCorrection = null
            }
          }

          const decorations = buildDecorations(newState.doc, corrections, prediction)

          return { corrections, activeCorrection, prediction, decorations }
        },
      },

      props: {
        decorations(state) {
          return this.getState(state)?.decorations ?? DecorationSet.empty
        },

        // Detect clicks on correction underlines
        handleClick(view, pos, event) {
          const target = event.target as HTMLElement
          const corrId =
            target?.getAttribute("data-tw-correction-id") ||
            target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")

          if (corrId) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, {
                type: "set-active-correction",
                id: corrId,
              })
            )
            return true
          }

          // Click elsewhere → close popup
          const ps = typewisePluginKey.getState(view.state)
          if (ps?.activeCorrection) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, { type: "close-popup" })
            )
          }
          return false
        },

        // Detect hover on correction underlines + dismiss on blur
        handleDOMEvents: {
          blur(view) {
            const ps = typewisePluginKey.getState(view.state)
            if (ps?.prediction || ps?.activeCorrection) {
              view.dispatch(
                view.state.tr.setMeta(typewisePluginKey, { type: "dismiss" })
              )
            }
            return false
          },
          mouseover(view, event) {
            const target = event.target as HTMLElement
            const corrId =
              target?.getAttribute("data-tw-correction-id") ||
              target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")

            if (corrId) {
              const ps = typewisePluginKey.getState(view.state)
              if (ps?.activeCorrection?.id !== corrId) {
                view.dispatch(
                  view.state.tr.setMeta(typewisePluginKey, {
                    type: "set-active-correction",
                    id: corrId,
                  })
                )
              }
            }
            return false
          },
        },

        // Trigger corrections on word boundaries
        handleTextInput(view, from, _to, text) {
          const isWordBoundary = /[\s.,;:!?\-)\]}>]/.test(text)

          if (isWordBoundary && opts.autocorrect) {
            const { $from } = view.state.selection
            const blockStart = $from.start()
            const sentenceText =
              view.state.doc.textBetween(blockStart, from, "") + text

            if (sentenceText.trim().length >= 2) {
              checkFinalWord(sentenceText, blockStart)
            }
          }

          return false
        },
      },

      view() {
        return {
          update(view, prevState) {
            if (!prevState.doc.eq(view.state.doc) && opts.predictions) {
              const ps = typewisePluginKey.getState(view.state)
              // Only schedule a new fetch if there's no active prediction
              if (!ps?.prediction) {
                schedulePrediction(view)
              }
            }
          },
          destroy() {
            if (predictionTimer) clearTimeout(predictionTimer)
            clearCachedGhostElement()
          },
        }
      },
    })

    return [plugin]
  },
})
