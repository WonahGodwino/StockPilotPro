import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CartItem, Product } from '@/types'

interface CartState {
  items: CartItem[]
  subsidiaryId: string | null
  addItem: (product: Product, qty?: number) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, qty: number) => void
  updateDiscount: (productId: string, discount: number) => void
  clearCart: () => void
  setSubsidiaryId: (id: string) => void
  get total(): number
  get itemCount(): number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      subsidiaryId: null,

      addItem: (product, qty = 1) => {
        set((state) => {
          const existing = state.items.find((i) => i.product.id === product.id)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.product.id === product.id ? { ...i, quantity: i.quantity + qty } : i
              ),
            }
          }
          return {
            items: [...state.items, { product, quantity: qty, unitPrice: Number(product.sellingPrice), discount: 0 }],
          }
        })
      },

      removeItem: (productId) =>
        set((state) => ({ items: state.items.filter((i) => i.product.id !== productId) })),

      updateQuantity: (productId, qty) =>
        set((state) => ({
          items: state.items.map((i) => (i.product.id === productId ? { ...i, quantity: Math.max(0, qty) } : i)),
        })),

      updateDiscount: (productId, discount) =>
        set((state) => ({
          items: state.items.map((i) => (i.product.id === productId ? { ...i, discount } : i)),
        })),

      clearCart: () => set({ items: [] }),

      setSubsidiaryId: (id) => set({ subsidiaryId: id }),

      get total() {
        return get().items.reduce((sum, i) => sum + i.quantity * i.unitPrice - i.discount, 0)
      },

      get itemCount() {
        return get().items.reduce((sum, i) => sum + i.quantity, 0)
      },
    }),
    {
      name: 'stockpilot-cart',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ items: state.items, subsidiaryId: state.subsidiaryId }),
    }
  )
)
