import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(root + '_shots/debugserver.log', 'utf8'))?.[1]
const port = 9609
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-debug5', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); if (s.result?.data) writeFileSync(root + '_shots/' + name, Buffer.from(s.result.data, 'base64')) }
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:3199/?token=' + token })
await new Promise((r) => setTimeout(r, 6000))
// 关掉内测声明
for (const label of ['继续', '稍后配置', '关闭']) {
  await evaluate("[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '" + label + "')?.click()")
  await new Promise((r) => setTimeout(r, 600))
}
await new Promise((r) => setTimeout(r, 800))
await evaluate("[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '设置')?.click()")
await new Promise((r) => setTimeout(r, 1500))
await evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find((b) => (b.textContent || '').trim() === '记忆')?.click()")
await new Promise((r) => setTimeout(r, 2200))
const closed = await evaluate("(() => { const f = document.querySelector('iframe[title=\"Nexus 记忆面板\"]'); const r = f.getBoundingClientRect(); const d = f.contentDocument; const el = d.querySelector('.nx-b'); const cs = getComputedStyle(el); const strip = d.querySelector('.status-strip')?.getBoundingClientRect(); const dlg = document.querySelector('[role=\"dialog\"]').getBoundingClientRect(); return { dialog: { w: Math.round(dlg.width), h: Math.round(dlg.height) }, iframe: { w: Math.round(r.width), h: Math.round(r.height) }, rootH: Math.round(el.getBoundingClientRect().height), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, strip: strip ? { h: Math.round(strip.height), w: Math.round(strip.width) } : null } })()")
console.log('CLOSED', JSON.stringify(closed))
await shot('real-01-closed.png')
await evaluate("document.querySelector('iframe[title=\"Nexus 记忆面板\"]').contentDocument.querySelector('.status-strip').click()")
await new Promise((r) => setTimeout(r, 1500))
const open = await evaluate("(() => { const f = document.querySelector('iframe[title=\"Nexus 记忆面板\"]'); const r = f.getBoundingClientRect(); const d = f.contentDocument; const el = d.querySelector('.nx-b'); const cs = getComputedStyle(el); const panel = d.querySelector('.panel').getBoundingClientRect(); const body = d.querySelector('.panel-body').getBoundingClientRect(); const dlg = document.querySelector('[role=\"dialog\"]').getBoundingClientRect(); return { iframe: { w: Math.round(r.width), h: Math.round(r.height) }, root: { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor }, panelBottom: Math.round(panel.bottom), bodyBottom: Math.round(body.bottom), docScroll: d.documentElement.scrollHeight, dialog: { h: Math.round(dlg.height) } } })()")
console.log('OPEN', JSON.stringify(open))
await shot('real-02-open.png')
socket.close(); proc.kill()