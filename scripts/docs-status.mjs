/**
 * 文档状态门禁：把「文档说实现了什么」变成机器可核对的事实。
 *
 * 为什么需要它：本仓库出过一类反复发生的偏差 —— 文档按设计稿写「已实现」，
 * 而代码只落了模块、没接线（`runLifecycle` 有实现有单测、全仓零调用点），
 * 或者配置项被解析但没人读（`coldArchive` / `sessionModeDefault` / `mode`），
 * 或者功能只落在非默认面板上（一键修法 / 按字节降序 / 成本）。人读文档看不出来。
 *
 * 机制（对齐本项目「无度量不上线」的自我要求）：
 *   1. `docs/status.json` 是唯一事实源：每条能力声明状态 + 若干「探针」；
 *   2. 探针是可执行的代码事实查询（符号有没有调用点、某字符串在不在、数量对不对）；
 *   3. `npm run docs:status` 依据注册表生成 `docs/IMPLEMENTATION-STATUS.md`；
 *   4. `npm run docs:check` 校验「注册表声明 == 代码事实」且「生成物与注册表一致」，
 *      任一漂移即退出码 1 —— CI 与 pre-commit 都会拦。
 *
 * 于是：改代码导致状态变化 → 探针失败 → 必须回来改注册表 → 文档自动重生成。
 *
 * 用法：
 *   node scripts/docs-status.mjs            # 生成 IMPLEMENTATION-STATUS.md
 *   node scripts/docs-status.mjs --check    # 校验（漂移即失败）
 *   node scripts/docs-status.mjs --explain  # 打印每个探针的实测值（起草注册表用）
 *
 * @module scripts/docs-status
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const REGISTRY = 'docs/status.json'
const OUTPUT = 'docs/IMPLEMENTATION-STATUS.md'

const argv = new Set(process.argv.slice(2))
const MODE = argv.has('--check') ? 'check' : argv.has('--explain') ? 'explain' : 'write'

/** 扫描时永远跳过的目录（本地环境、缓存、构建产物、历史归档）。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'lib', 'dist', '.pnpm-store', '.npm-cache',
  '_archive', '_dsh_test', '_shots', '_testhome', '.dsh-repair', '.backup-history', '.npmx', 'bench',
])
const SOURCE_RE = /\.(?:ts|tsx|mjs|js|yml|yaml|json)$/

/** 探针作用域 → 目录（`src-except-config` 额外排除 config.ts 自身）。 */
const SCOPES = {
  src: { dirs: ['src'] },
  'src-except-config': { dirs: ['src'], exclude: ['src/config.ts'] },
  tests: { dirs: ['tests'] },
  bench: { dirs: ['bench'] },
  ci: { dirs: ['.github'] },
}

/** 源文件缓存：同一作用域只读一次盘。 */
const fileCache = new Map()
function collect(scope) {
  if (fileCache.has(scope)) return fileCache.get(scope)
  const spec = SCOPES[scope]
  if (spec === undefined) throw new Error('unknown scope: ' + scope)
  const files = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full)
        continue
      }
      if (!SOURCE_RE.test(entry.name)) continue
      const rel = relative(root, full).split(sep).join('/')
      if ((spec.exclude ?? []).includes(rel)) continue
      files.push({ path: rel, text: readFileSync(full, 'utf8') })
    }
  }
  for (const dir of spec.dirs) walk(join(root, dir))
  files.sort((left, right) => left.path.localeCompare(right.path))
  fileCache.set(scope, files)
  return files
}

function scopeText(scope) {
  return collect(scope).map(file => file.text).join('\n')
}

function countMatches(text, pattern) {
  const re = new RegExp(pattern, 'g')
  return (text.match(re) ?? []).length
}

function readFileIfExists(rel) {
  const full = join(root, rel)
  if (!existsSync(full) || !statSync(full).isFile()) return undefined
  return readFileSync(full, 'utf8')
}

