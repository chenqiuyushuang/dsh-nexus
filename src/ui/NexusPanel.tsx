/** Nexus 记忆面板：独立 /nexus 页与 DSH 设置面板 iframe 共用的单一实现（React）。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chip, Tag, Btn, Select } from './components.tsx'

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
}
interface MemoryItem {
  id: string
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
}
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
const SCOPE_NAME: Record<string, string> = { user: '用户', project: '项目', episode: '会话' }
/** 槽位展示名（与后端判别值一一对应）。 */
const SLOT_NAME: Record<string, string> = {
  personal: '个人', user: '个人', project: '项目', episode: '会话', feedback: '反馈', reference: '资料',
}
const STATUS_NAME: Record<string, string> = {
  pending: '待确认', 'needs-review': '冲突', active: '活跃', archived: '已归档', superseded: '已取代', rejected: '已拒绝',
}

/** 解析 /nexus/api 的 JSON 响应。 */
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  return res.json() as Promise<T>
}

interface LoadParams { q: string; s: string; st: string }

/** 面板加载参数，记录为 state 以便事件与查询同步。 */
export function NexusPanel(): React.ReactNode {
  const [state, setState] = useState<NexusState | null>(null)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [neighbors, setNeighbors] = useState<Record<string, { loading: boolean; list: Neighbor[] | null; error?: string }>>({})
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editScope, setEditScope] = useState('project')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
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

  const load = useCallback(async ({ q, s, st: statusFilter }: LoadParams): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [stateData, mem, thr, mods, dec] = await Promise.all([
        j<NexusState>('/nexus/api/state'),
        j<MemoryItem[]>(`/nexus/api/memory?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(s)}&limit=80`),
        j<Thresholds>('/nexus/api/settings'),
        j<ModelRow[]>('/nexus/api/models'),
        j<Decisions>('/nexus/api/decisions'),
      ])
      setState(stateData)
      setDecisions(dec)
      setItems(statusFilter === '' ? mem : mem.filter((item) => item.status === statusFilter))
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

  const current: LoadParams = { q: query, s: scope, st: status }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(current) }, 250)
    return () => { window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, status, load])

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(current) }, 15000)
    return () => { window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const reload = (): void => { void load(current) }

  const post = async (path: string, body: unknown): Promise<void> => {
    await j(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    reload()
  }
  const runAction = async (path: string, body: unknown, label: string): Promise<boolean> => {
    try { await post(path, body); return true }
    catch (err) { window.alert(`${label}：${err instanceof Error ? err.message : String(err)}`); return false }
  }
  const confirmOne = (id: string): void => { void runAction('/nexus/api/memory/confirm', { ids: [id] }, '确认失败') }

  const startEdit = (item: MemoryItem): void => { setEditingId(item.id); setEditText(item.statement); setEditScope(item.scope) }
  const saveEdit = async (id: string): Promise<void> => {
    const next = editText.trim()
    if (next === '') return
    if (await runAction('/nexus/api/memory/update', { id, statement: next, scope: editScope }, '编辑失败')) setEditingId(null)
  }
  const cancelEdit = (): void => setEditingId(null)

  const askArchive = (id: string): void => setConfirmingId(id)
  const confirmArchive = async (id: string): Promise<void> => {
    if (await runAction('/nexus/api/memory/reject', { ids: [id] }, '归档失败')) setConfirmingId(null)
  }
  const cancelArchive = (): void => setConfirmingId(null)

  const askDelete = (id: string): void => setDeleteId(id)
  const confirmDelete = async (id: string): Promise<void> => {
    if (await runAction('/nexus/api/memory/delete', { ids: [id] }, '删除失败')) setDeleteId(null)
  }
  const cancelDelete = (): void => setDeleteId(null)

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
  const togglePin = (item: MemoryItem): void => {
    void runAction('/nexus/api/memory/pin', { id: item.id, pinned: item.pinned !== true }, '置顶失败')
  }
  // 彻底清除（仅回收站/归档行）：真删 + 清边，二次确认
  const purgeOne = (id: string): void => {
    if (!window.confirm('彻底清除这条记忆？内容会从磁盘移除，无法恢复。')) return
    void runAction('/nexus/api/memory/purge', { ids: [id] }, '彻底清除失败')
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
      <header className="nx-header">
        <div>
          <h1 className="nx-title">记忆</h1>
          <p className="nx-sub">查看和管理本会话沉淀的记忆。</p>
        </div>
        <button className="nx-btn" onClick={() => setShowSettings((s) => !s)}>{showSettings ? '收起设置' : '设置'}</button>
      </header>

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
        <input className="nx-search" placeholder="搜索记忆内容…" value={query} onChange={(e) => setQuery(e.target.value)} />
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

      <div className="nx-list">
        {loading && items.length === 0 ? <div className="nx-empty">加载中…</div>
        : error !== null ? <div className="nx-empty">加载失败：{error}</div>
        : items.length === 0 ? <div className="nx-empty">暂无记忆。会话中我会自动提炼并保存值得记住的信息。</div>
        : items.map((item) => (
            <div className="nx-row" key={item.id}>
              <div className="nx-row-head">
                <div className="nx-tags">
                  <Tag text={SCOPE_NAME[item.scope] ?? item.scope} className="scope" />
                  <span className="nx-tag-sep">|</span>
                  <Tag text={SLOT_NAME[item.slot] ?? item.slot} className={`slot-${item.slot}`} />
                  <span className="nx-tag-sep">|</span>
                  <Tag text={STATUS_NAME[item.status] ?? item.status} className={`status-${item.status}`} />
                  {item.pinned === true && <><span className="nx-tag-sep">|</span><Tag text="置顶" /></>}
                </div>
              </div>
              {editingId === item.id
                ? <div className="nx-edit-wrap">
                    <Select ariaLabel="作用域" value={editScope} onChange={(v) => setEditScope(v)} options={[
                      { value: 'project', label: '项目' },
                      { value: 'user', label: '个人' },
                    ]} />
                    <textarea className="nx-edit" value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} autoFocus />
                  </div>
                : <div className="nx-statement">{item.statement}</div>}
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
              <div className="nx-actions">
                {(item.status === 'pending' || item.status === 'needs-review') && <Btn kind="primary" onClick={() => confirmOne(item.id)}>确认</Btn>}
                {item.status === 'pending' && item.conflictWith !== undefined && (
                  <Btn onClick={() => { const keep = item.conflictWith; if (keep !== undefined) mergeInto(item.id, keep) }}>合并重复</Btn>
                )}
                {editingId === item.id
                  ? <><Btn kind="primary" onClick={() => void saveEdit(item.id)}>保存</Btn><Btn onClick={cancelEdit}>取消</Btn></>
                  : <Btn onClick={() => startEdit(item)}>编辑</Btn>}
                {item.status !== 'archived' && item.status !== 'superseded' && item.status !== 'rejected' && (
                  confirmingId === item.id
                    ? <><Btn kind="danger" onClick={() => void confirmArchive(item.id)}>确认归档</Btn><Btn onClick={cancelArchive}>取消</Btn></>
                    : <Btn kind="danger" onClick={() => askArchive(item.id)}>归档</Btn>
                )}
                <Btn onClick={() => togglePin(item)}>{item.pinned === true ? '取消置顶' : '置顶'}</Btn>
                {item.status === 'archived'
                  ? <><Btn onClick={() => restoreOne(item.id)}>恢复</Btn><Btn kind="danger" onClick={() => purgeOne(item.id)}>彻底清除</Btn></>
                  : null}
                <Btn onClick={() => toggleNeighbors(item.id)}>{openIds.has(item.id) ? '收起' : '关系'}</Btn>
                {deleteId === item.id
                  ? <><Btn kind="danger" onClick={() => void confirmDelete(item.id)}>确认移入回收站</Btn><Btn onClick={cancelDelete}>取消</Btn></>
                  : <Btn onClick={() => askDelete(item.id)}>移入回收站</Btn>}
              </div>
              {openIds.has(item.id) && (
                <div className="nx-neighbors">
                  {neighbors[item.id] === undefined || neighbors[item.id]?.loading === true
                    ? <div className="nx-n-item">加载中…</div>
                    : neighbors[item.id]?.error !== undefined
                      ? <div className="nx-n-item">关系查询失败：{neighbors[item.id]?.error}</div>
                      : (neighbors[item.id]?.list ?? []).length === 0
                        ? <div className="nx-n-item">暂无关联记忆。</div>
                        : (neighbors[item.id]?.list ?? []).map((n, i) => (
                            <div className="nx-n-item" key={i}><span className="nx-n-edge">{n.edge ?? '相关'}</span>{n.atom?.statement ?? n.other ?? ''}</div>
                          ))}
                </div>
              )}
            </div>
          ))}
      </div>

      <footer className="nx-footer">
        {state !== null && <div className="nx-footer-meta">注入 {state.cost.inject.inputTokens}/{state.cost.inject.outputTokens} tok · 提炼 {state.cost.extract.inputTokens}/{state.cost.extract.outputTokens} tok</div>}
        <div>记忆保存在本机 <code>~/.dsh/nexus</code>；也可用 <code>/memory list</code>、<code>/memory search</code> 在会话中查看。</div>
      </footer>
    </div>
  )
}