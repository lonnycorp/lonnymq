import { node } from "@lonnycorp/htmlforge"
import { COLOR } from "@src/constant.ts"

type Link = {
    key: MainNavKey
    label: string
    href: string
}

export const MAIN_NAV_KEY = {
    Home: "home",
    Diy: "diy",
    Source: "source",
    Docs: "docs",
} as const

export type MainNavKey = typeof MAIN_NAV_KEY[keyof typeof MAIN_NAV_KEY]

const LINKS: Link[] = [
    { key: MAIN_NAV_KEY.Home, label: "home", href: "/" },
    { key: MAIN_NAV_KEY.Diy, label: "diy", href: "/diy.html" },
    { key: MAIN_NAV_KEY.Source, label: "source", href: "https://github.com/lonnycorp/lonnymq" },
    { key: MAIN_NAV_KEY.Docs, label: "docs", href: "/docs/" },
]

type NavOptions = {
    selectedKey?: MainNavKey
    links?: Link[]
}

export class Nav implements node.Buildable {
    private readonly selectedKey?: MainNavKey

    private readonly root = new node.Element("nav")
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("gap", "8px")
        .style("justify-content", "center")
        .style("line-height", "1.5")
        .style("margin", "34px 0 0")
        .style("gap", "6px", { mediaQuery: "@media (max-width: 640px)" })
        .style("margin", "12px 0 0", { mediaQuery: "@media (max-width: 640px)" })

    constructor(options: NavOptions = {}) {
        const links = options.links ?? LINKS
        this.selectedKey = options.selectedKey

        this.root
            .child(
                new node.Element("span")
                    .style("color", COLOR.Brand)
                    .style("display", "none")
                    .style("display", "inline", { mediaQuery: "@media (max-width: 640px)" })
                    .style("font-weight", "700")
                    .child(new node.Text("LonnyMQ"))
            )
            .child(this.createSeparator({ mobileOnly: true }))

        for (let index = 0; index < links.length; index += 1) {
            const link = links[index]

            if (index > 0) {
                this.root.child(this.createSeparator())
            }

            this.root.child(this.createLink(link))
        }
    }

    build() {
        return this.root.build()
    }

    private createLink(link: Link) {
        if (link.key === this.selectedKey) {
            return new node.Element("span")
                .style("color", COLOR.Inactive)
                .style("font-weight", "700")
                .style("padding", "0 2px")
                .child(new node.Text(link.label))
        }

        return new node.Element("a")
            .attribute("href", link.href)
            .style("color", COLOR.Link)
            .style("background", COLOR.LinkHoverBackground, { pseudoSelector: ":hover" })
            .style("color", COLOR.LinkHoverText, { pseudoSelector: ":hover" })
            .style("font-weight", "700")
            .style("padding", "0 2px")
            .style("text-decoration", "underline")
            .child(new node.Text(link.label))
    }

    private createSeparator(options?: { mobileOnly?: boolean }) {
        const separator = new node.Element("span")
            .style("color", COLOR.Link)
            .child(new node.Text("|"))

        if (options?.mobileOnly) {
            separator
                .style("display", "none")
                .style("display", "inline", { mediaQuery: "@media (max-width: 640px)" })
        }

        return separator
    }
}
