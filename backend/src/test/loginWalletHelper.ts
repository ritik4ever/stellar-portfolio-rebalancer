import request from 'supertest'
import type { Application } from 'express'
import { Keypair } from '@stellar/stellar-sdk'

export async function loginWithWalletChallenge(app: Application, kp: Keypair) {
    const address = kp.publicKey()
    const challengeRes = await request(app)
        .post('/api/auth/challenge')
        .send({ address })
        .expect(200)
    const challenge = challengeRes.body.data.challenge as string
    const sig = kp.sign(Buffer.from(challenge, 'utf8')).toString('base64')
    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ address, signature: sig })
        .expect(200)
    return {
        data: loginRes.body.data as {
            accessToken: string
            refreshToken: string
            expiresIn: number
            refreshExpiresIn: number
        },
        loginRes,
    }
}