/**
 * 评估一个探针，返回实测值（boolean 或 number）。
 * 探针只做四类事实查询，刻意保持简单——复杂度全在注册表里，不在引擎里。
 */
function observe(probe) {
  switch (probe.kind) {
    case 'symbol-called': {
      // 有调用点 = `sym(` 的出现次数 减去 `function sym(` 定义次数 > 0
      const text = scopeText(probe.scope ?? 'src')
      const total = countMatches(text, '\\b' + probe.symbol + '\\s*\\(')
      const defs = countMatches(text, 'function\\s+' + probe.symbol + '\\s*\\(')
      return total - defs > 0
    }
    case 'text-present': {
      if (probe.file !== undefined) {
        const text = readFileIfExists(probe.file)
        if (text === undefined) return false
        return new RegExp(probe.pattern).test(text)
      }
      return new RegExp(probe.pattern).test(scopeText(probe.scope ?? 'src'))
    }
    case 'count': {
      let text = probe.file !== undefined
        ? (readFileIfExists(probe.file) ?? '')
        : scopeText(probe.scope ?? 'src')
      // `between` 把计数限制在一个区间内（例如「Config 接口里到底有几个旋钮」），
      // 否则同一文件里其它接口的可选字段会一起被数进来，指标就失去意义。
      if (Array.isArray(probe.between)) {
        const start = text.indexOf(probe.between[0])
        const end = start < 0 ? -1 : text.indexOf(probe.between[1], start + probe.between[0].length)
        text = start < 0 || end < 0 ? '' : text.slice(start, end)
      }
      return countMatches(text, probe.pattern)
    }
    case 'file-exists':
      return readFileIfExists(probe.path) !== undefined
    default:
      throw new Error('unknown probe kind: ' + String(probe.kind))
  }
}

const STATUS_META = {
  implemented: { icon: '✅', label: '已实现', order: 0 },
  partial: { icon: '⚠️', label: '部分实现', order: 1 },
  inconsistent: { icon: '⚠️', label: '与文档不一致', order: 2 },
  dead: { icon: '🧟', label: '有代码未接线', order: 3 },
  missing: { icon: '❌', label: '未实现', order: 4 },
  removed: { icon: '🗑️', label: '承诺已撤销', order: 5 },
}

function statusMeta(status) {
  const meta = STATUS_META[status]
  if (meta === undefined) throw new Error('unknown status: ' + status)
  return meta
}

/**
 * 处置决定：状态回答「现在怎样」，处置回答「打算怎么办」。
 * 两者的相容性由 DISPOSITION_ALLOWS 约束 —— 例如 `keep` 只能配 `implemented`，
 * 免得出现「状态是未实现、处置却是保持现状」这种自相矛盾的登记。
 */
const DISPOSITION_META = {
  keep: { icon: '—', label: '保持', order: 0 },
  'fix-code': { icon: '🔧', label: '改代码', order: 1 },
  'fix-docs': { icon: '📄', label: '改文档', order: 2 },
  delete: { icon: '🗑️', label: '删', order: 3 },
  defer: { icon: '⏸️', label: '推迟', order: 4 },
}

/**
 * 相容性表的实质约束只有一条：**`keep` 当且仅当 `implemented`**。
 * 已经正确的功能不需要「改代码」，没实现的功能当然要靠「改代码」补 —— 所以
 * `fix-code` 必须允许 `missing`。其余组合只排除语义上不成立的配对。
 */
const DISPOSITION_ALLOWS = {
  // keep = 「无需再动作」，因此既覆盖已实现，也覆盖已按决定删除的承诺
  keep: ['implemented', 'removed'],
  'fix-code': ['missing', 'partial', 'inconsistent', 'dead'],
  'fix-docs': ['missing', 'partial', 'inconsistent'],
  delete: ['missing', 'partial', 'inconsistent', 'dead'],
  defer: ['missing', 'partial', 'dead'],
}

