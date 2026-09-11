/**
 * 参考稿布局原语（样例 HTML 的结构）：卡片 / 列表容器 / 状态卡 / 骨架屏 / 空态。
 * 这些是"外壳"，不含业务逻辑 —— 数据与交互仍由 NexusPanel 注入，便于单测与复用。
 */
import type { ReactNode } from 'react'

/** 参考稿 .list-container：一张卡片把表头与条目包在一起。 */
export function ListCard({ header, children }: { header?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="nx-listcard">
      {header !== undefined && <div className="nx-listcard-head">{header}</div>}
      {children}
    </div>
  )
}

/** 参考稿 .status-card：既是计数也是筛选入口（点一下 = 按该状态过滤）。 */
export interface StatusCardDef { key: string; label: string; value: number | string; tone?: 'ok' | 'warn' | 'bad'; }
export function StatusCards({ cards, active, onPick }: { cards: StatusCardDef[]; active: string; onPick: (key: string) => void }): ReactNode {
  return (
    <div className="nx-status-cards" role="group" aria-label="按状态筛选">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          className={'nx-status-card' + (card.tone !== undefined ? ' ' + card.tone : '') + (active === card.key ? ' on' : '')}
          aria-pressed={active === card.key}
          onClick={() => onPick(card.key)}
        >
          <span className="nx-status-card-label">{card.label}</span>
          <span className="nx-status-card-value">{card.value}</span>
        </button>
      ))}
    </div>
  )
}

/** 参考稿的骨架屏：加载时给形状而不是一句「加载中…」，避免布局跳动。 */
export function Skeleton({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="nx-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="nx-skeleton-item" key={index}>
          <div className="nx-skeleton-box" />
          <div className="nx-skeleton-lines"><i /><i className="short" /></div>
        </div>
      ))}
    </div>
  )
}

/** 参考稿的空态/错误态：图标 + 标题 + 说明 + 可选重试。 */
export function StateBox({ tone = 'empty', icon, title, hint, action }: { tone?: 'empty' | 'error'; icon: 'search' | 'alert'; title: string; hint?: string; action?: ReactNode }): ReactNode {
  return (
    <div className={'nx-statebox ' + tone} role={tone === 'error' ? 'alert' : undefined}>
      {icon === 'search'
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
      <p className="nx-statebox-title">{title}</p>
      {hint !== undefined && <p className="nx-statebox-hint">{hint}</p>}
      {action}
    </div>
  )
}

/** 参考稿 .progress-section：分段占用条 + 图例。 */
export function ProgressCard({ label, badge, segments, legend, foot }: {
  label: string
  badge?: ReactNode
  segments: Array<{ key: string; ratio: number }>
  legend: ReactNode
  foot?: ReactNode
}): ReactNode {
  return (
    <section className="nx-progress">
      <div className="nx-progress-head">
        <span>{label}</span>
        {badge}
      </div>
      <div className="nx-progress-track">
        {segments.filter((s) => s.ratio > 0).map((s) => (
          <i key={s.key} className={'nx-seg-' + s.key} style={{ flexGrow: Math.max(0.02, s.ratio), flexBasis: 0 }} />
        ))}
      </div>
      <div className="nx-progress-legend">{legend}</div>
      {foot !== undefined && <div className="nx-progress-foot">{foot}</div>}
    </section>
  )
}
