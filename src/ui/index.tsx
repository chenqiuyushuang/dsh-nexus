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
  const report = (): void => {
    window.parent.postMessage({ type: 'nexus-height', height: document.documentElement.scrollHeight }, '*')
  }
  new ResizeObserver(report).observe(document.documentElement)
  report()
}
