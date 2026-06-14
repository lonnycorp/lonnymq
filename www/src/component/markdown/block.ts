import type { BlockContent, RootContent } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { Blocks, type BlockOptions } from "@src/component/markdown/blocks.ts"
import { Code } from "@src/component/markdown/code.ts"
import { Heading, kindFromDepth } from "@src/component/markdown/heading.ts"
import { List } from "@src/component/markdown/list.ts"
import { Paragraph } from "@src/component/markdown/paragraph.ts"
import { Phrasing } from "@src/component/markdown/phrasing.ts"
import { ThematicBreak } from "@src/component/markdown/thematic-break.ts"

export class Block implements node.Buildable {
    private readonly root: node.Buildable

    constructor(block: BlockContent | RootContent, options: BlockOptions = {}) {
        if (block.type === "heading") {
            this.root = new Heading(kindFromDepth(block.depth))
                .child(new Phrasing(block.children))
            return
        }

        if (block.type === "paragraph") {
            this.root = new Paragraph(block, options)
            return
        }

        if (block.type === "code") {
            this.root = new Code(block)
            return
        }

        if (block.type === "list") {
            this.root = new List(block)
            return
        }

        if (block.type === "blockquote") {
            this.root = new Blocks(block.children, { compactParagraphs: true })
            return
        }

        if (block.type === "thematicBreak") {
            this.root = new ThematicBreak()
            return
        }

        throw new Error(`Markdown block node is not supported: ${block.type}`)
    }

    build() {
        return this.root.build()
    }
}
