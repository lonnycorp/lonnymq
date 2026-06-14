import { node } from "@lonnycorp/htmlforge"
import { COLOR } from "@src/constant.ts"

const BACKGROUND = "#111111"
const INK = COLOR.Brand

export const styleBody = (body: node.Element) => {
    body
        .style("background", BACKGROUND)
        .style("box-sizing", "border-box")
        .style("font-size", "0.8rem")
        .style("color", INK)
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("font-family", "monospace")
        .style("align-items", "center")
        .style("justify-content", "flex-start")
        .style("margin", "0")
        .style("min-height", "100vh")
        .style("padding", "24px 24px 0")
}
