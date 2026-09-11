import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const ref = readFileSync(root + '_shots/reference-modal.html', 'utf8')
const nexus = readFileSync(root + 'lib/nexus.html', 'utf8')
const port = 9401
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-cmp', '--window-size=1000,1000', 'about:blank'], { stdio: 'ignore' })
async function ready() { for (let i = 0; i < 60; i += 1) { try { const r = await fetch('http://127.0.0.1:' + String(port) + '/json/version'); if (r.ok) return } catch { } await new Promise((r) => setTimeout(r, 500)) } throw new Error('no chrome') }
await ready()
const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
const socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const listeners = []
socket.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return } for (const l of listeners) l(m) }
await new Promise((r) => { socket.onopen = r })
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); socket.send(JSON.stringify({ id, method, params })) })
const host = (src, h) => '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0A0A0A}iframe{border:0;display:block;width:780px;height:' + h + 'px}</style></head><body><iframe id="f" src="' + src + '"></iframe></body></html>'
listeners.push((m) => {
  if (m.method !== 'Fetch.requestPaused') return
  const { requestId, request } = m.params
  const url = request.url
  const ok = (body) => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(body, 'utf8').toString('base64') })
  if (/\/host-ref$/.test(url)) void ok(host('http://127.0.0.1:3080/frame-ref', 720))
  else if (/\/host-cur$/.test(url)) void ok(host('http://127.0.0.1:3080/frame-cur', 720))
  else if (/\/frame-ref$/.test(url)) void ok(ref)
  else if (/\/frame-cur$/.test(url)) void ok(nexus)
  else void send('Fetch.continueRequest', { requestId })
})
const probe = `(() => {
  const d = document.getElementById('f').contentDocument
  const pick = (sel, props) => { const el = d.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs.getPropertyValue(p); return o }
  return {
    card: pick('.progress-section, .nx-progress', ['background-color', 'border-top-color', 'border-top-width', 'border-radius', 'padding']),
    title: pick('.progress-header span, .nx-progress-head span', ['font-size', 'color']),
    item: pick('.list-item-main, .nx-row-head', ['padding', 'background-color']),
    itemTitle: pick('.item-title, .nx-row-title', ['font-size', 'line-height', 'color']),
    itemSub: pick('.item-sub, .nx-row-sub', ['font-size', 'color']),
    tag: pick('.tag, .nx-tag', ['font-size', 'padding', 'border-radius', 'color', 'background-color', 'border-top-width']),
    cardBg: pick('.list-container, .nx-listcard', ['background-color', 'border-top-color', 'border-radius']),
    pageBg: pick('body', ['background-color', 'color', 'font-size'])
  }
})()`
await send('Page.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await send('Page.navigate', { url: 'http://127.0.0.1:3080/host-ref' })
await new Promise((r) => setTimeout(r, 3000))
const a = await send('Runtime.evaluate', { expression: probe, returnByValue: true })
await send('Page.navigate', { url: 'http://127.0.0.1:3080/host-cur' })
await new Promise((r) => setTimeout(r, 3500))
const b = await send('Runtime.evaluate', { expression: probe, returnByValue: true })
console.log(JSON.stringify({ sample: a.result?.result?.value, panel: b.result?.result?.value }, null, 1))
socket.close(); proc.kill()
