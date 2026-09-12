/**
 * V0.7 复刻档：样例 HTML 的 1:1 React 翻译（用户定稿"一模一样的"）。
 *
 * 与旧面板（NexusPanel）的关系：两者并存，入口用 ?panel=sample 切换；确认后再删旧的。
 * 数据源不变：/nexus/api/{memory,state,settings,models,neighbors,decisions}。
 *
 * 忠实复刻的部分：DOM 结构、类名、层级、交互（展开/编辑/批量/右键/Toast 撤销/骨架屏/
 * 空态错误态/键盘导航/搜索高亮/冲突 Diff/置信度环）全部照样例写。
 * 见 src/ui/replica.css 文件头：只有 3 处因物理约束无法照抄（宽度/body 作用域/变量作用域）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface MemoryItem {
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
  reviewNote?: string
  statementLength?: number
  truncated?: boolean
  injectBytes?: number
}
interface MemoryPage { items: MemoryItem[]; total: number; offset: number; limit: number }
interface NexusState {
  active: number
  pending: number
  conflicts: number
  degraded: boolean
  byScope?: { user: number; project: number; episode: number }
  project?: string
  injection?: { budgetBytes: number; bytes: number; shown: Array<{ id: string; bytes: number }>; dropped: Array<{ id: string; reason: string; detail: string }> }
}
interface Thresholds { autoAcceptThreshold: number; modelAutoThreshold: number }
interface ModelRow { provider: string; providerName: string; model: string; modelName: string }
interface Neighbor { edge?: string; atom?: { statement: string }; other?: string }

const SCOPE_WORD: Record<string, string> = { user: '跨项目', project: '本项目', episode: '本会话' }
const SLOT_WORD: Record<string, string> = { personal: '个人', user: '个人', project: '项目', episode: '会话', feedback: '反馈', reference: '资料' }
const STATUS_WORD: Record<string, string> = { pending: '待确认', 'needs-review': '冲突', active: '活跃', archived: '已归档', superseded: '已取代', rejected: '已拒绝' }
/** 状态 → 样例的 tag 类名（样例只有 archived/active/conflict 三种）。 */
function tagClass(status: string): string {
  if (status === 'needs-review') return 'conflict'
  if (status === 'pending') return 'pending'
  if (status === 'active') return 'active'
  return 'archived'
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error('HTTP ' + String(res.status))
  return res.json() as Promise<T>
}

function relTime(at: number): string {
  const diff = Date.now() - at
  if (!Number.isFinite(diff) || diff < 0) return new Date(at).toLocaleDateString()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return String(min) + '分钟前'
  const hour = Math.floor(min / 60)
  if (hour < 24) return String(hour) + '小时前'
  const day = Math.floor(hour / 24)
  if (day <= 30) return String(day) + '天前'
  return new Date(at).toLocaleDateString()
}

function dotClass(confidence?: number): string {
  const pct = (confidence ?? 0) * 100
  return pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'low'
}

/** 搜索命中高亮（样例的 highlightText：<mark>包裹命中片段）。 */
function Highlight({ text, term }: { text: string; term: string }): React.ReactNode {
  if (term === '') return text
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  if (!lower.includes(needle)) return text
  const out: React.ReactNode[] = []
  let rest = text
  let key = 0
  while (rest !== '') {
    const at = rest.toLowerCase().indexOf(needle)
    if (at < 0) { out.push(rest); break }
    if (at > 0) out.push(rest.slice(0, at))
    out.push(<mark key={key++}>{rest.slice(at, at + needle.length)}</mark>)
    rest = rest.slice(at + needle.length)
  }
  return out
}

