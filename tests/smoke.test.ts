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
    expect(resolved.mode).toBe('standard')
    expect(resolved.indexBudgetBytes).toBe(1024)
    expect(resolved.extract).toBe('reminder')
    expect(resolved.vector).toBe(false)
    expect(resolved.autoDegradeDays).toBe(7)
    expect(resolved.pendingMax).toBe(200)
    expect(resolved.coldArchive).toBe(false)
  })

  it('accepts a valid full config (callable schema)', () => {
    expect(() => Config({
      mode: 'strict', indexBudgetBytes: 2048, extract: 'off',
      vector: true, autoDegradeDays: 14, pendingMax: 50, coldArchive: true,
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
    expect(() => Config({ mode: 'insane' })).toThrow(ValidationError)
  })
})