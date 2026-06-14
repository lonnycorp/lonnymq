import type { InlineCode as MdastInlineCode } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { COLOR } from "@src/constant.ts"

export class InlineCode implements node.Buildable {
    private readonly root: node.Element

    constructor(code: MdastInlineCode) {
        this.root = new node.Element("code")
            .style("background", "#0B0B0B")
            .style("color", COLOR.Brand)
            .style("padding", "0 3px")
            .child(new node.Text(code.value))
    }

    build() {
        return this.root.build()
    }
}
