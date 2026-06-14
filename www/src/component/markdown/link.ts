import type { Link as MdastLink } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { Phrasing } from "@src/component/markdown/phrasing.ts"
import { COLOR } from "@src/constant.ts"

export class Link implements node.Buildable {
    private readonly root: node.Element

    constructor(link: MdastLink) {
        this.root = new node.Element("a")
            .attribute("href", link.url)
            .style("color", COLOR.Link)
            .style("background", COLOR.LinkHoverBackground, { pseudoSelector: ":hover" })
            .style("color", COLOR.LinkHoverText, { pseudoSelector: ":hover" })
            .style("padding", "0 2px")
            .child(new Phrasing(link.children))
    }

    build() {
        return this.root.build()
    }
}
