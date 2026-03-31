/**
 * Supported currencies with their display names and symbols.
 * ISO 4217 currency codes.
 */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA' },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
] as const

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code']

/**
 * Returns a currency formatter function for the given currency code.
 * Falls back to USD if the code is not recognised by Intl.
 */
export function makeCurrencyFormatter(
  currencyCode: string,
  options: Intl.NumberFormatOptions = {}
): (value: number) => string {
  const code = currencyCode || 'USD'
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      ...options,
    })
    return (value: number) => formatter.format(value)
  } catch {
    // Fallback for unrecognised codes
    const entry = SUPPORTED_CURRENCIES.find((c) => c.code === code)
    const symbol = entry?.symbol ?? code
    return (value: number) => `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2, ...options })}`
  }
}

/**
 * Returns the symbol for a currency code, or the code itself as fallback.
 */
export function getCurrencySymbol(currencyCode: string): string {
  const entry = SUPPORTED_CURRENCIES.find((c) => c.code === currencyCode)
  return entry?.symbol ?? currencyCode
}
