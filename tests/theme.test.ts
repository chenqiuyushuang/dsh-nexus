/** B7 主题跟随：字号解析/夹取/查询参数。 */
import { describe, expect, it } from 'vitest'
import { fontSizeFromQuery, isDarkTheme, pickContentFontSize } from '../src/ui/theme.ts'

describe('宿主字号跟随', () => {
  it('解析 px / 纯数字，越界夹到 12-17，脏值回退 14', () => {
    expect(pickContentFontSize('15px')).toBe(15)
    expect(pickContentFontSize('16')).toBe(16)
    expect(pickContentFontSize('9px')).toBe(12)
    expect(pickContentFontSize('40px')).toBe(17)
    expect(pickContentFontSize('abc')).toBe(14)
    expect(pickContentFontSize('')).toBe(14)
    expect(pickContentFontSize(undefined)).toBe(14)
    expect(pickContentFontSize(null)).toBe(14)
  })

  it('主题跟随宿主：宿主有属性就听宿主的，读不到才用系统偏好', () => {
    expect(isDarkTheme(true, false)).toBe(true)
    expect(isDarkTheme(false, true)).toBe(false)
    expect(isDarkTheme(undefined, true)).toBe(true)
    expect(isDarkTheme(undefined, false)).toBe(false)
  })

  it('查询参数 ?fontSize= 优先，非法值同样回退', () => {
    expect(fontSizeFromQuery('?fontSize=15')).toBe(15)
    expect(fontSizeFromQuery('?a=1&fontSize=13px')).toBe(13)
    expect(fontSizeFromQuery('?fontSize=99')).toBe(17)
    expect(fontSizeFromQuery('?fontSize=x')).toBe(14)
    expect(fontSizeFromQuery('')).toBeUndefined()
  })
})
