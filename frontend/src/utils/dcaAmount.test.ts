import { describe, expect, it } from 'vitest'
import { formatDcaAmount, parseDcaAmount } from './dcaAmount'

describe('DCA amount boundaries', () => {
  it('parses decimal-comma token units without grouping or rounding', () => {
    expect(parseDcaAmount('0,0000001', 'de')).toBe(0.0000001)
    expect(parseDcaAmount('199999999,9999999', 'de')).toBe(199999999.9999999)
    expect(parseDcaAmount('200000000', 'de')).toBe(200000000)
    expect(formatDcaAmount(0.0000001, 'de')).toBe('0,0000001')
  })

  it.each(['0', '-1', '0,00000001', '200000001', '1.234,5', '1,2,3', ''])('rejects %s', (input) => {
    expect(parseDcaAmount(input, 'de')).toBeNull()
  })
})
