/**
 * V0.8 面板 B：用户附件第二版的 React 移植（用户定稿"用 B 作为面板"）。
 *
 * 结构照搬 B：顶部状态条（入口）→ 面板（标题 / 模式·预算 / 统计行 / 四个标签页 /
 * 底部）。标签页 = 归因（哪些进了上下文、哪些没进、为什么）· 记忆库 · 回收站 · 设置。
 * 类名沿用 B 的命名（.status-strip/.panel/.mem-card/.lib-item/.settings-section…），
 * 样式在 src/ui/b-panel.css（作用域 .nx-b，B 的调色板原样保留）。
 *
 * 与 B 原型的三处落地差异（都记在 b-panel.css 头部）：
 *   1) 面板宽度自适应（B 写死 420px；DSH 设置弹窗内容区实测 418px）；
 *   2) 入口：B 是"点状态条开面板"，这里状态条常驻在面板上方（设置项本身已是入口）；
 *   3) 数据全部接真：/nexus/api/{state,memory,mode,settings,models,neighbors,decisions}。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type PanelMode = 'readwrite' | 'readonly' | 'paused'

interface MemoryItem {
  id: string
  subject: string
  statement: string
  scope: string
  slot: string
  status: string
  kind: string
  provenance?: string
  pinned?: boolean
  confidence?: number
  weight: number
  createdAt: number
  updatedAt: number
  injectBytes?: number
  statementLength?: number
  truncated?: boolean
  conflictWith?: string
  reviewNote?: string
}
interface MemoryPage { items: MemoryItem[]; total: number; offset: number; limit: number }
interface InjectionEntry { id: string; subject: string; statement: string; scope: string; status: string; weight: number; bytes: number; pinned: boolean; confidence?: number; provenance?: string }
interface InjectionDrop extends InjectionEntry { reason: string; detail: string }
interface NexusState {
  active: number
  pending: number
  conflicts: number
  degraded: boolean
  mode: 'read-write' | 'write-only' | 'pause'
  trash: number
  byScope?: { user: number; project: number; episode: number }
  sourceCounts?: { user: number; model: number; agent: number }
  noise?: { count: number; ids: string[] }
  stats?: { today: number; pending: number; rejected: number; injections: number }
  injection?: {
    budgetBytes: number; bytes: number; textBytes: number; project: string
    shown: InjectionEntry[]; dropped: InjectionDrop[]; counts: Record<string, number>
  }
}
interface Thresholds { autoAcceptThreshold: number; modelAutoThreshold: number; extractorLlm?: { provider: string; model: string } }
interface ModelRow { provider: string; providerName: string; model: string; modelName: string }
interface Neighbor { edge?: string; atom?: { statement: string }; other?: string }

const SOURCE_WORD: Record<string, string> = { 'user-declared': '用户明文', 'model-inferred': '模型推断', 'agent-curated': '子代理整理' }
const SCOPE_WORD: Record<string, string> = { user: '用户作用域', project: '项目作用域', episode: '会话作用域' }
const STATUS_WORD: Record<string, string> = { active: '活跃', pending: '待确认', 'needs-review': '冲突', archived: '已归档', superseded: '已取代' }
const DROP_WORD: Record<string, string> = {
  oversize: '单条超过预算', budget: '预算不够', 'unknown-project': '没有项目归属', 'other-project': '属于其他项目',
  episode: '会话级记忆', inactive: '非活跃状态', archived: '已归档',
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error('HTTP ' + String(res.status))
  return res.json() as Promise<T>
}
const post = (path: string, body: unknown): Promise<unknown> =>
  json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

function confLevel(confidence?: number): string {
  const pct = (confidence ?? 0) * 100
  return pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'low'
}
function fmtB(bytes: number): string {
  // 两位小数会把 418px 的行挤到换行（原型实测："1.00 KB" 的 KB 被折下去）
  return bytes >= 1024 ? (bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1) + ' KB' : String(bytes) + ' B'
}
function relTime(at: number): string {
  const diff = Date.now() - at
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return String(min) + ' 分钟前'
  const hour = Math.floor(min / 60)
  if (hour < 24) return String(hour) + ' 小时前'
  return String(Math.floor(hour / 24)) + ' 天前'
}
function Highlight({ text, term }: { text: string; term: string }): React.ReactNode {
  if (term === '') return text
  const at = text.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return text
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + term.length)}</mark>{text.slice(at + term.length)}</>
}

export function BPanel(): React.ReactNode {
  const [state, setState] = useState<NexusState | null>(null)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [thresholds, setThresholds] = useState<Thresholds | null>(null)
  const [models, setModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'attribution' | 'library' | 'trash' | 'settings'>('attribution')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [libFilter, setLibFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'user' | 'project' | 'episode'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 彻底清除不可恢复 → 二次确认（原来 70×30 一键清 34 条，无确认无撤销）
  const [emptyConfirm, setEmptyConfirm] = useState(false)
  // 宽屏双栏里的"详情栏"选中项（窄栏不显示这一栏）
  const [detailId, setDetailId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<MemoryItem | null>(null)
  const [editText, setEditText] = useState('')
  const [editConf, setEditConf] = useState(0.9)
  const [editScope, setEditScope] = useState('user')
  const [creating, setCreating] = useState(false)
  const [newText, setNewText] = useState('')
  const [newScope, setNewScope] = useState('project')
  const [newConf, setNewConf] = useState(0.9)
  const [relatedFor, setRelatedFor] = useState<string | null>(null)
  const [related, setRelated] = useState<Neighbor[]>([])
  const [keepOriginal, setKeepOriginal] = useState(true)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [autoT, setAutoT] = useState('0.90')
  const [modelT, setModelT] = useState('0.95')
  const [extractSel, setExtractSel] = useState('')
  const toastTimer = useRef<number | null>(null)
  const lastChecked = useRef(-1)
  // portal 目标必须是 .nx-b 根节点：菜单/弹窗的样式都挂在这个作用域下，
  // portal 到 document.body 会掉出作用域（实测 position:static、rect y=448，点不到）
  const rootRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const [st, page, thr, mods] = await Promise.all([
        json<NexusState>('/nexus/api/state'),
        json<MemoryPage>('/nexus/api/memory?offset=0&limit=200'),
        json<Thresholds>('/nexus/api/settings'),
        json<ModelRow[]>('/nexus/api/models'),
      ])
      setState(st)
      setItems(page.items)
      setTotal(page.total)
      setThresholds(thr)
      setAutoT(thr.autoAcceptThreshold.toFixed(2))
      setModelT(thr.modelAutoThreshold.toFixed(2))
      setModels(mods)
      setExtractSel(thr.extractorLlm === undefined ? '' : thr.extractorLlm.provider + '::' + thr.extractorLlm.model)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Esc：关菜单优先，其次关面板（原型 title 里承诺过 "关闭 (Esc)"，之前没实现）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (menu !== null) { setMenu(null); return }
      if (editing !== null) { setEditing(null); return }
      if (creating) { setCreating(false); return }
      if (relatedFor !== null) { setRelatedFor(null); return }
      if (open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [menu, editing, creating, relatedFor, open])

  // 菜单点外关闭（原型只有 onClick 自关，点菜单自己也会关）
  useEffect(() => {
    if (menu === null) return
    const onDown = (e: MouseEvent): void => { if ((e.target as HTMLElement)?.closest('[data-nxb-menu]') == null) setMenu(null) }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [menu])

  const showToast = useCallback((text: string, undo?: () => void): void => {
    setToast(undo === undefined ? { text } : { text, undo })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => { setToast(null) }, undo === undefined ? 2200 : 5000)
  }, [])

  /** 执行一次写操作，返回是否成功 —— 失败时调用方不能假设状态已变（批量选择不能白清）。 */
  const run = async (path: string, body: unknown, label: string, undo?: () => void): Promise<boolean> => {
    try { await post(path, body); await load(); showToast(label, undo); return true }
    catch (err) { showToast(label + '失败：' + (err instanceof Error ? err.message : String(err))); return false }
  }
  const restoreIds = (ids: string[], any = false): Promise<boolean> =>
    run('/nexus/api/memory/restore', any ? { ids, any: true } : { ids }, '已恢复 ' + String(ids.length) + ' 条')

  // ---- 模式：三个按钮立即生效并落盘 ----
  const panelMode: PanelMode = state?.mode === 'write-only' ? 'readonly' : state?.mode === 'pause' ? 'paused' : 'readwrite'
  const setMode = async (next: PanelMode): Promise<void> => {
    setState((prev) => (prev === null ? prev : { ...prev, mode: next === 'readwrite' ? 'read-write' : next === 'readonly' ? 'write-only' : 'pause' }))
    try { await post('/nexus/api/mode', { mode: next }); showToast(next === 'readwrite' ? '已切到「记录中」' : next === 'readonly' ? '已切到「只看不记」' : '已关闭记忆（不记也不注入）') }
    catch { showToast('模式切换失败'); await load() }
  }

  // 旧版服务（未重启）不会有 mode/stats/sourceCounts：用本地数据兜底，别显示成 0 或"未知"。
  // 注意这两个必须在下面的 useMemo 之前定义——否则 useMemo 回调先执行会撞上 TDZ。
  const stats = state?.stats ?? {
    today: items.filter((i) => i.createdAt >= new Date().setHours(0, 0, 0, 0)).length,
    pending: state?.pending ?? 0,
    rejected: 0,
    injections: 0,
  }
  const sourceOf = (entry: { provenance?: string; id: string }): string =>
    entry.provenance ?? items.find((i) => i.id === entry.id)?.provenance ?? ''

  // ---- 归因分组：进入上下文 / 置顶插队 / 用户明文 / 未进入 ----
  const groups = useMemo(() => {
    const inject = state?.injection
    if (inject === undefined) return []
    const shown = inject.shown
    // 分组必须互斥：一条记忆只能出现在一个组里。
    // 第一版把「进入上下文」和「用户明文 / 模型推断」并列，导致同一条被列了两遍（用户实拍可见），
    // 现在改成：置顶 / 进入 / 未进入（按原因）三块，来源只在组头上做分布提示。
    const pinned = shown.filter((e) => e.pinned)
    const rest = shown.filter((e) => !e.pinned)
    const sourceMix = (cards: InjectionEntry[]): string => {
      const user = cards.filter((e) => sourceOf(e) === 'user-declared').length
      const model = cards.filter((e) => sourceOf(e) === 'model-inferred').length
      const agent = cards.filter((e) => sourceOf(e) === 'agent-curated').length
      const parts: string[] = []
      if (user > 0) parts.push('用户明文 ' + String(user))
      if (model > 0) parts.push('模型推断 ' + String(model))
      if (agent > 0) parts.push('子代理 ' + String(agent))
      return parts.join(' · ')
    }
    const buckets = new Map<string, InjectionDrop[]>()
    for (const drop of inject.dropped) {
      const arr = buckets.get(drop.reason) ?? []
      arr.push(drop)
      buckets.set(drop.reason, arr)
    }
    return [
      ...(pinned.length > 0 ? [{ key: 'pinned', label: '置顶插队', marker: 'warn', cards: pinned, count: pinned.length, bytes: pinned.reduce((s, e) => s + e.bytes, 0), mix: sourceMix(pinned) }] : []),
      { key: 'in', label: '进入上下文', marker: 'in', cards: rest, count: rest.length, bytes: rest.reduce((s, e) => s + e.bytes, 0), mix: sourceMix(rest) },
      ...Array.from(buckets.entries()).map(([reason, cards]) => ({ key: reason, label: '未进入 · ' + (DROP_WORD[reason] ?? reason), marker: 'out', cards, count: cards.length, bytes: 0, mix: '' })),
    ]
  }, [state])

  // ---- 记忆库筛选 ----
  const library = useMemo(() => items.filter((item) => {
    const term = query.trim().toLowerCase()
    const matchQuery = term === '' || item.statement.toLowerCase().includes(term) || item.subject.toLowerCase().includes(term)
    if (!matchQuery) return false
    if (scopeFilter !== 'all' && item.scope !== scopeFilter) return false
    switch (libFilter) {
      case 'active': return item.status === 'active'
      case 'pending': return item.status === 'pending'
      case 'conflict': return item.status === 'needs-review'
      case 'archived': return item.status === 'archived' || item.status === 'superseded'
      case 'today': return item.createdAt >= new Date().setHours(0, 0, 0, 0)
      case 'user': return item.provenance === 'user-declared'
      case 'subagent': return item.provenance === 'agent-curated'
      default: return true
    }
  }), [items, query, libFilter, scopeFilter])

  const trashItems = useMemo(() => items.filter((i) => i.status === 'archived'), [items])
  // 详情栏展示哪一条：显式选中的优先，否则给第一条（打开就有内容，不用先点）
  const libDetail = useMemo(
    () => library.find((i) => i.id === detailId) ?? library[0] ?? null,
    [library, detailId],
  )

  const toggleCheck = (id: string, shift: boolean): void => {
    const index = library.findIndex((i) => i.id === id)
    setSelected((prev) => {
      const copy = new Set(prev)
      if (shift && lastChecked.current >= 0 && index >= 0) {
        const [a, b] = [Math.min(lastChecked.current, index), Math.max(lastChecked.current, index)]
        for (const row of library.slice(a, b + 1)) copy.add(row.id)
      } else if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })
    lastChecked.current = index
  }

  const batch = async (kind: 'archive' | 'trash' | 'confirm'): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    let ok = false
    // 归档/入回收站补撤销（原来只有噪声横幅有）；失败不清空选择
    if (kind === 'archive') ok = await run('/nexus/api/memory/reject', { ids }, '已归档 ' + String(ids.length) + ' 条（同句不再自动记住）', () => { void restoreIds(ids, true) })
    if (kind === 'trash') ok = await run('/nexus/api/memory/delete', { ids }, '已移入回收站 ' + String(ids.length) + ' 条', () => { void restoreIds(ids) })
    if (kind === 'confirm') ok = await run('/nexus/api/memory/confirm', { ids }, '已确认 ' + String(ids.length) + ' 条')
    if (ok) setSelected(new Set())
  }

  const openEdit = async (item: MemoryItem): Promise<void> => {
    setMenu(null)
    setEditing(item)
    setEditText(item.statement)
    setEditConf(item.confidence ?? 0.9)
    setEditScope(item.scope === 'project' ? 'project' : 'user')
    try {
      const full = await json<{ statement: string }>('/nexus/api/memory/get?id=' + encodeURIComponent(item.id))
      setEditText(full.statement)
    } catch { /* 用预览 */ }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null) return
    await run('/nexus/api/memory/update', { id: editing.id, statement: editText, scope: editScope }, '已更新')
    setEditing(null)
  }

  const openRelated = async (id: string): Promise<void> => {
    setMenu(null)
    setRelatedFor(id)
    setRelated([])
    try { setRelated(await json<Neighbor[]>('/nexus/api/neighbors?id=' + encodeURIComponent(id))) }
    catch { setRelated([]) }
  }

  const inject = state?.injection
  const budget = inject?.budgetBytes ?? 1024
  const used = inject?.bytes ?? 0

  const pct = Math.min(100, Math.round((used / Math.max(1, budget)) * 100))
  const activeCount = state?.active ?? 0
  const scopeCounts = state?.byScope ?? { user: 0, project: 0, episode: 0 }
  const scopeTotal = Math.max(1, scopeCounts.user + scopeCounts.project + scopeCounts.episode)

  return (
    <div className="nx-b" ref={rootRef}>
      {/* 加载中也要有可见状态：否则数据到达前面板是一片空白 */}
      {/* 首屏：加载中 / 读取失败都要有真实状态。
          之前失败时状态条照样渲染「0 条进入上下文 | 0 B | 0 条待确认」—— 把"读取失败"伪装成"没有记忆"。 */}
      {state === null && (
        <div className="status-strip" role="status" aria-live="polite" aria-busy={loading}
          onClick={() => { if (!loading) { setLoading(true); void load() } }}>
          <span className={'dot' + (error !== null ? ' paused' : ' readonly')} aria-hidden="true" />
          <span className="primary">{loading ? '记忆加载中…' : '记忆读取失败'}</span>
          {error !== null && <><span className="sep" /><span className="warn-txt">点此重试</span></>}
        </div>
      )}

      {/* 顶部状态条：一行摘要，点开面板（B 的入口形态）。
          面板打开时隐藏它 —— 它显示的三项与面板首行完全重复，还白占 41px（448 高的 9%）。 */}
      {state !== null && !open && (
      <div className="status-strip" role="button" tabIndex={0} aria-expanded={open} aria-controls="nx-b-panel"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}>
        {/* 圆点只表模式：之前 noise>0 会盖掉 paused/readonly，最该显眼的状态反而看不见 */}
        <span className={'dot' + (panelMode === 'paused' ? ' paused' : panelMode === 'readonly' ? ' readonly' : '')}
          role="img" aria-label={'记忆模式：' + (panelMode === 'readwrite' ? '记录中' : panelMode === 'readonly' ? '只看不记' : '已关闭')} />
        <span className="primary">{(inject?.shown.length ?? 0)} 条进入上下文</span>
        <span className="sep" />
        <span>{fmtB(used)} / {fmtB(budget)}</span>
        <span className="sep" />
        <span className={state !== null && state.pending > 0 ? 'warn-txt' : ''}>{state?.pending ?? 0} 条待确认</span>
        {/* 误写提示挪到这里，只占文字不抢圆点 */}
        {(state?.noise?.count ?? 0) > 0 && <span className="warn-txt">· {state?.noise?.count} 条疑似误写</span>}
      </div>
      )}

      {open && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="panel" id="nx-b-panel" role="dialog" aria-modal="true" aria-label="记忆" onClick={(e) => e.stopPropagation()}>
            {/* 标题行删除（专家实测 54px）：宿主设置弹窗自带标题、状态条常驻，再写一遍"记忆"是三重冗余。
                ✕ 降级成模式行行尾的小图标（20×20）。 */}
            <div className="mode-budget-row">
              <div className="mode-group">
                <button className={'mode-btn' + (panelMode === 'readwrite' ? ' active' : '')} data-mode="readwrite" title="记录新记忆，并注入已有记忆" onClick={() => void setMode('readwrite')}>记录中</button>
                <button className={'mode-btn' + (panelMode === 'readonly' ? ' active' : '')} data-mode="readonly" title="不记录新记忆，但仍注入已有记忆" onClick={() => void setMode('readonly')}>只看不记</button>
                <button className={'mode-btn' + (panelMode === 'paused' ? ' active' : '')} data-mode="paused" title="既不记录也不注入" onClick={() => void setMode('paused')}>已关闭</button>
              </div>
              <div className="budget-mini">
                <div className="budget-mini-top">
                  <strong>{fmtB(used)} / {fmtB(budget)}</strong>
                  <span className="budget-mini-counts">进 {(inject?.shown.length ?? 0)} · 出 {(inject?.dropped.length ?? 0)}</span>
                </div>
                <div className="budget-mini-bar">
                  <div className="seg" data-scope="global" style={{ flexGrow: scopeCounts.user / scopeTotal }} />
                  <div className="seg" data-scope="project" style={{ flexGrow: scopeCounts.project / scopeTotal }} />
                  <div className="seg" data-scope="session" style={{ flexGrow: scopeCounts.episode / scopeTotal }} />
                </div>
              </div>
              <button className="close-btn" title="关闭 (Esc)" aria-label="关闭记忆面板" onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* 统计行 */}
            {/* 标签页 */}
            <div className="tabs" role="tablist" aria-label="记忆视图">
              <button role="tab" aria-selected={tab === 'attribution'} className={'tab' + (tab === 'attribution' ? ' active' : '')} onClick={() => setTab('attribution')}>归因 <span className="badge">{inject?.shown.length ?? 0}</span></button>
              <button role="tab" aria-selected={tab === 'library'} className={'tab' + (tab === 'library' ? ' active' : '')} onClick={() => setTab('library')}>记忆库 <span className="badge">{total}</span></button>
              <button role="tab" aria-selected={tab === 'trash'} className={'tab' + (tab === 'trash' ? ' active' : '')} onClick={() => setTab('trash')}>回收站 <span className={'badge' + (trashItems.length > 0 ? ' warn' : '')}>{trashItems.length}</span></button>
              <button role="tab" aria-selected={tab === 'settings'} className={'tab' + (tab === 'settings' ? ' active' : '')} onClick={() => setTab('settings')}>设置</button>
            </div>

            <div className="panel-body">
              {loading && <div className="empty-hint">加载中…<div className="sub">正在读取本地记忆库</div></div>}
              {!loading && error !== null && (
                <div className="empty-hint">读取失败：{error}
                  <div className="sub"><button className="mini-btn" onClick={() => { setLoading(true); void load() }}>点击重试</button></div>
                </div>
              )}

              {/* ---------- 归因 ---------- */}
              {!loading && error === null && tab === 'attribution' && (
                <>
                  {state?.noise !== undefined && state.noise.count > 0 && (
                    <div className="banner" role="status">
                      <div className="banner-text">检测到 <strong>{state.noise.count}</strong> 条疑似误写的记忆（子代理回执 / 系统提示词），会挤占注入预算。</div>
                      <button onClick={() => { setTab('library'); setLibFilter('subagent'); setQuery('') }}>查看</button>
                      <button onClick={() => {
                        const ids = state.noise?.ids ?? []
                        void run('/nexus/api/memory/reject', { ids }, '已归档 ' + String(ids.length) + ' 条误写记忆',
                          () => { void post('/nexus/api/memory/restore', { ids, any: true }).then(() => load()) })
                      }}>一键归档</button>
                    </div>
                  )}

                  {groups.map((group) => (
                    <div className={'reason-group' + (collapsed.has(group.key) ? ' collapsed' : '')} key={group.key}>
                      <div className="reason-header" role="button" tabIndex={0} aria-expanded={!collapsed.has(group.key)}
                        onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed((prev) => { const next = new Set(prev); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next }) } }}>
                        <span className="caret" aria-hidden="true">▾</span>
                        <span className={'marker ' + group.marker} aria-hidden="true" />
                        <span className="label">{group.label}</span>
                        <span className="count">{group.mix !== '' ? group.mix + ' · ' : ''}{group.count} 条{group.bytes > 0 ? ' · ' + fmtB(group.bytes) : ''}</span>
                      </div>
                      <div className="reason-body">
                        {group.cards.map((card) => {
                          const share = card.bytes / Math.max(1, budget)
                          return (
                            <div className={'mem-card' + (card.pinned ? ' pinned' : '')} key={card.id}>
                              <div className="mem-card-head">
                                <div className="mem-card-title">
                                  {card.subject !== '' && !card.statement.startsWith(card.subject) ? card.subject + '：' : ''}
                                  <Highlight text={card.statement.slice(0, 120)} term={query.trim()} />
                                </div>
                                <span className={'mem-card-size' + (share >= 0.3 ? ' over' : '')}>{fmtB(card.bytes)}</span>
                                <button className="mem-card-more" aria-label={'更多操作：' + card.statement.slice(0, 20)} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ id: card.id, x: Math.min(r.right - 168, window.innerWidth - 176), y: r.bottom + 4 }) }}>⋯</button>
                              </div>
                              <div className="mem-card-meta">
                                {card.confidence !== undefined
                                  ? <span className={'conf-dot ' + confLevel(card.confidence)} role="img" aria-label={'置信度 ' + Math.round(card.confidence * 100) + '%'} />
                                  : <span className="conf-dot unknown" role="img" aria-label="置信度未标注" />}
                                {SOURCE_WORD[sourceOf(card)] ?? '来源未标注'}
                                {card.confidence !== undefined && <> <span className="sep-dot">·</span> {card.confidence.toFixed(2)}</>}
                                <span className="sep-dot">·</span> {SCOPE_WORD[card.scope] ?? card.scope}
                                {card.pinned && <><span className="sep-dot">·</span><span className="pin-flag">置顶</span></>}
                              </div>
                              {'detail' in card && (card as InjectionDrop).detail !== undefined && (
                                <div className="mem-card-why">
                                  <span className="why-text warn">{(card as InjectionDrop).detail}</span>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  {groups.length === 0 && <div className="empty-hint">还没有记忆进入过上下文<div className="sub">在会话里说「记住：…」试试</div></div>}
                </>
              )}

              {/* ---------- 记忆库 ---------- */}
              {!loading && error === null && tab === 'library' && (
                <>
                  <div className="lib-toolbar">
                    <input className="lib-search" placeholder="搜索记忆内容…" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <select className="lib-select" value={libFilter} onChange={(e) => setLibFilter(e.target.value)}>
                      <option value="all">全部状态</option>
                      <option value="active">活跃</option>
                      <option value="pending">待确认</option>
                      <option value="conflict">冲突</option>
                      <option value="archived">已归档</option>
                      <option value="today">今日写入</option>
                      <option value="user">仅用户明文</option>
                      <option value="subagent">仅子代理回执</option>
                    </select>
                    <select className="lib-select" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}>
                      <option value="all">全部作用域</option>
                      <option value="user">跨项目</option>
                      <option value="project">本项目</option>
                      <option value="episode">本会话</option>
                    </select>
                    <button className="btn-add-new" onClick={() => { setCreating(true); setNewText(''); setNewScope('project') }}>新增</button>
                  </div>

                  <div className={'batch-bar' + (selected.size > 0 ? ' show' : '')}>
                    <span className="batch-info">已选 <strong>{selected.size}</strong> 条</span>
                    <button onClick={() => void batch('confirm')}>确认</button>
                    <button onClick={() => void batch('archive')}>归档</button>
                    <button className="danger" onClick={() => void batch('trash')}>入回收站</button>
                    <button onClick={() => setSelected(new Set())}>取消</button>
                  </div>

                  <div className="lib-split">
                  <div className="lib-list">
                    {library.map((item, index) => (
                      <div className={'lib-item' + (item.pinned === true ? ' pinned' : '') + (selected.has(item.id) ? ' selected' : '')} key={item.id}>
                        <input
                          type="checkbox"
                          className="lib-item-check"
                          checked={selected.has(item.id)}
                          onChange={(e) => toggleCheck(item.id, (e.nativeEvent as MouseEvent).shiftKey === true)}
                        />
                        <div className="lib-item-body" role="button" tabIndex={0} aria-expanded={expandedId === item.id}
                          onClick={() => { setDetailId(item.id); setExpandedId(expandedId === item.id ? null : item.id) }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(item.id); setExpandedId(expandedId === item.id ? null : item.id) } }}>
                          <div className="lib-item-title"><Highlight text={item.statement.slice(0, 140)} term={query.trim()} /></div>
                          <div className="lib-item-sub">
                            <span className={'status-dot ' + (item.status === 'active' ? 'active' : item.status === 'pending' ? 'pending' : item.status === 'needs-review' ? 'conflict' : 'archived')} aria-hidden="true" />
                            {STATUS_WORD[item.status] ?? item.status}
                            <span className="sep-dot">·</span> {SOURCE_WORD[item.provenance ?? ''] ?? '来源未标注'}
                            <span className="sep-dot">·</span> {SCOPE_WORD[item.scope] ?? item.scope}
                            {item.confidence !== undefined && <><span className="sep-dot">·</span> {item.confidence.toFixed(2)}</>}
                            <span className="sep-dot">·</span> {relTime(item.updatedAt)}
                          </div>
                          {expandedId === item.id && (
                            <div className="conflict-inline" style={{ marginTop: 8 }}>
                              <div className="diff-row"><div className="diff-label">原始文本{typeof item.statementLength === 'number' && item.truncated === true ? '（前 140 字，全文 ' + String(item.statementLength) + ' 字）' : ''}</div><div className="diff-new" style={{ whiteSpace: 'pre-wrap' }}>{item.statement}</div></div>
                              {item.conflictWith !== undefined && (
                                <div className="diff-row"><div className="diff-label">冲突对象</div><div className="diff-old">{item.conflictWith}</div></div>
                              )}
                              <div className="diff-actions">
                                {item.status === 'pending' && <button className="mini-btn green" onClick={() => void run('/nexus/api/memory/confirm', { ids: [item.id] }, '已确认')}>确认</button>}
                                <button className="mini-btn accent" onClick={() => void openEdit(item)}>编辑</button>
                                <button className="mini-btn" onClick={() => void openRelated(item.id)}>关系</button>
                              </div>
                            </div>
                          )}
                        </div>
                        <span className="lib-item-size">{item.injectBytes !== undefined ? fmtB(item.injectBytes) : ''}</span>
                        <button className="lib-item-more" aria-label={'更多操作：' + item.statement.slice(0, 20)} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ id: item.id, x: Math.min(r.right - 168, window.innerWidth - 176), y: r.bottom + 4 }) }}>⋯</button>
                      </div>
                    ))}
                    {library.length === 0 && <div className="empty-hint">没有匹配的记忆<div className="sub">试试放宽筛选或搜索词</div></div>}
                  </div>

                  {/* 宽屏（≥560px）右侧详情栏：窄栏里 display:none，保持单列 + 行内展开 */}
                  <aside className="lib-detail" aria-label="记忆详情">
                    {libDetail === null
                      ? <div className="empty-hint">选一条记忆查看详情<div className="sub">窄栏下点条目行内展开</div></div>
                      : <>
                          <div className="ld-title">{libDetail.statement}</div>
                          <div className="ld-meta">
                            {STATUS_WORD[libDetail.status] ?? libDetail.status}
                            <span className="sep-dot">·</span> {SOURCE_WORD[libDetail.provenance ?? ''] ?? '来源未标注'}
                            <span className="sep-dot">·</span> {SCOPE_WORD[libDetail.scope] ?? libDetail.scope}
                            {libDetail.injectBytes !== undefined && <><span className="sep-dot">·</span> {fmtB(libDetail.injectBytes)} 注入</>}
                            <span className="sep-dot">·</span> 更新 {relTime(libDetail.updatedAt)}
                            <span className="sep-dot">·</span> ID {libDetail.id}
                          </div>
                          <div className="ld-actions">
                            {libDetail.status === 'pending' && <button className="mini-btn green" onClick={() => void run('/nexus/api/memory/confirm', { ids: [libDetail.id] }, '已确认')}>确认</button>}
                            <button className="mini-btn accent" onClick={() => void openEdit(libDetail)}>编辑</button>
                            <button className="mini-btn" onClick={() => void run('/nexus/api/memory/pin', { id: libDetail.id, pinned: libDetail.pinned !== true }, libDetail.pinned === true ? '已取消置顶' : '已置顶')}>{libDetail.pinned === true ? '取消置顶' : '置顶'}</button>
                            <button className="mini-btn" onClick={() => void openRelated(libDetail.id)}>关联</button>
                            <button className="mini-btn warn" onClick={() => void run('/nexus/api/memory/reject', { ids: [libDetail.id] }, '已归档', () => { void restoreIds([libDetail.id], true) })}>归档</button>
                            <button className="mini-btn danger" onClick={() => void run('/nexus/api/memory/delete', { ids: [libDetail.id] }, '已移入回收站', () => { void restoreIds([libDetail.id]) })}>入回收站</button>
                          </div>
                        </>}
                  </aside>
                  </div>
                </>
              )}

              {/* ---------- 回收站 ---------- */}
              {!loading && error === null && tab === 'trash' && (
                <>
                  <div className="trash-toolbar">
                    <span className="trash-count">共 <strong>{trashItems.length}</strong> 条已归档（可恢复）</span>
                    {trashItems.length > 0 && (emptyConfirm
                      ? <>
                          <button className="mini-btn" onClick={() => setEmptyConfirm(false)}>取消</button>
                          <button className="btn-empty-trash" onClick={() => { setEmptyConfirm(false); void run('/nexus/api/memory/purge', { ids: trashItems.map((i) => i.id) }, '已彻底清除 ' + String(trashItems.length) + ' 条（不可恢复）') }}>确认清除 {trashItems.length} 条？</button>
                        </>
                      : <button className="btn-empty-trash" onClick={() => setEmptyConfirm(true)}>彻底清空</button>)}
                  </div>
                  <div className="lib-list">
                    {trashItems.map((item) => (
                      <div className="lib-item" key={item.id}>
                        <div className="lib-item-body">
                          <div className="lib-item-title">{item.statement.slice(0, 120)}</div>
                          <div className="lib-item-sub">
                            <span className="status-dot archived" />
                            {item.reviewNote === 'user-deleted' ? '手动移入' : '系统归档'}
                            <span className="sep-dot">·</span> {relTime(item.updatedAt)}
                          </div>
                        </div>
                        <button className="mini-btn green" onClick={() => void run('/nexus/api/memory/restore', { ids: [item.id], any: true }, '已恢复')}>恢复</button>
                      </div>
                    ))}
                    {trashItems.length === 0 && <div className="empty-hint">回收站是空的<div className="sub">归档或删除的记忆会出现在这里</div></div>}
                  </div>
                </>
              )}

              {/* ---------- 设置 ---------- */}
              {!loading && error === null && tab === 'settings' && (
                <>
                  <div className="settings-section">
                    <div className="settings-title">置信阈值（记忆自动接受的门槛）</div>
                    <div className="setting-row">
                      <span className="label">用户明文 / 工具写入 ≥</span>
                      <input type="number" min={0} max={1} step={0.01} value={autoT} onChange={(e) => setAutoT(e.target.value)} />
                    </div>
                    <div className="setting-row">
                      <span className="label">模型推断 ≥</span>
                      <input type="number" min={0} max={1} step={0.01} value={modelT} onChange={(e) => setModelT(e.target.value)} />
                    </div>
                    <div className="setting-hint">低于阈值的记忆进入「待确认」，不会自动生效。</div>
                  </div>

                  <div className="settings-section">
                    <div className="settings-title">LLM 提炼器</div>
                    <div className="setting-row">
                      <span className="label">模型</span>
                      <select className="setting-select" value={extractSel} onChange={(e) => setExtractSel(e.target.value)}>
                        <option value="">（不启用）</option>
                        {models.map((m) => <option key={m.provider + '::' + m.model} value={m.provider + '::' + m.model}>{m.providerName} · {m.modelName}</option>)}
                      </select>
                    </div>
                    <div className="setting-hint">启用后，会话结束时用该模型提炼记忆（消耗 token，默认关闭）。</div>
                  </div>

                  <div className="settings-section">
                    <div className="settings-title">运行状态</div>
                    {/* 今日统计从面板顶部搬到这里：原来 4 个数字占 30–64px，其中三项与状态条/本块重复 */}
                    <div className="doctor-block" style={{ marginBottom: 6 }}>
                      <div className="row"><span className="dim">今日写入</span><span>{stats.today}</span></div>
                      <div className="row"><span className="dim">待确认</span><span>{stats.pending}</span></div>
                      <div className="row"><span className="dim">已拒收</span><span>{stats.rejected}</span></div>
                      <div className="row"><span className="dim">注入次数</span><span>{stats.injections}</span></div>
                    </div>
                    <div className="doctor-block">
                      <div className="row"><span className="dim">注入预算</span><span>{fmtB(budget)}</span></div>
                      <div className="row"><span className="dim">本次占用</span><span>{fmtB(used)}（{pct}%）</span></div>
                      <div className="row"><span className="dim">活跃记忆</span><span>{activeCount} 条</span></div>
                      <div className="row"><span className="dim">自动降级</span><span className={state?.degraded === true ? 'warn' : 'ok'}>{state?.degraded === true ? '已降级（不注入）' : '正常'}</span></div>
                    </div>
                    <div className="setting-hint">记忆保存在本机 ~/.dsh/nexus；也可用 /memory list、/memory search 在会话中查看。</div>
                  </div>

                  <div className="settings-section">
                    <div className="setting-row" style={{ justifyContent: 'flex-end' }}>
                      <button className="mini-btn accent" disabled={savingSettings} onClick={() => {
                        setSavingSettings(true)
                        void (async () => {
                          try {
                            const body: Record<string, number> = {}
                            const auto = Number(autoT)
                            const model = Number(modelT)
                            if (Number.isFinite(auto)) body.auto = auto
                            if (Number.isFinite(model)) body.model = model
                            await post('/nexus/api/settings/threshold', body)
                            const idx = extractSel.indexOf('::')
                            await post('/nexus/api/settings/extractor', idx > 0 ? { provider: extractSel.slice(0, idx), model: extractSel.slice(idx + 2) } : {})
                            await load()
                            showToast('设置已保存')
                          } catch (err) { showToast('保存失败：' + (err instanceof Error ? err.message : String(err))) }
                          finally { setSavingSettings(false) }
                        })()
                      }}>保存设置</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ⋯ 操作菜单（B 的 menu-popup） */}
      {menu !== null && createPortal(
        <div className="menu-popup show" data-nxb-menu="true" role="menu" style={{ left: Math.min(Math.max(8, menu.x), Math.max(8, window.innerWidth - 180)), top: Math.min(Math.max(8, menu.y), Math.max(8, window.innerHeight - 260)) }}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { const item = items.find((i) => i.id === menu.id); setMenu(null); if (item !== undefined) void openEdit(item) }}>✏️ 编辑记忆</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenu(null); void navigator.clipboard?.writeText(menu.id); showToast('记忆 ID 已复制') }}>📋 复制 ID</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { void openRelated(menu.id) }}>🔗 关联记忆</button>
          <div className="menu-divider" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenu(null); void run('/nexus/api/memory/pin', { id: menu.id, pinned: true }, '已置顶（下次注入优先）') }}>📌 置顶</button>
          <button type="button" role="menuitem" className="menu-item danger" onClick={() => { setMenu(null); void run('/nexus/api/memory/reject', { ids: [menu.id] }, '已归档（同句不再继承自动记住）') }}>📦 归档</button>
          <button type="button" role="menuitem" className="menu-item danger" onClick={() => { setMenu(null); void run('/nexus/api/memory/delete', { ids: [menu.id] }, '已移入回收站（可恢复）') }}>🗑️ 移入回收站</button>
        </div>,
        rootRef.current ?? document.body,
      )}

      {/* 编辑 */}
      {editing !== null && createPortal(
        <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">编辑记忆</div><button className="close-btn" onClick={() => setEditing(null)}>✕</button></div>
            <div className="modal-body">
              <div className="field">
                <label>原始文本 <span className="hint">{editText.length} 字</span></label>
                <textarea className="field-textarea" value={editText} onChange={(e) => setEditText(e.target.value)} />
              </div>
              <div className="field">
                <label>置信度</label>
                <div className="conf-row">
                  <input type="range" min={0} max={1} step={0.01} value={editConf} onChange={(e) => setEditConf(Number(e.target.value))} />
                  <span className="conf-value">{editConf.toFixed(2)}</span>
                </div>
              </div>
              <div className="field">
                <label>作用域</label>
                <div className="chip-group">
                  <button className={'chip' + (editScope === 'user' ? ' active' : '')} onClick={() => setEditScope('user')}>跨项目</button>
                  <button className={'chip' + (editScope === 'project' ? ' active' : '')} onClick={() => setEditScope('project')}>本项目</button>
                </div>
              </div>
              <div className="impact-hint info">保存后立即生效，并同步到 ~/.dsh/nexus 的可读文件。</div>
            </div>
            <div className="modal-footer">
              <button className="mini-btn" onClick={() => setEditing(null)}>取消</button>
              <button className="mini-btn accent" onClick={() => void saveEdit()}>保存</button>
            </div>
          </div>
        </div>,
        rootRef.current ?? document.body,
      )}

      {/* 新增 */}
      {creating && createPortal(
        <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setCreating(false) }}>
          <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">新增记忆</div><button className="close-btn" onClick={() => setCreating(false)}>✕</button></div>
            <div className="modal-body">
              <div className="field">
                <label>内容 <span className="hint">写清楚"什么时候适用"</span></label>
                <textarea className="field-textarea" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="例如：这个项目用 pnpm，不用 npm。" />
              </div>
              <div className="field">
                <label>作用域</label>
                <div className="chip-group">
                  <button className={'chip' + (newScope === 'user' ? ' active' : '')} onClick={() => setNewScope('user')}>跨项目</button>
                  <button className={'chip' + (newScope === 'project' ? ' active' : '')} onClick={() => setNewScope('project')}>本项目</button>
                </div>
              </div>
              <div className="field">
                <label>置信度</label>
                <div className="conf-row">
                  <input type="range" min={0} max={1} step={0.01} value={newConf} onChange={(e) => setNewConf(Number(e.target.value))} />
                  <span className="conf-value">{newConf.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="mini-btn" onClick={() => setCreating(false)}>取消</button>
              <button className="mini-btn accent" onClick={() => {
                void (async () => {
                  try {
                    await post('/nexus/api/memory/create', { statement: newText.trim(), scope: newScope, confidence: newConf })
                    await load()
                    setCreating(false)
                    showToast('已新增 1 条记忆')
                  } catch (err) { showToast('新增失败：' + (err instanceof Error ? err.message : String(err))) }
                })()
              }}>保存</button>
            </div>
          </div>
        </div>,
        rootRef.current ?? document.body,
      )}

      {/* 关联 */}
      {relatedFor !== null && createPortal(
        <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setRelatedFor(null) }}>
          <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">关联记忆</div><button className="close-btn" onClick={() => setRelatedFor(null)}>✕</button></div>
            <div className="modal-body">
              <div className="related-list">
                {related.length === 0 && <div className="empty-hint">暂无关联记忆</div>}
                {related.map((row, index) => (
                  <div className="related-item" key={index}>
                    <span className="rel-check" />
                    <div className="rel-text">
                      {(row.atom?.statement ?? row.other ?? '').slice(0, 140)}
                      <div className="rel-scope">{row.edge ?? '相关'}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>保存时把两条合并成一条？</label>
                <div className="chip-group">
                  <button className={'chip' + (keepOriginal ? ' active' : '')} onClick={() => setKeepOriginal(true)}>保留原记忆</button>
                  <button className={'chip' + (!keepOriginal ? ' active' : '')} onClick={() => setKeepOriginal(false)}>只留合并后的</button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="mini-btn" onClick={() => setRelatedFor(null)}>关闭</button>
            </div>
          </div>
        </div>,
        rootRef.current ?? document.body,
      )}

      {/* Toast */}
      <div className={'toast' + (toast !== null ? ' show' : '')} role="status" aria-live="polite">
        <span>{toast?.text ?? ''}</span>
        {toast?.undo !== undefined && <button className="undo" onClick={() => { const undo = toast.undo; setToast(null); undo?.() }}>撤销</button>}
      </div>
    </div>
  )
}
