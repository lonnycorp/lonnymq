import { node } from "@lonnycorp/htmlforge"
import { fromMarkdown } from "mdast-util-from-markdown"
import { Blocks } from "@src/component/markdown/blocks.ts"

export class Markdown implements node.Buildable {
    private readonly root: Blocks

    constructor(markdown: string) {
        this.root = new Blocks(fromMarkdown(markdown).children)
    }

    build() {
        return this.root.build()
    }
}