export function SamplePanel(): React.ReactNode {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<NexusState | null>(null)
  const [thresholds, setThresholds] = useState<Thresholds | null>(null)
  const [models, setModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'conflict' | 'archived'>('all')
  const [scope, setScope] = useState<'all' | 'user' | 'project' | 'episode'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editScore, setEditScore] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  // 样例只有 4 条；真实库几十条。一页 50 条 + 列表内部滚动，保持模态高度可控
  const [pageSize, setPageSize] = useState(50)
  // 样例的 .settings-panel 初始带 collapsed 类（默认收起，标题常驻）
  const [settingsCollapsed, setSettingsCollapsed] = useState(true)
  const [autoT, setAutoT] = useState('0.9')
  const [modelT, setModelT] = useState('0.95')
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null)
  const [neighbors, setNeighbors] = useState<Record<string, Neighbor[]>>({})
  // 面板内主题切换（样例的 🌙）：初值跟随宿主，点一下反向覆盖
  const [themeOverride, setThemeOverride] = useState<'dark' | 'light' | null>(null)
  const lastChecked = useRef<number>(-1)
  const toastTimer = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const [page, st, thr, mods] = await Promise.all([
        j<MemoryPage>('/nexus/api/memory?offset=0&limit=100'),
        j<NexusState>('/nexus/api/state'),
        j<Thresholds>('/nexus/api/settings'),
        j<ModelRow[]>('/nexus/api/models'),
      ])
      setItems(page.items)
      setTotal(page.total)
      setState(st)
      setThresholds(thr)
      setAutoT(String(thr.autoAcceptThreshold))
      setModelT(String(thr.modelAutoThreshold))
      setModels(mods)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 主题：跟随宿主，可用样例的 🌙 覆盖
  const hostDark = (): boolean => {
    try { return document.body.hasAttribute('data-ds-dark-theme') } catch { return false }
  }
  const dark = themeOverride === null ? hostDark() : themeOverride === 'dark'

  const showToast = useCallback((text: string, undo?: () => void): void => {
    setToast(undo === undefined ? { text } : { text, undo })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => { setToast(null) }, undo === undefined ? 2500 : 5000)
  }, [])

  const post = async (path: string, body: unknown): Promise<void> => {
    await j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await load()
  }

  // ---- 筛选（样例：状态卡 + 作用域 + 搜索三者与运算）----
  const visible = useMemo(() => items.filter((item) => {
    const matchStatus = filter === 'all'
      || (filter === 'active' && item.status === 'active')
      || (filter === 'conflict' && (item.status === 'needs-review' || item.status === 'pending'))
      || (filter === 'archived' && (item.status === 'archived' || item.status === 'superseded'))
    const matchScope = scope === 'all' || item.scope === scope
    const term = query.trim().toLowerCase()
    const matchSearch = term === '' || item.statement.toLowerCase().includes(term) || item.subject.toLowerCase().includes(term)
    return matchStatus && matchScope && matchSearch
  }), [items, filter, scope, query])

  const counts = useMemo(() => ({
    all: items.length,
    active: items.filter((i) => i.status === 'active').length,
    conflict: items.filter((i) => i.status === 'needs-review' || i.status === 'pending').length,
    archived: items.filter((i) => i.status === 'archived' || i.status === 'superseded').length,
  }), [items])

  const scopeCounts = state?.byScope ?? { user: 0, project: 0, episode: 0 }
  const scopeTotal = Math.max(1, scopeCounts.user + scopeCounts.project + scopeCounts.episode)
  const dropped = state?.injection?.dropped.length ?? 0

  // ---- 选择：勾选 / Shift 连选 / 全选 ----
  const toggleCheck = (id: string, shift: boolean): void => {
    const index = visible.findIndex((i) => i.id === id)
    setSelected((prev) => {
      const copy = new Set(prev)
      if (shift && lastChecked.current >= 0 && index >= 0) {
        const [from, to] = [Math.min(lastChecked.current, index), Math.max(lastChecked.current, index)]
        for (const row of visible.slice(from, to + 1)) copy.add(row.id)
      } else if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })
    lastChecked.current = index
  }
  const selectAll = (on: boolean): void => {
    setSelected(on ? new Set(visible.map((i) => i.id)) : new Set())
  }

  // ---- 键盘导航（样例：↑↓ 焦点环、空格勾选、Ctrl+Z 撤销）----
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const tag = (event.target as { tagName?: string } | null)?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'ArrowDown') { event.preventDefault(); setFocusedIndex((i) => Math.min(i + 1, visible.length - 1)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setFocusedIndex((i) => Math.max(i - 1, 0)) }
      else if (event.key === ' ') {
        const row = visible[focusedIndex]
        if (row !== undefined) { event.preventDefault(); toggleCheck(row.id, false) }
      } else if (event.key === 'Escape') setCtx(null)
      else if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  })

  // ---- 单条操作（样例的 ⋯ 菜单 → 右键菜单）----
  const archiveOne = async (id: string): Promise<void> => {
    const ids = [id]
    await post('/nexus/api/memory/reject', { ids })
    showToast('已将记忆归档', () => { void post('/nexus/api/memory/restore', { ids, any: true }) })
  }
  const trashOne = async (id: string): Promise<void> => {
    const ids = [id]
    await post('/nexus/api/memory/delete', { ids })
    showToast('已将记忆移入回收站', () => { void post('/nexus/api/memory/restore', { ids }) })
  }
  const batch = async (kind: 'archive' | 'trash' | 'confirm'): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (kind === 'confirm') { await post('/nexus/api/memory/confirm', { ids }); showToast('已确认 ' + String(ids.length) + ' 条') }
    if (kind === 'archive') { await post('/nexus/api/memory/reject', { ids }); showToast('已批量归档 ' + String(ids.length) + ' 条') }
    if (kind === 'trash') { await post('/nexus/api/memory/delete', { ids }); showToast('已批量移入回收站 ' + String(ids.length) + ' 条') }
    setSelected(new Set())
  }

  const startEdit = async (item: MemoryItem): Promise<void> => {
    setEditingId(item.id)
    setEditText(item.statement)
    setEditScore(String(item.confidence ?? 0))
    try {
      const full = await j<{ statement: string }>('/nexus/api/memory/get?id=' + encodeURIComponent(item.id))
      setEditText(full.statement)
    } catch { /* 取全文失败就先用预览 */ }
  }
  const saveEdit = async (id: string): Promise<void> => {
    await post('/nexus/api/memory/update', { id, statement: editText })
    setEditingId(null)
    showToast('记忆 ' + id + ' 已更新')
  }
  const saveSettings = async (): Promise<void> => {
    const body: Record<string, number> = {}
    const auto = Number(autoT)
    const model = Number(modelT)
    if (Number.isFinite(auto)) body.auto = auto
    if (Number.isFinite(model)) body.model = model
    await j('/nexus/api/settings/threshold', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    showToast('全局修改已保存')
  }

  // 冲突对照需要「旧记忆」原文：展开时按需拉关系
  useEffect(() => {
    const item = items.find((i) => i.id === expandedId)
    const other = item?.conflictWith
    if (other === undefined || neighbors[other] !== undefined) return
    void j<Neighbor[]>('/nexus/api/neighbors?id=' + encodeURIComponent(other))
      .then((list) => { setNeighbors((prev) => ({ ...prev, [other]: list })) })
      .catch(() => { /* 拉不到就只显示 ID */ })
  }, [expandedId, items, neighbors])

  const conflictText = (item: MemoryItem): string | null => {
    if (item.conflictWith === undefined) return null
    const list = neighbors[item.conflictWith]
    if (list === undefined) return null
    const hit = list.find((n) => n.other === item.conflictWith)
    return hit?.atom?.statement ?? null
  }

  const ringClass = (confidence?: number): string => {
    const pct = (confidence ?? 0) * 100
    return pct >= 90 ? 'green' : pct >= 70 ? 'blue' : 'orange'
  }

  return (
    <div className={'nx-replica' + (dark ? '' : ' replica-light')}>
      {/* Toast 与右键菜单 portal 到 body：它们在样例里是 fixed 定位的页面级元素，
          留在 .content 内会被 overflow 裁掉（样例因为挂在 body 下才没这个问题）。
          CSS 变量来自 body 上的宿主主题 + .nx-replica 的继承，portal 后仍可取到根变量。 */}
      {createPortal(
        <div className={'toast' + (toast !== null ? ' show' : '')} id="toast">
          <span>{toast?.text ?? ''}</span>
          {toast?.undo !== undefined && <button className="btn-undo" onClick={() => { const undo = toast.undo; setToast(null); undo?.() }}>撤销 (Ctrl+Z)</button>}
        </div>,
        document.body,
      )}

      <div className="overlay">
        <div className="modal" id="modal">
          <div className="header">
            <h2>记忆设置</h2>
            <div className="header-right">
              <button className="theme-toggle" title="切换主题" onClick={() => setThemeOverride(dark ? 'light' : 'dark')}>{dark ? '🌙' : '☀️'}</button>
            </div>
          </div>

          <div className="content">
            {/* 进度卡：分段条 = 作用域占比；徽标 = 没进入上下文的条数 */}
            <div className="progress-section">
              <div className="progress-header">
                <span>记忆占用情况</span>
                <span className="badge" onClick={() => setFilter('conflict')}>{dropped > 0 ? '未进入 ' + String(dropped) + ' 条' : '全部进入'}</span>
              </div>
              <div className="progress-bar">
                <div className="user" style={{ width: String((scopeCounts.user / scopeTotal) * 100) + '%' }} onClick={() => setScope(scope === 'user' ? 'all' : 'user')} />
                <div className="project" style={{ width: String((scopeCounts.project / scopeTotal) * 100) + '%' }} onClick={() => setScope(scope === 'project' ? 'all' : 'project')} />
                <div className="episode" style={{ width: String((scopeCounts.episode / scopeTotal) * 100) + '%' }} onClick={() => setScope(scope === 'episode' ? 'all' : 'episode')} />
              </div>
              <div className="progress-labels">
                <span>用户 {Math.round((scopeCounts.user / scopeTotal) * 100)}%</span>
                <span>项目 {Math.round((scopeCounts.project / scopeTotal) * 100)}%</span>
                <span>会话 {Math.round((scopeCounts.episode / scopeTotal) * 100)}%</span>
                <span>总计 {state?.injection?.bytes ?? 0}B / {state?.injection?.budgetBytes ?? 1024}B</span>
              </div>
            </div>

            {/* 状态卡：计数 + 筛选 */}
            <div className="status-grid" id="statusGrid">
              <div className={'status-card' + (filter === 'all' ? ' active-filter' : '')} onClick={() => setFilter('all')}>全部 <span>{counts.all}</span></div>
              <div className={'status-card active' + (filter === 'active' ? ' active-filter' : '')} onClick={() => setFilter('active')}>活跃 <span className="active">{counts.active}</span></div>
              <div className={'status-card warning' + (filter === 'conflict' ? ' active-filter' : '')} onClick={() => setFilter('conflict')}>冲突 <span>{counts.conflict}</span></div>
              <div className={'status-card' + (filter === 'archived' ? ' active-filter' : '')} onClick={() => setFilter('archived')}>归档 <span>{counts.archived}</span></div>
            </div>

            {/* 设置折叠条 */}
            <div className={'settings-panel' + (settingsCollapsed ? ' collapsed' : '')} id="settingsPanel">
              <button type="button" className="settings-header" onClick={() => setSettingsCollapsed((v) => !v)}>
                <h3>置信阈值（记忆自动接受的门槛）</h3>
                <span className="arrow">▼</span>
              </button>
              <div className="settings-body-wrapper">
                <div className="settings-body-inner">
                  <div className="settings-body">
                    <div className="form-row">
                      <div className="form-group"><label>用户明文工具</label><input className="input-box" value={autoT} onChange={(e) => setAutoT(e.target.value)} /></div>
                      <div className="form-group"><label>模型推断</label><input className="input-box" value={modelT} onChange={(e) => setModelT(e.target.value)} /></div>
                    </div>
                    <div className="help-text">
                      自动接受：用户明文工具 ≥ {autoT} 即生效；模型推断 ≥ {modelT} 才生效。
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="list-toolbar">
                <input
                  ref={searchRef}
                  className="search-input"
                  placeholder="搜索记忆内容 (支持防抖/高亮)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="btn-add" onClick={() => showToast('新增入口开发中')}>新增</button>
              </div>

              <div className={'batch-bar' + (selected.size > 0 ? ' show' : '')} id="batchBar">
                <span>已选 <strong>{selected.size}</strong> 条</span>
                <div>
                  <button onClick={() => void batch('archive')}>归档</button>
                  <button onClick={() => void batch('trash')}>移入回收站</button>
                  <button onClick={() => setSelected(new Set())}>取消选择</button>
                </div>
              </div>

              <div className="list-container" id="listContainer">
                <div className="list-header" style={{ position: 'sticky', top: 0 }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={visible.length > 0 && visible.every((i) => selected.has(i.id))}
                      ref={(node) => { if (node !== null) node.indeterminate = selected.size > 0 && !visible.every((i) => selected.has(i.id)) }}
                      onChange={(e) => selectAll(e.target.checked)}
                    />
                    全选
                  </label>
                  <span id="listCount">显示 {Math.min(pageSize, visible.length)} / {total} 条</span>
                </div>

                {loading && items.length === 0 && (
                  <div id="skeletonScreen">
                    {[0, 1, 2].map((k) => (
                      <div className="skeleton-item" key={k}>
                        <div className="skeleton-checkbox" />
                        <div className="skeleton-text"><div className="skeleton-line" /><div className="skeleton-line short" /></div>
                      </div>
                    ))}
                  </div>
                )}

                {!loading && error === null && visible.slice(0, pageSize).map((item, index) => {
                  const open = expandedId === item.id
                  const editing = editingId === item.id
                  const other = conflictText(item)
                  return (
                    <div
                      className={'list-item' + (open ? ' expanded' : '') + (focusedIndex === index ? ' focused' : '')}
                      key={item.id}
                      tabIndex={0}
                      onContextMenu={(e) => { e.preventDefault(); setCtx({ id: item.id, x: e.clientX, y: e.clientY }) }}
                    >
                      <div className="list-item-main" onClick={() => setExpandedId(open ? null : item.id)}>
                        <input
                          type="checkbox"
                          className="item-checkbox"
                          checked={selected.has(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => toggleCheck(item.id, (e.nativeEvent as MouseEvent).shiftKey === true)}
                        />
                        <div className="item-meta">
                          <div className="item-title">
                            <span className={'confidence-dot ' + dotClass(item.confidence)} />
                            <Highlight text={item.statement} term={query.trim()} />
                          </div>
                          <div className="item-sub">
                            <span>{item.slot === 'project' ? '🛠' : '👤'} {SLOT_WORD[item.slot] ?? item.slot} · {SCOPE_WORD[item.scope] ?? item.scope}</span>
                            <span>{relTime(item.updatedAt)}</span>
                          </div>
                        </div>
                        <span className={'tag ' + tagClass(item.status)}>{STATUS_WORD[item.status] ?? item.status}</span>
                        <span className="arrow">▼</span>
                      </div>

                      <div className="item-details-wrapper">
                        <div className="item-details-inner">
                          <div className="item-details">
                            {item.conflictWith !== undefined && (
                              <div className="conflict-view">
                                <div className="conflict-title">⚠️ {item.status === 'needs-review' ? '检测到与现有记忆冲突' : '疑似与现有记忆重复'}</div>
                                <div className="diff-grid">
                                  <div className="diff-box old"><div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11 }}>现有记忆 (旧)</div>{other ?? ('记忆 ' + item.conflictWith)}</div>
                                  <div className="diff-box new"><div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11 }}>本条记忆</div>{item.statement}</div>
                                </div>
                                <div className="diff-actions">
                                  <button className="btn-keep-old" onClick={(e) => { e.stopPropagation(); void batch('archive') }}>保留旧记忆</button>
                                  <button className="btn-use-new" onClick={(e) => { e.stopPropagation(); void post('/nexus/api/memory/confirm', { ids: [item.id] }).then(() => { showToast('已采用本条记忆') }) }}>采用新记忆</button>
                                </div>
                              </div>
                            )}

                            {!editing ? (
                              <div className="read-view">
                                <div className="detail-grid" style={{ marginTop: item.conflictWith !== undefined ? 12 : 0 }}>
                                  <div><span>记忆 ID</span><p>{item.id}</p></div>
                                  <div><span>创建时间</span><p>{new Date(item.updatedAt).toLocaleString()}</p></div>
                                  <div><span>作用域</span><p>{SCOPE_WORD[item.scope] ?? item.scope}</p></div>
                                  <div>
                                    <span>置信度得分</span>
                                    <div className="score-display">
                                      <div className={'score-ring ' + ringClass(item.confidence)}><span>{Math.round((item.confidence ?? 0) * 100)}</span></div>
                                      <p style={{ margin: 0, color: (item.confidence ?? 0) >= (thresholds?.autoAcceptThreshold ?? 0.9) ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                                        {(item.confidence ?? 0).toFixed(2)}
                                        {(item.confidence ?? 0) >= (thresholds?.autoAcceptThreshold ?? 0.9) ? ' (已生效)' : '（低于阈值）'}
                                      </p>
                                    </div>
                                  </div>
                                  <div style={{ gridColumn: 'span 2' }}><span>原始文本</span><p className="raw-text">{item.statement}</p></div>
                                  {item.injectBytes !== undefined && (
                                    <div><span>占注入预算</span><p>{item.injectBytes} B / {state?.injection?.budgetBytes ?? 1024} B</p></div>
                                  )}
                                  {item.truncated === true && (
                                    <div><span>说明</span><p>仅显示前 400 字（全文 {item.statementLength ?? 0} 字）</p></div>
                                  )}
                                </div>
                                <div className="edit-actions">
                                  <button className="btn-edit" onClick={(e) => { e.stopPropagation(); void startEdit(item) }}>编辑</button>
                                </div>
                              </div>
                            ) : (
                              <div className="edit-view">
                                <div className="detail-grid">
                                  <div><span>记忆 ID</span><p>{item.id}</p></div>
                                  <div><span>创建时间</span><p>{new Date(item.updatedAt).toLocaleString()}</p></div>
                                  <div><span>作用域</span><p>{SCOPE_WORD[item.scope] ?? item.scope}</p></div>
                                  <div>
                                    <span>置信度得分</span>
                                    <input type="number" step="0.01" className="edit-input score-input" value={editScore} onChange={(e) => setEditScore(e.target.value)} />
                                  </div>
                                  <div style={{ gridColumn: 'span 2' }}>
                                    <span>原始文本</span>
                                    <textarea className="edit-textarea text-input" value={editText} onChange={(e) => setEditText(e.target.value)} />
                                  </div>
                                </div>
                                <div className="edit-actions">
                                  <button className="btn-cancel" onClick={(e) => { e.stopPropagation(); setEditingId(null) }}>取消</button>
                                  <button className="btn-save" onClick={(e) => { e.stopPropagation(); void saveEdit(item.id) }}>保存</button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {!loading && error === null && visible.length === 0 && (
                  <div className="state-container" id="emptyState" style={{ display: 'flex' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <p>没有找到匹配的记忆</p>
                    <p className="sub">试试调整筛选条件或搜索词</p>
                  </div>
                )}

                {!loading && error === null && visible.length > pageSize && (
                  <div className="load-more">
                    <button onClick={() => setPageSize((n) => n + 50)}>加载更多（还有 {visible.length - pageSize} 条）</button>
                  </div>
                )}

                {error !== null && (
                  <div className="state-container" id="errorState" style={{ display: 'flex' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    <p style={{ color: 'var(--accent-red)' }}>网络请求失败</p>
                    <p className="sub">无法连接到记忆数据库</p>
                    <button className="btn-retry" onClick={() => { setLoading(true); void load() }}>点击重试</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="footer">
            <button className="btn-primary" onClick={() => void saveSettings()}>确认并应用全局修改</button>
          </div>
        </div>
      </div>

      {ctx !== null && createPortal(
        <div className="context-menu show" id="contextMenu" style={{ left: ctx.x, top: ctx.y }} onClick={() => setCtx(null)}>
          <div className="context-menu-item" onClick={() => { setExpandedId(ctx.id); void startEdit(items.find((i) => i.id === ctx.id) ?? items[0]!) }}>✏️ 编辑记忆</div>
          <div className="context-menu-item" onClick={() => { void navigator.clipboard?.writeText(ctx.id); showToast('记忆 ID 已复制到剪贴板') }}>📋 复制记忆 ID</div>
          <div className="context-menu-item" onClick={() => { void archiveOne(ctx.id) }}>📦 归档</div>
          <div className="context-menu-item danger" onClick={() => { void trashOne(ctx.id) }}>🗑️ 移入回收站</div>
        </div>,
        document.body,
      )}
    </div>
  )
}
