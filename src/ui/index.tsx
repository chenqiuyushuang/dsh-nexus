/**
 * /nexus 面板浏览器入口：切换暗色（沿用 DSH 的 body[data-ds-dark-theme]），
 * 将 NexusPanel 挂到 #root。其余数据由 NexusPanel 从 /nexus/api/* 拉取。
 */
import { createRoot } from 'react-dom/client'
import { NexusPanel } from './NexusPanel.tsx'

function applyTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  document.body.toggleAttribute('data-ds-dark-theme', query.matches)
}
applyTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

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