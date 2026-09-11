/**
 * 包体门禁：机器把关「这个 tarball 里到底装了什么、是不是当前构建」。
 *
 * 为什么需要：file: tarball 是这个插件的实际分发方式，而这个开发周期里已经踩过两次坑 ——
 * ① 同名同版本 → pnpm 认为无需更新（装上的是旧包）；② 包体内容与 lib/ 不一致（忘了重建）。
 * 二者都只能靠机器发现。
 *
 * 用法：npm run check:pack（CI 里也跑）
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []
const notes = []

// 1) 允许进包的文件（package.json 的 files 字段就是白名单）
const allow = (pkg.files ?? []).map((entry) => String(entry).replace(/^\.\//, ''))
const alwaysAllowed = ['package.json', 'README.md', 'LICENSE']
const isAllowed = (path) => alwaysAllowed.includes(path) || allow.some((entry) => path === entry || path.startsWith(entry.replace(/\/$/, '') + '/'))

const dry = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }))[0]
const paths = dry.files.map((file) => file.path)

// 2) 不允许泄露源码/测试/脚本/截图
for (const path of paths) {
  if (!isAllowed(path)) problems.push('包里有不该发布的文件：' + path)
}

// 3) 必需文件必须在
for (const required of ['package.json', 'lib/index.js', 'lib/client.js', 'lib/nexus.html', 'cordis.patch.yml']) {
  if (!paths.includes(required)) problems.push('缺少必需文件：' + required)
}

// 4) 中间产物不该进包（lib/nexus-ui.js 只是构建中间物，HTML 已内联）
if (paths.includes('lib/nexus-ui.js')) problems.push('包里有构建中间产物 lib/nexus-ui.js（应只在本地产出）')

// 5) 内容一致性：包里的 lib/* 必须与工作区当前构建逐字节一致
const dir = mkdtempSync(join(tmpdir(), 'nexus-pack-'))
try {
  execFileSync('npm', ['pack', '--pack-destination', dir], { cwd: root, stdio: 'ignore' })
  const tgz = join(dir, execFileSync('ls', [dir], { encoding: 'utf8' }).trim().split('\n')[0])
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/nexus.html']) {
    const fromPack = execFileSync('tar', ['-xzOf', tgz, 'package/' + file])
    const onDisk = readFileSync(join(root, file))
    if (!fromPack.equals(onDisk)) problems.push('包里的 ' + file + ' 与工作区构建不一致（忘了 npm run build？）')
  }
  // 6) 体积上限（防止误把 node_modules/截图打进包）
  const sizeLimit = 512 * 1024
  if (dry.size > sizeLimit) problems.push('包体 ' + dry.size + ' B 超过上限 ' + sizeLimit + ' B')
  else notes.push('包体 ' + dry.size + ' B（上限 ' + sizeLimit + ' B）· 含 ' + String(paths.length) + ' 个文件')
  rmSync(dir, { recursive: true, force: true })
} catch (error) {
  problems.push('打包失败：' + String(error && error.message ? error.message : error))
}

// 7) 版本与包名自检
notes.push('包名 ' + pkg.name + ' · 版本 ' + pkg.version)
if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(pkg.name)) problems.push('包名不规范：' + pkg.name)

for (const note of notes) console.log('· ' + note)
for (const path of paths.sort()) console.log('  ' + path)
if (problems.length > 0) {
  console.error('\n包体门禁未通过：')
  for (const problem of problems) console.error('  ✖ ' + problem)
  process.exit(1)
}
console.log('\n包体门禁通过：内容与当前构建一致、无泄露、无中间产物。')