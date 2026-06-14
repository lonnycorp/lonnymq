import type { Text as MdastText } from "mdast"
import { node } from "@lonnycorp/htmlforge"

export class Text implements node.Buildable {
    private readonly root: node.Text

    constructor(text: MdastText) {
        this.root = new node.Text(text.value)
    }

    build() {
        return this.root.build()
    }
}
