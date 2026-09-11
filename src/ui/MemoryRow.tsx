/**
 * B3 列表行：折叠态 = 单行（勾选框 + 作用域色条 + 一句正文省略号 + 状态字 + ⋯，约 38px），
 * 展开后才给标签行、完整正文、冲突/重复提示与元信息；次要操作收进「⋯」菜单。
 *
 * 为什么要拆出来：面板原来的行同时塞 7 个按钮 + 元信息 + 提示，3000 字的记忆直接顶满一屏。
 * 拆成组件后折叠/展开/菜单/二次确认都能被渲染测试覆盖（见 tests/panel-list.test.ts）。
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { Btn, Select, Tag } from './components.tsx'
import { nextMenuIndex } from './keyboard.ts'

export interface MemoryRowItem {
  id: string
  subject: string
  scope: string
  slot: string
  status: string
  pinned?: boolean
  statement: string
  weight: number
  confidence?: number
  updatedAt: number
  conflictWith?: string
  supersededBy?: string
  reviewNote?: string
  statementLength?: number
  truncated?: boolean
  /** 进注入块占的字节（服务端算好，与运行时同源）。 */
  injectBytes?: number
}
export interface NeighborView { edge?: string; atom?: { statement: string }; other?: string }
export interface NeighborState { loading: boolean; list: NeighborView[] | null; error?: string }
/** 受控展开容器（grid-template-rows 0fr↔1fr）：收起到 0、展开到内容自然高度，都不写死像素。 */
export function Disclosure({ open, className, children }: { open: boolean; className?: string; children: ReactNode }): ReactNode {
  // 收起时只做视觉隐藏是不够的：内容仍在 DOM 里，读屏与 Tab 还会摸到它。
  // inert 一次性关掉「可见 + 可聚焦 + 可访问树」，比 aria-hidden + 手动 tabIndex={-1} 可靠。
  const inner: Record<string, unknown> = { className: 'nx-disclosure-inner' }
  if (!open) inner.inert = ''
  return (
    <div className={'nx-disclosure' + (open ? ' open' : '') + (className !== undefined ? ' ' + className : '')}>
      <div {...inner}>{children}</div>
    </div>
  )
}
/** 右键菜单坐标（panel 持有，行只负责把事件报上来）。 */
export interface RowContextMenu { open: boolean; x: number; y: number }

const SCOPE_NAME: Record<string, string> = { user: '跨项目', project: '本项目', episode: '本会话' }
const SLOT_NAME: Record<string, string> = {
  personal: '个人', user: '个人', project: '项目', episode: '会话', feedback: '反馈', reference: '资料',
}
const STATUS_NAME: Record<string, string> = {
  pending: '待确认', 'needs-review': '冲突', active: '活跃', archived: '已归档', superseded: '已取代', rejected: '已拒绝',
}
/** 置信度圆点：<60% 红 / 60-89% 琥珀 / ≥90% 绿；颜色 + title 双通道（不靠颜色单独传达）。 */
function ConfDot({ confidence }: { confidence?: number }): ReactNode {
  const pct = Math.round((confidence ?? 0) * 100)
  const tone = pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'low'
  return <span className={'nx-conf ' + tone} title={'置信度 ' + String(pct) + '%'} aria-label={'置信度 ' + String(pct) + '%'} role="img" />
}

const FOLDED_HINT = '点击展开全文'
const COLLAPSE_HINT = '点击收起'

export interface MemoryRowProps {
  item: MemoryRowItem
  selected: boolean
  /** 键盘导航焦点环（panel 的 ↑/↓ 导航）。 */
  focused?: boolean
  onSelect: (id: string, next: boolean, mods?: { shift?: boolean; meta?: boolean }) => void
  /** 初始展开（测试/深链用）。 */
  defaultExpanded?: boolean
  /** 受控展开：面板用它实现「同时只展开一条」（手风琴），避免长记忆把列表视口吃光。 */
  expandedId?: string | null
  onToggleExpand?: (id: string | null) => void
  neighbors?: NeighborState
  neighborsOpen: boolean
  onToggleNeighbors: (id: string) => void
  /** 注入预算（字节）：用于显示这一条占预算的比例。 */
  budgetBytes?: number
  /** 取全文（列表只给 400 字预览）。 */
  onLoadFull: (id: string) => Promise<string>
  onSave: (id: string, statement: string, scope: string) => Promise<boolean>
  onConfirm: (id: string) => void
  onTogglePin: (item: MemoryRowItem) => void
  onArchive: (id: string) => Promise<boolean>
  onRestore: (id: string) => void
  onDelete: (id: string) => Promise<boolean>
  onPurge: (id: string) => Promise<boolean>
  onMerge: (dropId: string, keepId: string) => void
  /** 右键菜单状态（panel 传；不传则只支持行内「⋯」）。 */
  ctxMenu?: RowContextMenu
  onRowContextMenu?: (id: string, event: { clientX: number; clientY: number; preventDefault: () => void }) => void
}

