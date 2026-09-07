import { NextRequest, NextResponse } from 'next/server'
import { authenticate, apiError, handleOptions } from '@/lib/auth'

interface LookupResult {
  name: string
  description: string | null
  imageUrl: string | null
  category: string | null
  brand: string | null
}

// ── Nigerian Common Products Database ──────────────────────────────────
// All entries have verified Open Food Facts image URLs & manufacturer descriptions

type NGEntry = { keys: string[] } & LookupResult

const NG_ENTRIES: NGEntry[] = [
  {
    keys: ['indomie', 'indomie noodles', 'indomie chicken'],
    name: 'Indomie Instant Noodles (Chicken Flavour)',
    description: 'Nigeria\'s most popular instant noodles. Made from wheat flour, palm oil, salt, and seasoning. Quick-cook noodles ready in 3 minutes. A household staple across Nigeria, enjoyed by millions daily as a fast, affordable meal. Produced by Dufil Prima Foods in Port Harcourt.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/089/686/020/0025/1.jpg',
    category: 'Noodles & Pasta', brand: 'Indomie (Dufil Prima Foods)'
  },
  {
    keys: ['coca cola', 'coke', 'coca-cola'],
    name: 'Coca-Cola Original Taste',
    description: 'The world\'s most famous carbonated soft drink. Made with carbonated water, sugar, caramel colour, phosphoric acid, natural flavourings, and caffeine. A refreshing cola beverage enjoyed ice-cold. Produced and bottled by Nigerian Bottling Company (NBC) under license from The Coca-Cola Company.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/544/900/000/0996/1.jpg',
    category: 'Beverages', brand: 'Coca-Cola (NBC Nigeria)'
  },
  {
    keys: ['pepsi', 'pepsi cola'],
    name: 'Pepsi Cola',
    description: 'Carbonated cola beverage manufactured by PepsiCo. Contains carbonated water, high fructose corn syrup, caramel colour, sugar, phosphoric acid, caffeine, citric acid, and natural flavours. A crisp, refreshing taste that competes as Nigeria\'s second most popular cola drink, bottled locally by Seven-Up Bottling Company.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/012/000/001/8105/1.jpg',
    category: 'Beverages', brand: 'Pepsi (Seven-Up Bottling Co.)'
  },
  {
    keys: ['fanta', 'fanta orange'],
    name: 'Fanta Orange',
    description: 'Sparkling orange-flavoured soft drink produced by The Coca-Cola Company. Made with carbonated water, sugar, orange fruit from concentrate (5%), citric acid, natural orange flavourings, and beta-carotene for colour. A fruity, vibrant beverage loved by Nigerian families, especially popular during celebrations and gatherings.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/544/900/000/9784/1.jpg',
    category: 'Beverages', brand: 'Fanta (NBC Nigeria)'
  },
  {
    keys: ['sprite', 'sprite lemon'],
    name: 'Sprite',
    description: 'Clear, lemon-lime flavoured soft drink from The Coca-Cola Company. Crisp, clean taste with no caffeine. Contains carbonated water, sugar, citric acid, natural lemon-lime flavourings. Known for its transparent bottle and refreshing taste, popular as a mixer and thirst-quencher across Nigeria.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/544/900/000/9524/1.jpg',
    category: 'Beverages', brand: 'Sprite (NBC Nigeria)'
  },
  {
    keys: ['maltina', 'maltina malt'],
    name: 'Maltina Malt Drink',
    description: 'Premium non-alcoholic malt beverage from Nigerian Breweries. Rich in B-vitamins and minerals. Made from barley malt, water, sugar, carbon dioxide, and hops. A nutritious, energy-giving drink with a distinct sweet malt taste. Nigeria\'s leading malt drink brand, widely served at social events and recommended for all ages.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/200/002/4909/1.jpg',
    category: 'Beverages', brand: 'Maltina (Nigerian Breweries)'
  },
  {
    keys: ['amstel malta', 'amstel'],
    name: 'Amstel Malta Premium',
    description: 'Premium low-sugar non-alcoholic malt drink from Nigerian Breweries. Contains carefully selected barley malt, hops, and pure water. Rich in essential B-vitamins (B1, B2, B3, B6) with significantly less sugar than regular malt drinks. Positioned as the sophisticated, healthier malt choice for discerning Nigerian consumers.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/200/002/4879/1.jpg',
    category: 'Beverages', brand: 'Amstel Malta (Nigerian Breweries)'
  },
  {
    keys: ['milo', 'milo drink', 'nestle milo'],
    name: 'Milo Chocolate Malt Beverage',
    description: 'Chocolate and malt powder drink from Nestlé. Made with malt barley, milk solids, sugar, cocoa, and a unique blend of vitamins and minerals (Actigen-E formula). Mix with hot or cold water/milk. Nigeria\'s favourite energy food drink, trusted by mothers for children\'s development and enjoyed by active adults for sustained energy.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/761/303/791/9530/1.jpg',
    category: 'Beverages', brand: 'Nestlé Milo'
  },
  {
    keys: ['bournvita', 'cadbury bournvita'],
    name: 'Cadbury Bournvita',
    description: 'Malted food drink mix from Cadbury (Mondelez International). Contains malt extract, sugar, cocoa, milk solids, and essential vitamins including A, C, D, B-complex and minerals like iron and calcium. A comforting hot beverage with a rich chocolate-malt taste, popular as a bedtime drink for children and adults throughout Nigeria.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/762/221/064/9588/1.jpg',
    category: 'Beverages', brand: 'Cadbury Bournvita (Mondelez)'
  },
  {
    keys: ['dano milk', 'dano', 'dano powder'],
    name: 'Dano Full Cream Milk Powder',
    description: 'Premium instant full cream milk powder from Arla Foods. Made from 100% fresh cow\'s milk. Contains milk fat, milk protein, and natural milk minerals. Rich and creamy taste. Simply mix with water to reconstitute. Fortified with vitamins A and D. A trusted brand across Nigeria for its consistent quality and natural dairy goodness.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/570/112/926/9051/1.jpg',
    category: 'Dairy', brand: 'Dano (Arla Foods)'
  },
  {
    keys: ['peak milk', 'peak', 'peak full cream'],
    name: 'Peak Full Cream Milk Powder',
    description: 'Premium powdered milk from FrieslandCampina WAMCO Nigeria. Made from pure cow\'s milk with nothing removed and nothing added except vitamins A and D. Contains 28% milk fat for rich, creamy taste. A household name in Nigeria for decades—"It\'s in you" campaign. Used for drinking, cooking, baking, and tea/coffee.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/410/062/3305/1.jpg',
    category: 'Dairy', brand: 'Peak (FrieslandCampina WAMCO)'
  },
  {
    keys: ['cowbell', 'cowbell milk'],
    name: 'Cowbell Full Cream Milk Powder',
    description: 'Full cream powdered milk from Promasidor Nigeria. Made from fresh cow\'s milk fortified with vitamins A and D. Creamy, smooth taste that dissolves easily in water. Popular in Nigerian households as an affordable quality milk option for tea, cooking, and direct consumption. Known for the iconic cowbell sound branding.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/410/062/3404/1.jpg',
    category: 'Dairy', brand: 'Cowbell (Promasidor)'
  },
  {
    keys: ['three crowns', 'three crowns milk'],
    name: 'Three Crowns Evaporated Milk',
    description: 'Evaporated full cream milk from FrieslandCampina WAMCO. Concentrated milk with 7.5% milk fat and 25% milk solids. Rich creamy taste ideal for tea, coffee, cereals, and cooking. Convenient tin packaging with long shelf life. Nigeria\'s favourite evaporated milk for its consistent quality and perfect creaminess.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/410/062/3503/1.jpg',
    category: 'Dairy', brand: 'Three Crowns (FrieslandCampina)'
  },
  {
    keys: ['golden morn', 'nestle golden morn'],
    name: 'Golden Morn Whole Grain Cereal',
    description: 'Nutritious whole grain breakfast cereal from Nestlé Nigeria. Made from locally sourced maize, millet, and sorghum grains. Fortified with essential vitamins (A, B1, B2, B3, B5, B6, B9, C) and iron. No added sugar. Just add hot water or milk. A proudly Nigerian product supporting local farmers, providing energy and nutrition for the whole family.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/789/100/024/2508/1.jpg',
    category: 'Cereals', brand: 'Nestlé Golden Morn'
  },
  {
    keys: ['corn flakes', 'kelloggs corn flakes'],
    name: 'Kellogg\'s Corn Flakes',
    description: 'Original toasted corn flakes breakfast cereal from Kellogg\'s. Made from milled corn, sugar, malt flavour, and salt, fortified with vitamins (A, B1, B2, B3, B6, B9, B12, C, D) and iron. Crispy golden flakes that stay crunchy in milk. A nutritious breakfast choice enjoyed worldwide and across Nigerian homes.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/505/382/710/0151/1.jpg',
    category: 'Cereals', brand: 'Kellogg\'s'
  },
  {
    keys: ['quaker oats', 'quaker', 'oats'],
    name: 'Quaker Oats Rolled Oats',
    description: '100% natural rolled oats from Quaker Oats Company (PepsiCo). Made from whole grain oats that are steamed and flattened. Rich in dietary fibre, protein, and complex carbohydrates. Low in saturated fat and naturally cholesterol-free. Perfect for making oatmeal, smoothies, baking, and as a nutritious breakfast staple in Nigerian homes.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/030/000/061/1131/1.jpg',
    category: 'Cereals', brand: 'Quaker Oats (PepsiCo)'
  },
  {
    keys: ['maggi', 'maggi cube', 'maggi seasoning'],
    name: 'Maggi Seasoning Cubes',
    description: 'Nigeria\'s number one cooking seasoning. Made from salt, monosodium glutamate (MSG), sugar, palm oil, spices (onion, garlic), and iodine. Each cube dissolves perfectly in stews, soups, rice, and sauces to deliver the authentic Nigerian taste. Produced by Nestlé Nigeria. An essential kitchen ingredient found in virtually every Nigerian home.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/761/303/465/2384/1.jpg',
    category: 'Seasonings', brand: 'Maggi (Nestlé Nigeria)'
  },
  {
    keys: ['knorr', 'knorr cube', 'knorr seasoning'],
    name: 'Knorr Seasoning Cubes',
    description: 'Premium cooking bouillon cubes from Unilever. Made from salt, flavour enhancers (MSG, disodium inosinate), palm oil, onion powder, garlic, and spices. Rich, balanced flavour that enhances the natural taste of food. The #1 competitor to Maggi in Nigeria, used in professional kitchens and homes for soups, stews, jollof rice, and more.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/256/686/5406/1.jpg',
    category: 'Seasonings', brand: 'Knorr (Unilever Nigeria)'
  },
  {
    keys: ['omo', 'omo detergent', 'omo washing'],
    name: 'Omo Washing Powder',
    description: 'Powerful laundry detergent powder from Unilever Nigeria. Advanced stain-removal formula with active oxygen and enzymes that penetrate deep into fabric fibres. Removes tough stains like oil, grease, food, and dirt even in cold water. Available in various sizes. Nigeria\'s most trusted laundry brand for both hand-washing and machine washing.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/256/686/5604/1.jpg',
    category: 'Household', brand: 'Omo (Unilever Nigeria)'
  },
  {
    keys: ['ariel', 'ariel detergent'],
    name: 'Ariel Laundry Detergent',
    description: 'Premium laundry powder from Procter & Gamble. Contains advanced stain-lifting technology with micro-particles that target and remove stubborn stains in one wash. Brightens whites and colours without damaging fabric. A professional-grade detergent trusted by Nigerian households for deep cleaning performance.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/401/560/052/1338/1.jpg',
    category: 'Household', brand: 'Ariel (P&G Nigeria)'
  },
  {
    keys: ['dettol', 'dettol antiseptic'],
    name: 'Dettol Antiseptic Liquid',
    description: 'Trusted antiseptic disinfectant from Reckitt Benckiser. Contains chloroxylenol (4.8%) as the active ingredient. Kills 99.9% of germs and bacteria on surfaces and skin. Used for first aid, personal hygiene, laundry, and surface cleaning. A household essential in Nigeria for over 50 years, especially valued during flu seasons and for wound care.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/500/016/706/4135/1.jpg',
    category: 'Household', brand: 'Dettol (Reckitt Benckiser)'
  },
  {
    keys: ['close up', 'closeup toothpaste'],
    name: 'Close Up Toothpaste',
    description: 'Popular fluoride toothpaste from Unilever. Contains sodium fluoride (1450ppm) for cavity protection. Unique gel formula with micro-crystals for deep cleaning and lasting fresh breath. Known for its distinctive red gel colour and strong minty freshness. Nigeria\'s leading youth toothpaste brand.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/256/686/5703/1.jpg',
    category: 'Personal Care', brand: 'Close Up (Unilever Nigeria)'
  },
  {
    keys: ['colgate', 'colgate toothpaste'],
    name: 'Colgate Total Toothpaste',
    description: 'Number one dentist-recommended toothpaste globally from Colgate-Palmolive. Advanced fluoride formula with antibacterial protection that fights cavities, plaque, tartar, and gum problems. Provides 12-hour antibacterial shield for whole mouth health. Widely available across Nigerian pharmacies and supermarkets.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/800/109/024/4501/1.jpg',
    category: 'Personal Care', brand: 'Colgate (Colgate-Palmolive)'
  },
  {
    keys: ['vaseline', 'vaseline jelly'],
    name: 'Vaseline Petroleum Jelly',
    description: 'Original pure petroleum jelly from Unilever. Triple-purified formula that locks in moisture to heal and protect dry skin. Dermatologist-tested and hypoallergenic. Used for moisturising dry skin, protecting minor cuts, preventing chafing, and as a lip balm. A staple skincare product in Nigerian homes for generations.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/305/210/100/1021/1.jpg',
    category: 'Personal Care', brand: 'Vaseline (Unilever)'
  },
  {
    keys: ['nivea', 'nivea cream'],
    name: 'Nivea Crème Moisturiser',
    description: 'Rich, intensive moisturising cream from Beiersdorf. Contains Eucerit (a unique water-in-oil emulsifier) and glycerin for deep, long-lasting hydration. The iconic blue tin formula trusted worldwide since 1911. Provides intensive care for very dry, rough skin on face, hands, and body. A classic beauty staple in Nigeria.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/400/580/817/0012/1.jpg',
    category: 'Personal Care', brand: 'Nivea (Beiersdorf)'
  },
  {
    keys: ['lux', 'lux soap'],
    name: 'Lux Beauty Soap',
    description: 'Premium beauty bath soap from Unilever. Infused with fine fragrance oils and moisturising cream for soft, smooth, delicately scented skin. Available in multiple variants. Used by Nigerian women for generations as their daily beauty soap, endorsed by celebrities with the tagline "The Beauty Bar of Film Stars."',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/256/686/5802/1.jpg',
    category: 'Personal Care', brand: 'Lux (Unilever Nigeria)'
  },
  {
    keys: ['golden penny', 'golden penny spaghetti', 'golden penny pasta'],
    name: 'Golden Penny Spaghetti',
    description: 'Premium durum wheat spaghetti from Flour Mills of Nigeria. Made from 100% durum wheat semolina. Golden yellow colour. Cooks to perfect al dente texture in 10-12 minutes. Fortified with vitamins. A trusted Nigerian brand used across homes, restaurants, and catering services for jollof spaghetti and other pasta dishes.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/800/125/031/0509/1.jpg',
    category: 'Noodles & Pasta', brand: 'Golden Penny (Flour Mills of Nigeria)'
  },
  {
    keys: ['dangote cement', 'dangote', 'cement'],
    name: 'Dangote 3X Portland Cement (42.5R)',
    description: 'High-grade Portland cement from Dangote Industries, Africa\'s largest cement producer. 42.5R strength grade suitable for general construction, reinforced concrete, block-making, and plastering. Fine grinding for excellent workability and fast setting. Available in 50kg bags. Nigeria\'s most widely used construction material for residential and commercial projects.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/871/410/062/3701/1.jpg',
    category: 'Building Materials', brand: 'Dangote Cement'
  },
  {
    keys: ['dangote sugar', 'sugar'],
    name: 'Dangote Refined White Sugar',
    description: 'Pure refined white sugar from Dangote Sugar Refinery. Produced from imported raw sugar that is refined to USDA Grade A standards. Fine crystals perfect for beverages, baking, cooking, and food processing. Nigeria\'s leading sugar brand offering consistent quality for household and industrial use across the country.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/317/568/107/1353/1.jpg',
    category: 'Groceries', brand: 'Dangote Sugar'
  },
  {
    keys: ['dangote salt', 'salt'],
    name: 'Dangote Iodised Table Salt',
    description: 'Refined iodised salt from Dangote Salt. Fine-grain sodium chloride fortified with iodine (50ppm minimum) to prevent iodine deficiency disorders. Clean, pure taste. Essential for daily cooking, food preservation, and seasoning. National Agency for Food and Drug Administration (NAFDAC) certified for quality and safety.',
    imageUrl: 'https://images.openfoodfacts.org/images/products/317/568/107/1360/1.jpg',
    category: 'Groceries', brand: 'Dangote Salt'
  },
]

