/**
 * B3 列表行：折叠态两行截断（≤56px：标签行 + 2 行正文），展开才显示元信息、提示与完整内容；
 * 次要操作收进「⋯」菜单，折叠态只留最高频的「确认 / 展开」。
 *
 * 为什么要拆出来：面板里的行既有 7 个按钮又有元信息，3000 字的记忆直接顶满一屏（实测稚嫩的主因）；
 * 拆成受控 + 本地 UI 状态的纯展示组件后，折叠/展开/菜单/二次确认都能被渲染测试覆盖。
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Btn, Select, Tag } from './components.tsx'

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
}
export interface NeighborView { edge?: string; atom?: { statement: string }; other?: string }
export interface NeighborState { loading: boolean; list: NeighborView[] | null; error?: string }

const SCOPE_NAME: Record<string, string> = { user: '用户', project: '项目', episode: '会话' }
const SLOT_NAME: Record<string, string> = {
  personal: '个人', user: '个人', project: '项目', episode: '会话', feedback: '反馈', reference: '资料',
}
const STATUS_NAME: Record<string, string> = {
  pending: '待确认', 'needs-review': '冲突', active: '活跃', archived: '已归档', superseded: '已取代', rejected: '已拒绝',
}

export interface MemoryRowProps {
  item: MemoryRowItem
  selected: boolean
  onSelect: (id: string, next: boolean) => void
  /** 初始展开（测试/深链用）。 */
  defaultExpanded?: boolean
  neighbors?: NeighborState
  neighborsOpen: boolean
  onToggleNeighbors: (id: string) => void
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
}

export function MemoryRow({
  item, selected, onSelect, defaultExpanded, neighbors, neighborsOpen, onToggleNeighbors,
  onLoadFull, onSave, onConfirm, onTogglePin, onArchive, onRestore, onDelete, onPurge, onMerge,
}: MemoryRowProps): ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded === true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editScope, setEditScope] = useState(item.scope)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const editSeq = useRef(0)
  const archivable = item.status !== 'archived' && item.status !== 'superseded' && item.status !== 'rejected'
  const inTrash = item.status === 'archived' && item.reviewNote === 'user-deleted'

  const startEdit = async (): Promise<void> => {
    const seq = (editSeq.current += 1)
    setMenuOpen(false)
    setEditing(true)
    setEditText(item.statement)
    try {
      const full = await onLoadFull(item.id)
      // 用户可能已经开始改：只有没换行、没重新进入编辑时才覆盖
      if (editSeq.current === seq) setEditText(full)
    } catch { /* 失败时保留预览，保存仍走服务端校验 */ }
  }
  const closeMenu = (): void => { setMenuOpen(false); setConfirmArchive(false); setConfirmDelete(false); setConfirmPurge(false) }

  return (
    <div className={'nx-row' + (selected ? ' selected' : '') + (expanded ? ' open' : '')}>
      <div className="nx-row-head">
        <input
          type="checkbox"
          className="nx-check"
          checked={selected}
          aria-label={'选择：' + item.subject}
          onChange={(event) => onSelect(item.id, event.target.checked)}
        />
        <div className="nx-tags">
          <Tag text={SCOPE_NAME[item.scope] ?? item.scope} className="scope" />
          <Tag text={SLOT_NAME[item.slot] ?? item.slot} className={'slot-' + item.slot} />
          <Tag text={STATUS_NAME[item.status] ?? item.status} className={'status-' + item.status} />
          {item.pinned === true && <Tag text="置顶" />}
        </div>
        {(item.status === 'pending' || item.status === 'needs-review') && (
          <Btn kind="primary" onClick={() => onConfirm(item.id)}>确认</Btn>
        )}
        <button
          type="button"
          className="nx-more"
          aria-label="更多操作"
          aria-expanded={menuOpen}
          onClick={() => { if (menuOpen) closeMenu(); else setMenuOpen(true) }}
        >⋯</button>
      </div>

      {editing ? (
        <div className="nx-edit-wrap">
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
      ) : (
        <div
          className={'nx-statement' + (expanded ? '' : ' folded')}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          title={expanded ? '点击收起' : '点击展开全文' }
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded(!expanded) } }}
        >{item.statement}</div>
      )}

      {expanded && (
        <div className="nx-row-more">
          {item.truncated === true && !editing && (
            <div className="nx-hint">列表只显示前 400 字（全文 {item.statementLength ?? 0} 字）；点「⋯ → 编辑」载入全文。</div>
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
            <span>更新 {new Date(item.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="nx-menu" role="menu">
          {!editing && <button type="button" role="menuitem" className="nx-menu-item" onClick={() => void startEdit()}>编辑</button>}
          <button type="button" role="menuitem" className="nx-menu-item" onClick={() => { onTogglePin(item); closeMenu() }}>
            {item.pinned === true ? '取消置顶' : '置顶'}</button>
          {item.status === 'pending' && item.conflictWith !== undefined && (
            <button type="button" role="menuitem" className="nx-menu-item" onClick={() => { const keep = item.conflictWith; if (keep !== undefined) onMerge(item.id, keep); closeMenu() }}>合并重复</button>
          )}
          <button type="button" role="menuitem" className="nx-menu-item" onClick={() => { onToggleNeighbors(item.id); closeMenu() }}>
            {neighborsOpen ? '收起关系' : '关系'}</button>
          {archivable && (confirmArchive
            ? <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => { void onArchive(item.id).then((ok) => { if (ok) closeMenu() }) }}>确认归档（同句不再自动记住）</button>
            : <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => setConfirmArchive(true)}>归档</button>)
          }
          {item.status !== 'archived' && (confirmDelete
            ? <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => { void onDelete(item.id).then((ok) => { if (ok) closeMenu() }) }}>确认移入回收站</button>
            : <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => setConfirmDelete(true)}>移入回收站</button>)
          }
          {item.status === 'archived' && (inTrash
            ? (confirmPurge
                ? <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => { void onPurge(item.id).then((ok) => { if (ok) closeMenu() }) }}>确认彻底清除</button>
                : <><button type="button" role="menuitem" className="nx-menu-item" onClick={() => { onRestore(item.id); closeMenu() }}>恢复</button>
                  <button type="button" role="menuitem" className="nx-menu-item danger" onClick={() => setConfirmPurge(true)}>彻底清除</button></>)
            : <span className="nx-menu-note">系统归档（不可彻底清除）</span>)
          }
        </div>
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
