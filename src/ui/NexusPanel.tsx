/** Nexus 记忆面板：独立 /nexus 页与 DSH 设置面板 iframe 共用的单一实现（React）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, Btn, Select } from './components.tsx'
import { MemoryRow } from './MemoryRow.tsx'
import type { MemoryRowItem } from './MemoryRow.tsx'
import { isPlainSlash, shouldHandleSlashKey } from './keyboard.ts'
import { ScopeBar } from './ScopeBar.tsx'
import type { ScopeCounts } from './ScopeBar.tsx'
import { InjectionBar } from './InjectionBar.tsx'
import type { InjectionTruthView, ProjectRefView } from './InjectionBar.tsx'

interface CostAggregate {
  inputTokens: number
  outputTokens: number
}
interface NexusState {
  active: number
  pending: number
  conflicts: number
  degraded: boolean
  cost: { inject: CostAggregate; extract: CostAggregate }
  /** B7：作用域计数（用户/项目/会话）。 */
  byScope?: ScopeCounts
  /** B4：默认查看的项目 + 可选项目清单 + 注入真相。 */
  project?: string
  projects?: ProjectRefView[]
  injection?: InjectionTruthView
}
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
  supersededBy?: string
  reviewNote?: string
  /** B2：列表只回前 400 字，这里给出真实长度；完整内容走 /memory/get。 */
  statementLength?: number
  truncated?: boolean
  projectRef?: string
}
/** B2：分页响应（服务端筛选 + 总数，前端不再"截断后过滤"）。 */
interface MemoryPage { items: MemoryItem[]; total: number; offset: number; limit: number }
interface Neighbor {
  edge?: string
  atom?: { statement: string }
  other?: string
}
interface Thresholds { autoAcceptThreshold: number; modelAutoThreshold: number; extractorLlm?: { provider: string; model: string } }
interface ModelRow { provider: string; providerName: string; model: string; modelName: string }
/** 决策日志（可解释性）：为什么没记 / 系统自己改了什么 / 上次会话小结。 */
interface DecisionReject { at: number; source: string; ruleId?: string; sample: string; reason: string }
interface AutoChange { id: string; statement: string; status: string; reviewNote?: string; updatedAt: number }
interface Decisions {
  rejects: DecisionReject[]
  autoChanges: AutoChange[]
  lastSummary?: { at: number; saved: number; pending: number; skippedWindows: number }
}

/** 作用域展示名（三种，统一中文）。 */

/** 解析 /nexus/api 的 JSON 响应。 */
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  return res.json() as Promise<T>
}

interface LoadParams { q: string; s: string; st: string; p: string }

/** 单页条数（服务端上限 200）。 */
const PAGE_SIZE = 50
/** 列表查询 URL：q/scope/status 全部走服务端，避免"先截断再过滤"造成静默漏报。 */
function memoryUrl(params: { q: string; s: string; st: string }, offset: number): string {
  return '/nexus/api/memory?q=' + encodeURIComponent(params.q)
    + '&scope=' + encodeURIComponent(params.s)
    + '&status=' + encodeURIComponent(params.st)
    + '&offset=' + String(offset) + '&limit=' + String(PAGE_SIZE)
}