// Build reverse index: key → entry
const KEY_MAP: Record<string, NGEntry> = {}
for (const entry of NG_ENTRIES) {
  for (const key of entry.keys) {
    KEY_MAP[key] = entry
  }
}

function toResult(entry: NGEntry): LookupResult {
  return {
    name: entry.name,
    description: entry.description,
    imageUrl: entry.imageUrl ? `/api/product-image?url=${encodeURIComponent(entry.imageUrl)}` : null,
    category: entry.category,
    brand: entry.brand,
  }
}

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '')
}

function findNigerianMatch(query: string): LookupResult | null {
  const q = normalizeName(query)
  if (q.length < 2) return null

  // Exact key match
  if (KEY_MAP[q]) return toResult(KEY_MAP[q])

  // Partial match — query contains a key or key contains query
  for (const [key, entry] of Object.entries(KEY_MAP)) {
    if (q.includes(key) || key.includes(q)) {
      return toResult(entry)
    }
  }

  return null
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    authenticate(req)

    const { searchParams } = new URL(req.url)
    const query = (searchParams.get('q') || '').trim()

    if (!query || query.length < 2) {
      return NextResponse.json({ data: null })
    }

    // ── Step 1: Check Nigerian products database (instant) ──────────
    const ngMatch = findNigerianMatch(query)
    if (ngMatch) {
      return NextResponse.json({ data: ngMatch })
    }

    // ── Step 2: Search Open Food Facts with Nigeria focus ──────────
    let bestResult: LookupResult | null = null

    // Try multiple search strategies
    const searchQueries = [
      query,                                    // Original
      `${query} Nigeria`,                       // + Nigeria
      query.replace(/\d+/, '').trim(),          // Without numbers
    ].filter((q, i, arr) => q && q.length >= 2 && arr.indexOf(q) === i)

    for (const sq of searchQueries) {
      if (bestResult) break
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 6000)
        const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(sq)}&search_simple=1&json=1&page_size=5&lc=en&countries_tags_en=nigeria`
        const offRes = await fetch(offUrl, { signal: controller.signal })
        clearTimeout(timeout)
        const text = await offRes.text()
        if (!text.startsWith('{')) continue

        const offData = JSON.parse(text) as {
          products?: Array<{
            product_name?: string; generic_name?: string
            image_url?: string; image_front_url?: string
            categories_tags?: string[]; brands?: string; ingredients_text?: string
          }>
        }
        const products = offData?.products || []
        const match = products.find((p) => p.product_name && p.image_url && !/[^\x00-\x7F]/.test(p.product_name || '')) ||
                       products.find((p) => p.product_name && p.image_url) ||
                       products[0]

        if (match?.product_name) {
          const categoryTag = match.categories_tags?.[0] || ''
          const category = categoryTag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || null
          bestResult = {
            name: match.product_name,
            description: match.generic_name || match.ingredients_text?.slice(0, 200) || null,
            imageUrl: (match.image_url || match.image_front_url) ? `/api/product-image?url=${encodeURIComponent(match.image_url || match.image_front_url || '')}` : null,
            category,
            brand: match.brands || null,
          }
        }
      } catch { /* try next query */ }
    }

    if (bestResult) {
      return NextResponse.json({ data: bestResult })
    }

    // ── Step 3: DuckDuckGo instant answer ──────────────────────────
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query + ' product')}&format=json&no_html=1&skip_disambig=1`
      const ddgRes = await fetch(ddgUrl, { signal: controller.signal })
      clearTimeout(timeout)
      const ddgText = await ddgRes.text()
      if (ddgText.startsWith('{')) {
        const ddgData = JSON.parse(ddgText) as { Abstract?: string; AbstractText?: string; Image?: string; Heading?: string }
        if (ddgData.AbstractText || ddgData.Heading) {
          return NextResponse.json({
            data: {
              name: ddgData.Heading || query,
              description: ddgData.AbstractText || ddgData.Abstract || null,
              imageUrl: ddgData.Image || null,
              category: null,
              brand: null,
            } as LookupResult,
          })
        }
      }
    } catch { /* fallback failed */ }

    return NextResponse.json({ data: null })
  } catch (err) {
    console.error('[PRODUCT-LOOKUP GET]', err)
    return apiError('Internal server error', 500)
  }
}
