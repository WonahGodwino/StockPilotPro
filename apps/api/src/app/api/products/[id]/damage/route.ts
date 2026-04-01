import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { assertSubsidiaryAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const damageSchema = z.object({
  quantity: z.number().min(0.001),
  unit: z.string().min(1).default('pcs'),
  reason: z.enum(['EXPIRED', 'DAMAGED', 'LOST', 'RAW_MATERIAL_DAMAGE', 'OTHER']),
  damageStage: z.enum(['FINISHED_GOODS', 'RAW_MATERIAL']).default('FINISHED_GOODS'),
  description: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const productId = params.id
    const body = await req.json()
    const { quantity, unit, reason, damageStage, description } = damageSchema.parse(body)

    // Get the product
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product) {
      return apiError('Product not found', 404)
    }

    // Check access
    assertSubsidiaryAccess(user, product.subsidiaryId)

    // Validate quantity
    if (quantity > Number(product.quantity)) {
      return apiError('Quantity exceeds available stock', 400)
    }

    // Cost logic:
    //   FINISHED_GOODS → value lost = selling price (goods completed/ready for sale)
    //   RAW_MATERIAL   → value lost = purchase/cost price (input materials for production)
    const pricePerUnit =
      damageStage === 'RAW_MATERIAL'
        ? Number(product.costPrice)
        : Number(product.sellingPrice)
    const cost = pricePerUnit * quantity

    // Create damage record
    const damageRecord = await prisma.damageRecord.create({
      data: {
        tenantId: product.tenantId,
        subsidiaryId: product.subsidiaryId,
        productId: productId,
        userId: user.userId,
        quantity: quantity,
        unit,
        reason,
        damageStage,
        description,
        cost,
        date: new Date(),
        createdBy: user.userId,
      },
    })

    // Update product quantity
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        quantity: { decrement: quantity },
        updatedBy: user.userId,
      },
    })

    // Log audit
    await logAudit({
      tenantId: product.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'product',
      entityId: productId,
      oldValues: {
        quantity: product.quantity,
      },
      newValues: {
        quantity: updatedProduct.quantity,
        damageReason: reason,
        damageStage,
        damageQuantity: quantity,
        damageUnit: unit,
      },
    })

    return NextResponse.json({
      message: 'Damage record created successfully',
      damageRecord,
      product: updatedProduct,
    })
  } catch (err) {
    console.error('[DAMAGE POST]', err)
    if (err instanceof z.ZodError) {
      return apiError('Invalid request data', 400)
    }
    return apiError('Internal server error', 500)
  }
}
