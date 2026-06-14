import type { Paragraph as MdastParagraph } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { type BlockOptions } from "@src/component/markdown/blocks.ts"
import { Phrasing } from "@src/component/markdown/phrasing.ts"

export class Paragraph implements node.Buildable {
    private readonly root: node.Element

    constructor(paragraph: MdastParagraph, options: BlockOptions = {}) {
        this.root = new node.Element("p")
            .style("margin", options.compactParagraphs ? "0" : "0 0 18px")
            .child(new Phrasing(paragraph.children))
    }

    build() {
        return this.root.build()
    }
}
