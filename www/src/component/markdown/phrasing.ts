import type { PhrasingContent } from "mdast"
import { node } from "@lonnycorp/htmlforge"
import { PhrasingChild } from "@src/component/markdown/phrasing-child.ts"

export class Phrasing implements node.Buildable {
    private readonly root = new node.Fragment()

    constructor(children: PhrasingContent[]) {
        for (const child of children) {
            this.root.child(new PhrasingChild(child))
        }
    }

    build() {
        return this.root.build()
    }
}
