/**
 * /nexus 面板浏览器入口：切换暗色（沿用 DSH 的 body[data-ds-dark-theme]），
 * 将 NexusPanel 挂到 #root。其余数据由 NexusPanel 从 /nexus/api/* 拉取。
 */
import { createRoot } from 'react-dom/client'
import { NexusPanel } from './NexusPanel.tsx'
import { SamplePanel } from './SamplePanel.tsx'
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

// V0.7 复刻档对照入口：?panel=sample 用样例 1:1 复刻版，默认仍是旧面板。
// 两边并存，确认复刻档没问题后再切默认、删旧组件。
const container = document.getElementById('root')
const useSample = new URLSearchParams(window.location.search).get('panel') === 'sample'
if (container !== null) createRoot(container).render(useSample ? <SamplePanel /> : <NexusPanel />)

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
    const app = document.querySelector('.nx-app')
    const list = document.querySelector('.nx-list')
    let chrome = 0
    if (app !== null) {
      const style = getComputedStyle(app)
      chrome += Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      for (const child of app.children) {
        if (child === list) continue
        const rect = child.getBoundingClientRect()
        const margin = Number.parseFloat(getComputedStyle(child).marginBottom)
        chrome += rect.height + (Number.isFinite(margin) ? margin : 0)
      }
    }
    const firstRow = list?.querySelector('.nx-row')
    const pitch = (firstRow !== null && firstRow !== undefined ? firstRow.getBoundingClientRect().height : 44) + 6
    const listDesired = list === null ? 0 : Math.min(list.scrollHeight, pitch * 6)
    return Math.ceil(chrome + Math.max(listDesired, 160) + 8)
  }
  const report = (): void => {
    // 宿主没告知可用高度时按 620 申请（面板自身会滚，宿主不认也不会更差）
    const cap = hostHeight > 0 ? Math.min(620, Math.max(320, hostHeight - 24)) : 620
    const height = Math.min(desiredHeight(), cap)
    window.parent.postMessage({ type: 'nexus-height', height }, '*')
  }
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; height?: unknown } | null
    if (data?.type === 'nexus-viewport' && typeof data.height === 'number' && data.height > 0) {
      hostHeight = data.height
      report()
    }
  })
  new ResizeObserver(report).observe(document.documentElement)
  report()
}