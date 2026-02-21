import { redactArgs } from './secretRedactor.js'

const logger = {
    info: (message: string, ...meta: any[]) => {
        console.log(...redactArgs([`[INFO] ${message}`, ...meta]))
    },
    error: (message: string, ...meta: any[]) => {
        console.error(...redactArgs([`[ERROR] ${message}`, ...meta]))
    },
    warn: (message: string, ...meta: any[]) => {
        console.warn(...redactArgs([`[WARN] ${message}`, ...meta]))
    }
}

export { logger }