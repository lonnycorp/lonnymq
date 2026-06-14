import type { PhrasingContent } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { Break } from "@src/component/markdown/break.ts"
import { Emphasis } from "@src/component/markdown/emphasis.ts"
import { InlineCode } from "@src/component/markdown/inline-code.ts"
import { Link } from "@src/component/markdown/link.ts"
import { Strong } from "@src/component/markdown/strong.ts"
import { Text } from "@src/component/markdown/text.ts"

export class PhrasingChild implements node.Buildable {
    private readonly root: node.Buildable

    constructor(child: PhrasingContent) {
        if (child.type === "text") {
            this.root = new Text(child)
            return
        }

        if (child.type === "inlineCode") {
            this.root = new InlineCode(child)
            return
        }

        if (child.type === "emphasis") {
            this.root = new Emphasis(child)
            return
        }

        if (child.type === "strong") {
            this.root = new Strong(child)
            return
        }

        if (child.type === "link") {
            this.root = new Link(child)
            return
        }

        if (child.type === "break") {
            this.root = new Break()
            return
        }

        throw new Error(`Markdown inline node is not supported: ${child.type}`)
    }

    build() {
        return this.root.build()
    }
}
