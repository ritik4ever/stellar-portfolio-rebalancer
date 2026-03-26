import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
    requestId?: string
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
    requestContextStorage.run(context, fn)

export const getRequestContext = (): RequestContext | undefined =>
    requestContextStorage.getStore()

export const getRequestId = (): string | undefined =>
    requestContextStorage.getStore()?.requestId
