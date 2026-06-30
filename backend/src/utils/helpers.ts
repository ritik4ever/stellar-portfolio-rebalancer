export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

export function getErrorObject(error: unknown): Record<string, unknown> {
    if (error instanceof Error) return { message: error.message, stack: error.stack, name: error.name };
    return { error: String(error) };
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'true' || lower === '1') return true;
        if (lower === 'false' || lower === '0') return false;
    }
    return undefined;
}

export function stableStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(obj).sort();
    const entries = keys.map(key => `${JSON.stringify(key)}:${stableStringify((obj as any)[key])}`);
    return `{${entries.join(',')}}`;
}
