import jwt from 'jsonwebtoken'
import { prisma } from './prisma'

export interface JWTPayload {
  userId: string
  email: string
  role: string
  tenantId: string | null
  subsidiaryId: string | null
}

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'

export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions)
}

export function signRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions)
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload
}

export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload
}

export async function storeRefreshToken(userId: string, token: string) {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } })
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.deleteMany({ where: { token } })
}

export async function rotateRefreshToken(oldToken: string, payload: JWTPayload) {
  const newRefresh = signRefreshToken(payload)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { token: oldToken } }),
    prisma.refreshToken.create({ data: { userId: payload.userId, token: newRefresh, expiresAt } }),
  ])

  const newAccess = signAccessToken(payload)
  return { accessToken: newAccess, refreshToken: newRefresh }
}
