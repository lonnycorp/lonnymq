import { node } from "@lonnycorp/htmlforge"

export class Content implements node.Buildable {
    private readonly root = new node.Element("section")
        .style("background", "#181818")
        .style("box-shadow", "6px 6px 0 #050505")
        .style("box-sizing", "border-box")
        .style("color", "#FFFFFF")
        .style("line-height", "1.55")
        .style("margin", "26px auto 0")
        .style("max-width", "720px")
        .style("padding", "24px")
        .style("width", "100%")

    child(child: node.Buildable) {
        this.root.child(child)
        return this
    }

    build() {
        return this.root.build()
    }
}
