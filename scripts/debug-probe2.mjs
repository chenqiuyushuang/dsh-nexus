import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(root + '_shots/debugserver.log', 'utf8'))?.[1]
const port = 9603
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-debug2', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
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
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:3199/?token=' + token })
await new Promise((r) => setTimeout(r, 6000))
// 打开设置
await evaluate("[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '设置')?.click()")
await new Promise((r) => setTimeout(r, 1500))
const dlgInfo = await evaluate("(() => { const d = document.querySelector('[role=\"dialog\"]'); if (!d) return null; const btns = [...d.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 10)); const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), buttons: btns.slice(0, 12) } })()")
console.log('dialog:', JSON.stringify(dlgInfo))
// 点「记忆」
await evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find((b) => (b.textContent || '').trim() === '记忆')?.click()")
await new Promise((r) => setTimeout(r, 2500))
const frameInfo = await evaluate("(() => { const f = document.querySelector('iframe[title=\"Nexus 记忆面板\"]'); if (!f) return null; const r = f.getBoundingClientRect(); const p = f.parentElement; const pr = p.getBoundingClientRect(); const cs = getComputedStyle(p); return { iframe: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) }, parent: { w: Math.round(pr.width), h: Math.round(pr.height), pad: cs.padding, display: cs.display, overflow: cs.overflowY }, parentTag: p.tagName + '.' + (p.className || '').toString().slice(0, 40) } })()")
console.log('iframe:', JSON.stringify(frameInfo))
const inner = await evaluate("(() => { const f = document.querySelector('iframe[title=\"Nexus 记忆面板\"]'); const d = f.contentDocument; const B = (s) => { const el = d.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth } }; return { docH: d.documentElement.clientHeight, root: B('.nx-b'), strip: B('.status-strip'), panel: B('.panel'), overlay: B('.overlay') } })()")
console.log('inner:', JSON.stringify(inner))
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) writeFileSync(root + '_shots/debug-settings-closed.png', Buffer.from(shot.result.data, 'base64'))
// 点状态条展开面板
await evaluate("document.querySelector('iframe[title=\"Nexus 记忆面板\"]').contentDocument.querySelector('.status-strip').click()")
await new Promise((r) => setTimeout(r, 1200))
const expanded = await evaluate("(() => { const f = document.querySelector('iframe[title=\"Nexus 记忆面板\"]'); const d = f.contentDocument; const B = (s) => { const el = d.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius } }; return { iframeH: d.documentElement.clientHeight, root: B('.nx-b'), panel: B('.panel'), body: B('.panel-body') } })()")
console.log('expanded:', JSON.stringify(expanded))
const shot2 = await send('Page.captureScreenshot', { format: 'png' })
if (shot2.result?.data) writeFileSync(root + '_shots/debug-settings-open.png', Buffer.from(shot2.result.data, 'base64'))
console.log('errors:', errors.length ? errors.join(' | ') : 'none')
socket.close(); proc.kill()