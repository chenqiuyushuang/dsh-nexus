import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const ref = readFileSync(root + '_shots/reference-modal.html', 'utf8')
const port = 9391
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-refshot', '--window-size=1000,1000', 'about:blank'], { stdio: 'ignore' })
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
listeners.push((m) => {
  if (m.method !== 'Fetch.requestPaused') return
  const { requestId, request } = m.params
  if (/reference-modal\.html$/.test(request.url)) void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(ref, 'utf8').toString('base64') })
  else void send('Fetch.continueRequest', { requestId })
})
await send('Page.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
await send('Page.setDeviceMetricsOverride', { width: 828, height: 772, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:3080/reference-modal.html' })
await new Promise((r) => setTimeout(r, 2500))
const m = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const modal = document.querySelector('.modal')
  const content = document.querySelector('.content')
  const list = document.querySelector('.list-container')
  const item = document.querySelector('.list-item')
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } }
  return { win: [window.innerWidth, window.innerHeight], modal: box(modal), content: box(content), list: box(list), item: box(item), itemPad: getComputedStyle(item.querySelector('.list-item-main')).padding, modalPad: getComputedStyle(content).padding, gap: getComputedStyle(content).gap }
})()` })
console.log(JSON.stringify(m.result?.result?.value ?? m, null, 1))
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) writeFileSync(root + '_shots/reference-sample.png', Buffer.from(shot.result.data, 'base64'))
socket.close(); proc.kill()
