/**
 * 嵌入式面板预览与实测：复刻 DSH「设置」弹窗里的窄栏（默认 418x448），
 * 用 CDP 的 Fetch 拦截把 /nexus 换成当前本地构建，再在 iframe 内量真实布局并截图。
 *
 * 用法：node scripts/panel-preview.mjs [--width 418] [--height 448] [--font 14] [--dark]
 *        [--out _shots/embedded.png] [--stub-state] [--expand-inject] [--open-settings] [--select-first] [--fixed]
 *   --stub-state  给 /state 补上新字段（today/noise/valueGateShadow），用于本地验证「运行中的服务还是旧代码」的情况
 *   --fixed       宿主拒绝长高（压测最坏情况）
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback }
const width = Number(arg('width', '418'))
const height = Number(arg('height', '448'))
const font = arg('font', '14')
const out = arg('out', '_shots/embedded.png')
const dark = process.argv.includes('--dark')
const fixedHost = process.argv.includes('--fixed')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const html = readFileSync(fileURLToPath(new URL('../lib/nexus.html', import.meta.url)), 'utf8')
const resize = fixedHost
  ? ''
  : 'var f=document.getElementById("f");f.style.height=Math.min(e.data.height,620)+"px";'
const harness = '<!doctype html><html><head><meta charset="utf-8"><style>html{font-size:' + font + 'px}html,body{margin:0;background:#111}iframe{border:0;display:block}</style></head><body' + (dark ? ' data-ds-dark-theme' : '') + '>' +
  '<iframe id="f" src="/nexus" style="width:' + String(width) + 'px;height:' + String(height) + 'px"></iframe>' +
  '<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="nexus-height"){window.__panelHeight=e.data.height;' + resize + '}})<\/script></body></html>'
const port = Number(arg('port', '9336'))
const profile = fileURLToPath(new URL('../_shots/chrome-profile/', import.meta.url))
mkdirSync(dirname(fileURLToPath(new URL('../' + out, import.meta.url))), { recursive: true })

const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
async function ready() { for (let i = 0; i < 60; i += 1) { try { const r = await fetch('http://127.0.0.1:' + String(port) + '/json/version'); if (r.ok) return } catch { /* 等待 */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Chrome 未就绪') }
await ready()
const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
const page = targets.find((t) => t.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const listeners = []
socket.onmessage = (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  for (const listener of listeners) listener(msg)
}
await new Promise((resolve) => { socket.onopen = resolve })
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })

const stubSource = `(() => {
  const orig = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const target = typeof input === 'string' ? input : (input && input.url) || ''
    const res = await orig(input, init)
    if (target.indexOf('/nexus/api/state') >= 0) {
      const data = await res.clone().json()
      data.today = { line: '今日写入 2 条 · 待确认 1 · 拒收 3 条 · 注入 5 次 / 2780 B', saved: 2, pending: 1, rejected: 3, injections: 5, injectedBytes: 2780 }
      data.noise = { count: 27, ids: ['a'] }
      data.valueGateShadow = { accept: 4, review: 2, reject: 31, updatedAt: Date.now() }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return res
  }
})()`

listeners.push((msg) => {
  if (msg.method !== 'Fetch.requestPaused') return
  const { requestId, request } = msg.params
  const url = request.url
  if (/\/harness$/.test(url)) {
    void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(harness, 'utf8').toString('base64') })
  } else if (/\/nexus$/.test(url)) {
    void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(html, 'utf8').toString('base64') })
  } else {
    void send('Fetch.continueRequest', { requestId })
  }
})

const clickInFrame = async (selector) => send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; const el = doc.querySelector(' + JSON.stringify(selector) + '); if (el) el.click(); return !!el })()' })

