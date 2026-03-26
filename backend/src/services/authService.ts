import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import {
    createRefreshToken,
    findRefreshToken,
    deleteRefreshTokenById,
    deleteAllRefreshTokensForUser,
    generateRefreshTokenId
} from '../db/refreshTokenDb.js'
import { logger } from '../utils/logger.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-min-32-characters-long'
const ACCESS_EXPIRY_SEC = parseInt(process.env.JWT_ACCESS_EXPIRY_SEC || '900', 10)
const REFRESH_EXPIRY_SEC = parseInt(process.env.JWT_REFRESH_EXPIRY_SEC || '604800', 10)

export interface TokenPayload {
    sub: string
    type: 'access' | 'refresh'
    iat?: number
    exp?: number
}

export interface AuthTokens {
    accessToken: string
    refreshToken: string
    expiresIn: number
    refreshExpiresIn: number
}

export function getAuthConfig(): { enabled: boolean; accessExpirySec: number; refreshExpirySec: number } {
    const secretSet = Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
    return {
        enabled: secretSet,
        accessExpirySec: ACCESS_EXPIRY_SEC,
        refreshExpirySec: REFRESH_EXPIRY_SEC
    }
}

export function generateAccessToken(address: string): string {
    return jwt.sign(
        { sub: address, type: 'access' } as TokenPayload,
        JWT_SECRET,
        { expiresIn: ACCESS_EXPIRY_SEC }
    )
}

export async function issueTokens(address: string): Promise<AuthTokens> {
    const accessToken = generateAccessToken(address)
    const refreshId = generateRefreshTokenId()
    const refreshToken = jwt.sign(
        { sub: address, type: 'refresh', jti: refreshId } as TokenPayload & { jti: string },
        JWT_SECRET,
        { expiresIn: REFRESH_EXPIRY_SEC }
    )
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SEC * 1000)
    await createRefreshToken(refreshId, address, refreshToken, expiresAt)
    return {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_EXPIRY_SEC,
        refreshExpiresIn: REFRESH_EXPIRY_SEC
    }
}

export function verifyAccessToken(token: string): TokenPayload | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload
        if (decoded.type !== 'access') return null
        return decoded
    } catch {
        return null
    }
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens | null> {
    const row = await findRefreshToken(refreshToken)
    if (!row) return null
    try {
        const decoded = jwt.verify(refreshToken, JWT_SECRET) as TokenPayload & { jti?: string }
        if (decoded.type !== 'refresh') return null
    } catch {
        await deleteRefreshTokenById(row.id).catch(() => {})
        return null
    }
    await deleteRefreshTokenById(row.id)
    return issueTokens(row.user_address)
}

export async function logout(refreshToken: string | undefined, address: string | undefined): Promise<boolean> {
    if (refreshToken) {
        const row = await findRefreshToken(refreshToken)
        if (row) {
            await deleteRefreshTokenById(row.id)
            logger.info('Refresh token invalidated on logout', { userId: row.user_address })
            return true
        }
    }
    if (address) {
        const count = await deleteAllRefreshTokensForUser(address)
        if (count > 0) {
            logger.info('All refresh tokens invalidated for user', { userId: address, count })
            return true
        }
    }
    return false
}
