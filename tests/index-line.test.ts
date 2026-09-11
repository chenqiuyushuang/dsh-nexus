/** 注入行格式：主语与正文重复时只打印一次（用户每天在系统提示里看到的那一行）。 */
import { describe, expect, it } from 'vitest'
import { renderIndexLine } from '../src/atom.ts'
import { mkAtom } from './atom.test.ts'

describe('注入行不再重复主语（用户每天在系统提示里看到的格式）', () => {
  it('主语等于正文时只打印一次', () => {
    const atom = mkAtom({ slot: 'personal', subject: '用户的名字是 Daniel（中文对话）。', statement: '用户的名字是 Daniel（中文对话）。' })
    const line = renderIndexLine(atom)
    // 注入行会做 NFKC 归一（既有行为）：全角括号变半角
    expect(line).toBe('- [personal] 用户的名字是 Daniel(中文对话)。')
    expect(line.split('用户的名字是').length - 1).toBe(1)
  })

  it('主语是正文前缀时也只打印一次', () => {
    const atom = mkAtom({ subject: '尽调报告生成项目', statement: '尽调报告生成项目：工作流 JSON 导出在 workflow.json' })
    // NFKC 也把全角冒号转成半角
    expect(renderIndexLine(atom)).toBe('- [project] 尽调报告生成项目:工作流 JSON 导出在 workflow.json')
  })

  it('主语不是前缀时仍保留「主语：正文」（信息不丢）', () => {
    const atom = mkAtom({ subject: '包管理', statement: '项目使用 pnpm 管理依赖' })
    expect(renderIndexLine(atom)).toBe('- [project] 包管理：项目使用 pnpm 管理依赖')
  })

  it('去重后同一内容占的字节更少', () => {
    const atom = mkAtom({ slot: 'personal', subject: '用户的名字是 Daniel（中文对话）。', statement: '用户的名字是 Daniel（中文对话）。' })
    const duplicated = '用户的名字是 Daniel（中文对话）。：用户的名字是 Daniel（中文对话）。'
    expect(Buffer.byteLength(renderIndexLine(atom), 'utf8')).toBeLessThan(Buffer.byteLength(duplicated, 'utf8'))
  })
})