function dispositionMeta(disposition) {
  const meta = DISPOSITION_META[disposition]
  if (meta === undefined) throw new Error('unknown disposition: ' + String(disposition))
  return meta
}

function loadRegistry() {
  const raw = readFileIfExists(REGISTRY)
  if (raw === undefined) throw new Error('missing registry: ' + REGISTRY)
  const data = JSON.parse(raw)
  if (!Array.isArray(data.groups) || !Array.isArray(data.capabilities)) {
    throw new Error(REGISTRY + ' must have { groups: [], capabilities: [] }')
  }
  const known = new Set(data.groups)
  for (const cap of data.capabilities) {
    if (!known.has(cap.group)) throw new Error('capability ' + cap.id + ' has unknown group: ' + cap.group)
    statusMeta(cap.status)
    dispositionMeta(cap.disposition)
    if (!DISPOSITION_ALLOWS[cap.disposition].includes(cap.status)) {
      throw new Error('capability ' + cap.id + '：处置 ' + cap.disposition
        + ' 不允许状态 ' + cap.status + '（允许：' + DISPOSITION_ALLOWS[cap.disposition].join('/') + '）')
    }
    if (cap.disposition !== 'keep' && (typeof cap.rationale !== 'string' || cap.rationale.length === 0)) {
      throw new Error('capability ' + cap.id + '：非 keep 的处置必须写 rationale（为什么这么处置）')
    }
    if (!Array.isArray(cap.probes) || cap.probes.length === 0) {
      throw new Error('capability ' + cap.id + ' needs at least one probe')
    }
  }
  const removed = data._removed_symbols
  if (removed !== undefined) {
    if (!Array.isArray(removed.docs) || !Array.isArray(removed.symbols) || !Array.isArray(removed.exempt)) {
      throw new Error('_removed_symbols 需要 { docs: [], symbols: [], exempt: [] }')
    }
    const ids = new Set(data.capabilities.map(cap => cap.id))
    for (const symbol of removed.symbols) {
      if (typeof symbol.pattern !== 'string' || typeof symbol.note !== 'string') {
        throw new Error('_removed_symbols.symbols 每项需要 { pattern, note }')
      }
      if (symbol.cap !== undefined && !ids.has(symbol.cap)) {
        throw new Error('_removed_symbols 指向了不存在的能力：' + symbol.cap)
      }
      try { new RegExp(symbol.pattern) } catch { throw new Error('_removed_symbols 正则不合法：' + symbol.pattern) }
    }
  }
  return data
}

/** 跑全部探针，返回失败清单（空 = 绿）。 */
function verify(registry) {
  const failures = []
  for (const cap of registry.capabilities) {
    for (const probe of cap.probes) {
      const actual = observe(probe)
      if (actual !== probe.expect) {
        failures.push({ cap, probe, actual })
      }
    }
  }
  return failures
}

/**
 * 叙述文档门禁：**已删除的符号不许在活文档里被当成现有功能提起**。
 *
 * 探针只查代码事实（调用点/字面量），查不到「README 说包内有三套面板实现」这种叙述漂移 ——
 * 0.8.9 删掉旧面板入口后 README 的「已知限制」还留着，就是这么漏的。
 * 规则：`_removed_symbols.docs` 列出的活文档里，命中 `symbols[].pattern` 的行必须同时命中一个
 * `exempt` 词（说明这是在讲历史/回归），否则失败。
 * 版本命名文档（`docs/V0.x-*.md`）是当时的历史记录，故意不在扫描范围内。
 */
