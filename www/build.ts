import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { spawnSync } from "child_process"
import { Document, node } from "@lonnycorp/htmlforge"
import { Footer } from "@src/component/footer.ts"
import { Helmet } from "@src/component/helmet.ts"
import { IMAGES } from "@src/constant.ts"
import { styleBody } from "@src/shim.ts"
import { DIY_CHAPTERS, DiyPage } from "@src/page/diy.ts"
import { HomePage } from "@src/page/home.ts"

const PACKAGE_DIRECTORY = import.meta.dir
const ROOT_DIRECTORY = dirname(PACKAGE_DIRECTORY)
const DIST_PATH = join(ROOT_DIRECTORY, "dist", "www")
const DIST_DOCS_PATH = join(DIST_PATH, "docs")

const clean = () => {
    rmSync(DIST_PATH, { recursive: true, force: true })
    mkdirSync(DIST_PATH, { recursive: true })
}

const renderPage = (path: string, page: node.Buildable) => {
    const doc = new Document()

    doc.attribute("lang", "en")
    doc.head.child(new Helmet({ title: "LonnyMQ" }))
    styleBody(doc.body)
    doc.body.child(page)
    doc.body.child(new Footer())

    writeFileSync(join(DIST_PATH, path), doc.toString())
}

const buildImages = () => {
    for (const image of IMAGES) {
        const dstPath = join(DIST_PATH, image.publicPath.replace(/^\//, ""))

        mkdirSync(dirname(dstPath), { recursive: true })
        copyFileSync(image.srcPath, dstPath)
    }
}

const buildDocs = () => {
    const result = spawnSync(
        "bun",
        [
            "typedoc",
            "lonnymq/src",
            "--tsconfig",
            "lonnymq/tsconfig.json",
            "--out",
            DIST_DOCS_PATH,
            "--titleLink",
            "/docs/",
        ],
        {
            cwd: ROOT_DIRECTORY,
            stdio: "inherit",
        }
    )

    if (result.status !== 0) {
        throw new Error(`TypeDoc failed with exit code ${result.status}`)
    }
}

const build = () => {
    clean()
    buildImages()
    buildDocs()
    renderPage("index.html", new HomePage())

    for (const chapter of DIY_CHAPTERS) {
        renderPage(chapter.outputPath, new DiyPage(chapter))
    }
}

build()
