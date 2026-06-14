export type Value = null | number | string | boolean | bigint | Date
export type ValueNode<T extends Value> = { nodeType: "VALUE", value: T }
export type RefNode = { nodeType: "REF", value: string }
export type RawNode = { nodeType: "RAW", value: string }

export type Node =
    | ValueNode<any>
    | RefNode
    | RawNode

export const value = <T extends Value>(value: T): ValueNode<T> => ({
    nodeType: "VALUE",
    value
})

export const ref = (value: string): RefNode => ({
    nodeType: "REF",
    value: value
})

export const raw = (value: string): RawNode => ({
    nodeType: "RAW",
    value
})

const escapeString = (value : string): string => {
    const escaped = value.replace(/'/g, "''")
    return `'${escaped}'`
}

const escapeValue = (value: Value): string => {
    if (value === null) {
        return "NULL"
    } else if (typeof value === "string") {
        return escapeString(value)
    } else if (typeof value === "number") {
        return value.toString()
    } else if (typeof value === "boolean") {
        return value ? "TRUE" : "FALSE"
    } else if (value instanceof Date) {
        return `'${value.toISOString()}'`
    } else if (typeof value === "bigint") {
        return value.toString()
    } else {
        value satisfies never
        throw new Error(`Unsupported value type: ${typeof value}`)
    }
}

const escapeRef = (value: string): string => {
    const escaped = value.replace(/"/g, "\"\"")
    return `"${escaped}"`
}

const escapeNode = (value: Node): string => {
    if (value.nodeType === "VALUE") {
        return escapeValue(value.value)
    } else if (value.nodeType === "REF") {
        return escapeRef(value.value)
    } else if (value.nodeType === "RAW") {
        return value.value
    } else {
        value satisfies never
        throw new Error("Unsupported SQL node type")
    }
}

export const buildObjectNode = (obj: Record<string, Node>): Node => {
    const parts: string[] = []
    for (const [key, value] of Object.entries(obj)) {
        parts.push(escapeString(key))
        parts.push(escapeNode(value))
    }

    return raw(`JSONB_BUILD_OBJECT(${parts.join(",")})`)
}

export const fragment = (fragments: TemplateStringsArray, ...values: Node[]): RawNode => {
    const parts: string[] = []

    for (let ix = 0; ix < fragments.length; ix += 1) {
        parts.push(fragments[ix])

        if (ix < values.length) {
            parts.push(escapeNode(values[ix]))
        }
    }

    return raw(parts.join(""))
}
