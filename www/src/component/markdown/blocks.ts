import type { BlockContent, RootContent } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { Block } from "@src/component/markdown/block.ts"

export type BlockOptions = {
    compactParagraphs?: boolean
}

export class Blocks implements node.Buildable {
    private readonly root = new node.Fragment()

    constructor(blocks: Array<BlockContent | RootContent>, options: BlockOptions = {}) {
        for (const block of blocks) {
            this.root.child(new Block(block, options))
        }
    }

    build() {
        return this.root.build()
    }
}
