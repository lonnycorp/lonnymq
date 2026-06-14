import { readFileSync } from "fs"
import { join } from "path"
import { node } from "@lonnycorp/htmlforge"
import { Content } from "@src/component/content.ts"
import { Main } from "@src/component/main.ts"
import { Markdown } from "@src/component/markdown/index.ts"
import { MAIN_NAV_KEY } from "@src/component/nav.ts"
import { COLOR, WWW_DIRECTORY } from "@src/constant.ts"

export type DiyChapterKey =
    | "intro"
    | "scheduling"
    | "priority"
    | "multi-tenancy"
    | "durability"

export type DiyChapter = {
    key: DiyChapterKey
    label: string
    href: string
    outputPath: string
    contentPath: string
}

export const DIY_CHAPTERS: DiyChapter[] = [
    {
        key: "intro",
        label: "01",
        href: "/diy.html",
        outputPath: "diy.html",
        contentPath: join(WWW_DIRECTORY, "content/diy/01-intro.md"),
    },
    {
        key: "scheduling",
        label: "02",
        href: "/diy-scheduling.html",
        outputPath: "diy-scheduling.html",
        contentPath: join(WWW_DIRECTORY, "content/diy/02-scheduling.md"),
    },
    {
        key: "priority",
        label: "03",
        href: "/diy-priority.html",
        outputPath: "diy-priority.html",
        contentPath: join(WWW_DIRECTORY, "content/diy/03-priority.md"),
    },
    {
        key: "multi-tenancy",
        label: "04",
        href: "/diy-multi-tenancy.html",
        outputPath: "diy-multi-tenancy.html",
        contentPath: join(WWW_DIRECTORY, "content/diy/04-multi-tenancy.md"),
    },
    {
        key: "durability",
        label: "05",
        href: "/diy-durability.html",
        outputPath: "diy-durability.html",
        contentPath: join(WWW_DIRECTORY, "content/diy/05-durability.md"),
    },
]

type DiyNavPlacement = "top" | "bottom"

class DiyNav implements node.Buildable {
    private readonly root = new node.Element("nav")
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("gap", "6px")
        .style("justify-content", "center")
        .style("line-height", "1.5")

    constructor(
        chapters: DiyChapter[],
        private readonly selectedKey: DiyChapterKey,
        placement: DiyNavPlacement
    ) {
        this.root.style("margin", placement === "top" ? "0 0 24px" : "32px 0 0")

        const selectedIndex = chapters.findIndex((chapter) => chapter.key === selectedKey)
        const previous = selectedIndex > 0 ? chapters[selectedIndex - 1] : null
        const next = selectedIndex >= 0 && selectedIndex < chapters.length - 1
            ? chapters[selectedIndex + 1]
            : null

        this.root
            .child(this.createPagerLink("<prev", previous))
            .child(this.createSeparator())

        for (let index = 0; index < chapters.length; index += 1) {
            const chapter = chapters[index]

            if (index > 0) {
                this.root.child(this.createSeparator())
            }

            this.root.child(this.createLink(chapter))
        }

        this.root
            .child(this.createSeparator())
            .child(this.createPagerLink("next>", next))
    }

    build() {
        return this.root.build()
    }

    private createLink(chapter: DiyChapter) {
        if (chapter.key === this.selectedKey) {
            return new node.Element("span")
                .style("color", COLOR.Inactive)
                .style("font-weight", "700")
                .style("padding", "0 2px")
                .child(new node.Text(chapter.label))
        }

        return new node.Element("a")
            .attribute("href", chapter.href)
            .style("color", COLOR.Link)
            .style("background", COLOR.LinkHoverBackground, { pseudoSelector: ":hover" })
            .style("color", COLOR.LinkHoverText, { pseudoSelector: ":hover" })
            .style("font-weight", "700")
            .style("padding", "0 2px")
            .style("text-decoration", "underline")
            .child(new node.Text(chapter.label))
    }

    private createPagerLink(label: string, chapter: DiyChapter | null) {
        if (chapter === null) {
            return new node.Element("span")
                .style("color", COLOR.Inactive)
                .style("font-weight", "700")
                .style("padding", "0 2px")
                .child(new node.Text(label))
        }

        return new node.Element("a")
            .attribute("href", chapter.href)
            .style("color", COLOR.Link)
            .style("background", COLOR.LinkHoverBackground, { pseudoSelector: ":hover" })
            .style("color", COLOR.LinkHoverText, { pseudoSelector: ":hover" })
            .style("font-weight", "700")
            .style("padding", "0 2px")
            .style("text-decoration", "underline")
            .child(new node.Text(label))
    }

    private createSeparator() {
        return new node.Element("span")
            .style("color", COLOR.Link)
            .child(new node.Text("|"))
    }
}

export class DiyPage implements node.Buildable {
    private readonly root: Main

    constructor(chapter: DiyChapter) {
        this.root = new Main({ selectedNavKey: MAIN_NAV_KEY.Diy })
            .child(
                new Content()
                    .child(new DiyNav(DIY_CHAPTERS, chapter.key, "top"))
                    .child(new Markdown(readFileSync(chapter.contentPath, "utf8")))
                    .child(new DiyNav(DIY_CHAPTERS, chapter.key, "bottom"))
            )
    }

    build() {
        return this.root.build()
    }
}
