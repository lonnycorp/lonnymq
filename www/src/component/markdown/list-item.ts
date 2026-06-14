import type { ListItem as MdastListItem } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { Blocks } from "@src/component/markdown/blocks.ts"
import { Phrasing } from "@src/component/markdown/phrasing.ts"

export class ListItem implements node.Buildable {
    private readonly root: node.Buildable

    constructor(item: MdastListItem) {
        if (item.children.length === 1 && item.children[0]?.type === "paragraph") {
            this.root = new Phrasing(item.children[0].children)
            return
        }

        this.root = new Blocks(item.children, { compactParagraphs: true })
    }

    build() {
        return this.root.build()
    }
}
