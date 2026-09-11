/** B6 键盘纯逻辑：菜单环绕与「/」抢键判定。 */
import { describe, expect, it } from 'vitest'
import { isPlainSlash, nextMenuIndex, shouldHandleSlashKey } from '../src/ui/keyboard.ts'

describe('菜单方向键', () => {
  it('↑/↓ 环绕，Home/End 到首尾', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(nextMenuIndex(2, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(0, 'ArrowUp', 3)).toBe(2)
    expect(nextMenuIndex(-1, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(-1, 'ArrowUp', 3)).toBe(2)
    expect(nextMenuIndex(1, 'Home', 3)).toBe(0)
    expect(nextMenuIndex(1, 'End', 3)).toBe(2)
  })

  it('其他按键不归菜单管；空菜单返回 -1', () => {
    expect(nextMenuIndex(0, 'Enter', 3)).toBe(-1)
    expect(nextMenuIndex(0, 'Tab', 3)).toBe(-1)
    expect(nextMenuIndex(0, 'ArrowDown', 0)).toBe(-1)
  })
})

describe('「/」聚焦搜索', () => {
  it('输入类控件里不抢键，其它地方抢', () => {
    expect(shouldHandleSlashKey({ tagName: 'INPUT' })).toBe(false)
    expect(shouldHandleSlashKey({ tagName: 'TEXTAREA' })).toBe(false)
    expect(shouldHandleSlashKey({ tagName: 'SELECT' })).toBe(false)
    expect(shouldHandleSlashKey({ tagName: 'DIV', isContentEditable: true })).toBe(false)
    expect(shouldHandleSlashKey({ tagName: 'BUTTON' })).toBe(true)
    expect(shouldHandleSlashKey(null)).toBe(true)
  })

  it('只认不带修饰键的 /', () => {
    expect(isPlainSlash({ key: '/' })).toBe(true)
    expect(isPlainSlash({ key: 'a' })).toBe(false)
    expect(isPlainSlash({ key: '/', metaKey: true })).toBe(false)
    expect(isPlainSlash({ key: '/', ctrlKey: true })).toBe(false)
    expect(isPlainSlash({ key: '/', altKey: true })).toBe(false)
  })
})
