import { diagnose } from '../src/doctor.ts'
const state = await (await fetch('http://127.0.0.1:3080/nexus/api/state')).json()
const mem = await (await fetch('http://127.0.0.1:3080/nexus/api/memory?limit=200')).json()
const by = (s) => mem.items.filter((a) => a.status === s).length
const report = diagnose({
  counts: { active: by('active'), pending: by('pending'), conflicts: by('needs-review'), archived: by('archived'), superseded: by('superseded') },
  junk: state.noise ? state.noise.count : 0,
  injection: { bytes: state.injection.bytes, budgetBytes: state.injection.budgetBytes, lines: state.injection.lines, dropped: state.injection.dropped.length },
  today: { saved: 0, rejected: 0, injections: 0 },
  extractorLlm: false,
  degraded: state.degraded,
  storeWritable: true,
})
console.log('【/memory doctor 预演（用你当前库的真实数据）】')
console.log(report.lines.join('\n'))