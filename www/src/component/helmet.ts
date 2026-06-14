import { node } from "@lonnycorp/htmlforge"
import { FAVICON } from "@src/constant.ts"

const HIGHLIGHT_CSS_URL = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/base16/gruvbox-dark-hard.min.css"
const HIGHLIGHT_SCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"
const HIGHLIGHT_POSTGRES_SCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/languages/pgsql.min.js"
const HIGHLIGHT_INIT_SCRIPT = String.raw`
document.addEventListener("DOMContentLoaded", () => {
    if (!window.hljs) {
        return
    }

    hljs.highlightAll()
});
`
type HelmetParams = {
    title: string
}

export class Helmet implements node.Buildable {
    private readonly root: node.Fragment

    constructor(params: HelmetParams) {
        this.root = new node.Fragment()
            .child(new node.Element("meta").attribute("charset", "UTF-8"))
            .child(
                new node.Element("meta")
                    .attribute("name", "viewport")
                    .attribute("content", "width=device-width, initial-scale=1.0")
            )
            .child(new node.Element("title").child(new node.Text(params.title)))
            .child(
                new node.Element("link")
                    .attribute("rel", "icon")
                    .attribute("href", FAVICON.publicPath)
                    .attribute("type", "image/png")
            )
            .child(
                new node.Element("link")
                    .attribute("rel", "stylesheet")
                    .attribute("href", HIGHLIGHT_CSS_URL)
            )
            .child(
                new node.Element("script")
                    .attribute("src", HIGHLIGHT_SCRIPT_URL)
                    .attribute("defer", "defer")
            )
            .child(
                new node.Element("script")
                    .attribute("src", HIGHLIGHT_POSTGRES_SCRIPT_URL)
                    .attribute("defer", "defer")
            )
            .child(
                new node.Element("script")
                    .child(new node.Raw(HIGHLIGHT_INIT_SCRIPT))
            )
    }

    build() {
        return this.root.build()
    }
}
