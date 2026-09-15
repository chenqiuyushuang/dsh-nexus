import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(root + '_shots/debugserver.log', 'utf8'))?.[1]
const port = 9607
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-debug4', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
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
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:3199/?token=' + token })
await new Promise((r) => setTimeout(r, 6000))
await evaluate("[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '设置')?.click()")
await new Promise((r) => setTimeout(r, 1200))
await evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find((b) => (b.textContent || '').trim() === '记忆')?.click()")
await new Promise((r) => setTimeout(r, 2000))
await evaluate("document.querySelector('iframe[title=\"Nexus 记忆面板\"]').contentDocument.querySelector('.status-strip').click()")
await new Promise((r) => setTimeout(r, 1500))
const diag = await evaluate("(() => { const f = document.querySelector('iframe[title=\"Nexus 记忆面板\"]'); const d = f.contentDocument; const el = d.querySelector('.nx-b'); const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { cls: el.className, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, bw: cs.borderTopWidth, bc: cs.borderTopColor, h: Math.round(r.height), w: Math.round(r.width) } })()")
console.log('root:', JSON.stringify(diag))
socket.close(); proc.kill()