import { node } from "@lonnycorp/htmlforge"

export class ThematicBreak implements node.Buildable {
    private readonly root = new node.Element("hr")
        .style("border", "0")
        .style("border-top", "1px solid #2F2F2F")
        .style("margin", "24px 0")

    build() {
        return this.root.build()
    }
}
