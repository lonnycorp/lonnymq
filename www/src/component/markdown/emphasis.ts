import type { Emphasis as MdastEmphasis } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { Phrasing } from "@src/component/markdown/phrasing.ts"
import { COLOR } from "@src/constant.ts"

export class Emphasis implements node.Buildable {
    private readonly root: node.Element

    constructor(emphasis: MdastEmphasis) {
        this.root = new node.Element("span")
            .style("color", COLOR.Brand)
            .style("font-style", "italic")
            .child(new Phrasing(emphasis.children))
    }

    build() {
        return this.root.build()
    }
}
