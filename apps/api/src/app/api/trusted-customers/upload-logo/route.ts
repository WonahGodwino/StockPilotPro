import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
])

const MAX_FILE_SIZE = 3 * 1024 * 1024

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) return apiError('file is required', 422)
    if (file.size <= 0) return apiError('Uploaded file is empty', 422)
    if (file.size > MAX_FILE_SIZE) return apiError('File too large. Max size is 3MB', 422)
    if (!ALLOWED_TYPES.has(file.type)) return apiError('Unsupported file type. Use PNG, JPG, SVG or WEBP', 422)

    const extFromName = path.extname(file.name || '').toLowerCase()
    const defaultExt = file.type === 'image/svg+xml' ? '.svg' : '.png'
    const ext = extFromName || defaultExt

    const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'trusted-customers')
    await mkdir(uploadDir, { recursive: true })

    const bytes = Buffer.from(await file.arrayBuffer())
    const targetPath = path.join(uploadDir, filename)
    await writeFile(targetPath, bytes)

    const publicUrl = `/uploads/trusted-customers/${filename}`
    const absoluteUrl = new URL(publicUrl, req.nextUrl.origin).toString()

    return NextResponse.json({
      data: {
        url: publicUrl,
        absoluteUrl,
        originalName: file.name,
        size: file.size,
        contentType: file.type,
        uploadedByUserId: user.userId,
        uploadedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[UPLOAD TRUSTED CUSTOMER LOGO]', err)
    return apiError('Internal server error', 500)
  }
}