/** 面板加载参数，记录为 state 以便事件与查询同步。 */
export function NexusPanel(): React.ReactNode {
  const [state, setState] = useState<NexusState | null>(null)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  // B4：注入真相要针对某个项目计算（项目记忆按归属隔离）
  const [project, setProject] = useState('')
  const [scope, setScope] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [neighbors, setNeighbors] = useState<Record<string, { loading: boolean; list: Neighbor[] | null; error?: string }>>({})
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  // B3 批量选择（复用 ids[] 路由）；行内的编辑/二次确认状态已收进 MemoryRow
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchConfirm, setBatchConfirm] = useState<'archive' | 'trash' | null>(null)
  // B5 反馈层：底部 toast（成功带 5 秒撤销；失败带原因），取代 window.alert/confirm
  const [toast, setToast] = useState<{ text: string; error?: boolean; undo?: () => void } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addScope, setAddScope] = useState('user')
  const [settings, setSettings] = useState<Thresholds | null>(null)
  const [autoT, setAutoT] = useState('0.9')
  const [modelT, setModelT] = useState('0.95')
  const [showSettings, setShowSettings] = useState(false)
  const [models, setModels] = useState<ModelRow[]>([])
  const [extractSel, setExtractSel] = useState('')
  const [decisions, setDecisions] = useState<Decisions | null>(null)
  const [showDecisions, setShowDecisions] = useState(false)

  const load = useCallback(async ({ q, s, st, p }: LoadParams): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [stateData, page, thr, mods, dec] = await Promise.all([
        j<NexusState>('/nexus/api/state?project=' + encodeURIComponent(p)),
        j<MemoryPage>(memoryUrl({ q, s, st }, 0)),
        j<Thresholds>('/nexus/api/settings'),
        j<ModelRow[]>('/nexus/api/models'),
        j<Decisions>('/nexus/api/decisions'),
      ])
      setState(stateData)
      // 服务端会给出默认项目；只在本地还没选过时同步一次（避免来回覆盖）
      if (p === '' && stateData.project !== undefined && stateData.project !== '') setProject(stateData.project)
      setDecisions(dec)
      setItems(page.items)
      setTotal(page.total)
      setSettings(thr)
      setAutoT(String(thr.autoAcceptThreshold))
      setModelT(String(thr.modelAutoThreshold))
      setModels(mods)
      setExtractSel(thr.extractorLlm === undefined ? '' : `${thr.extractorLlm.provider}::${thr.extractorLlm.model}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const current: LoadParams = { q: query, s: scope, st: status, p: project }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(current) }, 250)
    return () => { window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, status, project, load])

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(current) }, 15000)
    return () => { window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const reload = (): void => { void load(current) }

  // B6：按「/」聚焦搜索（在输入框里打字时不抢键）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isPlainSlash(event)) return
      if (!shouldHandleSlashKey(event.target as { tagName?: string; isContentEditable?: boolean } | null)) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  // B2：翻页追加（服务端 offset/total），筛选变化时回到第一页
  const loadMore = async (): Promise<void> => {
    if (loadingMore || items.length >= total) return
    setLoadingMore(true)
    try {
      const page = await j<MemoryPage>(memoryUrl({ q: query, s: scope, st: status }, items.length))
      setItems((prev) => [...prev, ...page.items])
      setTotal(page.total)
    } catch (err) {
      showToast('加载更多失败：' + (err instanceof Error ? err.message : String(err)), undefined, true)
    } finally {
      setLoadingMore(false)
    }
  }

  const showToast = useCallback((text: string, undo?: () => void, error = false): void => {
    setToast({ text, ...(undo !== undefined ? { undo } : {}), ...(error ? { error: true } : {}) })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => { setToast(null) }, 5000)
  }, [])
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const data = await j<unknown>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    reload()
    return data
  }
  const runAction = async (path: string, body: unknown, label: string, undo?: () => void): Promise<boolean> => {
    try { await post(path, body); showToast(label, undo); return true }
    catch (err) { showToast(`${label}失败：${err instanceof Error ? err.message : String(err)}`, undefined, true); return false }
  }
  const confirmOne = (id: string): void => { void runAction('/nexus/api/memory/confirm', { ids: [id] }, '已确认 1 条') }

  // B2/B3：编辑必须先取全文（列表只回 400 字预览，照预览保存会截掉长记忆的后半段）
  const loadFull = async (id: string): Promise<string> =>
    (await j<{ statement: string }>('/nexus/api/memory/get?id=' + encodeURIComponent(id))).statement
  const saveEdit = (id: string, statement: string, scope: string): Promise<boolean> =>
    statement === '' ? Promise.resolve(false) : runAction('/nexus/api/memory/update', { id, statement, scope }, '已更新')
  // 归档 = 归档 + 黑名单；撤销走 restore(any)，并把黑名单回滚（服务端已实现）
  const archiveRow = (id: string): Promise<boolean> =>
    runAction('/nexus/api/memory/reject', { ids: [id] }, '已归档 1 条（同句不再自动记住）',
      () => { void runAction('/nexus/api/memory/restore', { ids: [id], any: true }, '已撤销归档') })
  const deleteRow = (id: string): Promise<boolean> =>
    runAction('/nexus/api/memory/delete', { ids: [id] }, '已移入回收站 1 条（可恢复）',
      () => { void runAction('/nexus/api/memory/restore', { ids: [id] }, '已撤销') })
  // 彻底清除：仅回收站条目，真删 + 清边 + 清同句拒绝样本（行内二次确认）
  const purgeRow = (id: string): Promise<boolean> =>
    runAction('/nexus/api/memory/purge', { ids: [id] }, '已彻底清除 1 条（内容、关系边、同句拒绝记录一并删除）')

  // B3 批量操作：选中集合走 ids[]，成功后可撤销（归档连黑名单一起回滚）
  const toggleSelect = (id: string, next: boolean): void => {
    setSelected((prev) => { const copy = new Set(prev); if (next) copy.add(id); else copy.delete(id); return copy })
  }
  const clearSelection = (): void => { setSelected(new Set()); setBatchConfirm(null) }
  const selectPage = (): void => { setSelected(new Set(items.map((item) => item.id))); setBatchConfirm(null) }
  const selectedIds = [...selected]
  const runBatch = async (path: string, label: string, undo?: () => void): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (await runAction(path, { ids }, label, undo)) clearSelection()
  }
  const batchConfirmActive = (): void => { void runBatch('/nexus/api/memory/confirm', '已确认 ' + String(selected.size) + ' 条') }
  const batchArchive = (): void => {
    const ids = [...selected]
    void runBatch('/nexus/api/memory/reject', '已归档 ' + String(ids.length) + ' 条（同句不再自动记住）',
      () => { void runAction('/nexus/api/memory/restore', { ids, any: true }, '已撤销归档') })
  }
  const batchTrash = (): void => {
    const ids = [...selected]
    void runBatch('/nexus/api/memory/delete', '已移入回收站 ' + String(ids.length) + ' 条（可恢复）',
      () => { void runAction('/nexus/api/memory/restore', { ids }, '已撤销') })
  }

  const startAdd = (): void => { setAdding(true); setAddText(''); setAddScope('user') }
  const cancelAdd = (): void => setAdding(false)
  const submitAdd = async (): Promise<void> => {
    const statement = addText.trim()
    if (statement === '') return
    if (await runAction('/nexus/api/memory/create', { statement, scope: addScope }, '新增失败')) setAdding(false)
  }
  const restoreOne = (id: string): void => { void runAction('/nexus/api/memory/restore', { ids: [id] }, '恢复失败') }
  // 近义重复：把当前这条合并到保留的那条（当前条置为 superseded）
  const mergeInto = (dropId: string, keepId: string): void => {
    void runAction('/nexus/api/memory/merge', { keep: keepId, drop: dropId }, '合并失败')
  }
  // 置顶：索引块排序第一优先（D3）
  const pinById = (id: string, next: boolean): void => {
    void runAction('/nexus/api/memory/pin', { id, pinned: next }, next ? '已置顶（下次注入优先）' : '已取消置顶',
      () => { void runAction('/nexus/api/memory/pin', { id, pinned: !next }, '已撤销') })
  }
  const togglePin = (item: MemoryRowItem): void => { pinById(item.id, item.pinned !== true) }

  // B4 注入真相条：一键修好「进不去上下文」的原因（复用现有路由，失败有 toast 说明）
  const injectionActions = {
    onProject: (ref: string): void => { setProject(ref) },
    onPin: (id: string, pinned: boolean): void => { pinById(id, pinned) },
    onAssign: (id: string, ref: string): void => { void runAction('/nexus/api/memory/update', { id, projectRef: ref }, '已指派到 ' + ref) },
    onScope: (id: string, scope: string): void => { void runAction('/nexus/api/memory/update', { id, scope }, '已改为用户级（所有项目可见）') },
    onSave: (id: string, statement: string, scope: string): void => { void runAction('/nexus/api/memory/update', { id, statement, scope }, '已更新') },
    // 注入条里的 statement 是 200 字预览；「缩短」前必须取全文，避免一编辑就截断
    onLoad: loadFull,
    onConfirm: (id: string): void => { confirmOne(id) },
  }

  const saveSettings = async (): Promise<void> => {
    try {
      const auto = Number(autoT)
      const model = Number(modelT)
      const tBody: Record<string, number> = {}
      if (Number.isFinite(auto) && auto >= 0 && auto <= 1) tBody.auto = auto
      if (Number.isFinite(model) && model >= 0 && model <= 1) tBody.model = model
      await j('/nexus/api/settings/threshold', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tBody) })
      const idx = extractSel.indexOf('::')
      const provider = idx > 0 ? extractSel.slice(0, idx) : ''
      const exModel = idx > 0 ? extractSel.slice(idx + 2) : ''
      const eBody: Record<string, string> = {}
      if (provider !== '' && exModel !== '') { eBody.provider = provider; eBody.model = exModel }
      await j('/nexus/api/settings/extractor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(eBody) })
      reload()
    } catch (err) { window.alert(`设置保存失败：${err instanceof Error ? err.message : String(err)}`) }
  }

  const modelGroups = useMemo(() => {
    const map = new Map<string, ModelRow[]>()
    for (const m of models) { const arr = map.get(m.providerName) ?? []; arr.push(m); map.set(m.providerName, arr) }
    return Array.from(map.entries()).map(([label, items]) => ({
      label,
      options: items.map((m) => ({ value: `${m.provider}::${m.model}`, label: m.modelName })),
    }))
  }, [models])

  const fetchNeighbors = async (id: string): Promise<void> => {
    setNeighbors((prev) => ({ ...prev, [id]: { loading: true, list: null } }))
    try {
      const ns = await j<Neighbor[]>(`/nexus/api/neighbors?id=${encodeURIComponent(id)}`)
      setNeighbors((prev) => ({ ...prev, [id]: { loading: false, list: ns } }))
    } catch (err) {
      setNeighbors((prev) => ({ ...prev, [id]: { loading: false, list: null, error: err instanceof Error ? err.message : String(err) } }))
    }
  }
  const toggleNeighbors = (id: string): void => {
    if (openIds.has(id)) {
      setOpenIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      return
    }
    setOpenIds((prev) => new Set(prev).add(id))
    if (neighbors[id]?.list !== undefined) return
    void fetchNeighbors(id)
  }

  const chips: Array<[string, string | number, string | undefined]> = state === null
    ? []
    : [
        ['活跃', state.active, 'ok'],
        ['待确认', state.pending, 'warn'],
        ['冲突', state.conflicts, 'bad'],
        ['降级', state.degraded ? '是' : '否', state.degraded ? 'warn' : undefined],
      ]

  return (
    <div className="nx-app">
      {toast !== null && (
        <div className={toast.error === true ? 'nx-toast error' : 'nx-toast'} role="status" aria-live="polite">
          <span className="nx-toast-text">{toast.text}</span>
          {toast.undo !== undefined && (
            <button onClick={() => { const undo = toast.undo; setToast(null); undo?.() }}>撤销</button>
          )}
          <button onClick={() => setToast(null)}>关闭</button>
        </div>
      )}
      <header className="nx-header">
        <div>
          <h1 className="nx-title">记忆</h1>
          <p className="nx-sub">查看和管理本会话沉淀的记忆。</p>
        </div>
        <button className="nx-btn" onClick={() => setShowSettings((s) => !s)}>{showSettings ? '收起设置' : '设置'}</button>
      </header>

      <ScopeBar counts={state?.byScope} />

      {state?.injection !== undefined && (
        <InjectionBar
          truth={state.injection}
          projects={state.projects ?? []}
          project={state.project ?? project}
          {...injectionActions}
        />
      )}

      {state?.degraded === true && (
        <div className="nx-banner">近 7 天未使用记忆注入，已自动降级为「不注入」（节省 token）。继续使用后会逐步恢复。</div>
      )}

      <div className="nx-stats">
        {chips.length === 0 ? <span className="nx-chip">加载中…</span> : chips.map(([label, value, tone]) => (
          <Chip key={label} label={label} value={value} tone={tone} />
        ))}
      </div>
      {showSettings && settings !== null && (
        <div className="nx-settings">
          <div className="nx-settings-title">置信阈值（记忆自动接受的门槛）</div>
          <div className="nx-threshold">
            <label className="nx-threshold-field"><span>自动接受（用户明示/工具）</span><input type="number" min={0} max={1} step={0.01} className="nx-search nx-threshold-input" value={autoT} onChange={(e) => setAutoT(e.target.value)} placeholder="0-1" /></label>
            <label className="nx-threshold-field"><span>模型推断（LLM 提取）</span><input type="number" min={0} max={1} step={0.01} className="nx-search nx-threshold-input" value={modelT} onChange={(e) => setModelT(e.target.value)} placeholder="0-1" /></label>
          </div>
          <div className="nx-threshold-hint">自动接受：用户明示/工具写入 ≥ 此值即生效；模型推断：模型记忆 ≥ 此值才生效，否则进「待确认」。</div>
          <div className="nx-threshold nx-extractor-row">
            <span className="nx-threshold-label">LLM 提炼器</span>
            <Select ariaLabel="LLM 提炼器模型" value={extractSel} onChange={(v) => setExtractSel(v)} groups={[{ label: '关闭', options: [{ value: '', label: '（不启用）' }] }, ...modelGroups]} />
          </div>
          <div className="nx-settings-actions">
            <Btn kind="primary" onClick={() => void saveSettings()}>保存设置</Btn>
          </div>
        </div>
      )}

      <div className="nx-toolbar">
        <input
          ref={searchRef}
          type="search"
          className="nx-search"
          aria-label="搜索记忆（按 / 聚焦）"
          placeholder="搜索记忆内容…（按 / 聚焦）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select ariaLabel="作用域" value={scope} onChange={(v) => setScope(v)} options={[
          { value: '', label: '全部作用域' },
          { value: 'user', label: '用户' },
          { value: 'project', label: '项目' },
          { value: 'episode', label: '会话' },
        ]} />
        <Select ariaLabel="状态" value={status} onChange={(v) => setStatus(v)} options={[
          { value: '', label: '全部状态' },
          { value: 'pending', label: '待确认' },
          { value: 'needs-review', label: '冲突' },
          { value: 'active', label: '活跃' },
          { value: 'archived', label: '已归档' },
          { value: 'superseded', label: '已取代' },
        ]} />
        <Btn onClick={reload}>刷新</Btn>
        <Btn kind="primary" onClick={startAdd}>新增</Btn>
        <span className="nx-count" role="status" aria-live="polite">显示 {items.length} / 共 {total} 条</span>
        {items.length > 0 && <Btn onClick={selectPage}>全选本页</Btn>}
      </div>
      <div className="nx-decisions">
        <div className="nx-actions">
          <Btn onClick={() => setShowDecisions(!showDecisions)}>{showDecisions ? '收起决策日志' : '决策日志（为什么没记）'}</Btn>
        </div>
        {showDecisions && (
          <div className="nx-row">
            {decisions?.lastSummary !== undefined && (
              <div className="nx-hint">
                上次会话：新增 {decisions.lastSummary.saved} 条 · 待确认 {decisions.lastSummary.pending} 条
                {decisions.lastSummary.skippedWindows > 0 ? ` · 跳过 ${decisions.lastSummary.skippedWindows} 窗（超预算）` : ''}
              </div>
            )}
            {(decisions?.rejects.length ?? 0) === 0
              ? <div className="nx-empty">还没有被拒绝的记录。</div>
              : decisions!.rejects.slice(0, 20).map((reject, index) => (
                  <div className="nx-row" key={index}>
                    <div className="nx-meta">
                      <span>{reject.source}{reject.ruleId !== undefined ? ' · ' + reject.ruleId : ''}</span>
                      <span>{new Date(reject.at).toLocaleString()}</span>
                    </div>
                    <div className="nx-statement">未记住：{reject.sample}</div>
                    <div className="nx-hint">{reject.reason}</div>
                  </div>
                ))}
            {(decisions?.autoChanges.length ?? 0) > 0 && (
              <div className="nx-hint">
                系统自动变更 {decisions!.autoChanges.length} 条（如清理/重定作用域），可在列表里恢复或彻底清除。
              </div>
            )}
          </div>
        )}
      </div>
      {adding && (
        <div className="nx-add">
          <textarea className="nx-edit" value={addText} onChange={(e) => setAddText(e.target.value)} rows={2} placeholder="新增记忆内容…" autoFocus />
          <div className="nx-actions">
            <Select ariaLabel="作用域" value={addScope} onChange={(v) => setAddScope(v)} options={[
              { value: 'project', label: '项目' },
              { value: 'user', label: '用户' },
            ]} />
            <Btn kind="primary" onClick={() => void submitAdd()}>保存</Btn>
            <Btn onClick={cancelAdd}>取消</Btn>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="nx-batch" role="region" aria-label="批量操作">
          <span className="nx-batch-count">已选 {selected.size} 条</span>
          <Btn kind="primary" onClick={batchConfirmActive}>确认</Btn>
          {batchConfirm === 'archive'
            ? <><Btn kind="danger" onClick={batchArchive}>确认归档 {selected.size} 条</Btn><Btn onClick={() => setBatchConfirm(null)}>取消</Btn></>
            : <Btn kind="danger" onClick={() => setBatchConfirm('archive')}>归档</Btn>}
          {batchConfirm === 'trash'
            ? <><Btn kind="danger" onClick={batchTrash}>确认移入回收站 {selected.size} 条</Btn><Btn onClick={() => setBatchConfirm(null)}>取消</Btn></>
            : <Btn onClick={() => setBatchConfirm('trash')}>移入回收站</Btn>}
          <Btn onClick={clearSelection}>取消选择</Btn>
        </div>
      )}

      <div className="nx-list" role="list">
        {loading && items.length === 0 ? <div className="nx-empty">加载中…</div>
        : error !== null ? <div className="nx-empty">加载失败：{error}</div>
        : items.length === 0 ? (
            <div className="nx-empty">
              <div className="nx-empty-title">这里还没有记忆。</div>
              <div className="nx-empty-hint">在会话里说「记住：……」，我会自动提炼；也可以点右上角「新增」手动写入。</div>
            </div>
          )
        : items.map((item) => (
            <MemoryRow
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onSelect={toggleSelect}
              {...(neighbors[item.id] !== undefined ? { neighbors: neighbors[item.id] } : {})}
              neighborsOpen={openIds.has(item.id)}
              onToggleNeighbors={toggleNeighbors}
              onLoadFull={loadFull}
              onSave={saveEdit}
              onConfirm={confirmOne}
              onTogglePin={togglePin}
              onArchive={archiveRow}
              onRestore={restoreOne}
              onDelete={deleteRow}
              onPurge={purgeRow}
              onMerge={mergeInto}
            />
          ))}
        {items.length > 0 && items.length < total && (
          <div className="nx-more">
            <Btn disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? '加载中…' : '加载更多（还有 ' + String(total - items.length) + ' 条）'}
            </Btn>
          </div>
        )}
      </div>

      <footer className="nx-footer">
        {state !== null && (
          <div className="nx-footer-meta">
            本次会话注入累计 {state.cost.inject.inputTokens} tok · 提炼 {state.cost.extract.inputTokens}/{state.cost.extract.outputTokens} tok
            {state.injection !== undefined ? ' · 单次注入 ' + state.injection.textBytes + ' B' : ''}
          </div>
        )}
        <div>记忆保存在本机 <code>~/.dsh/nexus</code>；也可用 <code>/memory list</code>、<code>/memory search</code> 在会话中查看。</div>
      </footer>
    </div>
  )
}