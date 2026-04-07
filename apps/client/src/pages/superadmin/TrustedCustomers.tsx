import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import type { TrustedCustomer } from '@/types'
import toast from 'react-hot-toast'
import { Plus, Edit, Trash2, X, Loader2, Building2, ExternalLink, Upload, ImagePlus } from 'lucide-react'
import { getSuperadminCacheKey, isOnlineNow, readSuperadminCache, writeSuperadminCache } from '@/lib/superadminCache'
import {
  addPendingTrustedCustomerOperation,
  getPendingRecords,
  subscribePendingRecordsChanged,
  type TrustedCustomerPendingPayload,
} from '@/lib/db'

type TrustedCustomerForm = {
  name: string
  logoUrl: string
  websiteUrl: string
  displayOrder: number
  isActive: boolean
}

const emptyForm: TrustedCustomerForm = {
  name: '',
  logoUrl: '',
  websiteUrl: '',
  displayOrder: 0,
  isActive: true,
}

export default function TrustedCustomersPage() {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  const apiOrigin = apiBase.startsWith('http') ? new URL(apiBase).origin : window.location.origin

  const toPublicMediaUrl = (value?: string | null) => {
    if (!value) return ''
    if (/^https?:\/\//i.test(value) || value.startsWith('blob:') || value.startsWith('data:')) return value
    if (value.startsWith('/uploads/')) return `${apiOrigin}${value}`
    return value
  }

  const [items, setItems] = useState<TrustedCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ open: boolean; item: TrustedCustomer | null }>({ open: false, item: null })
  const [form, setForm] = useState<TrustedCustomerForm>(emptyForm)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [dragOverLogoZone, setDragOverLogoZone] = useState(false)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string>('')
  const [isOnline, setIsOnline] = useState(isOnlineNow())
  const [pendingStatusByCustomerId, setPendingStatusByCustomerId] = useState<Record<string, 'create' | 'update' | 'delete'>>({})
  const cacheKey = useMemo(() => getSuperadminCacheKey('trusted-customers'), [])

  const getQueuedBadgeStyles = (operation: 'create' | 'update' | 'delete') => {
    if (operation === 'create') return 'bg-sky-100 text-sky-700'
    if (operation === 'delete') return 'bg-rose-100 text-rose-700'
    return 'bg-amber-100 text-amber-700'
  }

  const getQueuedBadgeText = (operation: 'create' | 'update' | 'delete') => {
    if (operation === 'create') return 'Queued create'
    if (operation === 'delete') return 'Queued delete'
    return 'Queued update'
  }

  const refreshPendingTrustedCustomerStatuses = async () => {
    try {
      const pending = await getPendingRecords()
      const trustedPending = pending
        .filter((record) => record.type === 'trustedCustomer')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      const nextStatuses: Record<string, 'create' | 'update' | 'delete'> = {}
      for (const record of trustedPending) {
        const operation = record.data as TrustedCustomerPendingPayload
        nextStatuses[operation.trustedCustomerId] = operation.operation
      }
      setPendingStatusByCustomerId(nextStatuses)
    } catch {
      // Keep UI usable even if local queue lookup fails.
      setPendingStatusByCustomerId({})
    }
  }

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      void load()
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      if (!isOnlineNow()) {
        const cached = readSuperadminCache<{ items: TrustedCustomer[] }>(cacheKey)
        if (cached) {
          setItems(cached.items || [])
        } else {
          setItems([])
        }
        return
      }

      const res = await api.get<{ data: TrustedCustomer[] }>('/trusted-customers')
      setItems(res.data.data)
      writeSuperadminCache(cacheKey, { items: res.data.data, cachedAt: new Date().toISOString() })
    } catch {
      const cached = readSuperadminCache<{ items: TrustedCustomer[] }>(cacheKey)
      if (cached) {
        setItems(cached.items || [])
      } else {
        setItems([])
        toast.error('Failed to load trusted customers')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    writeSuperadminCache(cacheKey, { items, cachedAt: new Date().toISOString() })
  }, [cacheKey, items])

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    void refreshPendingTrustedCustomerStatuses()

    const unsubscribe = subscribePendingRecordsChanged(() => {
      void refreshPendingTrustedCustomerStatuses()
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setLogoPreviewUrl('')
    setModal({ open: true, item: null })
  }

  const openEdit = (item: TrustedCustomer) => {
    setForm({
      name: item.name,
      logoUrl: item.logoUrl || '',
      websiteUrl: item.websiteUrl || '',
      displayOrder: item.displayOrder,
      isActive: item.isActive,
    })
    setLogoPreviewUrl(item.logoUrl || '')
    setModal({ open: true, item })
  }

  const cropImageToSquare = async (file: File): Promise<File> => {
    if (file.type === 'image/svg+xml') return file

    const objectUrl = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Unable to read image file'))
        img.src = objectUrl
      })

      const cropSize = Math.min(image.naturalWidth, image.naturalHeight)
      const sourceX = Math.floor((image.naturalWidth - cropSize) / 2)
      const sourceY = Math.floor((image.naturalHeight - cropSize) / 2)
      const outputSize = 512

      const canvas = document.createElement('canvas')
      canvas.width = outputSize
      canvas.height = outputSize

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas is not supported in this browser')

      ctx.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, outputSize, outputSize)

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) {
            reject(new Error('Failed to process image crop'))
            return
          }
          resolve(result)
        }, 'image/png', 0.92)
      })

      const baseName = file.name.replace(/\.[^.]+$/, '')
      return new File([blob], `${baseName}-square.png`, { type: 'image/png' })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()

    const payload = {
      name: form.name,
      logoUrl: form.logoUrl,
      websiteUrl: form.websiteUrl,
      displayOrder: Number(form.displayOrder),
      isActive: form.isActive,
    }

    if (!isOnlineNow()) {
      const nowIso = new Date().toISOString()

      if (modal.item) {
        await addPendingTrustedCustomerOperation({
          operation: 'update',
          trustedCustomerId: modal.item.id,
          payload,
        })

        setItems((prev) => prev
          .map((item) => (
            item.id === modal.item!.id
              ? {
                  ...item,
                  ...payload,
                  updatedAt: nowIso,
                }
              : item
          ))
          .sort((a, b) => a.displayOrder - b.displayOrder)
        )

        toast.success('Trusted customer update queued for sync when internet returns.')
      } else {
        const localId = `local_tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await addPendingTrustedCustomerOperation({
          operation: 'create',
          trustedCustomerId: localId,
          payload,
        })

        setItems((prev) => [
          ...prev,
          {
            id: localId,
            ...payload,
            createdAt: nowIso,
            updatedAt: nowIso,
          } as TrustedCustomer,
        ].sort((a, b) => a.displayOrder - b.displayOrder))

        toast.success('Trusted customer create queued for sync when internet returns.')
      }

      setModal({ open: false, item: null })
      return
    }

    setSaving(true)
    try {
      if (modal.item) {
        await api.put(`/trusted-customers/${modal.item.id}`, payload)
        toast.success('Trusted customer updated')
      } else {
        await api.post('/trusted-customers', payload)
        toast.success('Trusted customer added')
      }

      setModal({ open: false, item: null })
      await load()
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save trusted customer')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!isOnlineNow()) {
      await addPendingTrustedCustomerOperation({
        operation: 'delete',
        trustedCustomerId: id,
      })
      setItems((prev) => prev.filter((item) => item.id !== id))
      toast.success('Trusted customer delete queued for sync when internet returns.')
      return
    }

    setDeletingId(id)
    try {
      await api.delete(`/trusted-customers/${id}`)
      toast.success('Trusted customer removed')
      await load()
    } catch {
      toast.error('Failed to delete trusted customer')
    } finally {
      setDeletingId(null)
    }
  }

  const handleLogoUpload = async (file: File | null) => {
    if (!file) return
    if (!isOnlineNow()) {
      toast.error('Logo upload requires internet. Save with current logo URL or upload when online.')
      return
    }
    setUploadingLogo(true)
    try {
      const preparedFile = await cropImageToSquare(file)
      const previewUrl = URL.createObjectURL(preparedFile)
      setLogoPreviewUrl(previewUrl)

      const formData = new FormData()
      formData.append('file', preparedFile)

      const res = await api.post<{ data: { url: string; absoluteUrl?: string } }>('/trusted-customers/upload-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      const persistedUrl = res.data.data.absoluteUrl || toPublicMediaUrl(res.data.data.url)
      setForm((prev) => ({ ...prev, logoUrl: persistedUrl }))
      setLogoPreviewUrl(persistedUrl)
      toast.success('Logo uploaded successfully')
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Logo upload failed')
    } finally {
      setUploadingLogo(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trusted Customers</h1>
          <p className="mt-0.5 text-sm text-gray-500">Manage customer names and logos shown on the public home page.</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add Customer
        </button>
      </div>

      {!isOnline && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm text-cyan-800">
          Offline mode: trusted customer create, edit, and delete actions are queued and will sync automatically when internet is restored.
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white text-gray-400">
          <Building2 className="mb-2 h-12 w-12 opacity-40" />
          <p>No trusted customers configured yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="card p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{item.name}</p>
                  <p className="text-xs text-gray-500">Display order: {item.displayOrder}</p>
                  {!!pendingStatusByCustomerId[item.id] && (
                    <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${getQueuedBadgeStyles(pendingStatusByCustomerId[item.id])}`}>
                      {getQueuedBadgeText(pendingStatusByCustomerId[item.id])}
                    </p>
                  )}
                  <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(item)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                    <Edit className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={deletingId === item.id} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50">
                    {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <p className="truncate text-gray-600">Logo URL: {item.logoUrl || '—'}</p>
                <p className="truncate text-gray-600">Website: {item.websiteUrl || '—'}</p>
                {item.websiteUrl && (
                  <a href={item.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700">
                    Open website
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-semibold">{modal.item ? 'Edit Trusted Customer' : 'Add Trusted Customer'}</h2>
              <button onClick={() => setModal({ open: false, item: null })} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Customer Name *</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Logo URL</label>
                <input className="input" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://.../logo.png" />
                <div className="mt-3 grid gap-3 sm:grid-cols-[112px_1fr]">
                  <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {logoPreviewUrl || form.logoUrl ? (
                      <img src={toPublicMediaUrl(logoPreviewUrl || form.logoUrl)} alt="Customer logo preview" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[11px] text-gray-400">No logo</span>
                    )}
                  </div>
                  <div>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOverLogoZone(true)
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault()
                        setDragOverLogoZone(false)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragOverLogoZone(false)
                        const droppedFile = e.dataTransfer.files?.[0] || null
                        void handleLogoUpload(droppedFile)
                      }}
                      className={`rounded-lg border border-dashed p-3 transition ${dragOverLogoZone ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-gray-50'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                          <ImagePlus className="h-3.5 w-3.5" />
                          {uploadingLogo ? 'Uploading...' : 'Choose File'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                            className="hidden"
                            disabled={uploadingLogo}
                            onChange={(e) => {
                              const selected = e.target.files?.[0] || null
                              void handleLogoUpload(selected)
                              e.currentTarget.value = ''
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, logoUrl: '' }))
                            setLogoPreviewUrl('')
                          }}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Clear Logo
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-500">
                        Drag and drop logo here or choose file. Images are auto-cropped to a square for consistent presentation.
                      </p>
                      <p className="text-[11px] text-gray-500">PNG/JPG/SVG/WEBP up to 3MB.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Website URL</label>
                <input className="input" value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://customer-site.com" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Display Order</label>
                  <input type="number" min={0} className="input" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) || 0 })} />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                    Active on home page
                  </label>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal({ open: false, item: null })} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {modal.item ? 'Save Changes' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
