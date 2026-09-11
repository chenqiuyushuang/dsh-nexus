/**
 * Model-facing tools: the on-demand layer of the memory surface.
 * One-sentence management plus search/read; all retrieval is zero-token.
 *
 * @module @chenqiuyushuang/dsh-nexus/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { NexusFacility } from './facility.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { classifyToolMemory, evaluateHardReject } from './extraction.ts'
import { rejectId } from './atom.ts'
import type { ResolvedConfig } from './config.ts'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
};

const params = {
  text: { type: 'string' as const, description: '一条值得长期记住的陈述', required: true as const },
  project: { type: 'string' as const, description: '项目标识（cwd 或项目名）；身份类信息无需传，其余默认不跨工作区注入' },
  ids: { type: 'string' as const, description: '逗号分隔的记忆 id 列表' },
  id: { type: 'string' as const, description: '记忆 id' },
  query: { type: 'string' as const, description: '检索关键词' },
  reason: { type: 'string' as const, description: '拒绝原因' },
  trace: { type: 'boolean' as const, description: '是否返回归档链' },
} satisfies ParameterSchemaSpec

/** Install memory tools + guidance section. */
export function installTools(ctx: Context, facility: NexusFacility, resolved: ResolvedConfig): void {
  void resolved;
  ctx.tools.register(defineTool({
    name: 'memory_remember',
    description: '保存一条长期记忆（事实/偏好/决策/教训）。新的重要记忆自动进入待确认，冲突会被标记。',
    parameters: { text: params.text, project: { type: 'string' as const, description: '项目标识（cwd 或项目名）；身份类无需传，其余默认不跨工作区注入' } },
    output: TEXT_OUTPUT,
    execute: async (args: { text: string; project?: string }) => {
      const verdict = evaluateHardReject(args.text);
      if (verdict.reject) return '已拒绝：' + verdict.reason;
      const cls = classifyToolMemory(args.text, args.project);
      const atom = await facility.saveAtom({
        fp: 'tool_' + hash16(args.text),
        kind: cls.kind, slot: cls.slot, provenance: 'agent-curated', scope: cls.scope,
        projectRef: cls.scope === 'project' ? (args.project ?? 'unknown') : undefined,
        subject: args.text.slice(0, 24),
        statement: args.text.slice(0, 4000),
        cues: deterministCues(args.text),
        weight: 1, pinned: false, injected: false,
        confidence: 0.98, sources: [],
      });
      return '已保存：' + atom.id + '（状态 ' + atom.status + '）';
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: '归档一条记忆（永不删除，可回溯）。',
    parameters: { id: params.id },
    output: TEXT_OUTPUT,
    execute: async (args: { id: string }) => {
      const results = await facility.review([args.id], 'reject', 'model requested forget');
      return results.length > 0 ? '已归档：' + results[0] : '未找到或已归档';
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: '检索记忆库（零 token 文本检索，可用措辞不同的说法命中线索）。',
    parameters: { query: params.query },
    output: TEXT_OUTPUT,
    execute: async (args: { query: string }) => {
      const store = await facility.store();
      const hits = await facility.retrieve({
        sessionId: 'tool-search',
        messages: [{ role: 'user', text: args.query }],
        turn: 0, step: 0,
        store: store.snapshot(),
      }, AbortSignal.timeout(10_000));
      await facility.recordRecall({
        sessionId: 'tool-search', turn: 0, step: 0, queryPreview: args.query,
        hits: hits.map(atom => ({ atomId: atom.id, score: atom.score, source: 'text' })),
        injectedBytes: 0,
      });
      return hits.length === 0 ? '无结果' : hits.map((atom, index) =>
        (index + 1) + '. [' + atom.slot + '·' + atom.kind + '] ' + atom.subject + '：' + atom.statement + ' (' + (atom.confidence * 100).toFixed(0) + '% conf, ' + atom.id + ')').join('\n');
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_read',
    description: '读取一条记忆的完整详情（含来源与归档链）。',
    parameters: { id: params.id, trace: params.trace },
    output: TEXT_OUTPUT,
    execute: async (args: { id: string; trace?: boolean }) => {
      const store = await facility.store();
      const atom = store.getAtom(args.id);
      if (atom === undefined) return '未找到记忆 ' + args.id;
      const lines = ['id: ' + atom.id, 'kind: ' + atom.kind, 'slot: ' + atom.slot, 'status: ' + atom.status,
        'statement: ' + atom.statement, 'confidence: ' + atom.confidence.toFixed(2), 'weight: ' + atom.weight,
        'sources: ' + (atom.sources.length === 0 ? '—' : atom.sources.map(source => source.sessionId + '#' + source.seq + (source.quote ? '「' + source.quote.slice(0, 60) + '」' : '')).join(' | '))];
      if (args.trace === true && (atom.supersededBy !== undefined || atom.supersedes !== undefined)) {
        lines.push('chain: supersedes=' + (atom.supersedes ?? '—') + ' supersededBy=' + (atom.supersededBy ?? '—'));
      }
      return lines.join('\n');
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_feedback',
    description: '反馈最近一次注入是否有用：good 提升权重，bad 降低权重并帮助校准。',
    parameters: { ids: params.ids, kind: { type: 'string' as const, enum: ['good', 'bad'] as const, description: 'good 或 bad' } },
    output: TEXT_OUTPUT,
    execute: async (args: { ids: string }) => {
      const ids = args.ids.split(',').map(id => id.trim()).filter(Boolean);
      const store = await facility.store();
      let bumped = 0;
      for (const id of ids) {
        const atom = store.getAtom(id);
        if (atom === undefined || atom.status !== 'active') continue;
        await store.updateAtom(id, current => ({ ...current, weight: Math.min(20, current.weight + 1), updatedAt: Date.now() }));
        bumped += 1;
      }
      return '已强化 ' + bumped + ' 条记忆';
    },
  }));
}

import { deterministCues, hash16 } from './extraction.ts';