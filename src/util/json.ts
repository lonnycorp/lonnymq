export type Result =
    | { resultType: "PARSE_SUCCESS", data: unknown }
    | { resultType: "PARSE_FAILURE", error: Error }

export const parse = (input : string) : Result => {
    try {
        const parsed = JSON.parse(input)
        return { resultType: "PARSE_SUCCESS", data: parsed }
    } catch (error) {
        return { resultType: "PARSE_FAILURE", error: error as Error }
    }
}
