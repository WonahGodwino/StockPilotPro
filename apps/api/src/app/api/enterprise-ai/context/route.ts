import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, getFreshFeatureSnapshot, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)

    const snapshot = await getFreshFeatureSnapshot(access.tenantId)
    const signals = await prisma.enterpriseAiSignal.findMany({
      where: {
        OR: [
          { signalClass: 'PUBLIC' },
          { signalClass: 'PLATFORM' },
          { signalClass: 'TENANT', tenantId: access.tenantId },
        ],
      },
      orderBy: { effectiveDate: 'desc' },
      take: 25,
      select: {
        id: true,
        signalClass: true,
        source: true,
        signalKey: true,
        signalValue: true,
        tags: true,
        effectiveDate: true,
      },
    })

    return NextResponse.json({
      data: {
        tenantId: access.tenantId,
        planName: access.planName,
        snapshot: {
          id: snapshot.id,
          version: snapshot.snapshotVersion,
          generatedAt: snapshot.generatedAt,
          freshnessScore: Number(snapshot.freshnessScore || 0),
          featureSnapshot: snapshot.featureSnapshot,
          sourceCoverage: snapshot.sourceCoverage,
        },
        signals,
      },
    })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI CONTEXT GET]', err)
    return apiError('Internal server error', 500)
  }
}
