/**
 * Mini holdout: 10 scenes × facts + paraphrase queries (expected subject in Top-5).
 * Honest scope: this gates RETRIEVAL recall of the LEXICAL tier; end-to-end
 * completion metrics come with the LLM-backed arena (WP-1 two-track).
 * Every paraphrase query shares at least one lexeme with its fact: pure
 * synonymy (发布 vs 部署) is the SEMANTIC tier (vector/LLM scoring, v0.4+)
 * and cannot be recalled lexically.
 *
 * @module @chenqiuyushuang/dsh-nexus/bench/holdout
 */

export interface Scene {
  readonly name: string
  readonly facts: { subject: string; statement: string }[]
  readonly queries: { text: string; expect: string }[]
}

export const SCENES: Scene[] = [
  {
    name: "发布流程",
    facts: [{ subject: "发布流程", statement: "发布从 staging 分支进行" }, { subject: "发布流程", statement: "发布前跑 npm test" }],
    queries: [
      { text: "我们上次怎么发的版", expect: "发布流程" },
      { text: "上线前要跑什么测试", expect: "发布流程" },
    ],
  },
  {
    name: "包管理器",
    facts: [{ subject: "包管理器", statement: "项目使用 pnpm 管理依赖" }],
    queries: [{ text: "依赖用什么工具装", expect: "包管理器" }],
  },
  {
    name: "部署环境",
    facts: [{ subject: "部署环境", statement: "生产环境走 github actions 自动部署" }],
    queries: [{ text: "生产环境是谁在发布", expect: "部署环境" }],
  },
  {
    name: "代码评审",
    facts: [{ subject: "代码评审", statement: "评审用 semantic-release 做提交规范" }],
    queries: [{ text: "提交规范工具", expect: "代码评审" }],
  },
  {
    name: "测试框架",
    facts: [{ subject: "测试框架", statement: "单元测试用 vitest 跑" }],
    queries: [{ text: "测试用什么框架", expect: "测试框架" }],
  },
  {
    name: "编辑器",
    facts: [{ subject: "编辑器", statement: "代码用 neovim 开发" }],
    queries: [{ text: "开发工具链", expect: "编辑器" }],
  },
  {
    name: "用户身份",
    facts: [{ subject: "用户身份", statement: "叫我丹尼尔就好" }],
    queries: [{ text: "我该称呼你什么", expect: "用户身份" }],
  },
  {
    name: "文档规范",
    facts: [{ subject: "文档规范", statement: "文档写中文，用 docs/ 目录" }],
    queries: [{ text: "文档放哪写什么语言", expect: "文档规范" }],
  },
  {
    name: "数据库",
    facts: [{ subject: "数据库", statement: "数据存 sqlite 单文件" }],
    queries: [{ text: "存储介质是什么", expect: "数据库" }],
  },
  {
    name: "会话记忆",
    facts: [{ subject: "会话记忆", statement: "记忆按会话隔离" }],
    queries: [{ text: "记忆会跨项目吗", expect: "会话记忆" }],
  },
];

export const TOP_K = 5;
export const BENCH_GATE_TEXT = 0.8; // 基准门槛（CI 将调至 0.9 当向量/语义上线）