function verifyNarrative(registry) {
  const spec = registry._removed_symbols
  if (spec === undefined) return []
  const problems = []
  for (const rel of spec.docs) {
    const text = readFileIfExists(rel)
    if (text === undefined) { problems.push('叙述文档缺失：' + rel); continue }
    const lines = text.split('\n')
    for (const symbol of spec.symbols) {
      const re = new RegExp(symbol.pattern)
      lines.forEach((line, index) => {
        if (!re.test(line)) return
        if (spec.exempt.some(word => line.includes(word))) return
        problems.push(rel + ':' + String(index + 1) + ' 把已删除的「' + symbol.note
          + '」当成现有功能（命中 /' + symbol.pattern + '/）。'
          + (symbol.cap !== undefined ? '对应能力：' + symbol.cap + '。' : '')
          + '若是在讲历史，同一行补一个豁免词（' + spec.exempt.slice(0, 3).join('/') + '…）。')
      })
    }
  }
  return problems
}

/**
 * 零测试引用的模块（自动核算，写进生成物）。
 *
 * 「反死机制」要求每条机制有回归测试；README 里那句「当前被自身代码违反」如果写死数字，
 * 下次增删模块就又过期了 —— 所以这里现算现写，README 只指向本表。
 * 口径：`src/` 下的 ts/tsx，文件名（含扩展名）在 `tests/` 的全部文件里一次都没出现过。
 */
function untestedModules() {
  const testText = collect('tests').map(file => file.text).join('\n')
  return collect('src')
    .filter(file => /\.[jt]sx?$/.test(file.path))
    .filter(file => !file.path.endsWith('src/index.ts'))
    .filter((file) => {
      const base = file.path.slice(file.path.lastIndexOf('/') + 1)
      return !testText.includes(base)
    })
    .map(file => file.path)
}

/**
 * 零调用点的导出（自动核算，写进生成物）——「有实现、没接线」的机器清单。
 *
 * 口径：`src/` 里 `export function|class X`，把 `X` 放到**整个 src/**（含自己文件里
 * 去掉声明行之后的部分）里数；一次都不出现 = 没人调用。`src/index.ts`（插件入口）与
 * `src/ui/index.tsx`（面板入口）排除 —— 它们是被宿主/HTML 加载的，不是被 import 的。
 * 名字只出现在 `tests/` 里的会单独标注：那仍是「生产路径没人用」，但至少被测试钉着。
 * 只看函数与类，不看常量/类型 —— 后两者常是配置或公开 API，误报率高。
 */
function deadExports() {
  const files = collect('src').filter(file => /\.[jt]sx?$/.test(file.path))
  const byPath = new Map(files.map(file => [file.path, file.text]))
  const testText = collect('tests').map(file => file.text).join('\n')
  const found = []
  for (const [path, text] of byPath) {
    if (path === 'src/index.ts' || path === 'src/ui/index.tsx') continue
    const re = /^export (?:async )?(?:function|class) (\w+)/gm
    let match
    while ((match = re.exec(text)) !== null) {
      const name = match[1]
      const word = new RegExp('\\b' + name + '\\b', 'g')
      let calls = 0
      for (const [other, otherText] of byPath) {
        // 自己文件里要先把声明行去掉，否则「定义」会被当成一次「使用」
        const scanned = other === path
          ? otherText.replace(new RegExp('^export (?:async )?(?:function|class) ' + name + '\\b.*$', 'm'), '')
          : otherText
        calls += (scanned.match(word) ?? []).length
      }
      if (calls === 0) found.push({ path, name, inTests: (testText.match(word) ?? []).length })
    }
  }
  return found
}

function probeText(probe) {
  switch (probe.kind) {
    case 'symbol-called':
      return '有调用点(' + probe.symbol + ') in ' + (probe.scope ?? 'src')
    case 'text-present':
      return (probe.file ?? probe.scope ?? 'src') + ' 含 ' + probe.pattern
    case 'count':
      return 'count(' + probe.pattern + ') in ' + (probe.file ?? probe.scope ?? 'src')
        + (Array.isArray(probe.between) ? ' 区间[' + probe.between[0] + ' … ' + probe.between[1] + ']' : '')
    case 'file-exists':
      return '存在 ' + probe.path
    default:
      return String(probe.kind)
  }
}

