export function formatUnits(value: bigint, decimals: number, fractionDigits = 4) {
  const base = 10n ** BigInt(decimals)
  const int = value / base
  const frac = value % base
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, fractionDigits)
  return `${int.toString()}${fractionDigits > 0 ? '.' + fracStr : ''}`
}

export function parseUnits(input: string, decimals: number): bigint {
  const [i, f = ''] = (input || '0').split('.')
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals)
  const s = (i || '0').replace(/[^0-9-]/g, '')
  const isNeg = s.startsWith('-')
  const intPart = BigInt(s || '0')
  const fracPart = BigInt(frac || '0')
  const base = 10n ** BigInt(decimals)
  const val = intPart * base + fracPart
  return isNeg ? -val : val
}
