import { copyFileSync, mkdirSync, rmSync } from "fs"
import { dirname, join } from "path"

const PACKAGE_DIRECTORY = import.meta.dir
const ROOT_DIRECTORY = dirname(PACKAGE_DIRECTORY)
const OUTPUT_DIRECTORY = join(ROOT_DIRECTORY, "dist", "lonnymq")
const BUNDLE_DIRECTORY = join(OUTPUT_DIRECTORY, "dist")

rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true })
mkdirSync(OUTPUT_DIRECTORY, { recursive: true })

const build = Bun.spawn({
    cmd: [
        "bun",
        "run",
        "tsdown",
        "src/index.ts",
        "--no-config",
        "--out-dir",
        BUNDLE_DIRECTORY,
        "--format",
        "esm",
        "--dts",
        "--clean",
        "--target",
        "es2022",
        "--platform",
        "node",
    ],
    cwd: PACKAGE_DIRECTORY,
    stderr: "inherit",
    stdout: "inherit",
})

const exitCode = await build.exited

if (exitCode !== 0) {
    process.exit(exitCode)
}

copyFileSync(join(PACKAGE_DIRECTORY, "package.json"), join(OUTPUT_DIRECTORY, "package.json"))
