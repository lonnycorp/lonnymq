import type { Code as MdastCode } from "mdast"
import { node } from "@lonnycorp/htmlforge"

export class Code implements node.Buildable {
    private readonly root: node.Element

    constructor(code: MdastCode) {
        this.root = new node.Element("pre")
            .style("border", "1px solid #2F2F2F")
            .style("box-shadow", "4px 4px 0 #050505")
            .style("box-sizing", "border-box")
            .style("font-size", "13px")
            .style("line-height", "1.45")
            .style("margin", "0 0 18px")
            .style("overflow-x", "auto")
            .style("width", "100%")
            .child(
                new node.Element("code")
                    .attribute("class", `language-${code.lang ?? "text"}`)
                    .child(new node.Text(code.value))
            )
    }

    build() {
        return this.root.build()
    }
}
