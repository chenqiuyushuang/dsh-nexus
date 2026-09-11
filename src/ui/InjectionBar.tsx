/**
 * B4 注入真相条：回答「这条记忆进不进上下文、为什么、怎么修」。
 *
 * 交互约定（UI 专家团）：折叠态一行给出 行数/字节/预算/未进入数；展开后分两组
 * （已进入 / 没进入，后者按原因分组），每行只给一个最相关的动作，3 步内可答。
 * 文案必须诚实：这里指的是「此刻新开一个会话会注入什么」，并写明同会话刷新规则。
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Btn, Select, Tag } from './components.tsx'

export interface InjectionEntryView {
  id: string
  slot: string
  scope: string
  status: string
  subject: string
  statement: string
  bytes: number
  pinned: boolean
  weight: number
  projectRef?: string
}
export interface InjectionDropView extends InjectionEntryView { reason: string; detail: string }
export interface InjectionTruthView {
  budgetBytes: number
  header: string
  bytes: number
  textBytes: number
  lines: number
  omitted: number
  pinned: number
  project: string
  shown: InjectionEntryView[]
  dropped: InjectionDropView[]
  counts: Record<string, number>
  /** 已归档/已取代条数（彻底出局，不计入「未进入」）。 */
  archived?: number
}
export interface ProjectRefView { ref: string; active: number; total: number; updatedAt: number }

/** 原因分组：顺序 = 用户最该先处理的排在前面。 */
const REASON: Array<{ key: string; title: string; hint: string; tone: string }> = [
  { key: 'unknown-project', title: '归属未知', hint: '项目记忆没有项目归属，按隔离规则永不注入。指派项目后立刻生效。', tone: 'bad' },
  { key: 'oversize', title: '单条超预算', hint: '单条比整个注入预算还大，永远进不去。缩短到预算内才会进。', tone: 'bad' },
  { key: 'budget', title: '被挤掉（预算已满）', hint: '预算被前面的条目占满。置顶可以插队，但会挤掉别人；也可以精简内容。', tone: 'warn' },
  { key: 'other-project', title: '属于其他项目', hint: '作用域隔离：本项目会话不会看到别的项目的记忆。归属写错可以改。', tone: '' },
  { key: 'episode', title: '会话记忆', hint: '只在产生它的那次会话里注入，新会话看不到。要长期可见就改成用户级。', tone: '' },
  { key: 'inactive', title: '非活跃状态', hint: '待确认/冲突/已归档/已取代的记忆不参与注入。', tone: '' },
]

/** 估算一条记忆写进索引行后的字节（含前缀、槽位、权重后缀；精确值由服务端 renderIndexLine 决定）。 */
function estimateLineBytes(entry: InjectionEntryView, statement: string): number {
  const line = '- [' + entry.slot + '] ' + entry.subject + '：' + statement + ' [w' + entry.weight + ']'
  return new TextEncoder().encode(line).length
}