function render(registry) {
  const generated = registry.capabilities
  const tally = new Map()
  const dispTally = new Map()
  for (const cap of generated) {
    tally.set(cap.status, (tally.get(cap.status) ?? 0) + 1)
    dispTally.set(cap.disposition, (dispTally.get(cap.disposition) ?? 0) + 1)
  }
  const lines = []
  lines.push('# Nexus 实现状态总表（机器校验）')
  lines.push('')
  lines.push('> **本文件由 `npm run docs:status` 生成，请勿手改。** 唯一事实源是 `docs/status.json`。')
  lines.push('> 校验：`npm run docs:check`（CI 与 pre-commit 都会跑）——它同时检查')
  lines.push('> ① 每条声明的探针与代码事实一致；② 本文件与注册表一致；③ 处置与状态相容、非 keep 必须写理由。')
  lines.push('')
  lines.push('这份表回答两个问题：**文档里写的功能，代码里到底有没有、接没接线、和描述是否一致**（状态）；')
  lines.push('以及 **发现不一致之后打算怎么办**（处置）。')
  lines.push('')
  lines.push('## 状态图例（现在怎样）')
  lines.push('')
  lines.push('| 状态 | 含义 |')
  lines.push('|---|---|')
  lines.push('| ✅ 已实现 | 文档描述与运行行为一致，探针可证 |')
  lines.push('| ⚠️ 部分实现 | 功能在，但覆盖面或参数与文档不同（差异写在「实测差异」列） |')
  lines.push('| ⚠️ 与文档不一致 | 两处描述互相矛盾，或描述的是非默认路径 |')
  lines.push('| 🧟 有代码未接线 | 模块/配置存在甚至带单测，但生产路径没有调用点或消费者 |')
  lines.push('| ❌ 未实现 | 文档承诺，代码里没有 |')
  lines.push('')
  lines.push('## 处置图例（打算怎么办）')
  lines.push('')
  lines.push('| 处置 | 含义 |')
  lines.push('|---|---|')
  lines.push('| 🔧 改代码 | 按文档（或按设计意图）把实现补齐 / 接线 / 修缺陷 |')
  lines.push('| 📄 改文档 | 承认现状，把承诺降级为与代码一致的表述 |')
  lines.push('| 🗑️ 删 | 删掉代码、配置项或文档承诺（与原则冲突、无消费者、或纯多余） |')
  lines.push('| ⏸️ 推迟 | 保留但明确标注为「未做」，并写明触发条件 |')
  lines.push('| — 保持 | 已实现且一致，无需动作 |')
  lines.push('')
  lines.push('> 裁定顺序（先到先判，前两步是硬否决）：')
  lines.push('> **Q1 现状是不是缺陷？**（安全缺口 / 自相矛盾 / 功能死胡同）→ 是 → 🔧 改代码，没有「以代码为准」的空间；')
  lines.push('> **Q2 承诺与项目自己的原则/反目标冲突吗？** → 是 → 🗑️ 两边都删；')
  lines.push('> **Q3 还有消费者或用户价值吗？** → 没有 → 🗑️ 删；')
  lines.push('> **Q4 都不是** → 比成本，默认偏 📄 改文档（改文档可逆、零回归，改代码有回归风险）。')
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push('| 状态 | 条数 |')
  lines.push('|---|---|')
  for (const status of Object.keys(STATUS_META).sort((a, b) => STATUS_META[a].order - STATUS_META[b].order)) {
    if (!tally.has(status)) continue
    const meta = statusMeta(status)
    lines.push('| ' + meta.icon + ' ' + meta.label + ' | ' + String(tally.get(status)) + ' |')
  }
  lines.push('| **合计** | **' + String(registry.capabilities.length) + '** |')
  lines.push('')
  lines.push('| 处置 | 条数 |')
  lines.push('|---|---|')
  for (const disposition of Object.keys(DISPOSITION_META).sort((a, b) => DISPOSITION_META[a].order - DISPOSITION_META[b].order)) {
    if (!dispTally.has(disposition)) continue
    const meta = dispositionMeta(disposition)
    lines.push('| ' + meta.icon + ' ' + meta.label + ' | ' + String(dispTally.get(disposition)) + ' |')
  }
  lines.push('')

  for (const group of registry.groups) {
    const rows = registry.capabilities.filter(cap => cap.group === group)
    if (rows.length === 0) continue
    lines.push('## ' + group)
    lines.push('')
    lines.push('| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |')
    lines.push('|---|---|---|---|---|---|')
    for (const cap of rows) {
      const meta = statusMeta(cap.status)
      const disp = dispositionMeta(cap.disposition)
      lines.push('| ' + meta.icon + ' ' + meta.label
        + ' | ' + disp.icon + ' ' + disp.label
        + ' | ' + cap.title
        + ' | ' + (cap.docs ?? '—')
        + ' | `' + (cap.evidence ?? '—') + '`'
        + ' | ' + (cap.detail ?? '—')
        + ' |')
    }
    lines.push('')
  }

  lines.push('## 待办：按处置分组')
  lines.push('')
  lines.push('处置的**理由**逐条写在 `docs/status.json` 的 `rationale` 字段里；这里只列清单。')
  lines.push('')
  for (const disposition of ['fix-code', 'fix-docs', 'delete', 'defer']) {
    const rows = registry.capabilities.filter(cap => cap.disposition === disposition)
    if (rows.length === 0) continue
    const meta = dispositionMeta(disposition)
    lines.push('### ' + meta.icon + ' ' + meta.label + '（' + String(rows.length) + ' 条）')
    lines.push('')
    for (const cap of rows) {
      lines.push('- **' + cap.title + '** — ' + cap.rationale)
    }
    lines.push('')
  }

  lines.push('## 零测试引用的模块（现算，不是手写的）')
  lines.push('')
  const untested = untestedModules()
  lines.push('口径：`src/` 下的 `.ts/.tsx`（不含 `src/index.ts`），文件名在 `tests/` 里一次都没出现过。'
    + 'README 的「反死机制」条目指向本节 —— 数字写死在文档里下次增删模块就会过期。')
  lines.push('')
  if (untested.length === 0) {
    lines.push('0 个：`src/` 下每个模块都被至少一个测试文件直接引用。')
  } else {
    lines.push('共 **' + String(untested.length) + '** 个：')
    lines.push('')
    for (const path of untested) lines.push('- `' + path + '`')
  }
  lines.push('')

  lines.push('## 零调用点的导出（现算：有实现、没接线的机器清单）')
  lines.push('')
  const dead = deadExports()
  lines.push('口径：`export function|class X` 的 `X` 在整个 `src/` 里（含自己文件的其余部分）一次都没被用到；'
    + '排除 `src/index.ts` 与 `src/ui/index.tsx`（宿主/HTML 加载的入口）。'
    + '标注「仅测试引用」的说明生产路径没人调、但至少被测试钉着。')
  lines.push('')
  if (dead.length === 0) {
    lines.push('0 个：`src/` 里每个导出的函数/类都有调用点。')
  } else {
    lines.push('共 **' + String(dead.length) + '** 个：')
    lines.push('')
    for (const entry of dead) {
      lines.push('- `' + entry.path + '` 的 `' + entry.name + '`'
        + (entry.inTests > 0 ? '（仅测试引用 ' + String(entry.inTests) + ' 处，生产路径零调用）' : '（全仓零引用）'))
    }
  }
  lines.push('')

  lines.push('## 维护规则')
  lines.push('')
  lines.push('1. 改了 `src/` 行为 → 跑 `npm run docs:check`；探针失败说明本表已过期。')
  lines.push('2. 新增/删除能力 → 先在 `docs/status.json` 增删条目、探针与处置，再跑 `npm run docs:status`。')
  lines.push('3. 探针必须查**运行事实**（调用点 / 消费者 / 字面量），不要查注释——注释会撒谎，这正是本表存在的理由。')
  lines.push('4. 状态从 ❌ 变 ✅ 的那次提交，必须同时删掉文档里对应的「未实现」表述，并把处置改回 `keep`。')
  lines.push('')
  return lines.join('\n')
}

