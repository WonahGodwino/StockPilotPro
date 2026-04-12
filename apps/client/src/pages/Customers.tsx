import { useEffect, useState } from 'react'
import { Users, Search, Star, History, Gift, Plus, PencilLine, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { Customer, LoyaltyLedgerEntry } from '@/types'

interface CustomerDetail extends Customer {
  purchaseHistory: Array<{
    id: string
    receiptNumber: string
    totalAmount: number
    currency: string
    paymentMethod: string
    createdAt: string
    items: Array<{ quantity: number; unitPrice: number; product: { name: string } }>
  }>
  loyaltyLedger: LoyaltyLedgerEntry[]
}

export default function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([])
  const [selected, setSelected] = useState<CustomerDetail | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustNote, setAdjustNote] = useState('')

  const loadCustomers = async (q = '') => {
    setLoading(true)
    try {
      const res = await api.get('/customers', { params: { q, limit: 100 } })
      setItems(res.data.data || [])
    } catch {
      toast.error('Failed to load customers')
    } finally {
      setLoading(false)
    }
  }

  const loadCustomerDetail = async (id: string) => {
    try {
      const res = await api.get(`/customers/${id}`)
      setSelected(res.data.data)
    } catch {
      toast.error('Failed to load customer details')
    }
  }

  useEffect(() => {
    const t = setTimeout(() => loadCustomers(search), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    void loadCustomers('')
  }, [])

  const resetForm = () => {
    setForm({ name: '', phone: '', email: '', address: '', notes: '' })
    setEditing(null)
    setShowCreate(false)
  }

  const submitForm = async () => {
    if (!form.name.trim()) {
      toast.error('Customer name is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await api.patch(`/customers/${editing.id}`, form)
        toast.success('Customer updated')
        await loadCustomers(search)
        await loadCustomerDetail(editing.id)
      } else {
        const res = await api.post('/customers', form)
        toast.success('Customer created')
        await loadCustomers(search)
        await loadCustomerDetail(res.data.data.id)
      }
      resetForm()
    } catch {
      toast.error('Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (customer: Customer) => {
    setEditing(customer)
    setShowCreate(true)
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      notes: '',
    })
  }

  const removeCustomer = async (customer: Customer) => {
    if (!confirm(`Archive ${customer.name}?`)) return
    try {
      await api.delete(`/customers/${customer.id}`)
      toast.success('Customer archived')
      if (selected?.id === customer.id) setSelected(null)
      await loadCustomers(search)
    } catch {
      toast.error('Failed to archive customer')
    }
  }

  const applyAdjustment = async (type: 'ADJUST' | 'REDEEM') => {
    if (!selected) return
    const value = parseInt(adjustPoints || '0')
    if (!value) {
      toast.error('Enter points value')
      return
    }
    try {
      await api.post(`/customers/${selected.id}/loyalty`, {
        type,
        points: value,
        note: adjustNote || undefined,
      })
      toast.success(type === 'REDEEM' ? 'Points redeemed' : 'Points adjusted')
      setAdjustPoints('')
      setAdjustNote('')
      await loadCustomers(search)
      await loadCustomerDetail(selected.id)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Loyalty update failed')
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Customers & Loyalty</h1>
            <p className="text-sm text-gray-500">Repeat buyers, purchase history, and point balances.</p>
          </div>
          <button className="btn-primary px-3 py-2" onClick={() => { resetForm(); setShowCreate(true) }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer by name, phone, email"
          />
        </div>

        {showCreate && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2 bg-gray-50">
            <input className="input" placeholder="Name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            <input className="input" placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            <textarea className="input min-h-[72px]" placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={resetForm}>Cancel</button>
              <button className="btn-primary flex-1" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-[68vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="text-sm text-gray-400 py-6 text-center">Loading customers...</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No customers found</p>
            </div>
          ) : (
            items.map((customer) => (
              <button
                key={customer.id}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${selected?.id === customer.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                onClick={() => loadCustomerDetail(customer.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-gray-900">{customer.name}</div>
                    <div className="text-xs text-gray-400">{customer.phone || customer.email || 'No contact info'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="p-1 rounded hover:bg-white" onClick={(e) => { e.stopPropagation(); startEdit(customer) }}>
                      <PencilLine className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                    <button type="button" className="p-1 rounded hover:bg-white" onClick={(e) => { e.stopPropagation(); void removeCustomer(customer) }}>
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-amber-50 px-2 py-2">
                    <div className="text-gray-400">Points</div>
                    <div className="font-semibold text-amber-700">{customer.loyaltyPoints}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-2 py-2">
                    <div className="text-gray-400">Visits</div>
                    <div className="font-semibold text-gray-900">{customer.visitCount}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-2 py-2">
                    <div className="text-gray-400">Spend</div>
                    <div className="font-semibold text-gray-900">{Number(customer.totalSpend || 0).toFixed(0)}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="card p-5 min-h-[60vh]">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-center text-gray-400">
            <div>
              <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Select a customer to view purchase history and loyalty ledger</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selected.name}</h2>
                <p className="text-sm text-gray-500">{selected.phone || selected.email || 'No contact info'}</p>
                {selected.address && <p className="text-sm text-gray-400 mt-1">{selected.address}</p>}
              </div>
              <div className="grid grid-cols-3 gap-2 min-w-[280px]">
                <div className="rounded-xl bg-amber-50 p-3 text-center">
                  <div className="text-xs text-gray-400">Loyalty Points</div>
                  <div className="text-lg font-bold text-amber-700">{selected.loyaltyPoints}</div>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 text-center">
                  <div className="text-xs text-gray-400">Visits</div>
                  <div className="text-lg font-bold text-gray-900">{selected.visitCount}</div>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 text-center">
                  <div className="text-xs text-gray-400">Total Spend</div>
                  <div className="text-lg font-bold text-gray-900">{Number(selected.totalSpend || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center gap-2 mb-3">
                <Gift className="w-4 h-4 text-amber-600" />
                <h3 className="font-semibold text-gray-900">Targeted Promotions / Loyalty Actions</h3>
              </div>
              <div className="grid md:grid-cols-[120px_1fr_auto_auto] gap-2 items-center">
                <input className="input" type="number" value={adjustPoints} onChange={(e) => setAdjustPoints(e.target.value)} placeholder="Points" />
                <input className="input" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Reason or promo note" />
                <button className="btn-secondary" onClick={() => applyAdjustment('ADJUST')}>Adjust</button>
                <button className="btn-primary" onClick={() => applyAdjustment('REDEEM')}>Redeem</button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Use this for targeted promotions, manual corrections, or point redemption at checkout support desk.</p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <History className="w-4 h-4 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Purchase History</h3>
                </div>
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {selected.purchaseHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No purchases yet</div>
                  ) : selected.purchaseHistory.map((sale) => (
                    <div key={sale.id} className="rounded-xl border border-gray-200 p-3 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-gray-900">{sale.receiptNumber}</div>
                          <div className="text-xs text-gray-400">{new Date(sale.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="text-sm font-semibold text-gray-900">{sale.currency} {Number(sale.totalAmount).toFixed(2)}</div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        {sale.items.slice(0, 3).map((item) => `${Number(item.quantity)}x ${item.product.name}`).join(', ')}
                        {sale.items.length > 3 ? ` +${sale.items.length - 3} more` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Star className="w-4 h-4 text-amber-600" />
                  <h3 className="font-semibold text-gray-900">Loyalty Ledger</h3>
                </div>
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {selected.loyaltyLedger.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No loyalty activity yet</div>
                  ) : selected.loyaltyLedger.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-gray-200 p-3 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-gray-900">{entry.type}</div>
                          <div className="text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString()}</div>
                        </div>
                        <div className={`text-sm font-semibold ${entry.points >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {entry.points >= 0 ? '+' : ''}{entry.points} pts
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                        <span>{entry.note || 'No note'}</span>
                        <span>{entry.balanceBefore} → {entry.balanceAfter}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
