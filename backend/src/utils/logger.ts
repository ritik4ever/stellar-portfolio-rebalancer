import pino from 'pino'
import { redactArgs } from './secretRedactor.js'
import { getRequestId } from './requestContext.js'

const isProduction = process.env.NODE_ENV === 'production'

const baseLogger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    base: {
        service: 'stellar-portfolio-backend',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
        const requestId = getRequestId()
        return requestId ? { requestId } : {}
    },
    hooks: {
        logMethod(args, method) {
            const safeArgs = redactArgs(args)
            if (
                typeof safeArgs[0] === 'string' &&
                safeArgs[1] &&
                typeof safeArgs[1] === 'object' &&
                !Array.isArray(safeArgs[1])
            ) {
                const [message, obj, ...rest] = safeArgs
                method.apply(this, [obj, message, ...rest] as Parameters<typeof method>)
                return
            }
            method.apply(this, safeArgs as Parameters<typeof method>)
        },
    },
})

type LoggerMethod = (...args: unknown[]) => void

type AppLogger = Omit<typeof baseLogger, 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'> & {
    fatal: LoggerMethod
    error: LoggerMethod
    warn: LoggerMethod
    info: LoggerMethod
    debug: LoggerMethod
    trace: LoggerMethod
}

const logger = baseLogger as AppLogger

const logAudit = (action: string, fields: Record<string, unknown> = {}): void => {
    logger.info({ event: 'audit', action, ...fields }, 'audit')
}

export { logger, logAudit }
