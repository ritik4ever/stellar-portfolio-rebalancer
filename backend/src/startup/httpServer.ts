import http from 'node:http'
import type { Express } from 'express'

export function createHttpServer(app: Express): http.Server {
    return http.createServer(app)
}
