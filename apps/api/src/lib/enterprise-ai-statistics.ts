export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(2))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function variance(values: number[], sample = false): number {
  if (values.length < (sample ? 2 : 1)) return 0
  const mean = average(values)
  const numerator = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  return numerator / Math.max(1, values.length - (sample ? 1 : 0))
}

export function standardDeviation(values: number[], sample = false): number {
  return Math.sqrt(Math.max(0, variance(values, sample)))
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const position = clamp(q, 0, 1) * (sorted.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return sorted[lowerIndex]
  const weight = position - lowerIndex
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight
}

export function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 3) return 0
  const meanLeft = average(left)
  const meanRight = average(right)
  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - meanLeft
    const rightDelta = right[index] - meanRight
    numerator += leftDelta * rightDelta
    leftVariance += leftDelta ** 2
    rightVariance += rightDelta ** 2
  }

  if (leftVariance === 0 || rightVariance === 0) return 0
  return numerator / Math.sqrt(leftVariance * rightVariance)
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x))
  return sign * y
}

export function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)))
}

export function inverseNormalQuantile(probability: number): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6)
  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239,
  ]
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572,
  ]
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ]
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416,
  ]

  const plow = 0.02425
  const phigh = 1 - plow

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }

  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -((((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1))
  }

  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ]

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  }

  let x = 0.9999999999998099
  let adjusted = value - 1

  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index] / (adjusted + index + 1)
  }

  const t = adjusted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(t) - t + Math.log(x)
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200
  const epsilon = 3e-7
  const fpMin = 1e-30
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap

  if (Math.abs(d) < fpMin) d = fpMin
  d = 1 / d
  let h = d

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const evenIndex = iteration * 2
    let aa = (iteration * (b - iteration) * x) / ((qam + evenIndex) * (a + evenIndex))
    d = 1 + aa * d
    if (Math.abs(d) < fpMin) d = fpMin
    c = 1 + aa / c
    if (Math.abs(c) < fpMin) c = fpMin
    d = 1 / d
    h *= d * c

    aa = (-(a + iteration) * (qab + iteration) * x) / ((a + evenIndex) * (qap + evenIndex))
    d = 1 + aa * d
    if (Math.abs(d) < fpMin) d = fpMin
    c = 1 + aa / c
    if (Math.abs(c) < fpMin) c = fpMin
    d = 1 / d
    const delta = d * c
    h *= delta

    if (Math.abs(delta - 1) <= epsilon) break
  }

  return h
}

export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1

  const numerator = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  const front = Math.exp(numerator)

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a
  }

  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

export function fDistributionSurvival(fStatistic: number, df1: number, df2: number): number {
  if (!Number.isFinite(fStatistic) || fStatistic <= 0 || df1 <= 0 || df2 <= 0) return 1
  const x = (df1 * fStatistic) / (df1 * fStatistic + df2)
  return clamp(1 - regularizedIncompleteBeta(x, df1 / 2, df2 / 2), 0, 1)
}

export function transpose(matrix: number[][]): number[][] {
  if (!matrix.length) return []
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]))
}

export function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  if (!left.length || !right.length) return []
  const result = Array.from({ length: left.length }, () => Array(right[0].length).fill(0))
  for (let rowIndex = 0; rowIndex < left.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < right[0].length; columnIndex += 1) {
      for (let innerIndex = 0; innerIndex < right.length; innerIndex += 1) {
        result[rowIndex][columnIndex] += left[rowIndex][innerIndex] * right[innerIndex][columnIndex]
      }
    }
  }
  return result
}

export function invertMatrix(matrix: number[][]): number[][] | null {
  const size = matrix.length
  if (!size || matrix.some((row) => row.length !== size)) return null

  const augmented = matrix.map((row, rowIndex) => [
    ...row.map((value) => Number(value)),
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0)),
  ])

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let maxRow = pivotIndex
    for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
      if (Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[maxRow][pivotIndex])) {
        maxRow = rowIndex
      }
    }

    if (Math.abs(augmented[maxRow][pivotIndex]) < 1e-10) return null

    if (maxRow !== pivotIndex) {
      const temp = augmented[pivotIndex]
      augmented[pivotIndex] = augmented[maxRow]
      augmented[maxRow] = temp
    }

    const pivot = augmented[pivotIndex][pivotIndex]
    for (let columnIndex = 0; columnIndex < size * 2; columnIndex += 1) {
      augmented[pivotIndex][columnIndex] /= pivot
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) continue
      const factor = augmented[rowIndex][pivotIndex]
      for (let columnIndex = 0; columnIndex < size * 2; columnIndex += 1) {
        augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex]
      }
    }
  }

  return augmented.map((row) => row.slice(size))
}

export type RegressionResult = {
  coefficients: number[]
  rss: number
  predictions: number[]
}

export function ordinaryLeastSquares(design: number[][], target: number[]): RegressionResult | null {
  if (!design.length || design.length !== target.length) return null
  const xt = transpose(design)
  const xtx = multiplyMatrices(xt, design)
  const xtxInverse = invertMatrix(xtx)
  if (!xtxInverse) return null
  const xty = multiplyMatrices(xt, target.map((value) => [value]))
  const coefficients = multiplyMatrices(xtxInverse, xty).map((row) => row[0])
  const predictions = design.map((row) => row.reduce((sum, value, index) => sum + value * (coefficients[index] || 0), 0))
  const rss = target.reduce((sum, actual, index) => sum + (actual - predictions[index]) ** 2, 0)
  return { coefficients, rss, predictions }
}