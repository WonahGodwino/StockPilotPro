import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react'
import { Search, X, UserPlus, Star, ChevronDown } from 'lucide-react'
import api from '@/lib/api'
import type { Customer } from '@/types'
import toast from 'react-hot-toast'

interface Props {
  selectedCustomer: Customer | null
  onSelect: (customer: Customer | null) => void
}

export default function CustomerSelector({ selectedCustomer, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const search = useCallback(async (q: string) => {
    setSearching(true)
    try {
      const res = await api.get<{ data: Customer[] }>('/customers', { params: { q, limit: 20 } })
      setResults(res.data.data || [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, open, search])

  // Initial load when dropdown opens
  useEffect(() => {
    if (open && results.length === 0 && !query) {
      search('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowCreate(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await api.post<{ data: Customer }>('/customers', {
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
      })
      toast.success('Customer created')
      onSelect(res.data.data)
      setOpen(false)
      setShowCreate(false)
      setNewName('')
      setNewPhone('')
    } catch {
      toast.error('Failed to create customer')
    } finally {
      setCreating(false)
    }
  }

  const handleSelect = (c: Customer) => {
    onSelect(c)
    setOpen(false)
    setQuery('')
  }

  const handleClear = (e: MouseEvent) => {
    e.stopPropagation()
    onSelect(null)
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm hover:border-blue-400 transition-colors"
      >
        <Star className="w-4 h-4 text-yellow-400 flex-shrink-0" />
        {selectedCustomer ? (
          <span className="flex-1 text-left text-gray-900 dark:text-gray-100 truncate">
            {selectedCustomer.name}
            <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400 font-semibold">
              {selectedCustomer.loyaltyPoints} pts
            </span>
          </span>
        ) : (
          <span className="flex-1 text-left text-gray-400">Attach customer (optional)</span>
        )}
        {selectedCustomer ? (
          <X className="w-4 h-4 text-gray-400 hover:text-red-500" onClick={handleClear} />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
          <div className="p-2">
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400 dark:text-gray-100"
                placeholder="Search by name or phone..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <ul className="max-h-52 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {searching ? (
              <li className="px-4 py-3 text-xs text-gray-400 text-center">Searching…</li>
            ) : results.length === 0 ? (
              <li className="px-4 py-3 text-xs text-gray-400 text-center">No customers found</li>
            ) : (
              results.map((c) => (
                <li
                  key={c.id}
                  className="px-4 py-2.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center justify-between"
                  onClick={() => handleSelect(c)}
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</div>
                    {c.phone && <div className="text-xs text-gray-400">{c.phone}</div>}
                  </div>
                  <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 whitespace-nowrap ml-3">
                    {c.loyaltyPoints} pts
                  </span>
                </li>
              ))
            )}
          </ul>

          {!showCreate ? (
            <div className="p-2 border-t border-gray-100 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                New customer
              </button>
            </div>
          ) : (
            <div className="p-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
              <input
                autoFocus
                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:border-blue-400"
                placeholder="Full name *"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:border-blue-400"
                placeholder="Phone (optional)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!newName.trim() || creating}
                  onClick={handleCreate}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? 'Saving…' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
