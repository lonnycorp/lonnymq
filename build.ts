import { mkdirSync, rmSync } from "fs"
import { join } from "path"

const PACKAGE_DIRECTORY = import.meta.dir
const OUTPUT_DIRECTORY = join(PACKAGE_DIRECTORY, "dist")

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
        OUTPUT_DIRECTORY,
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
