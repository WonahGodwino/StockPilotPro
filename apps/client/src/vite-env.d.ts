/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_URL?: string
	readonly VITE_SITE_URL?: string
	readonly VITE_GA_MEASUREMENT_ID?: string
	readonly VITE_SUBSCRIPTION_PAYMENT_FEE_PERCENT?: string
	readonly VITE_SUBSCRIPTION_PAYMENT_FEE_FIXED?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
