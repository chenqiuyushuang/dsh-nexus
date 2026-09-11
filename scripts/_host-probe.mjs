import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const port = 9381
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-h2', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
async function ready() { for (let i = 0; i < 60; i += 1) { try { const r = await fetch('http://127.0.0.1:' + String(port) + '/json/version'); if (r.ok) return } catch { } await new Promise((r) => setTimeout(r, 500)) } throw new Error('no chrome') }
await ready()
const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
const socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
socket.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => { socket.onopen = r })
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); socket.send(JSON.stringify({ id, method, params })) })
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:3080/' })
await new Promise((r) => setTimeout(r, 8000))
const geom = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const geo = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), display: c.display, cols: c.gridTemplateColumns, overflow: c.overflow, maxW: c.maxWidth } }
  const iframe = document.querySelector('iframe[title="Nexus 记忆面板"]')
  const chain = []
  let node = iframe
  for (let i = 0; i < 6 && node; i += 1) { chain.push(geo(node)); node = node.parentElement }
  return { winW: window.innerWidth, dialog: geo(dlg), dialogChildren: dlg ? [...dlg.children].map(geo) : null, iframeChain: chain, hasDialog: !!dlg, bodyText: document.body.innerText.slice(0, 120) }
})()` })
console.log(JSON.stringify(geom.result?.result?.value ?? geom, null, 1))
socket.close(); proc.kill()
