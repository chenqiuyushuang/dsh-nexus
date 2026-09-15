import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(root + '_shots/debugserver.log', 'utf8'))?.[1]
const port = 9601
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-debug', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
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
const errors = []
listeners.push((m) => { if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? '').slice(0, 160)) })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:3199/?token=' + token })
await new Promise((r) => setTimeout(r, 6000))
const probe = "(() => { const btns = [...document.querySelectorAll('button')].map((b) => ((b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 14) || b.className.toString().slice(0, 20))); return { title: document.title, url: location.href, buttons: btns.slice(0, 40), hasDialog: !!document.querySelector('[role=\"dialog\"]'), bodyLen: document.body.innerText.length } })()"
const out = await send('Runtime.evaluate', { expression: probe, returnByValue: true })
console.log(JSON.stringify(out.result?.result?.value, null, 1))
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) writeFileSync(root + '_shots/debug-01-home.png', Buffer.from(shot.result.data, 'base64'))
console.log('errors:', errors.length ? errors.join(' | ') : 'none')
socket.close(); proc.kill()