// ------------------------------- main -------------------------------
const registry = loadRegistry()
const failures = verify(registry)
const narrative = verifyNarrative(registry)

if (MODE === 'explain') {
  for (const cap of registry.capabilities) {
    console.log('\n[' + cap.status + '] ' + cap.id + ' — ' + cap.title)
    for (const probe of cap.probes) {
      const actual = observe(probe)
      const ok = actual === probe.expect ? 'ok  ' : 'FAIL'
      console.log('  ' + ok + ' ' + probeText(probe) + ' → 实测 ' + String(actual) + ' / 声明 ' + String(probe.expect))
    }
  }
  const untested = untestedModules()
  const dead = deadExports()
  console.log('\n零测试引用的模块：' + (untested.length === 0 ? '无' : '\n  ' + untested.join('\n  ')))
  console.log('零调用点的导出：' + (dead.length === 0 ? '无'
    : '\n  ' + dead.map(entry => entry.path + ' :: ' + entry.name + (entry.inTests > 0 ? '（仅测试引用）' : '')).join('\n  ')))
  console.log('叙述文档漂移：' + (narrative.length === 0 ? '无' : '\n  ' + narrative.join('\n  ')))
  console.log('\n探针失败 ' + String(failures.length) + ' 条')
  process.exit(failures.length === 0 && narrative.length === 0 ? 0 : 1)
}

