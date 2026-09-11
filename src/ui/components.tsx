/** Nexus /nexus 面板的轻量 React 呈现组件。视觉全部走 theme.css 的 --nx-* token。 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** 统计胶囊。tone 取值：ok | warn | bad | accent。 */
export function Chip({ label, value, tone }: { label: string; value: string | number; tone?: string }): ReactNode {
  return <span className={`nx-chip${tone !== undefined ? ' ' + tone : ''}`}>{label} <b>{value}</b></span>
}

/** 记忆标签。className 追加 slot-* / status-* 色调类。 */
export function Tag({ text, className }: { text: string; className?: string }): ReactNode {
  return <span className={`nx-tag${className !== undefined ? ' ' + className : ''}`}>{text}</span>
}

/** 动作按钮。kind 取值：primary | danger。 */
export function Btn({
  kind, disabled, onClick, children,
}: {
  kind?: 'primary' | 'danger'; disabled?: boolean; onClick: () => void; children: ReactNode;
}): ReactNode {
  return (
    <button
      className={`nx-btn${kind !== undefined ? ' ' + kind : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export interface SelectOption { value: string; label: string }
export interface SelectGroup { label: string; options: SelectOption[] }

/** DSH 风格下拉：自定义触发器 + 选项面板（支持分组，替代原生 <select>）。 */
export function Select({ value, onChange, options, groups, ariaLabel }: {
  value: string; onChange: (v: string) => void; options?: SelectOption[]; groups?: SelectGroup[]; ariaLabel: string;
}): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => { document.removeEventListener('mousedown', onDoc) }
  }, [])
  const all = options ?? groups?.flatMap((group) => group.options) ?? []
  const current = all.find((option) => option.value === value)
  const renderOption = (option: SelectOption): ReactNode => (
    <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={option.value === value}
      className={`nx-select-option${option.value === value ? ' selected' : ''}`}
      onClick={() => { onChange(option.value); setOpen(false) }}
    >
      <span>{option.label}</span>
      {option.value === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
    </button>
  )
  return (
    <div className="nx-select" ref={root}>
      <button type="button" className="nx-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((o) => !o)}>
        <span>{current?.label ?? ''}</span>
        <svg className="nx-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="nx-select-menu" role="listbox">
          {groups !== undefined
            ? groups.map((group) => (
                <div key={group.label} className="nx-select-group">
                  <div className="nx-select-group-label">{group.label}</div>
                  {group.options.map(renderOption)}
                </div>
              ))
            : (options ?? []).map(renderOption)}
        </div>
      )}
    </div>
  )
}