try {
  await send('Page.enable')
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  if (process.argv.includes('--stub-state')) await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/harness' })
  await new Promise((r) => setTimeout(r, 5000))
  if (process.argv.includes('--expand-inject')) { await clickInFrame('.nx-inject-bar'); await new Promise((r) => setTimeout(r, 600)) }
  if (process.argv.includes('--open-settings')) { await send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; const btn = [...doc.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "设置"); if (btn) btn.click(); return !!btn })()' }); await new Promise((r) => setTimeout(r, 800)) }
  // 场景：展开第一行（长记忆展开后的真实样子 —— 这正是我此前没看过的组合）
  if (process.argv.includes('--expand-row')) {
    await send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; const line = doc.querySelector(".nx-statement.folded"); if (line) line.click(); return !!line })()' })
    await new Promise((r) => setTimeout(r, 600))
  }
  // 场景：键盘导航焦点环（↑↓ 到第 2 行）
  if (process.argv.includes('--nav')) {
    // 键盘事件必须派发到 iframe 的 window（Input.dispatchKeyEvent 只到顶层文档，面板收不到）
    for (let i = 0; i < 2; i += 1) {
      await send('Runtime.evaluate', { expression: '(() => { const w = document.getElementById("f").contentWindow; w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); return true })()' })
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  // 场景：右键菜单（在第二行上派发 contextmenu）
  if (process.argv.includes('--ctx')) {
    await send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; const row = doc.querySelectorAll(".nx-row")[1]; if (!row) return false; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 16) })); return true })()' })
    await new Promise((r) => setTimeout(r, 700))
  }
  // 场景：参考稿绝对尺寸档（对照用；由面板 CSS 的 .reference-scale 类驱动）
  if (process.argv.includes('--reference-scale') || process.argv.includes('--row-scale')) {
    const cls = process.argv.includes('--reference-scale') ? 'reference-scale' : 'row-scale'
    await send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; const app = doc.querySelector(".nx-app"); if (app) app.classList.add("' + cls + '"); return !!app })()' })
    await new Promise((r) => setTimeout(r, 700))
  }
  if (process.argv.includes('--select-first')) {
    await send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; const row = doc.querySelector(".nx-row"); const cb = doc.querySelector(".nx-check"); window.__beforeTop = row ? Math.round(row.getBoundingClientRect().top) : null; if (cb) cb.click(); return window.__beforeTop })()' })
    await new Promise((r) => setTimeout(r, 700))
  }
  const expression = `(() => {
    const frame = document.getElementById('f')
    const doc = frame.contentDocument
    const win = frame.contentWindow
    const box = (selector) => { const el = doc.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) } }
    const rows = [...doc.querySelectorAll('.nx-row')]
    const list = doc.querySelector('.nx-list')
    const toolbar = doc.querySelector('.nx-toolbar')
    const first = rows[0]
    return {
      frame: { w: Math.round(win.innerWidth), h: Math.round(win.innerHeight) },
      panelReportedHeight: window.__panelHeight ?? null,
      sections: { header: box('.nx-header'), scopebar: box('.nx-scopebar'), scopeline: box('.nx-scopeline'), inject: box('.nx-inject'), noise: box('.nx-banner.noise'), stats: box('.nx-stats'), toolbar: box('.nx-toolbar'), settings: box('.nx-settings'), list: box('.nx-list'), footer: box('.nx-footer') },
      toolbarRows: toolbar ? new Set([...toolbar.children].map((c) => Math.round(c.getBoundingClientRect().top))).size : 0,
      toolbarItems: toolbar ? [...toolbar.children].map((c) => ((c.textContent || c.getAttribute('aria-label') || c.className).trim().slice(0, 10) + ':' + Math.round(c.getBoundingClientRect().width) + '@' + Math.round(c.getBoundingClientRect().top))) : [],
      statusItems: (() => { const bar = doc.querySelector('.nx-inject-bar'); return bar ? [...bar.children].map((c) => ((c.textContent || '').trim().slice(0, 10) + ':' + Math.round(c.getBoundingClientRect().width) + '@' + Math.round(c.getBoundingClientRect().top))) : [] })(),
      rowHeight: first ? Math.round(first.getBoundingClientRect().height) : null,
      pitch: rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top) : null,
      listH: list ? Math.round(list.getBoundingClientRect().height) : null,
      visibleRows: list && first ? Math.floor(list.getBoundingClientRect().height / (first.getBoundingClientRect().height + 6)) : 0,
      statementWidth: first ? Math.round((first.querySelector('.nx-statement')?.getBoundingClientRect().width ?? 0)) : null,
      docOverflow: doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
      headerTop: doc.querySelector('.nx-header') ? Math.round(doc.querySelector('.nx-header').getBoundingClientRect().top) : null,
      selectShift: (window.__beforeTop !== undefined && first) ? Math.round(first.getBoundingClientRect().top) - window.__beforeTop : null,
      batchVisible: !!doc.querySelector('.nx-batch'),
      noiseBanner: !!doc.querySelector('.nx-banner.noise'),
      scopelineText: doc.querySelector('.nx-scopeline') ? doc.querySelector('.nx-scopeline').textContent : null,
    }
  })()`
  const measured = await send('Runtime.evaluate', { expression, returnByValue: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) writeFileSync(fileURLToPath(new URL('../' + out, import.meta.url)), Buffer.from(shot.result.data, 'base64'))
  console.log(JSON.stringify(measured.result?.result?.value ?? measured, null, 2))
  console.log('截图: ' + out)
} finally {
  socket.close()
  proc.kill()
}
