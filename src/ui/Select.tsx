/**
 * 面板自绘下拉。
 *
 * 为什么不用原生 <select>：
 * 1. 它的弹层是**系统菜单**（macOS 亮色模式下就是一张白底 NSMenu），CSS 完全够不着，
 *    `color-scheme: dark` 也只在部分平台生效 —— 深色面板里点开是一张白菜单，
 *    和面板的卡片/圆角/字号不是一套语言。用户两次反馈「下拉形式不好看」说的就是它。
 * 2. 原生 select 的宽度由「最长选项」决定，同样的 padding 下雪佛龙与文字的间距时宽时窄：
 *    「全部状态」（最长选项比当前文案长）空一大截，「全部作用域」（文案本身就是最长选项）
 *    几乎贴住 —— 并排两个控件看着不像一套。
 *
 * 这里换成 <button> + 自绘列表：文字、间距、悬停、选中全部走面板自己的 token。
 * 弹层用 position: fixed 渲染，逃出 .panel-body 的滚动裁剪；下方空间不足时向上弹，
 * 并按可用空间限高。键盘：↑ ↓ Home End Enter Space Esc Tab。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
}

/** 触发器与弹层的间距 */
const GAP = 6
/** 弹层与视口边缘的最小距离 */
const EDGE = 8
/** 弹层最大高度（记忆库状态筛选 8 项 × 32px + 内边距 = 264，要能一次看全不滚动） */
const MAX_H = 280
/** 下方留不下这么多就考虑向上弹 */
const MIN_BELOW = 120

interface SelectBox {
  left: number
  top: number
  minWidth: number
  maxHeight: number
  /** true 表示弹层贴在触发器上方（用 translateY(-100%) 对齐） */
  up: boolean
}

export function Select(props: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const { value, options, onChange, className, ariaLabel, disabled } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState<SelectBox | null>(null)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  /** 键盘 Enter/Space 提交后浏览器还会补一次 click，用它吞掉，避免「选完又弹开」 */
  const keyCommit = useRef(false)
  /** 定位修正已经跑了几轮（弹层挂上才知道真实尺寸，最多两轮；不设闸会自激） */
  const pass = useRef(0)
  const current = options.find((option) => option.value === value) ?? options[0]

  /**
   * 从触发器实测位置算一次弹层几何。
   * 弹层已经挂上时还会用它的实测尺寸做两件事：
   *   ① 竖直：下方放不下**整张**列表、上方更宽裕 → 翻到触发器上面（否则最后几项被切掉）；
   *   ② 水平：弹层比触发器宽（选项比当前文案长）时可能越出右边缘 → 右边缘对齐触发器再夹在视口内。
   * 每次都从零算，所以滚动/resize 时直接重调即可，不会累积偏移。
   */
  const measure = useCallback((): SelectBox | null => {
    const trigger = triggerRef.current
    if (trigger === null) return null
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - EDGE - GAP
    const above = rect.top - EDGE - GAP
    const pop = popRef.current
    // scrollHeight 是「不限高时的内容高度」——max-height 生效时它仍然是整张列表的高度
    const need = pop?.scrollHeight ?? 0
    const width = pop?.getBoundingClientRect().width ?? 0
    // 还没量到内容时按经验判：下方连 MIN_BELOW 都放不下、且上方更宽裕 → 先按向上摆
    let up = below < Math.min(MAX_H, MIN_BELOW) && above > below
    if (need > 0) up = need > below && above > below
    let left = rect.left
    if (width > 0 && left + width > window.innerWidth - EDGE) {
      // 越界时优先「弹层右边缘对齐触发器右边缘」（往左长），而不是贴着视口边缘停 ——
      // 设置页的模型下拉在右端，贴边会让弹层和触发器错开一截，看着像没对齐。
      left = Math.max(EDGE, Math.min(rect.right - width, window.innerWidth - EDGE - width))
    }
    return {
      left,
      top: up ? rect.top - GAP : rect.bottom + GAP,
      minWidth: rect.width,
      maxHeight: Math.max(80, Math.min(MAX_H, up ? above : below)),
      up,
    }
  }, [])

  const place = useCallback(() => {
    const next = measure()
    if (next !== null) setBox(next)
  }, [measure])

  const openList = useCallback(() => {
    const found = options.findIndex((option) => option.value === value)
    setActive(found >= 0 ? found : 0)
    pass.current = 0
    place()
    setOpen(true)
  }, [options, place, value])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const commit = useCallback(
    (next: string) => {
      onChange(next)
      close(true)
    },
    [close, onChange],
  )

  // 弹层挂上之后再量一轮：第一轮里「是否出现滚动条」还会影响弹层宽度（滚动条占宽度），
  // 所以翻面/对齐要等第二轮才稳定。两轮封顶。
  useLayoutEffect(() => {
    if (!open || pass.current >= 2) return
    pass.current += 1
    place()
  }, [open, box, place])

  // 打开期间：跟随滚动/缩放重新定位；点别处或 Esc 关闭
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    const onScroll = (event: Event) => {
      const pop = popRef.current
      if (pop !== null && event.target instanceof Node && pop.contains(event.target)) return
      place()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, place])

  // 键盘移动高亮时把它滚进可视区
  useEffect(() => {
    if (!open) return
    const node = popRef.current?.querySelector('[data-active="true"]')
    // jsdom 没有实现 scrollIntoView，测试环境里跳过
    if (node instanceof HTMLElement && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled === true) return
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) openList()
        else setActive((index) => Math.min(index + 1, last))
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) openList()
        else setActive((index) => Math.max(index - 1, 0))
        break
      case 'Home':
        if (!open) return
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        if (!open) return
        event.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (!open) openList()
        else {
          const option = options[active]
          if (option !== undefined) {
            keyCommit.current = true
            commit(option.value)
          }
        }
        break
      case 'Tab':
        if (open) setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <div
      className={'nx-select' + (className !== undefined ? ' ' + className : '') + (open ? ' open' : '')}
      ref={rootRef}
    >
      <button
        type="button"
        className="sel-trigger"
        ref={triggerRef}
        disabled={disabled === true}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => {
          if (keyCommit.current) {
            keyCommit.current = false
            return
          }
          if (open) setOpen(false)
          else openList()
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="sel-label">{current?.label ?? ''}</span>
        <svg className="sel-chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && box !== null && (
        <div
          className="sel-pop"
          id={listId}
          role="listbox"
          ref={popRef}
          style={{
            left: box.left,
            top: box.top,
            minWidth: box.minWidth,
            maxWidth: 'calc(100vw - 16px)',
            maxHeight: box.maxHeight,
            transform: box.up ? 'translateY(-100%)' : undefined,
          }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              className="sel-opt"
              role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              // 不让触发器在点选项时失焦（失焦会触发 :focus 样式闪烁）
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(option.value)}
            >
              <span className="sel-opt-label">{option.label}</span>
              {option.value === value && (
                <span className="sel-opt-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
