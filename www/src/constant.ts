import { dirname, join } from "path"

export const ROOT_DIRECTORY = dirname(dirname(import.meta.dir))
export const WWW_DIRECTORY = join(ROOT_DIRECTORY, "www")

export const COLOR = {
    Brand: "#B6FF00",
    Inactive: "#666666",
    Link: "#FFFFFF",
    LinkHoverBackground: "#FFFFFF",
    LinkHoverText: "#000000",
} as const

export type Image = {
    srcPath: string
    publicPath: string
}

export const FAVICON: Image = {
    srcPath: join(ROOT_DIRECTORY, "asset/www/favicon.png"),
    publicPath: "/asset/favicon.png",
}

export const IMAGES: Image[] = [
    FAVICON,
]
