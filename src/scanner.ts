/**
 * Built-in security scanner: write-side prompt-injection / secret-leak /
 * destructive-command detection. 'minimal' is the shipped baseline;
 * 'recommended' adds file-level patterns. Any hit rejects the write.
 *
 * @module @chenqiuyushuang/dsh-nexus/scanner
 */
import type { CandidateAtom } from './atom.ts'
import type { SecurityScannerProcessor, ScanVerdict } from './processors.ts'

export interface ScannerRule {
  readonly id: string
  readonly re: RegExp
}

/** Baseline rules (ships enabled with scannerRules=minimal). */
export const MINIMAL_RULES: ScannerRule[] = [
  { id: 'prompt-injection', re: /忽略\s*(?:之前|以上)?\s*(?:所有)?\s*(?:指令|指示|要求)|ignore\s+(?:all\s+)?(?:previous|above)\s+instructions/i },
  // 专家团实测：sk-proj-/sk-ant- 含连字符可绕过；中文「密码是/密钥是」不在规则内。
  // 任一命中即拒绝写入 —— 密钥永不落盘、永不进注入块。
  {
    id: 'secret-leak',
    re: /(?:sk|rk|pk)-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd|密码|口令|密钥|私钥)\s*(?:[:=]|是|为)\s*[^\s，。；,;]{6,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i,
  },
  { id: 'personal-id', re: /\b\d{17}[\dXx]\b|\b\d{15}\b/ },
  { id: 'destructive-command', re: /rm\s+-rf\s+[\/~]|DROP\s+TABLE|DELETE\s+FROM|format\s+c:/i },
  // 密钥是隐私底线：随 minimal 一起出厂，不做 opt-in
  { id: 'env-credential', re: /AWS_(?:SECRET_)?ACCESS_KEY\s*=|GH_TOKEN\s*=|GITHUB_TOKEN\s*=|DATABASE_URL\s*=\s*\S+:\S+@/i },
];

/** Recommended additions (opts in). */
export const RECOMMENDED_RULES: ScannerRule[] = [
  ...MINIMAL_RULES,
  { id: 'file-destructive', re: /\btruncate\s+-s\s+0\b|>\s*\/dev\/sd[a-z]|mkfs\./i },
];

/** Create the built-in scanner for one rule set. */
export function createScanner(kind: 'minimal' | 'recommended'): SecurityScannerProcessor {
  const rules = kind === 'recommended' ? RECOMMENDED_RULES : MINIMAL_RULES;
  return {
    id: kind === 'minimal' ? 'builtin-minimal' : 'builtin-recommended',
    async scan(candidate: CandidateAtom): Promise<ScanVerdict> {
      const hay = candidate.subject + '\n' + candidate.statement;
      for (const rule of rules) {
        if (rule.re.test(hay)) {
          return { verdict: 'reject', reason: '扫描规则 ' + rule.id + ' 命中' };
        }
      }
      return { verdict: 'allow' };
    },
  };
}