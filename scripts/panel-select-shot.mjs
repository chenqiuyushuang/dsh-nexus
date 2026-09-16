/**
 * 下拉控件实测：把本地构建的面板塞进 iframe（Fetch 拦截替换 /nexus），量下拉触发器与
 * **展开后的弹层**的真实盒模型/配色，并截图。
 *
 * 为什么单独一个工具：下拉的样子只有真的渲染出来才看得见 —— 用户两次反馈「下拉形式不好看 /
 * 和整体风格不搭配」，第一次只按 CSS 算术修（appearance:none + 自绘雪佛龙）没修到点上：
 * 露馅的是**弹层**，而它是系统菜单，只看 CSS 看不出来。改 Select.tsx 后请务必跑一遍。
 *
 * 用法：
 *   node scripts/panel-select-shot.mjs --tab library             # 收起的触发器（3x 放大裁剪）
 *   node scripts/panel-select-shot.mjs --tab settings --open 0   # 点开第 0 个触发器，截整屏 2x
 * 选项：--tab library|settings|trash|attribution  --open <n>  --out <png>  --width/--height  --port
 * 输出：控件盒模型 + 计算样式 JSON、弹层几何（含 gap：正数=在触发器下方，负数=在上方）与截图路径。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d }
const width = Number(arg('width', '418'))
const height = Number(arg('height', '620'))
const out = arg('out', '_shots/panel-select.png')
const tab = arg('tab', 'library')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const html = readFileSync(fileURLToPath(new URL('../lib/nexus.html', import.meta.url)), 'utf8')
const port = Number(arg('port', '9337'))
const profile = fileURLToPath(new URL('../_shots/chrome-profile-sel/', import.meta.url))
mkdirSync(fileURLToPath(new URL('../_shots/', import.meta.url)), { recursive: true })

const harness = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#111}iframe{border:0;display:block}</style></head><body>' +
  '<iframe id="f" src="/nexus" style="width:' + String(width) + 'px;height:' + String(height) + 'px"></iframe></body></html>'

const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
  '--remote-debugging-port=' + String(port), '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
async function ready() { for (let i = 0; i < 60; i += 1) { try { const r = await fetch('http://127.0.0.1:' + String(port) + '/json/version'); if (r.ok) return } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Chrome 未就绪') }
await ready()
const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
const page = targets.find((t) => t.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const listeners = []
socket.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return } for (const l of listeners) l(m) }
await new Promise((r) => { socket.onopen = r })
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); socket.send(JSON.stringify({ id, method, params })) })

listeners.push((msg) => {
  if (msg.method !== 'Fetch.requestPaused') return
  const { requestId, request } = msg.params
  if (/\/harness$/.test(request.url)) {
    void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(harness, 'utf8').toString('base64') })
  } else if (/\/nexus(\?|$)/.test(request.url)) {
    void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(html, 'utf8').toString('base64') })
  } else void send('Fetch.continueRequest', { requestId })
})

const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: '(() => { const doc = document.getElementById("f").contentDocument; ' + expr + ' })()', returnByValue: true })
  return r.result?.result?.value
}

try {
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 3, mobile: false })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/harness' })
  await new Promise((r) => setTimeout(r, 5000))
  await evalIn('const s = doc.querySelector(".status-strip"); if (s) s.click(); return !!s')
  await new Promise((r) => setTimeout(r, 900))
  const label = tab === 'library' ? '记忆库' : tab === 'trash' ? '回收站' : tab === 'settings' ? '设置' : '归因'
  await evalIn('const b = [...doc.querySelectorAll(".tab")].find((x) => (x.textContent || "").indexOf(' + JSON.stringify(label) + ') >= 0); if (b) b.click(); return !!b')
  await new Promise((r) => setTimeout(r, 800))

  const measured = await evalIn(`
    const snap = (sel) => [...doc.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      return { sel, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 14),
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        bg: cs.backgroundColor, bgImage: cs.backgroundImage === 'none' ? 'none' : 'svg', color: cs.color,
        border: cs.borderTopColor + ' ' + cs.borderTopWidth, radius: cs.borderTopLeftRadius,
        font: cs.fontSize + '/' + cs.lineHeight, pad: cs.padding, appearance: cs.appearance }
    })
    const rows = [...doc.querySelectorAll('.lib-toolbar, .setting-row')].map((row) => {
      const r = row.getBoundingClientRect()
      return { row: row.className, y: Math.round(r.top), h: Math.round(r.height),
        kids: [...row.children].map((c) => { const b = c.getBoundingClientRect(); return (c.className || c.tagName) + ':' + Math.round(b.height) + 'h@' + Math.round(b.top) + 'w' + Math.round(b.width) }) }
    })
    return { controls: [...snap('.lib-select'), ...snap('.lib-search'), ...snap('.setting-select'), ...snap('.setting-text'), ...snap('.mini-btn'), ...snap('.btn-add-new'), ...snap('.setting-row input[type=number]')], rows,
      html: doc.querySelector('.lib-toolbar') ? doc.querySelector('.lib-toolbar').outerHTML.replace(/\\s+/g, ' ').slice(0, 600) : (doc.querySelector('.setting-select') ? doc.querySelector('.setting-select').parentElement.outerHTML.replace(/\\s+/g, ' ').slice(0, 700) : null) }
  `)
  console.log(JSON.stringify(measured, null, 2))

  const openIndex = Number(arg('open', '-1'))
  if (openIndex >= 0) {
    const opened = await evalIn('const t = doc.querySelectorAll(".sel-trigger")[' + String(openIndex) + ']; if (t) t.click(); return !!t')
    await new Promise((r) => setTimeout(r, 600))
    console.log('open trigger ' + String(openIndex) + ': ' + String(opened))
    const popMeasure = await evalIn(`
      const pop = doc.querySelector('.sel-pop'); const trg = doc.querySelectorAll('.sel-trigger')[${String(openIndex)}]
      if (!pop) return { pop: null }
      const pr = pop.getBoundingClientRect(); const tr = trg.getBoundingClientRect()
      const cs = doc.defaultView.getComputedStyle(pop)
      return { pop: { x: Math.round(pr.left), y: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) },
        innerWidth: doc.defaultView.innerWidth, scrollW: doc.documentElement.clientWidth,
        css: { left: cs.left, top: cs.top, width: cs.width, minWidth: cs.minWidth, maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, transform: cs.transform },
        trigger: { x: Math.round(tr.left), y: Math.round(tr.top), w: Math.round(tr.width), h: Math.round(tr.height) },
        gap: Math.round(pr.top - tr.bottom), bg: getComputedStyle(pop).backgroundColor, radius: getComputedStyle(pop).borderTopLeftRadius,
        opts: [...pop.querySelectorAll('.sel-opt')].map((o) => (o.textContent || '').trim() + '@' + Math.round(o.getBoundingClientRect().height)) }
    `)
    console.log('POP ' + JSON.stringify(popMeasure))
  }

  const clip = await evalIn('const el = doc.querySelector(".lib-toolbar") || doc.querySelector(".settings-section"); const r = el.getBoundingClientRect(); const f = document.getElementById("f").getBoundingClientRect(); return { x: Math.round(f.left + r.left) - 8, y: Math.round(f.top + r.top) - 8, width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 }')
  const full = await evalIn('const f = document.getElementById("f").getBoundingClientRect(); return { x: Math.round(f.left), y: Math.round(f.top), width: Math.round(f.width), height: Math.round(f.height) }')
  const region = openIndex >= 0 ? full : clip
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...region, scale: openIndex >= 0 ? 2 : 3 } })
  if (shot.result?.data) writeFileSync(fileURLToPath(new URL('../' + out, import.meta.url)), Buffer.from(shot.result.data, 'base64'))
  console.log('截图: ' + out + ' clip=' + JSON.stringify(region))
} finally {
  socket.close()
  proc.kill()
}
