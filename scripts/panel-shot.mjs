/**
 * 面板实测工具（P0 教训：UI 改动必须真的渲染出来看，不能只靠 CSS 算术）。
 *
 * 做法：用无头 Chrome 打开已安装的面板（拿到同源），再把本地 lib/nexus.html 注入同一个文档，
 * 这样相对 API 请求照样打到运行中的 DSH；然后量真实布局并截图。
 *
 * 用法：node scripts/panel-shot.mjs [--url http://127.0.0.1:3080/nexus] [--out _shots/panel.png] [--stub-noise]
 * 输出：JSON（视口/各区块位置高度/行高/行距/首屏行数）+ PNG 截图路径。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const url = arg('url', 'http://127.0.0.1:3080/nexus')
const out = arg('out', '_shots/panel.png')
const stubNoise = process.argv.includes('--stub-noise')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const html = readFileSync(new URL('../lib/nexus.html', import.meta.url), 'utf8')
const port = Number(arg('port', '9335'))
const profile = fileURLToPath(new URL('../_shots/chrome-profile/', import.meta.url))
mkdirSync(dirname(fileURLToPath(new URL('../' + out, import.meta.url))), { recursive: true })

const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
  '--remote-debugging-port=' + String(port), '--user-data-dir=' + profile, '--window-size=1080,760', 'about:blank'], { stdio: 'ignore' })

async function waitForChrome() {
  for (let i = 0; i < 60; i += 1) {
    try { const res = await fetch('http://127.0.0.1:' + String(port) + '/json/version'); if (res.ok) return } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Chrome 未就绪（检查 CHROME_PATH）')
}

await waitForChrome()
const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
const page = targets.find((target) => target.type === 'page')
if (page === undefined) throw new Error('没有可用的页面目标')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
socket.onmessage = (event) => { const msg = JSON.parse(String(event.data)); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } }
await new Promise((resolve) => { socket.onopen = resolve })
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })

try {
  await send('Page.enable')
  await send('Page.navigate', { url })
  await new Promise((resolve) => setTimeout(resolve, 2500))
  if (stubNoise) {
    await send('Runtime.evaluate', { expression: "(() => { const orig = window.fetch; window.fetch = async (input, init) => { const target = typeof input === 'string' ? input : (input && input.url) || ''; const res = await orig(input, init); if (target.indexOf('/nexus/api/state') >= 0) { const data = await res.clone().json(); data.noise = { count: 22, ids: ['stub-a', 'stub-b'] }; return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }) } return res }; return 'patched' })()" })
  }
  await send('Runtime.evaluate', { expression: 'document.open();document.write(' + JSON.stringify(html) + ');document.close();' })
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const expression = `(() => {
    const box = (selector) => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height) } }
    const rows = [...document.querySelectorAll('.nx-row')]
    const first = rows[0]
    const list = document.querySelector('.nx-list')
    const pitch = rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top) : null
    return {
      viewport: innerHeight,
      sections: { header: box('.nx-header'), scopebar: box('.nx-scopebar'), inject: box('.nx-inject'), noise: box('.nx-banner.noise'), stats: box('.nx-stats'), toolbar: box('.nx-toolbar'), list: box('.nx-list') },
      rows: rows.length,
      rowHeight: first ? Math.round(first.getBoundingClientRect().height) : null,
      pitch,
      rowsAboveFold: list && first && pitch ? Math.floor((innerHeight - list.getBoundingClientRect().top) / pitch) : null,
      noiseBanner: !!document.querySelector('.nx-banner.noise'),
      tallButtons: [...document.querySelectorAll('.nx-btn')].filter((b) => b.getBoundingClientRect().height > 36).map((b) => (b.textContent || '').trim().slice(0, 12) + ':' + Math.round(b.getBoundingClientRect().height)),
    }
  })()`
  const measured = await send('Runtime.evaluate', { expression, returnByValue: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const target = fileURLToPath(new URL('../' + out, import.meta.url))
  if (shot.result?.data) writeFileSync(target, Buffer.from(shot.result.data, 'base64'))
  console.log(JSON.stringify(measured.result?.result?.value ?? measured, null, 2))
  console.log('截图: ' + out)
} finally {
  socket.close()
  proc.kill()
}