const markdown = render(registry)

if (MODE === 'write') {
  writeFileSync(join(root, OUTPUT), markdown)
  console.log('· 已生成 ' + OUTPUT + '（' + String(registry.capabilities.length) + ' 条能力）')
  if (failures.length > 0 || narrative.length > 0) {
    if (failures.length > 0) {
      console.error('\n✖ 有 ' + String(failures.length) + ' 条探针与声明不符：')
      for (const { cap, probe, actual } of failures) {
        console.error('  · ' + cap.id + ' — ' + probeText(probe) + '：实测 ' + String(actual) + '，声明 ' + String(probe.expect))
      }
    }
    for (const problem of narrative) console.error('  · ' + problem)
    console.error('\n  说明代码已变化而注册表／叙述文档没跟上。请改 docs/status.json（或文档）后重跑。')
    process.exit(1)
  }
  console.log('· 全部探针通过')
  process.exit(0)
}

// check
const onDisk = readFileIfExists(OUTPUT)
const problems = []
if (failures.length > 0) {
  for (const { cap, probe, actual } of failures) {
    problems.push('探针不符：' + cap.id + ' — ' + probeText(probe) + '：实测 ' + String(actual) + '，声明 ' + String(probe.expect))
  }
}
problems.push(...narrative)
if (onDisk === undefined) {
  problems.push('缺少生成物：' + OUTPUT + '（跑 npm run docs:status）')
} else if (onDisk !== markdown) {
  problems.push('生成物与注册表不一致：' + OUTPUT + '（跑 npm run docs:status 重新生成）')
}

if (problems.length > 0) {
  console.error('\n✖ 文档状态门禁未通过：')
  for (const problem of problems) console.error('  · ' + problem)
  console.error('\n  文档与代码已经漂移。改 docs/status.json（或跑 npm run docs:status）后重试。')
  process.exit(1)
}
console.log('· 文档状态门禁通过：' + String(registry.capabilities.length) + ' 条能力声明与代码事实一致，生成物同步')
