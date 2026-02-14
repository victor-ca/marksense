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
 *
 * Cursor stability:
 *   ProseMirror's tr.insertText(text, from, to) internally calls
 *   selectionToInsertionEnd(), which moves the cursor to the end of the
 *   replaced range. Because corrections are applied asynchronously (after
 *   an API round-trip), the user's cursor has moved on by then. Every
 *   correction insertText is therefore followed by restoreSelection() to
 *   map the original cursor position through the change.
 *
 *   Decorations (underlines, ghost text) are only rebuilt when the
 *   corrections or prediction data actually change — not on every
 *   meta-only transaction. Unnecessary decoration rebuilds cause DOM
 *   mutations that can displace the browser selection.
 */

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, type EditorState, type Transaction, TextSelection } from "@tiptap/pm/state"
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
  /** Position of the auto-inserted trailing space after a prediction, or -1 */
  predictionSpacePos: number
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

// ─── User dictionary (never-correct list) ────────────────────────────────────

const DICT_STORAGE_KEY = "typewise-user-dictionary"

function loadDictionary(): Set<string> {
  try {
    const stored = localStorage.getItem(DICT_STORAGE_KEY)
    return new Set(stored ? JSON.parse(stored) : [])
  } catch {
    return new Set()
  }
}

let userDictionary = loadDictionary()

export function addToDictionary(word: string): void {
  userDictionary.add(word.toLowerCase())
  try {
    localStorage.setItem(DICT_STORAGE_KEY, JSON.stringify([...userDictionary]))
  } catch { /* quota exceeded — ignore */ }
}

