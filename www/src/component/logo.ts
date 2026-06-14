import { node } from "@lonnycorp/htmlforge"
import { COLOR } from "@src/constant.ts"

const LOGO = String.raw`
888                                         888b     d888  .d88888b.  
888                                         8888b   d8888 d88P" "Y88b 
888                                         88888b.d88888 888     888 
888      .d88b.  88888b.  88888b.  888  888 888Y88888P888 888     888 
888     d88""88b 888 "88b 888 "88b 888  888 888 Y888P 888 888     888 
888     888  888 888  888 888  888 888  888 888  Y8P  888 888 Y8b 888 
888     Y88..88P 888  888 888  888 Y88b 888 888   "   888 Y88b.Y8b88P 
88888888 "Y88P"  888  888 888  888  "Y88888 888       888  "Y888888"  
                                        888                      Y8b  
                                   Y8b d88P                           
                                    "Y88P"
`

const LOGO_LINES = LOGO.trim().split("\n")
const GRADIENT_START = COLOR.Link
const GRADIENT_END = COLOR.Brand

const interpolateColor = (start: string, end: string, ratio: number) => {
    const startValue = Number.parseInt(start.slice(1), 16)
    const endValue = Number.parseInt(end.slice(1), 16)

    const startRed = (startValue >> 16) & 0xff
    const startGreen = (startValue >> 8) & 0xff
    const startBlue = startValue & 0xff
    const endRed = (endValue >> 16) & 0xff
    const endGreen = (endValue >> 8) & 0xff
    const endBlue = endValue & 0xff

    const red = Math.round(startRed + (endRed - startRed) * ratio)
    const green = Math.round(startGreen + (endGreen - startGreen) * ratio)
    const blue = Math.round(startBlue + (endBlue - startBlue) * ratio)

    return `rgb(${red}, ${green}, ${blue})`
}

export class Logo implements node.Buildable {
    private readonly logo = new node.Element("pre")
        .style("display", "block")
        .style("margin", "0")
        .style("width", "max-content")
        .style("white-space", "pre")

    private readonly root = new node.Element("div")
        .style("display", "flex")
        .style("display", "none", { mediaQuery: "@media (max-width: 640px)" })
        .style("justify-content", "center")
        .style("margin-top", "24px")
        .child(this.logo)

    constructor() {
        for (let index = 0; index < LOGO_LINES.length; index += 1) {
            const ratio = index / (LOGO_LINES.length - 1)

            this.logo
                .child(
                    new node.Element("span")
                        .style("color", interpolateColor(GRADIENT_START, GRADIENT_END, ratio))
                        .child(new node.Text(LOGO_LINES[index]))
                )
                .child(new node.Text(index === LOGO_LINES.length - 1 ? "" : "\n"))
        }
    }

    build() {
        return this.root.build()
    }
}
