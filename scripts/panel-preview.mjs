/**
 * 嵌入式面板预览与实测：复刻「设置」弹窗里的窄栏（约 372x460 CSS px），
 * 用 CDP 的 Fetch 拦截把 /nexus 换成当前本地构建，再在 iframe 内量真实布局。
 *
 * 用法：node scripts/panel-preview.mjs [--width 372] [--height 460] [--out _shots/embedded.png]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback }
const width = Number(arg('width', '372'))
const height = Number(arg('height', '460'))
const out = arg('out', '_shots/embedded.png')
const font = arg('font', '14')
const dark = process.argv.includes('--dark')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const html = readFileSync(fileURLToPath(new URL('../lib/nexus.html', import.meta.url)), 'utf8')
const harness = '<!doctype html><html><head><meta charset="utf-8"><style>html{font-size:' + font + 'px}html,body{margin:0;background:#111}iframe{border:0;display:block}</style></head><body>' +
  '<iframe id="f" src="/nexus" style="width:' + String(width) + 'px;height:' + String(height) + 'px"></iframe></body></html>'
// 宿主主题属性：面板在嵌入态跟随宿主的 data-ds-dark-theme（B7），测试宿主必须给上
const themedHarness = dark ? harness.replace('<body>', '<body data-ds-dark-theme>') : harness
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

listeners.push((msg) => {
  if (msg.method !== 'Fetch.requestPaused') return
  const { requestId, request } = msg.params
  const url = request.url
  if (/\/harness$/.test(url)) {
    void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(themedHarness, 'utf8').toString('base64') })
  } else if (/\/nexus$/.test(url)) {
    void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(html, 'utf8').toString('base64') })
  } else {
    void send('Fetch.continueRequest', { requestId })
  }
})

try {
  await send('Page.enable')
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/harness' })
  await new Promise((r) => setTimeout(r, 5000))
  const expression = `(() => {
    const frame = document.getElementById('f')
    const doc = frame.contentDocument
    const win = frame.contentWindow
    const box = (root, selector) => { const el = root.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) } }
    const rows = [...doc.querySelectorAll('.nx-row')]
    const list = doc.querySelector('.nx-list')
    const toolbar = doc.querySelector('.nx-toolbar')
    const toolbarRows = toolbar ? new Set([...toolbar.children].map((c) => Math.round(c.getBoundingClientRect().top))).size : 0
    const first = rows[0]
    return {
      frame: { w: Math.round(win.innerWidth), h: Math.round(win.innerHeight) },
      sections: { header: box(doc, '.nx-header'), scopebar: box(doc, '.nx-scopebar'), inject: box(doc, '.nx-inject'), stats: box(doc, '.nx-stats'), toolbar: box(doc, '.nx-toolbar'), decisions: box(doc, '.nx-decisions'), list: box(doc, '.nx-list'), footer: box(doc, '.nx-footer') },
      toolbarRows,
      rowHeight: first ? Math.round(first.getBoundingClientRect().height) : null,
      listH: list ? Math.round(list.getBoundingClientRect().height) : null,
      visibleRows: list && first ? Math.floor(list.getBoundingClientRect().height / (first.getBoundingClientRect().height + 6)) : 0,
      listScrolls: list ? list.scrollHeight > list.clientHeight + 2 : false,
      toolbarItems: toolbar ? [...toolbar.children].map((c) => ({ text: (c.textContent || '').trim().slice(0, 10), w: Math.round(c.getBoundingClientRect().width), row: Math.round(c.getBoundingClientRect().top) })) : [],
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