export function isInDictionary(word: string): boolean {
  return userDictionary.has(word.toLowerCase())
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

/**
 * Restore the user's cursor after tr.insertText(text, from, to).
 *
 * ProseMirror's insertText unconditionally moves the cursor to the end of
 * the replacement (via selectionToInsertionEnd). For background corrections
 * we want the cursor to stay where the user left it, so we map the original
 * selection through the replacement mapping and re-apply it.
 */
function restoreSelection(tr: Transaction, originalState: EditorState): void {
  const { anchor, head } = originalState.selection
  const mappedAnchor = tr.mapping.map(anchor)
  const mappedHead = tr.mapping.map(head)
  try {
    tr.setSelection(TextSelection.create(tr.doc, mappedAnchor, mappedHead))
  } catch { /* mapped positions may be invalid — keep insertText's default */ }
}

// ─── Extension ───────────────────────────────────────────────────────────────

export const TypewiseIntegration = Extension.create<TypewiseOptions>({
  name: "typewise",

  addOptions() {
    return {
      apiBaseUrl: "https://api.typewise.ai/v0",
      apiToken: "",
      languages: ["en", "de", "fr"],
      predictionDebounce: 0,
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
          const { tr } = editor.state
          // Insert ghost text + trailing space
          tr.insertText(ghostText + " ", cursorPos)
          tr.setMeta(typewisePluginKey, {
            type: "clear-prediction",
            predictionSpacePos: cursorPos + ghostText.length,
          })
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
    let grammarAbort: AbortController | null = null
    let grammarTimer: ReturnType<typeof setTimeout> | null = null

    // ── Suppress hover popup until mouse actually moves ───────────────
    // After an auto-correction the browser fires mouseover on the new
    // decoration even though the pointer hasn't moved. We suppress the
    // popup until we see a real mousemove.
    let suppressHoverUntilMove = false

    // ── Cached ghost text DOM element (reused to avoid flicker) ──────
    let cachedGhostWrapper: HTMLSpanElement | null = null
    let cachedGhostTextSpan: HTMLSpanElement | null = null

    function getOrCreateGhostElement(ghostText: string): HTMLSpanElement {
      if (!cachedGhostWrapper) {
        cachedGhostWrapper = document.createElement("span")
        cachedGhostWrapper.className = "prediction-ghost-wrapper"

        cachedGhostTextSpan = document.createElement("span")
        cachedGhostTextSpan.className = "prediction-ghost-text"
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

        // Skip corrections for words in the user dictionary
        if (isInDictionary(originalWord)) return

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
          restoreSelection(tr, curState)
          tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
          tr.setMeta("addToHistory", false)
          suppressHoverUntilMove = true
          console.debug("[Typewise] auto-correction:", { original: originalWord, replacement: replacementWord, at: [wordFrom, wordTo], cursor: curState.selection.anchor, restoredCursor: tr.selection.anchor })
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
            const manualTr = curState.tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
            manualTr.setMeta("addToHistory", false)
            view.dispatch(manualTr)
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || signal.aborted) return
        console.debug("[Typewise] correction error:", err)
      }
    }

    // ── API: grammar correction ──────────────────────────────────────

    const SENTENCE_END_PUNCTUATION = [".", "!", "?"]
    const SENTENCE_END_RE = /([.!?])(\s|\n)|(?<![.!?\n *])\s*\n/

    /**
     * Extract the sentence around (or ending at) the given position.
     * Returns { text, from, to } where from/to are document positions.
     */
    function getSentenceAtPos(state: EditorState, pos: number): { text: string; from: number; to: number } | null {
      const $pos = state.doc.resolve(pos)
      const blockStart = $pos.start()
      const blockEnd = $pos.end()
      const blockText = state.doc.textBetween(blockStart, blockEnd, "")

      if (blockText.trim().length < 3) return null

      const posInBlock = pos - blockStart

      // 1. Find the end of the sentence at or before the cursor position.
      //    If the cursor is right after ".", the sentence end is at the cursor.
      let sentenceEnd = -1
      // First check: is there sentence-ending punctuation at or before cursor?
      for (let i = Math.min(posInBlock, blockText.length) - 1; i >= 0; i--) {
        if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
          sentenceEnd = i + 1
          break
        }
      }
      // If no punctuation before cursor, look forward (editing mid-sentence)
      if (sentenceEnd === -1) {
        for (let i = posInBlock; i < blockText.length; i++) {
          if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
            sentenceEnd = i + 1
            break
          }
        }
      }
      // No sentence boundary found at all → use block end
      if (sentenceEnd === -1) sentenceEnd = blockText.length

      // 2. Find the start of this sentence (look for previous sentence boundary)
      let sentenceStart = 0
      for (let i = sentenceEnd - 2; i >= 0; i--) {
        if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
          sentenceStart = i + 1
          // Skip whitespace after the previous sentence's punctuation
          while (sentenceStart < sentenceEnd && /\s/.test(blockText[sentenceStart])) {
            sentenceStart++
          }
          break
        }
      }

      const text = blockText.slice(sentenceStart, sentenceEnd)
      if (text.trim().length < 3) return null

      return { text, from: blockStart + sentenceStart, to: blockStart + sentenceEnd }
    }

    /**
     * Check if a sentence is complete (ends with punctuation).
     */
    function isSentenceComplete(text: string): boolean {
      const trimmed = text.trimEnd()
      return SENTENCE_END_PUNCTUATION.some(p => trimmed.endsWith(p))
    }

    async function checkGrammar(sentenceText: string, sentenceFrom: number, fullText: string) {
      if (!opts.autocorrect) return

      if (grammarAbort) grammarAbort.abort()
      grammarAbort = new AbortController()

      try {
        // Ensure text ends with punctuation (API requirement)
        const text = isSentenceComplete(sentenceText) ? sentenceText : sentenceText + "\n"

        const data = await typewisePost(
          opts.apiBaseUrl,
          "/grammar_correction/whole_text_grammar_correction",
          { text, languages: opts.languages, full_text: fullText },
          opts.apiToken || undefined
        )
        if (grammarAbort.signal.aborted || !data || tiptapEditor.isDestroyed) return

        const view = tiptapEditor.view
        const matches = data.matches || []
        if (matches.length === 0) return

        for (const match of matches) {
          const startIndex: number = match.startIndex ?? match.offset ?? 0
          const charsToReplace: number = match.charsToReplace ?? match.length ?? 0
          const suggestions = match.suggestions || match.replacements?.map((r: any) => ({
            correction: r.value,
            score: 1,
          })) || []

          if (charsToReplace === 0 || suggestions.length === 0) continue

          const wordFrom = sentenceFrom + startIndex
          const wordTo = wordFrom + charsToReplace
          if (wordFrom < 0 || wordTo > view.state.doc.content.size) continue

          const originalWord = view.state.doc.textBetween(wordFrom, wordTo, "")
          if (isInDictionary(originalWord)) continue

          const correctionType: "auto" | "manual" = match.correctionType === "auto" || match.underline_choice === "auto"
            ? "auto" : "manual"

          // Check if there's already a correction overlapping this range
          const ps = typewisePluginKey.getState(view.state)
          const hasOverlap = ps?.corrections.some(c =>
            (c.from < wordTo && c.to > wordFrom)
          )
          if (hasOverlap) continue

          if (correctionType === "auto" && suggestions[0]?.correction) {
            const replacementWord = suggestions[0].correction
            if (replacementWord === originalWord) continue

            const correction: CorrectionEntry = {
              id: nextCorrectionId(),
              from: wordFrom,
              to: wordFrom + replacementWord.length,
              type: "auto",
              originalValue: originalWord,
              currentValue: replacementWord,
              suggestions,
            }

            const { tr } = view.state
            tr.insertText(replacementWord, wordFrom, wordTo)
            restoreSelection(tr, view.state)
            tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
            tr.setMeta("addToHistory", false)
            suppressHoverUntilMove = true
            console.debug("[Typewise] grammar auto-correction:", { original: originalWord, replacement: replacementWord, at: [wordFrom, wordTo], cursor: view.state.selection.anchor, restoredCursor: tr.selection.anchor })
            view.dispatch(tr)
          } else if (correctionType === "manual") {
            const correction: CorrectionEntry = {
              id: nextCorrectionId(),
              from: wordFrom,
              to: wordTo,
              type: "manual",
              originalValue: originalWord,
              currentValue: originalWord,
              suggestions,
            }
            const manualTr = view.state.tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
            manualTr.setMeta("addToHistory", false)
            view.dispatch(manualTr)
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || grammarAbort?.signal.aborted) return
        console.warn("[Typewise] grammar correction error:", err)
      }
    }

    /**
     * Schedule grammar correction with a debounce.
     * Called when a sentence end is detected or when editing within a complete sentence.
     */
    function scheduleGrammarCheck(view: EditorView) {
      if (grammarTimer) clearTimeout(grammarTimer)
      grammarTimer = setTimeout(() => {
        const { $from } = view.state.selection
        const pos = $from.pos
        const sentence = getSentenceAtPos(view.state, pos)
        if (!sentence) return

        // Get full text up to and including the sentence (context for the API)
        const blockStart = $from.start()
        const fullText = view.state.doc.textBetween(0, sentence.to, "\n")
        checkGrammar(sentence.text, sentence.from, fullText)
      }, 800) // Small delay to avoid firing while still typing
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

        // Don't overwrite an existing prediction (it may have advanced via overlap)
        const currentPluginState = typewisePluginKey.getState(tiptapEditor.view.state)
        if (currentPluginState?.prediction) return

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
              class: c.type === "auto" ? "correction-underline-blue" : "correction-underline-red",
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
            predictionSpacePos: -1,
          }
        },

        apply(tr, prev, _oldState, newState): TypewisePluginState {
          const meta = tr.getMeta(typewisePluginKey)

          // Map correction positions only when the document changed;
          // skipping this for meta-only transactions avoids rebuilding
          // decorations (and the DOM mutations that can displace the cursor).
          let corrections = tr.docChanged
            ? prev.corrections
                .map((c) => ({
                  ...c,
                  from: tr.mapping.map(c.from, 1),
                  to: tr.mapping.map(c.to, -1),
                }))
                .filter((c) => c.from < c.to)
            : prev.corrections

          let activeCorrection = prev.activeCorrection
          let prediction = prev.prediction
          let predictionSpacePos = prev.predictionSpacePos

          // Map prediction space position through doc changes
          if (tr.docChanged && predictionSpacePos >= 0) {
            predictionSpacePos = tr.mapping.map(predictionSpacePos)
          }

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
                // Track the position of the auto-inserted space after prediction
                if (typeof meta.predictionSpacePos === "number") {
                  predictionSpacePos = meta.predictionSpacePos
                }
                break
              case "clear-prediction-space":
                predictionSpacePos = -1
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

          // ── Remove corrections whose text no longer matches ──
          // When the user edits (types into or deletes from) a corrected word,
          // the text at the mapped correction range will diverge from currentValue.
          // Also detect word extension: if a word character now sits right at
          // a correction boundary (e.g. user appended letters), the word is
          // changing and the correction is stale.
          if (tr.docChanged && !meta) {
            corrections = corrections.filter((c) => {
              if (c.from < 0 || c.to > newState.doc.content.size) return false
              const textNow = newState.doc.textBetween(c.from, c.to, "")
              if (textNow !== c.currentValue) return false
              // Word extended at the end? (e.g. user typed more letters after the word)
              if (c.to < newState.doc.content.size) {
                const charAfter = newState.doc.textBetween(c.to, c.to + 1, "")
                if (/\w/.test(charAfter)) return false
              }
              // Word extended at the start?
              if (c.from > 0) {
                const charBefore = newState.doc.textBetween(c.from - 1, c.from, "")
                if (/\w/.test(charBefore)) return false
              }
              return true
            })
            if (
              activeCorrection &&
              !corrections.find((c) => c.id === activeCorrection!.id)
            ) {
              activeCorrection = null
            }
          }

          // Only rebuild decorations (and trigger DOM mutations) when the
          // visual state actually changed — not on every meta-only transaction.
          const decorations = (corrections !== prev.corrections || prediction !== prev.prediction || tr.docChanged)
            ? buildDecorations(newState.doc, corrections, prediction)
            : prev.decorations

          return { corrections, activeCorrection, prediction, decorations, predictionSpacePos }
        },
      },

      props: {
        decorations(state) {
          return this.getState(state)?.decorations ?? DecorationSet.empty
        },

        // Detect clicks on correction underlines (single-click only)
        handleClick(view, pos, event) {
          // Only intercept single clicks — let double/triple clicks perform native
          // word/line selection even on underlined words
          if (event.detail !== 1) return false

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
          mousemove(_view, _event) {
            // Clear the suppress flag on real mouse movement so
            // subsequent hovers can open the correction popup.
            if (suppressHoverUntilMove) suppressHoverUntilMove = false
            return false
          },
          mouseover(view, event) {
            // Skip if hover is suppressed (mouse was stationary when a
            // new correction decoration appeared under the pointer).
            if (suppressHoverUntilMove) return false

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

        // Trigger spellcheck + grammar when pressing Enter (new paragraph).
        // ProseMirror handles Enter by splitting the block, so handleTextInput
        // never fires — we need handleKeyDown to catch it.
        // We capture the text and call the APIs directly because after Enter
        // the cursor moves to the new (empty) block; a debounced
        // scheduleGrammarCheck would read from the wrong paragraph.
        handleKeyDown(view, event) {
          if (event.key === "Enter" && opts.autocorrect) {
            const { $from } = view.state.selection
            const blockStart = $from.start()
            const textBeforeCursor = view.state.doc.textBetween(blockStart, $from.pos, "")
            if (textBeforeCursor.trim().length >= 2) {
              checkFinalWord(textBeforeCursor, blockStart)
            }
            if (textBeforeCursor.trim().length >= 3) {
              const fullText = view.state.doc.textBetween(0, $from.pos, "\n")
              checkGrammar(textBeforeCursor, blockStart, fullText)
            }
          }
          return false
        },

        // Trigger corrections on word boundaries + grammar on sentence end
        handleTextInput(view, from, _to, text) {
          // Smart space: if we just inserted a trailing space after a prediction
          // and the user types punctuation, reattach it to the previous word.
          // "example |" + "." → "example. |"
          const ps = typewisePluginKey.getState(view.state)
          const spacePos = ps?.predictionSpacePos ?? -1

          if (spacePos >= 0 && /^[.,;:!?)\]}>]$/.test(text)) {
            // Verify the space is still at the expected position
            if (spacePos < view.state.doc.content.size) {
              const charAtSpace = view.state.doc.textBetween(spacePos, spacePos + 1, "")
              if (charAtSpace === " ") {
                const { tr } = view.state
                // Replace space with punctuation + space
                tr.insertText(text + " ", spacePos, spacePos + 1)
                // Clear the prediction space tracker
                tr.setMeta(typewisePluginKey, { type: "clear-prediction-space" })
                view.dispatch(tr)
                // Still trigger grammar check if sentence-ending punctuation
                if (SENTENCE_END_PUNCTUATION.includes(text)) {
                  scheduleGrammarCheck(view)
                }
                return true
              }
            }
          }

          // Any other non-punctuation input clears the prediction space tracker
          if (spacePos >= 0 && !/^[.,;:!?)\]}>]$/.test(text)) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, { type: "clear-prediction-space" })
            )
          }

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

          // Trigger grammar check when sentence-ending punctuation is typed,
          // OR when a space is typed right after sentence-ending punctuation
          const isSentenceEnd = SENTENCE_END_PUNCTUATION.includes(text) ||
            (text === " " && from > 0 && SENTENCE_END_PUNCTUATION.includes(
              view.state.doc.textBetween(from - 1, from, ""))) ||
            (text === "\n")
          if (isSentenceEnd) {
            scheduleGrammarCheck(view)
          }

          return false
        },
      },

      view() {
        return {
          update(view, prevState) {
            // ── Cursor-jump detector ──────────────────────────────────
            const prevAnchor = prevState.selection.anchor
            const newAnchor = view.state.selection.anchor
            if (Math.abs(newAnchor - prevAnchor) > 3) {
              const docChanged = !prevState.doc.eq(view.state.doc)
              const prevPs = typewisePluginKey.getState(prevState) as TypewisePluginState | undefined
              const newPs = typewisePluginKey.getState(view.state) as TypewisePluginState | undefined
              console.debug("[Typewise] cursor jump:", {
                from: prevAnchor,
                to: newAnchor,
                delta: newAnchor - prevAnchor,
                docChanged,
                docSize: view.state.doc.content.size,
                nearEnd: newAnchor > view.state.doc.content.size - 3,
                corrections: { before: prevPs?.corrections.length ?? 0, after: newPs?.corrections.length ?? 0 },
                predictionChanged: !!prevPs?.prediction !== !!newPs?.prediction,
                popupChanged: !!prevPs?.activeCorrection !== !!newPs?.activeCorrection,
              })
            }

            if (!prevState.doc.eq(view.state.doc)) {
              if (opts.predictions) {
                const ps = typewisePluginKey.getState(view.state)
                // Only schedule a new fetch if there's no active prediction
                if (!ps?.prediction) {
                  schedulePrediction(view)
                }
              }

              // Grammar check: when editing inside an existing complete sentence
              if (opts.autocorrect) {
                const { $from } = view.state.selection
                const pos = $from.pos
                const sentence = getSentenceAtPos(view.state, pos)
                if (sentence) {
                  // Check if text AFTER the cursor contains sentence-ending punctuation
                  // (i.e. we're editing inside an already-complete sentence)
                  const textAfterCursor = sentence.text.slice(pos - sentence.from)
                  if (SENTENCE_END_PUNCTUATION.some(p => textAfterCursor.includes(p))) {
                    scheduleGrammarCheck(view)
                  }
                }
              }
            }
          },
          destroy() {
            if (predictionTimer) clearTimeout(predictionTimer)
            if (grammarTimer) clearTimeout(grammarTimer)
            clearCachedGhostElement()
          },
        }
      },
    })

    return [plugin]
  },
})
