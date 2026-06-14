import { readFileSync } from "fs"
import { join } from "path"
import { node } from "@lonnycorp/htmlforge"
import { Content } from "@src/component/content.ts"
import { Main } from "@src/component/main.ts"
import { Markdown } from "@src/component/markdown/index.ts"
import { MAIN_NAV_KEY } from "@src/component/nav.ts"
import { WWW_DIRECTORY } from "@src/constant.ts"

const CONTENT_PATH = join(WWW_DIRECTORY, "content/home.md")

export class HomePage implements node.Buildable {
    private readonly root = new Main({ selectedNavKey: MAIN_NAV_KEY.Home })
        .child(
            new Content()
                .child(new Markdown(readFileSync(CONTENT_PATH, "utf8")))
        )

    build() {
        return this.root.build()
    }
}
