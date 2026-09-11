import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(root + 'lib/nexus.html', 'utf8')
const port = 9361
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(root + '_shots', { recursive: true })
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--remote-debugging-port=' + String(port), '--user-data-dir=' + root + '_shots/chrome-profile-dbg2', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
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
const host = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}#f{border:0;width:418px;height:448px}</style></head><body><iframe id="f" src="/nexus"></iframe></body></html>'
listeners.push((m) => {
  if (m.method !== 'Fetch.requestPaused') return
  const { requestId, request } = m.params
  const body = /\/nexus$/.test(request.url) ? html : (/harness$/.test(request.url) ? host : null)
  if (body !== null) void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(body, 'utf8').toString('base64') })
  else void send('Fetch.continueRequest', { requestId })
})
await send('Page.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
await send('Page.navigate', { url: 'http://127.0.0.1:3080/harness' })
await new Promise((r) => setTimeout(r, 4500))
const out = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const d = document.getElementById('f').contentDocument
  const box = (sel) => { const el = d.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { sel, h: Math.round(r.height), minH: cs.minHeight, flex: cs.flex, overflow: cs.overflowY, display: cs.display } }
  const rows = [...d.querySelectorAll('.nx-row')].map((r) => Math.round(r.getBoundingClientRect().height))
  return {
    html: Math.round(d.documentElement.getBoundingClientRect().height),
    body: Math.round(d.body.getBoundingClientRect().height),
    app: box('.nx-app'), progress: box('.nx-progress'), cards: box('.nx-status-cards'),
    toolbar: box('.nx-toolbar'), listcard: box('.nx-listcard'), list: box('.nx-list'),
    firstRow: box('.nx-row'), disclosure: box('.nx-row .nx-disclosure'),
    title: (() => { const el = d.querySelector('.nx-row-title'); if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), display: cs.display, clamp: cs.webkitLineClamp, orient: cs.webkitBoxOrient, lh: cs.lineHeight, fs: cs.fontSize } })(),
    sub: (() => { const el = d.querySelector('.nx-row-sub'); return el ? Math.round(el.getBoundingClientRect().height) : null })(),
    head: (() => { const el = d.querySelector('.nx-row-head'); return el ? { h: Math.round(el.getBoundingClientRect().height), display: getComputedStyle(el).display, wrap: getComputedStyle(el).flexWrap, align: getComputedStyle(el).alignItems } : null })(),
    rowChildren: [...d.querySelector('.nx-row').children].map((el) => {
      const cs = getComputedStyle(el); const b = el.getBoundingClientRect()
      return { cls: (el.className || '').toString().slice(0, 30), tag: el.tagName, h: Math.round(b.height), w: Math.round(b.width), top: Math.round(b.top), bt: cs.borderTop, bb: cs.borderBottom, bg: cs.backgroundColor }
    }),
    hscroll: [...d.querySelectorAll('*')].map((el) => {
      const sw = el.scrollWidth; const cw = el.clientWidth
      if (sw <= cw + 1) return null
      const b = el.getBoundingClientRect()
      return { cls: (el.className || '').toString().slice(0, 34), tag: el.tagName, sw, cw, h: Math.round(b.height), top: Math.round(b.top), ox: getComputedStyle(el).overflowX }
    }).filter(Boolean),
    row: (() => {
      const r = d.querySelector('.nx-row')
      const parts = [...r.querySelectorAll('*')].map((el) => {
        const b = el.getBoundingClientRect()
        const sw = el.scrollWidth
        const cw = el.clientWidth
        return (sw > cw + 1) ? { cls: el.className.toString().slice(0, 40), tag: el.tagName, sw, cw, right: Math.round(b.right) } : null
      }).filter(Boolean)
      return { clientW: r.clientWidth, scrollW: r.scrollWidth, offsetW: r.offsetWidth, overflowing: parts.slice(0, 8), headScrollW: r.querySelector('.nx-row-head').scrollWidth, headClientW: r.querySelector('.nx-row-head').clientWidth, mainW: Math.round(r.querySelector('.nx-row-main').getBoundingClientRect().width), titleW: Math.round(r.querySelector('.nx-row-title').getBoundingClientRect().width), rawW: (() => { const el = r.querySelector('.nx-rawtext'); return el ? Math.round(el.getBoundingClientRect().width) : null })() }
    })(),
    rows
  }
})()` })
console.log(JSON.stringify(out.result?.result?.value ?? out, null, 1))
socket.close(); proc.kill()
