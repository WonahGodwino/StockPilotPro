/**
 * Supported currencies with their display names and symbols.
 * ISO 4217 currency codes.
 */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'AFN', name: 'Afghan Afghani', symbol: 'AFN' },
  { code: 'ALL', name: 'Albanian Lek', symbol: 'L' },
  { code: 'AMD', name: 'Armenian Dram', symbol: 'AMD' },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'BAM', name: 'Bosnia and Herzegovina Convertible Mark', symbol: 'KM' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: 'Tk' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BHD' },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'BIF' },
  { code: 'BND', name: 'Brunei Dollar', symbol: 'B$' },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'BWP', name: 'Botswana Pula', symbol: 'P' },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$' },
  { code: 'CRC', name: 'Costa Rican Colon', symbol: 'CRC' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kc' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$' },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DZD' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GEL', name: 'Georgian Lari', symbol: 'GEL' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L' },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: 'ILS' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD' },
  { code: 'IRR', name: 'Iranian Rial', symbol: 'IRR' },
  { code: 'ISK', name: 'Icelandic Krona', symbol: 'kr' },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JOD' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'KHR', name: 'Cambodian Riel', symbol: 'KHR' },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'KMF' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KWD' },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: 'KZT' },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'LBP' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD' },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'MDL' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
  { code: 'MKD', name: 'Macedonian Denar', symbol: 'MKD' },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: 'Rs' },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR' },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'Rs' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zl' },
  { code: 'PYG', name: 'Paraguayan Guarani', symbol: 'Gs' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'RSD' },
  { code: 'RUB', name: 'Russian Ruble', symbol: 'RUB' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'RWF' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'Rs' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le' },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'SOS' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: 'SSP' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'TND' },
  { code: 'TRY', name: 'Turkish Lira', symbol: 'TRY' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: 'UAH' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U' },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: 'UZS' },
  { code: 'VES', name: 'Venezuelan Bolivar', symbol: 'VES' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA' },
  { code: 'YER', name: 'Yemeni Rial', symbol: 'YER' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
  { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: 'Z$' },
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
