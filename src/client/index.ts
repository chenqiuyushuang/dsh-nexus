/**
 * Nexus 浏览器端（./client）：
 * 1. 注册设置面板第 5 项「记忆」（脑图标，host 设置弹窗导航行的第 5 行）；
 * 2. 内容为内嵌 iframe（/nexus 面板由 host webServer 提供，单一实现）；
 * 3. Shell 的导航图标按 section id 硬编码映射（models/plugins/agent-presets），
 *    未知 id 回退为齿轮 —— 不改 DSH 源码的前提下，用 DOM 补丁把本行的齿轮
 *    换成大脑 SVG（幂等 + MutationObserver 应对再渲染，失败时优雅回退齿轮）。
 *
 * @module @chenqiuyushuang/dsh-nexus/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: slots 服务类型合并（ctx.slots）与 settings.section 槽位声明。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement, useEffect, useState } from 'react'

/** 设置项导航标签。 */
const NAV_LABEL = '记忆'
/** 设置项 id（唯一，驱动 only 过滤与导航选中态）。 */
const SECTION_ID = 'memory'
/** 第 5 个设置项（general 0 / models 10 / plugins 15 / agent-presets 20）。 */
const SECTION_ORDER = 30

/** Cordis 服务依赖：仅需 slots（ui-slots 为 shell 基线，无需声明图形注入边）。 */
export const inject = ['slots']

/**
 * 设置页内容：内嵌 host 提供的 /nexus 面板（同一来源，免构建、免重复 UI）。
 */
function MemorySection(): ReturnType<typeof createElement> {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: unknown; height?: unknown } | null
      if (data?.type === 'nexus-height' && typeof data.height === 'number' && data.height > 0) setHeight(data.height)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])
  return createElement('iframe', {
    src: '/nexus',
    title: 'Nexus 记忆面板',
    style: {
      width: '100%',
      height: height > 0 ? height : 480,
      minHeight: 480,
      border: 'none',
      borderRadius: 0,
      display: 'block',
    },
  })
}

/**
 * 浏览器端插件入口。
 * @param ctx - 浏览器 cordis 上下文。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: () => NAV_LABEL,
  }, MemorySection))

  ctx.effect(() => {
    patchBrainIcon()
    const observer = new MutationObserver(() => { patchBrainIcon() })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, 'nexus: settings brain icon')
}

/** 把设置弹窗导航中的「记忆」行齿轮图标替换为大脑 SVG（幂等，可重入）。 */
function patchBrainIcon(): void {
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    const nav = dialog.querySelector('nav')
    if (nav === null) continue
    for (const button of nav.querySelectorAll('button')) {
      if (button.getAttribute('data-nexus-icon') === 'brain') continue
      const label = button.querySelector('span')
      if (label === null || (label.textContent ?? '').trim() !== NAV_LABEL) continue
      const icon = button.querySelector('svg')
      if (icon === null) continue
      button.replaceChild(brainSvg(), icon)
      button.setAttribute('data-nexus-icon', 'brain')
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 大脑图标（24 视图框线性描边，跟随 currentColor 主题色）。 */
function brainSvg(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const half = (d: string): SVGPathElement => {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    return path
  }
  svg.append(
    half('M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z'),
    half('M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z'),
    half('M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4'),
  )
  return svg
}