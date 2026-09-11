/**
 * /nexus 面板浏览器入口：切换暗色（沿用 DSH 的 body[data-ds-dark-theme]），
 * 将 NexusPanel 挂到 #root。其余数据由 NexusPanel 从 /nexus/api/* 拉取。
 */
import { createRoot } from 'react-dom/client'
import { NexusPanel } from './NexusPanel.tsx'
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

const container = document.getElementById('root')
if (container !== null) createRoot(container).render(<NexusPanel />)

// 嵌入 DSH 设置面板 iframe 时，把内容高度回传给宿主，让 iframe 自适应高度、
// 自身不再产生滚动条（滚动统一交给外层设置面板，保持唯一滚动条）。
if (window.parent !== window) {
  // 嵌入态：html.embedded 让 CSS 切成「固定高 + 仅列表滚动」的模型
  document.documentElement.classList.add('embedded')
  // 高度上限：不再把无上限的 scrollHeight 推给宿主（UI 专家实测：80 行会把 iframe 撑到数千 px，
  // 头部 236px 全部滚出视野）。上限 620px，宿主若更矮则用宿主高度（由 nexus-viewport 消息告知）。
  let hostHeight = 0
  const report = (): void => {
    const cap = hostHeight > 0 ? Math.min(620, Math.max(320, hostHeight - 24)) : 480
    const height = Math.min(document.documentElement.scrollHeight, cap)
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