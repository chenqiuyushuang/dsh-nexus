/**
 * B6 键盘交互的纯逻辑（可单测，不依赖 DOM）：
 * 「⋯」菜单的上下键/Home/End 环绕，以及面板快捷键的抢键判定。
 */

/** 菜单项之间移动：↑/↓ 环绕，Home/End 到首尾；返回 -1 表示这个键不归菜单管。 */
export function nextMenuIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return -1
}

/** 「/」聚焦搜索：正在输入框/文本域里打字时不抢键（否则没法输入斜杠）。 */
export function shouldHandleSlashKey(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (target === null) return true
  if (target.isContentEditable === true) return false
  const tag = (target.tagName ?? '').toLowerCase()
  return tag !== 'input' && tag !== 'textarea' && tag !== 'select'
}

/** 是否需要忽略组合键（⌘/Ctrl/Alt + /）。 */
export function isPlainSlash(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): boolean {
  if (event.key !== '/') return false
  return event.metaKey !== true && event.ctrlKey !== true && event.altKey !== true
}
