export const fromSecs = (secs: number): number => {
    return secs * 1000
}

export const fromMins = (mins: number): number => {
    return fromSecs(mins * 60)
}

export const fromHours = (hours: number): number => {
    return fromMins(hours * 60)
}

export const fromDays = (days: number): number => {
    return fromHours(days * 24)
}
