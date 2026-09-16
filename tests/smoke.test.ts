/**
 * Phase 0 smoke tests: plugin shape and config validation only.
 */
import { describe, expect, it } from 'vitest'
import { Config, name, resolveConfig } from '../src/index.ts'
import { ValidationError } from '@deepseek-ai/schemastery'

describe('nexus plugin shape', () => {
  it('declares a stable cordis plugin name', () => {
    expect(name).toBe('nexus')
  })

  it('fills documented defaults', () => {
    const resolved = resolveConfig({})
    expect(resolved.indexBudgetBytes).toBe(1024)
    expect(resolved.extract).toBe('reminder')
    expect(resolved.vector).toBe(false)
    expect(resolved.autoDegradeDays).toBe(7)
    expect(resolved.pendingMax).toBe(200)
    expect(resolved.scannerRules).toBe('minimal')
  })

  it('已删除的死旋钮不再出现在 schema 里（mode / coldArchive）', () => {
    // 两者曾「解析后无任何消费者」；按处置决定删除。未知键会被 schemastery 透传但不解析，
    // 所以老配置照旧能加载，只是不再有这两个字段。
    const resolved = resolveConfig(Config({ mode: 'strict', coldArchive: true } as never) as never)
    expect('mode' in resolved).toBe(false)
    expect('coldArchive' in resolved).toBe(false)
  })

  it('scannerRules 真的可选（回归：此键曾不在 schema 里，recommended 规则集运行时不可达）', () => {
    expect(resolveConfig(Config({ scannerRules: 'recommended' }) as never).scannerRules).toBe('recommended')
    expect(() => Config({ scannerRules: 'nonsense' })).toThrow(ValidationError)
  })

  it('accepts a valid full config (callable schema)', () => {
    expect(() => Config({
      indexBudgetBytes: 2048, extract: 'off',
      vector: true, autoDegradeDays: 14, pendingMax: 50,
      extractorLlm: { provider: 'deepseek', model: 'deepseek-chat' },
    })).not.toThrow()
  })

  it('loader accepts an EMPTY config (zero-config promise, regression for loader schema)', () => {
    expect(() => Config({})).not.toThrow()
    const resolved = resolveConfig(Config({}) as never)
    expect(resolved.extractorLlm).toBeUndefined()
  })

  it('treats incomplete extractorLlm as undefined (foolproof)', () => {
    const noModel = resolveConfig(Config({ extractorLlm: { provider: 'deepseek-official' } }) as never)
    expect(noModel.extractorLlm).toBeUndefined()
    const full = resolveConfig(Config({ extractorLlm: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }) as never)
    expect(full.extractorLlm?.model).toBe('deepseek-v4-flash')
  })

  it('rejects invalid enum values', () => {
    expect(() => Config({ extract: 'insane' })).toThrow(ValidationError)
  })
})