export function InjectionBar({ truth, projects, project, counts, detail, onProject, onPin, onAssign, onScope, onSave, onLoad, onConfirm, defaultOpen }: {
  /** 初始展开（测试与深链用）。 */
  defaultOpen?: boolean
  truth?: InjectionTruthView
  projects: ProjectRefView[]
  project: string
  onProject: (ref: string) => void
  onPin: (id: string, pinned: boolean) => void
  onAssign: (id: string, ref: string) => void
  onScope: (id: string, scope: string) => void
  onSave: (id: string, statement: string, scope: string) => void
  /** 取全文（列表里的 statement 是预览；缩短前必须换成全文，否则一编辑就截断）。 */
  onLoad?: (id: string) => Promise<string>
  onConfirm: (id: string) => void
  /** 合并进状态条的计数（窄栏里省掉一整行 chips）。 */
  counts?: { active: number; pending: number; conflicts: number }
  /** 摘要行（在用 N 条 / 跨项目分布 / 今日流量）：窄栏里移进展开区，别在顶部堆三层数字。 */
  detail?: string
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen === true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  if (truth === undefined) return null
  const percent = Math.min(100, Math.round((truth.bytes / Math.max(1, truth.budgetBytes)) * 100))
  const groups = REASON
    .map((meta) => ({ meta, rows: truth.dropped.filter((drop) => drop.reason === meta.key) }))
    .filter((group) => group.rows.length > 0)
  const editSeq = useRef(0)
  const startEdit = (entry: InjectionEntryView): void => {
    const seq = (editSeq.current += 1)
    setEditId(entry.id)
    setEditText(entry.statement)
    if (onLoad === undefined) return
    // 用户可能已经开始打字：只有仍停在同一条时才用全文覆盖预览
    void onLoad(entry.id)
      .then((full) => { if (editSeq.current === seq) setEditText(full) })
      .catch(() => {})
  }
  const saveEdit = (entry: InjectionEntryView): void => {
    const next = editText.trim()
    if (next === '') return
    onSave(entry.id, next, entry.scope)
    setEditId(null)
  }
  const renderRow = (entry: InjectionEntryView & { reason?: string; detail?: string }, isShown: boolean): ReactNode => (
    <div className={'nx-inject-row' + (isShown ? ' in' : '')} key={(isShown ? 'in:' : 'out:') + entry.id}>
      <div className="nx-inject-main">
        {/* 主语与正文重复时只显示一次（与注入行同一规则） */}
        {!entry.statement.startsWith(entry.subject) && <div className="nx-inject-subject">{entry.subject}</div>}
        <div className="nx-inject-statement">{entry.statement}</div>
      </div>
      <div className="nx-inject-side">
        <Tag text={entry.scope === 'user' ? '跨项目' : entry.scope === 'project' ? '本项目' : '本会话'} className="scope" />
        {entry.pinned && <Tag text="置顶" />}
        {/* 只有「已进入」的条目才谈得上吃预算；被挤掉的条目本身没占位 */}
        <span className={'nx-inject-bytes' + (isShown && entry.bytes / Math.max(1, truth.budgetBytes) >= 0.3 ? ' heavy' : '')}>
          {entry.bytes > 0 ? entry.bytes + ' B · ' + Math.round((entry.bytes / Math.max(1, truth.budgetBytes)) * 100) + '%' : '—'}
        </span>
      </div>
      {editId === entry.id && (
        <div className="nx-inject-edit">
          <textarea className="nx-edit" rows={3} value={editText} onChange={(event) => setEditText(event.target.value)} autoFocus />
          <div className="nx-inject-edit-meta">
            本条写入索引约 {estimateLineBytes(entry, editText)} B · 预算 {truth.budgetBytes} B
            {estimateLineBytes(entry, editText) > truth.budgetBytes ? '（仍超预算，继续缩短）' : '（可进入）'}
          </div>
          <div className="nx-actions">
            <Btn kind="primary" onClick={() => saveEdit(entry)}>保存</Btn>
            <Btn onClick={() => setEditId(null)}>取消</Btn>
          </div>
        </div>
      )}
      {editId !== entry.id && (
        <div className="nx-inject-actions">
          {/* 吃预算的「已进入」条目也要能就地缩短 */}
          {isShown && entry.bytes / Math.max(1, truth.budgetBytes) >= 0.3 && <Btn onClick={() => startEdit(entry)}>缩短</Btn>}
          {entry.reason === 'unknown-project' || entry.reason === 'other-project'
            ? <Btn kind="primary" onClick={() => onAssign(entry.id, project)}>指派到当前项目</Btn>
            : null}
          {entry.reason === 'episode' ? <Btn onClick={() => onScope(entry.id, 'user')}>改为用户级</Btn> : null}
          {entry.reason === 'inactive' && (entry.status === 'pending' || entry.status === 'needs-review')
            ? <Btn kind="primary" onClick={() => onConfirm(entry.id)}>确认</Btn>
            : null}
          {entry.reason === 'budget' ? <Btn onClick={() => onPin(entry.id, true)}>置顶插队</Btn> : null}
          {entry.reason === 'oversize' || entry.reason === 'budget' ? <Btn onClick={() => startEdit(entry)}>缩短</Btn> : null}
        </div>
      )}
    </div>
  )
  return (
    <section className="nx-inject" aria-label="上下文注入真相">
      <button type="button" className="nx-inject-bar" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="nx-inject-meter" aria-hidden="true"><i style={{ width: percent + '%' }} /></span>
        <span className="nx-inject-title">进入上下文</span>
        <b>注入 {truth.lines} 条</b>
        <span className="nx-dim">·</span>
        <b>{truth.bytes} B</b>
        <span className="nx-dim">/ {truth.budgetBytes} B</span>
        {truth.pinned > 0 && <Tag text={'置顶 ' + truth.pinned} />}
        <span className={truth.dropped.length > 0 ? 'nx-inject-badge warn' : 'nx-inject-badge'}>未进入 {truth.dropped.length}</span>
        {counts !== undefined && (
          <span className="nx-status-counts">在用 {counts.active} · 待确认 {counts.pending} · 冲突 {counts.conflicts}</span>
        )}
        {(truth.archived ?? 0) > 0 && <span className="nx-inject-badge">已归档 {truth.archived}</span>}
        <span className="nx-inject-caret" aria-hidden="true">{open ? '收起' : '为什么'}</span>
      </button>
      {open && (
        <div className="nx-inject-body">
          {detail !== undefined && detail !== '' && <div className="nx-inject-note">{detail}</div>}
          <div className="nx-inject-note">
            这是「此刻新开一个会话」会注入的真实内容：声明 + {truth.lines} 条记忆，共 {truth.textBytes} B。
            同一会话内只在首轮、内容变化或超过刷新间隔时才重新注入。
          </div>
          <div className="nx-inject-project">
            <span className="nx-dim">当前项目</span>
            <Select ariaLabel="当前项目" value={project} onChange={(value) => onProject(value)} options={
              projects.length === 0 ? [{ value: project, label: project }] : projects.map((row) => ({ value: row.ref, label: row.ref + '（活跃 ' + row.active + '/' + row.total + '）' }))
            } />
          </div>
          <div className="nx-inject-group">
            <div className="nx-inject-group-head">
              <b>已进入（{truth.shown.length} 条）</b>
              <span className="nx-dim">
                {truth.bytes} B / {truth.budgetBytes} B（{Math.round((truth.bytes / Math.max(1, truth.budgetBytes)) * 100)}%）
                · 剩余 {Math.max(0, truth.budgetBytes - truth.bytes)} B
              </span>
            </div>
            {truth.shown.length === 0 ? <div className="nx-empty">没有记忆进入上下文。</div> : [...truth.shown].sort((a, b) => b.bytes - a.bytes).map((entry) => renderRow(entry, true))}
            {truth.shown.some((entry) => entry.bytes / Math.max(1, truth.budgetBytes) >= 0.3) && (
              <div className="nx-hint">
                标黄的条目吃掉了 30% 以上预算 —— 缩短它就能把位置让给其他记忆（点这一行右侧的「缩短」）。
              </div>
            )}
          </div>
          {groups.map((group) => (
            <div className="nx-inject-group" key={group.meta.key}>
              <div className="nx-inject-group-head">
                <b className={group.meta.tone === '' ? undefined : 'nx-inject-tone-' + group.meta.tone}>{group.meta.title}（{group.rows.length}）</b>
                <span className="nx-dim">{group.meta.hint}</span>
              </div>
              {group.rows.map((entry) => renderRow(entry, false))}
            </div>
          ))}
          {truth.dropped.length === 0 && <div className="nx-empty">全部活跃记忆都已进入上下文。</div>}
          {(truth.archived ?? 0) > 0 && (
            <div className="nx-inject-note">另有 {truth.archived} 条已归档/已取代，已彻底退出注入范围（不限时间也不会进上下文）。</div>
          )}
        </div>
      )}
    </section>
  )
}