export function MemoryRow({
  item, selected, focused = false, onSelect, defaultExpanded, expandedId, onToggleExpand, neighbors, neighborsOpen, onToggleNeighbors, budgetBytes = Number.NaN,
  onLoadFull, onSave, onConfirm, onTogglePin, onArchive, onRestore, onDelete, onPurge, onMerge,
  ctxMenu, onRowContextMenu,
}: MemoryRowProps): ReactNode {
  const [expandedLocal, setExpandedLocal] = useState(defaultExpanded === true)
  // 受控优先（面板传 expandedId）；未受控时用本地状态（组件单测与独立使用）
  const expanded = expandedId !== undefined ? expandedId === item.id : expandedLocal
  const setExpanded = (next: boolean): void => {
    if (onToggleExpand !== undefined) onToggleExpand(next ? item.id : null)
    else setExpandedLocal(next)
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editScope, setEditScope] = useState(item.scope)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const editSeq = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  // 打开菜单即聚焦第一项；Esc 关闭后焦点回到「⋯」（键盘用户不会掉焦点）
  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [menuOpen])
  // 折叠态不显示标签行（那是展开后的信息）；高频的「确认」留在行内
  const showTags = expanded || editing
  const canConfirm = item.status === 'pending' || item.status === 'needs-review'
  const archivable = item.status !== 'archived' && item.status !== 'superseded' && item.status !== 'rejected'
  const inTrash = item.status === 'archived' && item.reviewNote === 'user-deleted'

  const startEdit = async (): Promise<void> => {
    const seq = (editSeq.current += 1)
    setMenuOpen(false)
    setEditing(true)
    setEditText(item.statement)
    try {
      const full = await onLoadFull(item.id)
      // 用户可能已经开始改：只有没换行、没重新进入编辑时才覆盖预览
      if (editSeq.current === seq) setEditText(full)
    } catch { /* 取全文失败就先用预览，保存仍走服务端 */ }
  }
  const closeMenu = (): void => { setMenuOpen(false); setConfirmArchive(false); setConfirmDelete(false); setConfirmPurge(false) }
  const onMenuKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); moreRef.current?.focus(); return }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = nextMenuIndex(index, event.key, items.length)
    if (next >= 0) { event.preventDefault(); items[next]?.focus() }
  }
  const onLineKey = (event: { key: string; preventDefault: () => void }, next: boolean): void => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded(next) }
  }

  // 菜单项只写一份：行内「⋯」与右键菜单共用（两处行为不一致是这类菜单最常见的 bug）。
  // 注意这里不用 role/onKeyDown——由各自的容器负责（行内 .nx-menu、右键 portal .nx-ctxmenu）。
  const menuItems: ReactNode[] = [
    !editing ? <button key="edit" type="button" role="menuitem" className="nx-menu-item" onClick={() => void startEdit()}>编辑</button> : null,
    <button key="pin" type="button" role="menuitem" className="nx-menu-item" onClick={() => { onTogglePin(item); closeMenu() }}>
      {item.pinned === true ? '取消置顶' : '置顶'}</button>,
    item.status === 'pending' && item.conflictWith !== undefined
      ? <button key="merge" type="button" role="menuitem" className="nx-menu-item" onClick={() => { const keep = item.conflictWith; if (keep !== undefined) onMerge(item.id, keep); closeMenu() }}>合并重复</button>
      : null,
    <button key="rel" type="button" role="menuitem" className="nx-menu-item" onClick={() => { onToggleNeighbors(item.id); closeMenu() }}>
      {neighborsOpen ? '收起关系' : '关系'}</button>,
    <span key="sep1" className="nx-menu-sep" aria-hidden="true" />,
    archivable ? (confirmArchive
      ? <button key="arch" type="button" role="menuitem" className="nx-menu-item danger" onClick={() => { void onArchive(item.id).then((ok) => { if (ok) closeMenu() }) }}>确认归档（同句不再自动记住）</button>
      : <button key="arch" type="button" role="menuitem" className="nx-menu-item danger" onClick={() => setConfirmArchive(true)}>归档</button>) : null,
    item.status !== 'archived' ? (confirmDelete
      ? <button key="del" type="button" role="menuitem" className="nx-menu-item danger" onClick={() => { void onDelete(item.id).then((ok) => { if (ok) closeMenu() }) }}>确认移入回收站</button>
      : <button key="del" type="button" role="menuitem" className="nx-menu-item danger" onClick={() => setConfirmDelete(true)}>移入回收站</button>) : null,
    item.status === 'archived' ? (inTrash
      ? (confirmPurge
          ? <button key="purge" type="button" role="menuitem" className="nx-menu-item danger" onClick={() => { void onPurge(item.id).then((ok) => { if (ok) closeMenu() }) }}>确认彻底清除</button>
          : <Fragment key="trash-actions"><button type="button" role="menuitem" className="nx-menu-item" onClick={() => { onRestore(item.id); closeMenu() }}>恢复</button>
            <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => setConfirmPurge(true)}>彻底清除</button></Fragment>)
      : <span key="sys" className="nx-menu-note">系统归档（不可彻底清除）</span>) : null,
  ]

  return (
    <div
      className={'nx-row' + (selected ? ' selected' : '') + (expanded ? ' open' : '') + (focused ? ' focused' : '')}
      role="listitem"
      data-nx-row={item.id}
      onContextMenu={(event) => { onRowContextMenu?.(item.id, event) }}
    >
      <div className="nx-row-head">
        <span className={'nx-sbar scope-' + item.scope} aria-hidden="true" />
        {/* 折叠态没有标签行：作用域不能只由颜色传达（WCAG 1.4.1） */}
        <span className="nx-sr-only">{SCOPE_NAME[item.scope] ?? item.scope}</span>
        <input
          type="checkbox"
          className="nx-check"
          checked={selected}
          aria-label={'选择：' + item.subject}
          title="Shift 连选 · Cmd/Ctrl 加选"
          onChange={(event) => {
            const native = event.nativeEvent as { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }
            onSelect(item.id, event.target.checked, {
              shift: native.shiftKey === true, meta: native.metaKey === true || native.ctrlKey === true,
            })
          }}
        />
        {/* 置信度圆点：折叠态唯一能承载"这条可不可信"的位置。颜色 + title/aria-label 双通道（WCAG 1.4.1） */}
        {!showTags && <ConfDot confidence={item.confidence} />}
        {showTags ? (
          <div className="nx-tags">
            <Tag text={SCOPE_NAME[item.scope] ?? item.scope} className="scope" />
            <Tag text={SLOT_NAME[item.slot] ?? item.slot} className={'slot-' + item.slot} />
            <Tag text={STATUS_NAME[item.status] ?? item.status} className={'status-' + item.status} />
            {item.pinned === true && <Tag text="置顶" />}
          </div>
        ) : (
          <>
            <svg className="nx-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            <div
              className="nx-statement folded"
              role="button"
              tabIndex={0}
              aria-expanded={false}
              title={FOLDED_HINT}
              onClick={() => setExpanded(true)}
              onKeyDown={(event) => onLineKey(event, true)}
            >{item.statement}</div>
            <span className={'nx-line-status status-' + item.status}>{STATUS_NAME[item.status] ?? item.status}</span>
            {item.pinned === true && <span className="nx-line-pin">置顶</span>}
          </>
        )}
        {canConfirm && <Btn kind="primary" onClick={() => onConfirm(item.id)}>确认</Btn>}
        <button
          type="button"
          ref={moreRef}
          className="nx-more"
          aria-label={'更多操作：' + item.subject}
          aria-expanded={menuOpen}
          onClick={() => { if (menuOpen) closeMenu(); else setMenuOpen(true) }}
        >⋯</button>
      </div>

      <Disclosure open={editing} className="nx-edit-wrap">
        <div className="nx-edit-wrap-inner">
          <Select ariaLabel="作用域" value={editScope} onChange={(value) => setEditScope(value)} options={[
            { value: 'project', label: '项目' },
            { value: 'user', label: '个人' },
          ]} />
          <textarea className="nx-edit" value={editText} onChange={(event) => setEditText(event.target.value)} rows={3} autoFocus />
          <div className="nx-actions">
            <Btn kind="primary" onClick={() => { void onSave(item.id, editText.trim(), editScope).then((ok) => { if (ok) setEditing(false) }) }}>保存</Btn>
            <Btn onClick={() => setEditing(false)}>取消</Btn>
          </div>
        </div>
      </Disclosure>

      {!editing && (
        <Disclosure open={expanded} className="nx-row-more">
          {/* 展开内容限高 + 内部滚动（并给键盘焦点，WCAG 2.1.1）：
              不限高的话，一条 400 字的记忆在窄栏里就是 10 行文字墙，把整屏推走 */}
          <div className="nx-statement-open" tabIndex={0} aria-label="记忆全文（可滚动）">
            <div
              className="nx-statement"
              role="button"
              tabIndex={0}
              aria-expanded={true}
              title={COLLAPSE_HINT}
              onClick={() => setExpanded(false)}
              onKeyDown={(event) => onLineKey(event, false)}
            >{item.statement}</div>
          </div>
          <div className="nx-actions">
            <Btn onClick={() => setExpanded(false)}>收起 ▴</Btn>
          </div>
          {item.truncated === true && (
            <div className="nx-hint">仅显示前 400 字（全文 {item.statementLength ?? 0} 字）· 「⋯ → 编辑」看全文</div>
          )}
          {item.status === 'needs-review' && item.conflictWith !== undefined && (
            <div className="nx-hint">与记忆 {item.conflictWith} 冲突</div>
          )}
          {item.status === 'pending' && item.conflictWith !== undefined && (
            <div className="nx-hint">疑似与记忆 {item.conflictWith} 重复（{item.reviewNote === 'suspected-duplicate' ? '近义' : '同类'}），可合并或保留</div>
          )}
          {item.status === 'superseded' && item.supersededBy !== undefined && (
            <div className="nx-hint replaced">被记忆 {item.supersededBy} 取代</div>
          )}
          <div className="nx-meta">
            <span>ID:{item.id}</span>
            <span>权重:{item.weight} · 置信度:{Math.round((item.confidence ?? 0) * 100)}%</span>
            {item.injectBytes !== undefined && (
              <span className={item.injectBytes / budgetBytes >= 0.3 ? 'heavy' : undefined}>
                占注入 {item.injectBytes} B{Number.isFinite(budgetBytes) && budgetBytes > 0 ? '（预算的 ' + Math.round((item.injectBytes / budgetBytes) * 100) + '%）' : ''}
              </span>
            )}
            <span>更新 {new Date(item.updatedAt).toLocaleString()}</span>
          </div>
        </Disclosure>
      )}

      {menuOpen && (
        <div className="nx-menu" role="menu" ref={menuRef} onKeyDown={onMenuKeyDown}>{menuItems}</div>
      )}

      {/* 右键菜单：portal 到 body，避免被列表 overflow / content-visibility 裁掉 */}
      {ctxMenu !== undefined && ctxMenu.open && createPortal(
        <div
          className="nx-ctxmenu"
          data-nx-ctxmenu="true"
          role="menu"
          aria-label={'记忆操作：' + item.subject}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          onContextMenu={(event) => { event.preventDefault() }}
        >
          {menuItems}
        </div>,
        document.body,
      )}

      {neighborsOpen && (
        <div className="nx-neighbors">
          {neighbors === undefined || neighbors.loading
            ? <div className="nx-n-item">加载中…</div>
            : neighbors.error !== undefined
              ? <div className="nx-n-item">关系查询失败：{neighbors.error}</div>
              : (neighbors.list ?? []).length === 0
                ? <div className="nx-n-item">暂无关联记忆。</div>
                : (neighbors.list ?? []).map((rowItem, index) => (
                    <div className="nx-n-item" key={index}><span className="nx-n-edge">{rowItem.edge ?? '相关'}</span>{rowItem.atom?.statement ?? rowItem.other ?? ''}</div>
                  ))}
        </div>
      )}
    </div>
  )
}
