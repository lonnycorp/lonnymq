import type { List as MdastList } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { ListItem } from "@src/component/markdown/list-item.ts"

export class List implements node.Buildable {
    private readonly root: node.Element

    constructor(list: MdastList) {
        this.root = new node.Element(list.ordered ? "ol" : "ul")
            .style("margin", list.ordered ? "0 0 18px" : "0")
            .style("padding", "0 0 0 24px")

        for (const item of list.children) {
            this.root.child(
                new node.Element("li")
                    .style("margin", "6px 0")
                    .child(new ListItem(item))
            )
        }
    }

    build() {
        return this.root.build()
    }
}
