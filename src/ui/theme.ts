/**
 * B7 主题跟随：把宿主的字号搬进面板（设置面板 iframe 与 /nexus 独立页共用）。
 * 纯函数便于单测；跨域读取失败时静默回退，绝不让面板因取字号而白屏。
 */

/** DSH 主题设置的字号范围（theme-settings：默认 14，范围 12-17）。 */
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 17
export const FONT_SIZE_DEFAULT = 14

/** 解析宿主字号（'15px' / '15' / 脏值），越界即夹到 12-17，无法解析用 14。 */
export function pickContentFontSize(hostValue: string | undefined | null): number {
  if (hostValue === undefined || hostValue === null) return FONT_SIZE_DEFAULT
  const parsed = Number.parseFloat(String(hostValue))
  if (!Number.isFinite(parsed)) return FONT_SIZE_DEFAULT
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(parsed)))
}

/** 主题判定：嵌入态跟随宿主的 data-ds-dark-theme，读不到才用系统偏好。 */
export function isDarkTheme(hostHasDarkAttribute: boolean | undefined, prefersDark: boolean): boolean {
  return hostHasDarkAttribute === undefined ? prefersDark : hostHasDarkAttribute
}

/** 应用字号到当前文档（幂等）。 */
export function applyContentFontSize(px: number): void {
  document.documentElement.style.setProperty('--nx-content-font-size', String(px) + 'px')
}

/** 从 URL 查询参数取字号（宿主也可显式传 ?fontSize=15）。 */
export function fontSizeFromQuery(search: string): number | undefined {
  const match = /[?&]fontSize=([^&]+)/.exec(search)
  if (match === null) return undefined
  return pickContentFontSize(decodeURIComponent(match[1]))
}
