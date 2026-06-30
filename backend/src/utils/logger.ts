import pino from 'pino'
import { redactArgs } from './secretRedactor.js'
import { getRequestId, getCorrelationId, getTraceId, getSpanId } from './requestContext.js'
import { getTraceId as getOtelTraceId, getSpanId as getOtelSpanId } from '../observability/tracing.js'

const isProduction = process.env.NODE_ENV === 'production'

const baseLogger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    base: {
        service: 'stellar-portfolio-backend',
        environment: process.env.NODE_ENV || 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => ({ level: label }),
    },
    mixin() {
        const requestId = getRequestId()
        const correlationId = getCorrelationId()
        const ctxTraceId = getTraceId()
        const ctxSpanId = getSpanId()
        const otelTraceId = getOtelTraceId()
        const otelSpanId = getOtelSpanId()
        const fields: Record<string, string> = {}
        if (requestId) fields.requestId = requestId
        if (correlationId) fields.correlation_id = correlationId
        if (ctxTraceId || otelTraceId) fields.trace_id = ctxTraceId || otelTraceId
        if (ctxSpanId || otelSpanId) fields.span_id = ctxSpanId || otelSpanId
        return fields
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
