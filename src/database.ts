export type QueryResult = {
    rows: Array<Record<string, unknown>>
}

export interface Client {
    query(query : string, params: Array<unknown>): Promise<QueryResult>
}

export type Adaptor<T> = (client: T) => Client
