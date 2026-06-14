import { node } from "@lonnycorp/htmlforge"
import { COLOR } from "@src/constant.ts"

export class Footer implements node.Buildable {
    private readonly root = new node.Element("footer")
        .style("background", "#000000")
        .style("box-sizing", "border-box")
        .style("color", COLOR.Link)
        .style("font-size", "0.72rem")
        .style("line-height", "1.5")
        .style("margin", "48px 0 0")
        .style("padding", "8px 24px")
        .style("text-align", "center")
        .style("width", "calc(100% + 48px)")
        .child(new node.Text("Created by the "))
        .child(
            new node.Element("a")
                .attribute("href", "https://www.lonnycorp.com")
                .style("color", COLOR.Link)
                .style("background", COLOR.LinkHoverBackground, { pseudoSelector: ":hover" })
                .style("color", COLOR.LinkHoverText, { pseudoSelector: ":hover" })
                .style("font-weight", "700")
                .style("padding", "0 2px")
                .style("text-decoration", "underline")
                .child(new node.Text("Lonny Corporation"))
        )

    build() {
        return this.root.build()
    }
}
