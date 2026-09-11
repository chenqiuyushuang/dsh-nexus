/**
 * 对齐实测：把「参考稿」和「当前 Nexus 面板」放进同一个窄栏（默认 418px）截图。
 * 用法：node scripts/ref-compare.mjs [--width 418] [--height 448] [--dark]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback }
const width = Number(arg('width', '418'))
const height = Number(arg('height', '448'))
const dark = process.argv.includes('--dark')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = fileURLToPath(new URL('../', import.meta.url))
const refFile = arg('ref', '_shots/reference-modal.html')
const ref = readFileSync(root + refFile, 'utf8')
const nexus = readFileSync(root + 'lib/nexus.html', 'utf8')
const shotTag = arg('tag', String(width))
const port = Number(arg('port', '9341'))
mkdirSync(root + '_shots', { recursive: true })

const page = (inner) => '<!doctype html><html' + (dark ? ' data-ds-dark-theme' : '') + '><head><meta charset="utf-8"><style>html,body{margin:0;background:#0A0A0A}#f{border:0;display:block;width:' + width + 'px;height:' + height + 'px}</style></head><body><iframe id="f" src="' + inner + '"></iframe></body></html>'

const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-ref', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
async function ready() { for (let i = 0; i < 60; i += 1) { try { const r = await fetch('http://127.0.0.1:' + String(port) + '/json/version'); if (r.ok) return } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Chrome not ready') }
await ready()
const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
const target = targets.find((t) => t.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const listeners = []
socket.onmessage = (event) => { const msg = JSON.parse(String(event.data)); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return } for (const l of listeners) l(msg) }
await new Promise((resolve) => { socket.onopen = resolve })
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })

const harness = (src) => page(src)

listeners.push((msg) => {
  if (msg.method !== 'Fetch.requestPaused') return
  const { requestId, request } = msg.params
  const url = request.url
  const html = (body) => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(body, 'utf8').toString('base64') })
  if (/\/host-ref$/.test(url)) void html(harness('http://127.0.0.1:3080/frame-ref'))
  else if (/\/host-cur$/.test(url)) void html(harness('http://127.0.0.1:3080/frame-cur'))
  else if (/\/frame-ref$/.test(url)) void html(ref)
  else if (/\/frame-cur$/.test(url)) void html(nexus)
  else void send('Fetch.continueRequest', { requestId })
})
const measureSrc = "(() => {\n  const inview = (d, sel) => { const el = d.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { sel, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) } }\n  const sels = ['h2', '.progress-section', '.status-grid', '.settings-panel', '.list-toolbar', '.list-container', '.footer', '.nx-header', '.nx-inject', '.nx-scopeline', '.nx-toolbar', '.nx-list', '.nx-footer']\n  const f = document.getElementById('f')\n  const d = f.contentDocument\n  const root = d.documentElement\n  const boxes = sels.map((s) => inview(d, s)).filter(Boolean)\n  return {\n    docScrollH: root.scrollHeight,\n    docClientH: root.clientHeight,\n    overflow: root.scrollHeight - root.clientHeight,\n    hScroll: root.scrollWidth - root.clientWidth,\n    boxes,\n    belowFold: boxes.filter((b) => b.top + b.h > root.clientHeight).map((b) => b.sel),\n    text: (d.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300)\n  }\n})()"
try {
  await send('Page.enable')
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/host-ref' })
  await new Promise((r) => setTimeout(r, 3000))
  const shotRef = await send('Page.captureScreenshot', { format: 'png' })
  if (shotRef.result?.data) writeFileSync(root + '_shots/ref-' + shotTag + '.png', Buffer.from(shotRef.result.data, 'base64'))
  const mRef = await send('Runtime.evaluate', { expression: measureSrc, returnByValue: true })
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/host-cur' })
  await new Promise((r) => setTimeout(r, 3000))
  const shotCur = await send('Page.captureScreenshot', { format: 'png' })
  if (shotCur.result?.data) writeFileSync(root + '_shots/cur-' + shotTag + '.png', Buffer.from(shotCur.result.data, 'base64'))
  const mCur = await send('Runtime.evaluate', { expression: measureSrc, returnByValue: true })
  console.log(JSON.stringify({ width, ref: mRef.result?.result?.value, cur: mCur.result?.result?.value }, null, 2))
} finally { socket.close(); proc.kill() }
