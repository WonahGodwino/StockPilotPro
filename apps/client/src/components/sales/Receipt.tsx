import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import type { Sale } from '@/types'
import { Printer, Plus } from 'lucide-react'
import { useReactToPrint } from 'react-to-print'
import { useAuthStore } from '@/store/auth.store'

interface Props {
  saleId: string
  onNewSale: () => void
}

export default function Receipt({ saleId, onNewSale }: Props) {
  const [sale, setSale] = useState<Sale & {
    subsidiary?: { name: string; address?: string }
    tenant?: { name: string; logo?: string }
  } | null>(null)
  const user = useAuthStore((s) => s.user)
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = useReactToPrint({ content: () => printRef.current })

  useEffect(() => {
    api.get(`/sales/${saleId}`).then((r) => setSale(r.data.data)).catch(console.error)
  }, [saleId])

  if (!sale) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-sm">
        {/* Action buttons */}
        <div className="flex gap-3 mb-4">
          <button onClick={handlePrint} className="btn-secondary flex-1">
            <Printer className="w-4 h-4" /> Print Receipt
          </button>
          <button onClick={onNewSale} className="btn-primary flex-1">
            <Plus className="w-4 h-4" /> New Sale
          </button>
        </div>

        {/* Printable receipt */}
        <div ref={printRef} className="bg-white border border-gray-200 rounded-xl p-6 font-mono text-sm shadow-sm">
          <div className="text-center mb-4 border-b pb-4">
            <p className="font-bold text-lg">{sale.tenant?.name || user?.tenant?.name}</p>
            {sale.subsidiary?.name && <p className="text-xs text-gray-500">{sale.subsidiary.name}</p>}
            {sale.subsidiary?.address && <p className="text-xs text-gray-400">{sale.subsidiary.address}</p>}
            <p className="text-xs text-gray-400 mt-2">Receipt #{sale.receiptNumber}</p>
            <p className="text-xs text-gray-400">{new Date(sale.createdAt).toLocaleString()}</p>
            {sale.user && <p className="text-xs text-gray-400">Served by: {sale.user.firstName} {sale.user.lastName}</p>}
          </div>

          <div className="space-y-1 mb-4">
            <div className="flex text-xs font-semibold text-gray-500 border-b pb-1">
              <span className="flex-1">Item</span>
              <span className="w-12 text-center">Qty</span>
              <span className="w-16 text-right">Price</span>
              <span className="w-16 text-right">Total</span>
            </div>
            {sale.items.map((item) => (
              <div key={item.id} className="flex text-xs items-center">
                <span className="flex-1 truncate">{item.product?.name}</span>
                <span className="w-12 text-center">{item.quantity}</span>
                <span className="w-16 text-right">${Number(item.unitPrice).toFixed(2)}</span>
                <span className="w-16 text-right">${Number(item.subtotal).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="border-t pt-3 space-y-1.5 text-xs">
            {Number(sale.discount) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Discount</span>
                <span>-${Number(sale.discount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm border-t pt-2 mt-1">
              <span>TOTAL</span>
              <span>${Number(sale.totalAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Paid ({sale.paymentMethod})</span>
              <span>${Number(sale.amountPaid).toFixed(2)}</span>
            </div>
            {Number(sale.amountPaid) > Number(sale.totalAmount) && (
              <div className="flex justify-between text-gray-500">
                <span>Change</span>
                <span>${(Number(sale.amountPaid) - Number(sale.totalAmount)).toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="text-center mt-4 text-xs text-gray-400 border-t pt-4">
            <p>Thank you for your business!</p>
            <p>Powered by StockPilot Pro</p>
          </div>
        </div>
      </div>
    </div>
  )
}
