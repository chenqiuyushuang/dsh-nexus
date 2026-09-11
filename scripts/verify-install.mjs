/**
 * 安装校验（P0 教训）：`file:` tarball 安装时，如果文件名与版本号都不变，
 * pnpm 会认为「无需更新」—— 实测用户重装后仍是旧副本。这个脚本负责回答：
 * 「我装的到底是哪个版本？和当前构建一致吗？」
 *
 * 用法：npm run verify:install
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const local = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const installedDir = join(homedir(), '.dsh/profiles/web/node_modules/@chenqiuyushuang/dsh-nexus')
const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex')

if (!existsSync(installedDir)) {
  console.log('未安装：' + installedDir)
  console.log('安装命令：dsh plugin --profile web add "file:' + join(root, 'dsh-nexus-' + local.version + '.tgz') + '"')
  process.exit(1)
}

const installed = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'))
let ok = true
console.log('本地构建版本: ' + local.version)
console.log('已安装版本  : ' + installed.version + (installed.version === local.version ? '  ✅' : '  ❌ 与本地不一致'))
if (installed.version !== local.version) ok = false
for (const file of ['lib/index.js', 'lib/nexus.html', 'lib/client.js']) {
  const a = md5(fileURLToPath(new URL('../' + file, import.meta.url)))
  const b = md5(join(installedDir, file))
  const same = a === b
  if (!same) ok = false
  console.log((same ? '  ✅ ' : '  ❌ ') + file + (same ? '' : '  已安装副本是旧的'))
}
try {
  const html = await (await fetch('http://127.0.0.1:3080/nexus')).text()
  const served = md5(Buffer.from(html))
  const localHtml = md5(fileURLToPath(new URL('../lib/nexus.html', import.meta.url)))
  const fresh = served === localHtml
  if (!fresh) ok = false
  console.log((fresh ? '  ✅ ' : '  ❌ ') + '运行中的服务返回的面板' + (fresh ? '' : ' 是旧版（改完要重启 dsh web）'))
} catch {
  console.log('  ⚠️  无法访问 http://127.0.0.1:3080/nexus（服务没在跑？）')
}
console.log(ok ? '\n一切就绪。' : '\n需要：dsh plugin --profile web add "file:' + join(root, 'dsh-nexus-' + local.version + '.tgz') + '" 然后重启 dsh web')
process.exit(ok ? 0 : 1)