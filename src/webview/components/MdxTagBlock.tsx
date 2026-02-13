import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import "./MdxTagBlock.scss"

/**
 * Renders a single JSX tag (opening, closing, or self-closing) as a compact,
 * non-editable code chip.  Used by the `MdxTag` atom node.
 */
export function MdxTagBlock({ node }: NodeViewProps) {
  const tag: string = node.attrs.tag || ""

  return (
    <NodeViewWrapper className="mdx-tag-block" contentEditable={false}>
      <code className="mdx-tag-code">{tag}</code>
    </NodeViewWrapper>
  )
}
