/**
 * /nexus 面板浏览器入口：切换暗色（沿用 DSH 的 body[data-ds-dark-theme]），
 * 将 BPanel 挂到 #root。其余数据由 BPanel 从 /nexus/api/* 拉取。
 *
 * **单一实现**：0.6 的 NexusPanel 与样例复刻档 SamplePanel 已删除（`?panel=old` /
 * `?panel=sample` 两个入口一并移除）。它们的能力要么已移植进 BPanel（逐条一键修法、
 * 成本明细），要么属于被后续版本推翻的中间产物；留着只会让同一个面板有三份真相。
 */
import { createRoot } from 'react-dom/client'
import { BPanel } from './BPanel.tsx'
import { applyContentFontSize, fontSizeFromQuery, isDarkTheme, pickContentFontSize } from './theme.ts'

// B7：主题跟随宿主（同源 iframe 读宿主的 data-ds-dark-theme，跨域回退系统偏好）
function hostIsDark(): boolean | undefined {
  try {
    if (window.parent !== window) return window.parent.document.body.hasAttribute('data-ds-dark-theme')
  } catch { /* 跨域 */ }
  return undefined
}

function applyTheme(): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.body.toggleAttribute('data-ds-dark-theme', isDarkTheme(hostIsDark(), prefersDark))
}

// 宿主切换主题时同步（设置面板里改主题不必刷新）
try {
  if (window.parent !== window) new MutationObserver(applyTheme).observe(window.parent.document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
} catch { /* 跨域 */ }
applyTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

// B7：字号跟随宿主（同源 iframe 才读得到；跨域/异常一律回退默认 14px）
function applyHostFontSize(): void {
  const fromQuery = fontSizeFromQuery(window.location.search)
  if (fromQuery !== undefined) { applyContentFontSize(fromQuery); return }
  try {
    if (window.parent !== window) {
      const host = window.parent.document.documentElement
      applyContentFontSize(pickContentFontSize(window.parent.getComputedStyle(host).fontSize))
    }
  } catch { /* 跨域 iframe：用默认字号 */ }
}
applyHostFontSize()

// 单一实现：只有 BPanel，不再有 ?panel= 路由
const container = document.getElementById('root')
if (container !== null) {
  createRoot(container).render(<BPanel />)
}

// 嵌入 DSH 设置面板 iframe 时，把内容高度回传给宿主，让 iframe 自适应高度、
// 自身不再产生滚动条（滚动统一交给外层设置面板，保持唯一滚动条）。
if (window.parent !== window) {
  // 嵌入态：html.embedded 让 CSS 切成「固定高 + 仅列表滚动」的模型
  document.documentElement.classList.add('embedded')
  // 高度上限：不再把无上限的 scrollHeight 推给宿主（UI 专家实测：80 行会把 iframe 撑到数千 px，
  // 头部 236px 全部滚出视野）。上限 620px，宿主若更矮则用宿主高度（由 nexus-viewport 消息告知）。
  let hostHeight = 0
  /**
   * 期望高度 = 列表以外各区块的真实高度 + 列表期望高度（最多 6 行）。
   * 不能用 documentElement.scrollHeight：.nx-app 是 height:100%，scrollHeight 恒等于
   * 当前 iframe 高度 → 面板只会「保持原样」，永远长不大（实测上报 448 = 当前高度）。
   */
  const desiredHeight = (): number => {
    // 单一实现后只剩面板 B（.nx-b）：常驻状态条 + 面板内的 .panel-body。
    // 旧面板（.nx-app/.nx-list）的分支已随它们一起删除 —— 留着只会误导。
    const bRoot = document.querySelector('.nx-b')
    if (bRoot === null) return 168
    const strip = bRoot.querySelector('.status-strip') as HTMLElement | null
    const panel = bRoot.querySelector('.panel') as HTMLElement | null
    if (panel === null) return Math.ceil((strip?.getBoundingClientRect().height ?? 44) + 8)
    // 面板打开：直接吃满宿主可用高（内容多高交给内部滚动）。
    // 之前是按"内容高（最多 6 张卡）"算，结果宿主里只报到 471，而设置弹窗有 800 高，
    // 面板下方白留一大片（用户实拍指出）。
    if (bRoot.classList.contains('panel-open')) {
      return hostHeight > 0 ? hostHeight : window.innerHeight
    }
    const body = bRoot.querySelector('.panel-body') as HTMLElement | null
    const panelChrome = panel.getBoundingClientRect().height - (body?.getBoundingClientRect().height ?? 0)
    const card = bRoot.querySelector('.mem-card') as HTMLElement | null
    const want = card !== null ? card.getBoundingClientRect().height * 6 : 360
    const scroll = body?.scrollHeight ?? 0
    const bodyWant = Math.min(scroll, want)
    return Math.ceil(panelChrome + Math.max(bodyWant, 200) + 16)
  }
  const report = (): void => {
    const cap = hostHeight > 0 ? Math.min(2000, Math.max(320, hostHeight)) : 2000
    const height = Math.min(desiredHeight(), cap)
    window.parent.postMessage({ type: 'nexus-height', height }, '*')
  }
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; height?: unknown } | null
    if (data?.type === 'nexus-viewport' && typeof data.height === 'number' && data.height > 0) {
      hostHeight = data.height
      // 面板填满宿主给的可用高；宿主没给就吃满 iframe（CSS 的 max-height 回退 100%）
      document.documentElement.style.setProperty('--nx-b-available', String(data.height) + 'px')
      report()
    }
  })
  new ResizeObserver(report).observe(document.documentElement)
  report()
}