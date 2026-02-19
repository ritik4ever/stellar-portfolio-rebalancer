
export function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

export function downloadJSON(filename: string, data: unknown) {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json;charset=utf-8" })
    downloadBlob(filename, blob)
}


export function toCSV<T extends Record<string, unknown>>(
    rows: T[],
    headers?: string[]
) {
    if (!rows.length) return ""

    const cols = headers ?? Object.keys(rows[0])

    const escape = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v)
        const needsQuotes = /[",\n]/.test(s)
        const escaped = s.replace(/"/g, '""')
        return needsQuotes ? `"${escaped}"` : escaped
    }

    const head = cols.join(",")
    const body = rows.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n")
    return `${head}\n${body}\n`
}

export function downloadCSV(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    downloadBlob(filename, blob)
}