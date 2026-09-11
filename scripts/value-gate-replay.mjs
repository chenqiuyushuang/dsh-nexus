/**
 * 价值门影子回放：拿真实库里的每条记忆跑一遍 assessValue，看它会不会被拦。
 * 影子期不改变任何写入行为 —— 这个脚本只回答「如果上线，会拦掉什么」。
 *
 * 用法：node scripts/value-gate-replay.mjs [--limit 200]
 */
import { assessValue } from '../src/value-gate.ts'

const res = await fetch('http://127.0.0.1:3080/nexus/api/memory?limit=200')
const data = await res.json()
const rows = data.items.map((atom) => ({ atom, assessment: assessValue({ statement: atom.statement, subject: atom.subject, scope: atom.scope, kind: atom.kind }) }))

const byVerdict = { accept: 0, review: 0, reject: 0 }
for (const row of rows) byVerdict[row.assessment.verdict] += 1

console.log('总数', rows.length, '| 判定', JSON.stringify(byVerdict))
console.log('')
console.log('--- 现在「活跃」的条目，价值门怎么看 ---')
for (const row of rows.filter((r) => r.atom.status === 'active')) {
  const a = row.assessment
  console.log('  [' + a.verdict + ' ' + String(a.score).padStart(4) + '] ' + row.atom.statement.slice(0, 46).replace(/\n/g, ' '))
  console.log('         ' + a.reasons.slice(0, 3).join(' / '))
}
console.log('')
console.log('--- 现在「非活跃」的条目（应被判 reject）---')
const inactive = rows.filter((r) => r.atom.status !== 'active')
const wrong = inactive.filter((r) => r.assessment.verdict !== 'reject')
console.log('  非活跃', inactive.length, '条，其中价值门认为「还有价值」的：', wrong.length, '条')
for (const row of wrong.slice(0, 8)) {
  console.log('    [' + row.assessment.verdict + ' ' + row.assessment.score + '] ' + row.atom.statement.slice(0, 44).replace(/\n/g, ' '))
}
console.log('')
console.log('--- 被拦的原因分布（非活跃中）---')
const reasonCount = {}
for (const row of inactive) {
  const key = row.assessment.reasons.filter((r) => r.startsWith('-')).slice(-1)[0] ?? '(无减分项)'
  reasonCount[key] = (reasonCount[key] || 0) + 1
}
for (const [reason, count] of Object.entries(reasonCount).sort((a, b) => b[1] - a[1])) console.log('  ' + String(count).padStart(3) + '  ' + reason)