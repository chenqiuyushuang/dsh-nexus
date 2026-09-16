# Nexus 记忆系统 · 设计文档（终版 v1.0）

> 状态：设计定稿。依据 = DSH 162 个记忆插件普查 + 五家主流智能体（Codex / Claude Code / ZCode / Qoder / WorkBuddy）官方记忆设计对照 + 人脑记忆科学（认知神经科学）+ DSH 源码扩展点核对 + 四项设计原则。
> 证据链（插件普查 / 厂商对照 / 脑科学 / 决策工作簿 / DSH API 事实）是内部工作材料，不随本仓库分发；本文已收敛其结论。

> ⚠️ **本文是「设计意图」，不是「实现状态」。** 它按 v0.2 的设计稿写成，而实现只落地了其中一部分。
>
> **唯一的实现状态清单是 [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md)**（`npm run docs:status` 从
> `docs/status.json` 生成，`npm run docs:check` 用代码探针校验）。本文正文里凡与实现有出入的小节，
> 都在对应处带了 `> 实现状态` 标注。
>
> 这里**不再维护第二份差异表** —— 曾经有过一份 8 行的汇总表，它与状态注册表重复，
> 于是同一件事要在两处更新，本身就是下一个漂移源。要查「哪条实现了、哪条没有、打算怎么办」，
> 看状态表；要查「设计为什么这么定」，看本文。

---

## 1. 定位与目标

Nexus 是 DSH 的**本地优先、零配置、成本自保**的记忆层：它不替用户思考，只替用户保管『跨会话该记得的事』，并在正确的时候安静地想起来。

**优秀的标准：用户从不需要想起它，除非它突然想起用户该记得的事；每次想起，花的是它能省下的零头。**

### 四项设计原则（一切决策的仲裁依据）

1. **好用为王**：用户可见面 ≤3 个入口（索引段 / 一句『记住·忘掉』 / `/memory`），其余全部幕后化；零弹窗、零配置、零学习成本；
2. **不烧 token**：存在完整零 token 路径（确定性提取 / BM25 检索 / 索引注入），LLM 只在门控下按次计费；账本透明 + 7 天无使用自动降级；
3. **辩证看方案**：采用率是『有人试过』的证据，不是正确性证据。判据 = 功能正确性 / 长期成本 / 可逆性 / 与 DSH 微内核一致性。少数派正确的照样采纳（确定性提取轨、原子生命周期机制、不做时间衰减判失效）；
4. **借鉴验证过的骨架**：五家独立收敛的发明直接拿来（规则/记忆双轨 + 四槽位 + 索引两段式），只有它们止步的地方才自造（生命周期机制、冲突裁决、线索编码）。

---

## 2. 设计依据（四层证据的结论）

### 2.1 DSH 生态（162 个 memory + 179 个 knowledge 插件，7 派）

- **共识（采纳）**：分层存储、冻结快照保 prefix cache（33%）、人工门控（队列 27%）、明文 + 词法检索（无 embedding 也够）、蒸馏可见可审计、注入行对用户可见、跨生态导入是刚需（52%）；
- **少数派正确（采纳）**：确定性捕获（work-continuity 方法论：事件触发无 LLM 猜测；生态零家做）；原子生命周期（memoir/biomemory：唯一提供溯源/权重/冲突机制者）；
- **流行但负体验（拒绝）**：弹窗逐条审批（15%）、每步检索注入（破坏缓存）、前后台 dream 高频代谢（8%，复杂且用户无感）、图寻路工具（用户不用）；

### 2.2 五家厂商（收敛骨架 + 共同止步点）

- **收敛发明（骨架层直接采用）**：规则（AGENTS.md/CLAUDE.md=确定性、必加载）与记忆（=概率性回忆、后台生成、按需召回）双轨；四类槽位 user/feedback/project/reference（Claude 与 ZCode 逐字相同）；MEMORY.md 索引（一行一条，200 行/25KB 上限）+ 每条一主题文件的两段式；提取全部后台、成功结束、可跳过；记忆是软上下文不是硬策略；
- **共同止步点（Nexus 的价值区）**：五家全部文件式、无生命周期机制、无溯源、冲突只能『定期人工 review』（Claude 官方原话）；Codex 甚至声明记忆不可手工编辑（但 ZCode/WorkBuddy 可编辑——矛盾正是用阶段化消解）。

### 2.3 人脑记忆科学（5 处验证 / 4 处修正 / 1 处推迟）

- **验证**：工作记忆小而靠检索（=索引注入而非全量）；遗忘曲线衰减强度不衰减真实性（=weight/confidence 分离）；干扰靠竞争（=冲突置顶人裁）；已有记忆重复提取会抑制（=已见账本）；适应性遗忘是功能（=待确认 7 天过期归档）；离线巩固（=后台提取不阻塞对话）；
- **修正**：① 编码特异性 → Atom 加 `cues` 线索字段；② 重建记忆失真 → sources 加 `quote` 原话，gist 永不替换原文；③ 注意力决定编码深度 → 门控按『反馈 > 决策 > 偏好 > 事实』排序；④ 扩散激活 → 关联只做『邻居弹出』展示，不做寻路；
- **推迟**：CLS 离线整合（海马体快记/新皮层慢学）→ v0.3 周频整合器，v0.2 不做。

### 2.4 DSH 扩展点（已逐行核对的源码事实）

- 生命周期：`session/created` / `session/event`(session, event)（事件含 `seq`/`time`）/ `session/disposed`；无 `session/start`；
- 注入：`agent/pre-step` waterfall（`prepend: true`，先 `next()` 再追加）；注入消息 = `createUserMessage` + `source:{kind:'plugin',plugin,form:'snapshot',sections}`；
- 存储：`ctx.storageDomain.open(defineDomain(...))`，`layout:'per-record'`，`KvTable{get/entries/put/update/delete}`，backend json/sqlite 即插即换；
- LLM：`ctx.llm.stream(GenerateOptions)` + `BlockAssembler` + `deadline`（`@deepseek-ai/dsh-timeout`）；⚠ `purpose` 目前仅 `'compaction'|'session-title'`，Nexus 提取先省略；
- 工具：`ctx.tools.register(defineTool({...}))`（parameters 用 schemastery z）；命令：`ctx.commands.register({name,description,input,handler})`，`CommandInvocation{commandId,agent,rawInput,attachments,signal}`；
- 节流：`ctx.sessionProjections.register({key,stateVersion,stateSchema,init,apply})` + `stateOf(session,key)`；
- 其他：`expandAssistantStream` 取 assistant 文本；`systemPrompt.section`；事件声明 `declare module '@deepseek-ai/cordis' { interface Events {...} }`；~~待核对 seam：`dsh-inject-scheduler`~~（已核对：本仓库宿主版本里**不存在该 seam**，相应承诺已撤销）。

---

## 3. 总体架构

```
人工规则层       AGENTS.md / 项目说明          ← 不归 Nexus 管；硬禁令走 DSH 权限/钩子（记忆=软上下文）
                        │ 某条规则被重复违反 → 提示写进规则（最省 token 的记忆是规则）
                        ▼
Nexus 事实层      原子库（sqlite 默认 / json 可选）← 唯一事实源：状态/溯源/权重/冲突指针
                  + cues[]（编码线索）  + sources[].quote（原话片段）
                        │ 写入时同批生成投影
                        ▼
               MEMORY.md / USER.md 投影        ← 人类可读 = 编辑入口；人改投影 → 回灌原子(user-declared)
                        │ 索引（一行一条，≤1KB）
                        ▼
               `## 记忆` 索引注入（会话开始一次，冻结，缓存友好）

写入   ① 确定性（0 token）：用户原话 / goal·todo 事件 / 工具失败教训 → 直接入库
       ② 收尾提炼（门控 LLM，≤2 条/次）：turn 成功结束 AND ≥3 轮 AND 冷却 AND ≥1 工具 → 待确认
       ③ 硬拒绝（永远）：临时话题 / 代码可推导 / 规则文件已有 / MCP·web 来源 → 不入库
       （编码深度按注意力：反馈 > 决策 > 偏好 > 事实）

读取   索引注入（会话一次，冻结） + memory_search / memory_read（BM25 零 token；向量可选 + RRF）
       cues 命中加权（『部署』≈『发布』）；已见账本：同一条一会议至多一次；会话内写入不改已注入

生命周期  去重合并（自动）· 冲突置顶人裁（[冲突]，绝不静默篡改）· 待确认 7 天过期归档 · 永不删除（指针）
         无时间衰减（强度=weight 随遗忘曲线衰减，有效性由冲突驱动）· v0.3 周频离线整合器

成本     /memory cost 账本 + 注入 7 天零使用 → 自动『只写不读』+ 提示 + 一键全关

关联     只存不玩：supersedes / sources / 相关链接 → UI『相关记忆』邻里展示（扩散激活，不做寻路）
```

---

## 4. 数据模型 v1.0

### Atom（记忆原子，三层表）

```
Atom {
  id: 'nex_<16hex>';  fp: string                  // 内容指纹（去重键）
  kind: 'fact'|'decision'|'preference'|'lesson'|'episode'   // 内容轴
  slot: 'personal'|'feedback'|'project'|'reference'        // 用途轴（五家收敛四槽位）
  provenance: 'user-declared'|'model-inferred'|'agent-curated'
  scope: 'user'|'project'|'episode';  projectRef?: string   // 归属轴
  subject: string;  statement: string;  cues: string[]     // 线索（编码特异性）
  confidence: number       // 0..1 当下可信度（来源强度）
  weight: number           // 1..20 强度（引用巩固 +1/3次，遗忘曲线衰减，pinned 豁免）
  pinned: boolean
  status: 'pending'|'needs-review'|'active'|'superseded'|'archived'
  injected: boolean        // 是否进入索引（审核过 ≠ 常驻）
  supersedes?: MemoryId;  supersededBy?: MemoryId         // 永不删除，只指针
  sources: { sessionId; seq; quote? }[]                   // 原话片段（抗重建失真）
  embedding?: { provider; dim; vec }                      // 可选
  createdAt / updatedAt / reviewedAt? / reviewNote?
}
```

### Edge-lite（关联，只存不玩）

> **v0.2 只开零 LLM 边**：`provenance`（supersedes/sources 转化）与 `co-occurrence`（同窗口实体共现）默认开；`semantic` 语义边默认**关**（v0.3 可选增强，避免 v0.2 额外 token 开销）。边与原子同生命周期归档。

```
Edge { id; from; to; rel; kind: 'provenance'|'co-occurrence'|'wiki'; confidence; suspended; sources[] }
```

### RecallRecord（成本/命中账本）

```
RecallRecord { id; at; sessionId; turn; step; queryPreview; hits[{atomId; score; source}]; injectedBytes; served?: boolean }
```

> **实现状态（§4 全节）**：⚠️ 三处与代码不符。
> ① **`embedding?` 字段已删**（V0.9 审计判定为真死代码，0.5.1 移除），但上面的 Atom 定义里还留着；
> ② `RecallRecord` 的 **`served?` 字段不存在**（`src/atom.ts:124-137`）；
> ③ Edge 的 `kind` 文档写 `'provenance'|'co-occurrence'|'wiki'`，代码是 `'provenance'|'co-occurrence'|'semantic'`（`src/atom.ts:113`）；
> ④ **状态枚举里没有 `deleted`**（`src/atom.ts:52` 只有 pending/needs-review/active/superseded/archived）—— `V0.5-DESIGN.md` D4 设计的「回收站 = `status: deleted` + `deletedAt`」没有按那种形式实现，实际是 `archived` + `reviewNote: 'user-deleted'`。
> 属实的部分：三层轴（kind/slot/scope）、四槽位、provenance、cues、weight/confidence 分离、supersedes 指针、sources[].quote。

### Atom 状态机（用户可感知两级，其余幕后）

```
pending ──批量确认──▶ active ──冲突──▶ needs-review（置顶 [冲突]，一句话裁决）
   │ 7天过期/用户拒绝       │                 │
   └────────▶ archived ◀───┘──superseded──◀──┘   （永不删除，只指针）
```

> **实现状态**：❌ 图中的「**7 天过期**」不存在（pending 只按条数淘汰，见 §5.5）；「用户拒绝」「冲突」「superseded」「永不删除只指针」属实。

---

## 5. 行为管线

### 5.1 捕获与提取（三通道）

| 通道 | 触发 | 成本 | 产物 |
|---|---|---|---|
| 确定性 | 用户原话触发词（记住/以后都/习惯是…）、`goal/changed`·`todo/write` 事件、工具失败教训（规则提取） | 0 token | user-declared 直写 + provenance/共现边（diff 门控：无变化不写） |
| LLM 收尾提炼 | turn 成功结束 AND ≥3 轮 AND 冷却AND ≥1 工具（排除 idle/aborted/subagent） | 1 次调用（≤2 条） | 候选 → pending（批量 review，不弹窗） |
| 硬拒绝 | 临时话题 / 代码可推导 / AGENTS.md·规则已有 / MCP·web 检索来源 / **模糊句**（疑问、感叹、无主语心理活动、一时情绪） | 0 | 不入库（对齐 Claude/ZCode skip 规则 + Codex disable_on_external_context）；**全部记录 RejectLog**（样本 + 规则 ID + 类型）|

全部 fail-open：任何异常只记日志，绝不阻断对话。

> **实现状态（§5.1）**：✅ 三通道已可用。
> ① 「硬拒绝」的 5 类规则**现已全部生效**：`临时话题`（显式当下性标记，保守判定）与 `可推导`（自述来源是仓库文件）此前只声明不返回，已补齐；`规则文件已有` 的 `rulesText` 现由 scheduler 从 cwd 的 `AGENTS.md` / `CLAUDE.md` 读取并传入（按 cwd 缓存、fail-open）—— 旧实现从来不传，那条规则在生产里永不触发。仅 `source`（外部来源）仍无生产调用方，因为上游 `textOfUser` 已把插件来源的消息整条挡掉了。
> ② LLM 收尾提炼的真实门控是「会话 dispose 且 user 消息 ≥2」，上表的「≥3 轮 AND 冷却 AND ≥1 工具」并未实现；产出条数也没有「≤2 条」限制。
> ③ 确定性通道②（goal/todo）**已修**：这两个事件 DSH 是作为 **session 事件**走 `session/event` firehose 发的，旧实现 `ctx.on('goal/change')` 挂在错的 bus 上**从未触发**；且落库写死 `sessionId: 'host'`，episode 记忆只在本会话注入 → 即便触发也永不注入。现在从 firehose 取真实 session 并把 `projectRef` 传给抽取器。
> ④ RejectLog **现已覆盖写入侧全部拒收**：触发词硬拒、扫描器拒收、门控拒收、用户拒绝四条路径都留样本（此前只有第一与第四条）。

### 5.2 门控矩阵（写入时，编码深度排序）

| 候选 | 动作 |
|---|---|
| feedback（你纠正模型的行为） | 高优先级：阈值 0.9 → active 或 pending；`[feedback]` 角标 |
| decision（你拍板）/ preference（你习惯）× user-declared | 阈值 0.9 → active；冲突 → needs-review |
| fact / lesson × user-declared | 阈值 0.9 → active |
| 任何 × model-inferred | 阈值 0.95；否则 pending（批量 review） |
| agent-curated（工具写入） | active，`injected` 由人再调 |
| 与 active preference 冲突 | **needs-review** 置顶 `[冲突]`，绝不自动 supersede 用户偏好 |

**拒绝回流（RejectLog）**：每次 reject / 硬拒记录（样本、类型、触发规则 ID）→ 月度规则报告（哪些规则误杀/漏杀、覆盖率）→ 半自动规则更新（规则版本化 + `dry-run` 预览）；被拒样本同时作为提取器提示的负样例上下文（下次提炼时注入最近 5 条误杀模式）。

**Pending 队列防堆积（评审增量）**：pending 是『建议候选』，**永不进入冻结索引**；上限 `pendingMax`（默认 200），超限按最老时间淘汰并记录；未确认候选每天最多进入一次『待确认』提醒（聚合，不弹窗）。

### 5.3 注入（三层，缓存友好）

1. **稳定层**：`systemPrompt.section`——工具指南（文本恒定）；
2. **冻结索引**：会话第一次请求注入 `## 记忆` 段（一行一条：`[slot] subject：statement（weight）`；pinned/weight 排序；≤1KB；`[n% — x/y chars]` 用量表头）；会话内写入落盘但**不改已注入内容**（下会话生效）；
   > **实现状态**：⚠️ 原写「≤1KB / **200 行截断**」——**行数上限不存在**（`src/projection.ts:51-67` 只有字节预算，没有行数上限；1KB 下也到不了 200 行）。该承诺已撤销，正文已删除。冻结、排序、表头格式与实现一致。
3. **按需层**：`memory_search` / `memory_read`（触发词自动补检索；追加不替换）。
3.1 **冲突被动感知（不弹窗折中）**：当冻结索引/按需结果中存在 `[冲突]` 记忆时，索引末尾追加一行轻量提示：`⚠️ N 条冲突记忆待裁决（/memory conflict）`——被动可见，不打断。

护栏：已见账本（同一会话至多一次）；固定不可信框定（『可能相关的记忆，仅供参考：』+ 防注入警告）；写入侧安全扫描（提示注入/外泄/危险指令命中即拒）；软硬边界声明（记忆不承载禁令）。

### 5.4 检索

- **默认文本检索**（0 token）：2/3-gram CJK + 英文词 + 代码标识符；标题 2.5× 加权；`cues` 命中加权；epoch 感知 1 小时时间桶 LRU 查询缓存（`limit` 不进缓存键）；
  > **实现状态**：✅ 已对齐。实际算法是**加权重叠 + IDF 稀有度因子**（`src/text.ts:148-164`、`src/retriever-text.ts:126-152`）—— **没有 tf 饱和，也没有长度归一，所以不是 BM25**，本节的措辞已按此更正。分词方式、标题 2.5×、cues 加权、查询缓存四点属实。
- **向量可选**（开关 + HTTP encoder + RRF 融合；默认参数 rrfK=60 / topK=6；**降级语义**：单次超时/报错 → 跳过向量用纯文本；连续 3 次失败 → 自动停用向量直到下次成功或重开配置；降级全程有事件与日志）；
  > **实现状态**：⚠️ 代码完整但**本部署从未配置**外部 embedding 服务，属「默认关闭、零使用、零测试」；`docs/V0.9-SURFACE-AUDIT.md` 已将其列为「建议删，待决定」。另：该模块的降级事件未实现，只有日志。
- 质量门槛：固定 holdout 集 Top-5 ≥ 0.8（随 `npm test` 执行）；**cues 决不依赖 LLM 单独成功**：LLM 提取失败时回退 subject+statement 的确定性切词（2/3-gram + 实体词），线索字段永不为空；
  > **实现状态**：✅ 已对齐（原写 ≥90% 且称 CI 门禁）。实际基准是 `bench/holdout.ts`（10 场景 / 12 查询），门槛 **0.8**（`bench/holdout.ts:75`，注释写明「CI 将调至 0.9 当向量/语义上线」），且目前**只有召回命中一个指标**，端到端完成度未做。§11 过去把它列为 v0.3 待办，与本处矛盾 —— 已在 §11 更正。cues 的确定性兜底属实。
- 检索只服务工具调用，不自动注入全文。

### 5.5 生命周期（最小集）

> **实现状态（整节）**：⚠️ 部分落地。`runLifecycle` **已接线**（`NexusFacility` 的写入路径 saveAtom / review 驱动，模块内 6 小时节流、无后台定时器）——
> 此前它全仓零调用点，权重衰减从未运行过。**episode TTL 已按决定删除**（它与下面「active 永不受时间影响」冲突）。逐条：

- 去重合并（同 subject 同 slot 近义，自动）；⚠️ 实现是「标记为待确认 + 疑似重复」，**不自动合并**
- 冲突需人裁（置顶 + `[冲突]` + CONFLICT 事件）；✅ 属实（事件名为 `nexus/memory/conflict-detected`）
- 待确认过期 → archived（适应性遗忘；`pinned` 候选不设过期；**已确认的 active 记忆永不受时间影响**——有效期只由冲突与人工裁决驱动）；
  > ⚠️ **已实现，但期限收敛为单一 30 天**（`PENDING_TTL_DAYS`，由生命周期 tick 执行，reviewNote=`pending-expired`，pinned 豁免）。原设计的**三档**（feedback 14 / fact·reference 30 / decision·preference 60）需要三份常量与三份解释，当前样本量支撑不起这个精细度 —— 等有真实分布再加档。「慢热保护」（过期前 1 天提示）与「误杀纳入月度 review」**未实现**。
  > 另：pending 仍有**条数**上限淘汰（`pendingMax=200`，`src/facility.ts`），与时间过期并存。
- 永不删除：supersede / archive 指针，可回溯 lineage；
  > ✅ 指针机制属实；`memory_read(id, trace: true)` 现已沿指针**双向走完整链**。
- **无时间衰减判失效**：weight（强度）按遗忘曲线降、下限 1；confidence（可信度）仅由冲突与来源决定；
  > ✅ **现已生效**：衰减在写入路径被驱动（30 天 −1、下限 1、衰减不刷新 updatedAt）；confidence 不随时间变属实。
- v0.3：周频离线整合器（高频同类 → 概括记忆 model-inferred，**默认进 pending，绝不直接 active**，原文永不删；备份+断点+dry-run）；
  > ⚠️ 已存在的是 `src/integrator.ts` + `/memory integrate`（默认 dry-run），但**零使用、零测试**，V0.9 审计列为待决定项。
- ~~**冷迁移（默认关，高级开启）**：archived atoms 可按配置移出主表（仅 trace 可溯），`coldArchive: false` 默认；recalls 365 天滚动 + 可选保留期归档~~：🗑️ **承诺已撤销**（0.8.9 删除）。`coldArchive` 配置项被解析后**无任何消费者**、冷迁移代码从未存在；recalls 实际按**条数**（2000）滚动，不是 365 天。
- ~~episode 90 天 TTL 归档~~：🗑️ **承诺已撤销**。原实现会按时间归档 active 的 episode 记忆，与本节「active 永不受时间影响」直接冲突，也贴近 §12 反目标「时间衰减判失效」。代码已删，回归测试断言 900 天前的 episode 记忆仍是 active。

### 5.6 成本控制（自保机制）

- `/memory cost`：注入 / 提炼 / 编码各自 token 数，按 provider/model 明细，365 天滚动；
- **自动降级**：注入内容连续 7 天零使用（recall ledger 判定）→ 自动『只写不读』+ 提示一行；
- 一键全关（只写不读 / 完全关闭）；
- 预算滚动窗口（按 turn 收紧）+ 提炼限速（低于剩余额度阈值时跳过一次）。


### 5.7 宿主兼容性契约（能力探测 + 优雅降级）

> 原则：**任何 DSH seam 依赖都视为『可用则用、不可用则降级』，绝不 crash，绝不让记忆系统拖垮会话。**

| DSH seam | 不可用时 | 降级行为 | 告警 |
|---|---|---|---|
| ~~`dsh-inject-scheduler`~~ | ~~未挂载~~ | 🗑️ **该行承诺已撤销**：seam 从未被探测（全仓无该符号），`agent/pre-step` 是唯一注入路径，「回退」无对象 | — |
| `session.meta.cwd` | 缺失/不可读 | 关闭 project 层记忆（projectRef 置空），user/episode 不受影响 | 事件 + 配置页标注 |
| `llm.purpose` 仅 compaction/session-title | Nexus 需打业务标记 | 省略 purpose 继续运行（已知限制），日志标记 | 事件 + README 已知限制 |
| `sessionProjections` | 未挂载 | 节流退化为进程内状态（会话级） | 事件 `nexus/degraded` |
| `storageDomain` 后端故障 | 写失败 | fail-open：逐条原子写，失败仅日志；投影置脏位待重试 | 日志 + 脏位状态可在 /memory status 看到 |
| 事件模型变更（session/event 签名变动） | 不兼容版本 | 版本探测 → 禁用自动捕获，仅保留工具/命令通道 | 启动告警 + 版本兼容矩阵 |

> **实现状态（§5.7）**：⚠️ 本节一半是空条款 —— 已按「要么做、要么撤销承诺」逐条裁定：
> ① `dsh-inject-scheduler` **从未被探测**（全仓无该符号）—— `agent/pre-step` 是唯一注入路径，所谓「回退」无对象。🗑️ **该行承诺已撤销**。
> ② 只有 `sessionProjections` / `storageDomain` / `tools` / `commands` 四项被 `probeHost` 探测，且只在启动时发**一个聚合** `nexus/degraded` 事件；cwd 缺失与 sessionProjections 缺失只有 `console.warn`，**不发事件**。上表「每个 seam 一条告警」的写法与实际不符，**以本行为准**。
> ③ 「脏位」🗑️ **决定不做**：写入 fail-open、进程崩溃最多丢当前一条，这已在设计取舍之内；`/memory status` 因此不显示脏位。但 `storeWritable` 已从硬编码 `true` 改为真实写探测（`store.probeWritable()`），✖ 分支现在可达。
> ④ 「Schema 迁移」的实际范围：**域 `version`（当前 1）+ 拒绝读取更高版本 + 幂等清扫游标**（`src/migrate.ts`）。`compatibleVersions`、逐版迁移脚本表、迁移前备份 🗑️ **未实现**，上表相应承诺以本行为准。

**写一致性**：所有写入走 storage-domain 原子写链（`KvTable.put/update`）；提取批量 = 逐条幂等 put（`fp` 去重），进程崩溃最多丢当前一条，重启重跑安全；投影与原子库双通道，任一失败置脏位、下次写入重试。

> **实现状态**：⚠️ 写链属实（`src/store.ts:125-127`）；但 **`fp` 去重不存在**（`atom.fp` 写入后全仓无读取点），**脏位与重试也不存在**；写入失败只会 `console.warn` 一次，且失败的那条会**静默丢失**（`facility` 调用 `store.putAtom` 时没有兜底）。

**Schema 迁移**：域 `version` 递增 + 记录 `compatibleVersions` + 启动时逐版迁移脚本（只读老版本、迁移到新版本后写回）；迁移前自动备份；迁移失败保持旧版可读并告警。

> **实现状态**：⚠️ 只有「域 version=1 + 拒绝读取更高版本 + 幂等清扫游标」（`src/migrate.ts:11,49-91`）。**`compatibleVersions`、逐版迁移脚本表、迁移前备份都不存在**（`compatibleVersions` 只出现在本文档里）。

---

## 6. 处理器接口与事件（开发者面，默认单链）

```
interface ExtractorProcessor   { id; extract(input): Promise<ExtractOutput> }              // 多活链（预留）
interface RetrieverProcessor   { id; retrieve(input, signal): Promise<RetrievedAtom[]> }    // 多活融合（预留）
interface ForgetterProcessor   { id; forget(candidate, snap): Promise<ForgetPlan> }         // 单活
interface EncoderProcessor     { id; dim; encode(text): Promise<number[]> }                 // 单活（向量可选）
interface SecurityScannerProcessor { id; scan(candidate): Promise<ScanVerdict> }            // 多活链
ForgetPlan: write-new | merge-into | supersede | needs-review | reject
```

事件（声明式，可审计，供 DSH 生态消费）——**实际 emit 的是这 7 个**：
`nexus/memory/{pending,saved,rejected,superseded,conflict-detected}`、`nexus/memory/recalled`、`nexus/degraded`。

> **实现状态（§6）**：✅ 已对齐。原清单列了 11 个，其中 6 个从未 emit，现已从清单移除：
> - `nexus/store/opened`：在 `src/events.ts` 有类型声明，但全仓无 `emit` 调用点；
> - `nexus/memory/archived`、`nexus/memory/decayed`、`nexus/recall/gated`、`nexus/feedback/applied`、`nexus/edge/added`：**连类型声明都没有** —— 不是「忘了 emit」，而是尚未设计。
>
> 反向补齐了一个：`nexus/memory/recalled`（实现里有声明也有 emit，原清单漏了它）。

---

## 7. 用户面（工具 / 命令 / 文件）

| 面 | 入口 | 说明 |
|---|---|---|
| 模型 | `memory_remember` `memory_forget` `memory_search` `memory_read` `memory_feedback` | 一句话管理；检索只走工具。`memory_read` 默认只读 active；`trace: true` 时返回 superseded/archived 链（带状态标注）——归档记忆可查不可污染召回。`memory_feedback(ids, good\|bad)` 按反馈调权重（good 加权并刷新时间，bad 降权且不刷新） |
| 人类 | `/memory`（list / search / show / edit / delete / confirm / reject / conflict / cost / doctor / session / import / integrate / skill-compile / purge） | 冲突裁决 = 一键三选（keep-new / keep-old / keep-both）+ 批量入口（`--all`）；edit 改陈述会重算指纹与线索，delete 走回收站；彻底清除在面板回收站 |
| 人类 | 对话直接说『记住…』『忘掉…』 | 零 token 确定性通道 |
| 人类 | 直接编辑 `MEMORY.md` / `USER.md` | 改完回灌原子（user-declared） |

> **实现状态（§7）**：✅ 工具面与命令面已对齐。
> ① **工具是五个**：`memory_remember` / `memory_forget` / `memory_search` / `memory_read` / **`memory_feedback`**（已补进上表）。`memory_feedback` 的 `bad` 分支曾因 `kind` 未被读取而**增加**权重，已修。
> ② `memory_read` **现已默认只读 active**（非 active 返回带 `trace` 提示的说明），`trace: true` 会沿 `supersedes` / `supersededBy` **双向走完整归档链**（带环与长度保护）。
> ③ **`/memory edit` 与 `/memory delete` 已实现**（delete 走回收站路径，与面板同一条）；**冲突一键三选 + `--all` 批量已实现**（keep-new / keep-old / keep-both）；`reject` 的可选原因已修（按 `nex_` 前缀区分 id 与原因）。
> ④ 面板已不是「v0.3 待做」：**单一实现**（只有 BPanel；`?panel=old` / `?panel=sample` 与两套旧面板已删除）。删旧面板时丢掉「手动合并近义重复」的入口，已登记为待补（检测与后端接口都还在）。

---

## 8. 配置面（默认零配置）

> ⚠️ 本节原写「≤5 项可调」，与实际不符（Config 接口 20 个顶层字段，数字由 `config-knob-count` 探针维护）。
> 下面的配置块里 `edges:` **仍不存在**、`mode` 与 `coldArchive` 是死旋钮 —— 详见本节末尾的「实现状态」。

> **安装即用承诺**：web profile 用户只需 `dsh plugin --profile web add @chenqiuyushuang/dsh-nexus` + 重启，其余全默认。**存储后端默认跟随宿主 storage-domain 默认后端（web=json，零操作）**；sqlite 为一行可选升级（`dsh-storage-sqlite` + `routes: { nexus_memory: sqlite }`）。headless/TUI/自定义 profile 需按 DSH 惯例补 storage 三行（一次性）。

```yaml
- id: nexus
  name: '@chenqiuyushuang/dsh-nexus'   # 旧名 @chenqiuyushuang/nexus 已不用
  config:
    mode: standard                # strict | standard（默认）| loose —— ⚠️ 解析但无行为分支（死旋钮）
    indexBudgetBytes: 1024        # 注入索引预算 ✅
    extract: reminder             # deterministic | reminder（默认）| off ✅
    vector: false                 # 可选 embedding endpoint ✅（默认关）
    autoDegradeDays: 7            # 连续无使用 → 只写不读 ✅
    pendingMax: 200               # 待确认上限，超限按最老淘汰 ✅
    scannerRules: minimal         # minimal（默认）| recommended ✅
    # ~~mode~~ / ~~coldArchive~~ / ~~edges~~：🗑️ 均已删除（前两个是零消费者的死旋钮，第三个从未进 schema）
```

**三模式差异**（其余同配置）：`strict` 只注入高置信（≥0.95）+ 不注入 model-inferred；`standard` 阈值 0.9/0.95 + 全文索引；`loose` 阈值 0.8 + 含 model-inferred 标注。

> **实现状态（§8）**：✅ 已按处置决定收敛。
> ① **包名已改**：实际是 `@chenqiuyushuang/dsh-nexus`。
> ② **`scannerRules` 已接入**（`src/config.ts` + `src/index.ts` 读取 `resolved.scannerRules`），`recommended` 规则集不再是运行时不可达的死配置。
> ③ **`mode`（三模式差异）与 `coldArchive` 已删除**：二者此前只被解析、没有任何消费者；按 Q3（零消费者 → 删）从 Config schema、ResolvedConfig 与文档中一并移除。`edges:` 从未进过 schema，文档承诺也一并删除。
> ④ 旋钮数量过去在三处口径不一（本节「≤5 项」/ `src/config.ts` 注释「≤8 tunables」/ 实际值）。现在**不再写死数字**，由 `docs:check` 的 `config-knob-count` 探针数并核对。
> 属实的部分：`indexBudgetBytes: 1024`、`extract: reminder`、`autoDegradeDays: 7`、`pendingMax: 200`、`vector: false`、`scannerRules: minimal`、`sessionModeDefault: read-write` 的默认值与实现一致。

---

## 9. Token 经济（用户问得最多的账）

- **支出**：索引注入 500–800 token/会话（每天 4 会话 ≈ 3K）；收尾提炼 ≤2–3 次/天 ≈ 7K；合计每天 ≈ 1–1.2 万 token，占重度用户每天消耗的 **2–3%**；
- **节省**：同组 A/B 实测——无记忆 181 万输入 vs 有记忆 26.6 万（**6.8×**）、步骤 +70%、输出 3×；注入轮平均快 210ms；稳态缓存命中率 **89.1%**（记忆注入不伤缓存）；
- **零 token 路径**：确定性提取 0、文本检索 0、索引生成 0；
- **自保**：成本账本 + 7 天零用自动只写不读 + 一键全关；
- **诚实边界**：单会话轻量用法 → 净支出，建议关闭；跨会话长期项目 → 净节省 30–80%。

---

## 10. 验收清单（『好用』五标准的可测试化）

1. 装好零配置，会话开场索引注入一次，前缀稳定（缓存友好）；
2. 『记住 X』零 token 入库；下会话模型接得上『上次那件事』；
3. 收尾候选进待确认，无弹窗；7 天过期归档；
4. 同一条绝不重复注入；垃圾三拒（临时/可推导/外部）硬编码有效；
5. 三条路径改一条记忆（对话/命令/文件），改完立即生效；
6. `/memory cost` 数字齐全；
7. 注入 7 天零使用 → 自动只写不读 + 提示；
8. 冲突置顶 `[冲突]`，一句话裁决，绝不静默篡改；
9. `memory_read` 显示原文出处（quote + 会话引用）；
10. 语义相近措辞不同（『发布』vs『部署』）能搜到（cues 生效）；
11. 30 天稳定性：0 次脏注入 / 0 次重复注入 / 0 次会话阻塞。
12. `pinned` 记忆永不自动过期；待确认按类型分级期限归档（评审意见 #1）；
13. 冲突裁决一键三选 + 批量入口可用（评审意见 #2）；
14. RejectLog 月度报告可产出（评审意见 #4）。

> **实现状态（§10）**：14 条里 **11 条已达成**，3 条部分达成。逐条核对：
> - ⚠️ **#3**：收尾候选进待确认、无弹窗属实；过期归档**已实现**，但期限是**统一 30 天**而非原设计的 7 天/分级。
> - ⚠️ **#4**：「不重复注入」属实；「垃圾三拒」中的**临时话题与可推导已补齐**，规则文件已有也因 `rulesText` 接通而生效；只有「外部来源」仍依赖上游过滤。
> - ✅ **#12**：`pinned` 免过期现在是真保护（pending 过期路径显式跳过 pinned）；分级期限**已按简化后的单一档实现**（见 §5.5）。
> - ✅ **#13**：一键三选（keep-new / keep-old / keep-both）与 `--all` 批量**已实现**，见 §7。
> - ⚠️ **#14**：RejectLog **已覆盖写入侧四条路径**，但**月度报告产出仍未做**。
> - ✅ **#9**：`memory_read` 现在默认只读 active，`trace: true` 会走完整归档链。
> - ✅ #1 #2 #6 #7 #8 #10 基本属实；#5 的「文件路径」（改 MEMORY.md 回灌原子）属实；#11 是长期承诺，本次未验证。

---

## 11. 路线图

- **v0.2（MVP）**：Atom v2（含 cues/quote/slot）+ Edge-lite（仅零 LLM 边）+ 三通道提取 + 门控矩阵 + **宿主兼容性探测与降级** + 索引冻结注入 + 文本检索 + 冲突 needs-review（一键 A/B + 批量 + 索引尾行轻量提示）+ 工具/命令 + 反馈记账（ok/bad）+ RejectLog 拒绝回流 + pending 上限淘汰 + 会话开关 + 扫描器（含推荐规则集样例）+ 成本账本 + 自动降级；
- **v0.3**：周频离线整合器（CLS 新皮层功能；概括记忆默认 pending、原文永不删、风险说明）+ 语义边（默认关→可选开）+ 向量/RRF 可选 + 成本看板 + 原生 slot 记忆工作台（含『相关记忆』邻里图）+ 跨生态导入（分批限流 + 上限）+ 技能编译（≥3 次强化 lesson 集合 → SKILL.md 草稿进 pending，失败回滚=不改原文）+ **自有 holdout 基准（双指标：① 召回命中②端到端完成度；CI 门禁；坦诚局限：召回命中≠模型实际采纳）**；
- **v1.0**：MemBench 式 A/B 基准（CI 门槛）+ 项目记忆 git 共享 + 反馈闭环硬化（隔离/恢复）。

> **实现状态（§11）**：⚠️ 两处要更正。
> ① 「BM25 检索」已在上文改为「文本检索」——实际实现是加权重叠 + IDF（无 tf 饱和与长度归一）。
> ② **holdout 基准并非「v0.3 才做」**：它已经存在（`bench/holdout.ts`，10 场景 / 12 查询）并随 `npm test` 执行，只是门槛为 **0.8** 而非 §5.4 写的 90%，且只有召回命中一个指标（端到端完成度未做）。§5.4 与本节过去互相矛盾，以此处为准。

---

## 12. 反目标（坚定不做）

弹窗审批 · 会话模式矩阵 · 图寻路/BFS · 时间衰减判失效 · 多用户 · 云端同步 · 独立 SPA · MCP 服务端 · dream 高频代谢 · 处理器多活默认（接口保留）。

---

## 13. 一句话总结

**骨架照搬五家收敛发明（规则/记忆双轨 + 四槽位 + 索引两段式），机制采用脑科学验证过的生命周期（强度衰减/干扰竞争/适应性遗忘/离线巩固），检索依赖线索编码（cues + quote），成本自保（零 token 路径 + 账本 + 自动降级），体验零打扰（队列不弹窗、冲突人裁、三秒改得动）——这就是 Nexus。**

---

## 14. 评审意见处理记录（第一份评审，v1.0.1）

> 见上一版记录：7 天归档分级期限 / 冲突一键三选+批量 / holdout 基准提前 / RejectLog 拒绝回流。

---


## 15. 第二份评审意见处理记录（工程评审，v1.0.2）

| 风险/建议 | 结论 | 处理 |
|---|---|---|
| 宿主 DSH 强耦合缺降级（高风险） | **采纳（置顶）** | 新增 §5.7 宿主兼容性契约：每个 seam 依赖 = 能力探测 + 优雅降级 + 告警事件；**任一 seam 探测失败 → 按 §5.7 降级矩阵处理**（如 `session.meta.cwd` 缺失 → 关闭 project 层但不 crash；`purpose` 受限 → 日志+风险标记继续跑）；schema 迁移 = 版本戳 + compatibleVersions + 逐版迁移脚本；写入走 storage-domain 原子写链（逐条 put，崩溃最多丢当前条，重跑幂等） |
| LLM 提炼噪声：pending 堆积 | **采纳** | pending 上限 200 超限淘汰最老；明确 pending 永不进冻结索引；模糊句（疑问/感叹/无主语/一时情绪）加入硬拒绝规则 |
| 冲突记忆用户被动感知弱 | **采纳（折中恰当）** | 不弹窗保持；索引末尾轻量提示 `⚠️ N 条冲突待裁决（/memory conflict）`——被动可见零打断 |
| 检索：BM25 分词边界 / 向量调参 / cues 依赖 LLM | **采纳** | 代码标识符独立 tokenize；RRF 默认参数与降级语义写入文档（连续 3 次失败自动停用向量）；cues 兜底 = 确定性切词，永不为空 |
| 存储膨胀、投影批量编辑、schema 迁移 | **采纳** | archived 冷迁移（默认关）+ recalls 滚动；投影回灌=逐条原子 diff 不做整文件合并；导入分批限流；迁移策略见 §5.7 |
| 安全扫描偏弱 | **采纳** | 文档内置推荐规则集样例（提示注入/外泄/危险指令），`scannerRules: minimal|recommended`；明确 minimal 仅为基线 |
| Edge semantics 额外 token | **采纳（正确降本）** | v0.2 只开 provenance/co-occurrence，semantic 默认关 v0.3 可选 |
| 路线图边界模糊（整合器/技能/基准） | **采纳** | 三者风险与输入输出已明确化：概括记忆默认 pending；技能=≥3 次强化 lesson→SKILL.md 草稿进 pending+失败不改原文；基准双指标+局限声明 |
| 异常边界（崩溃半写/磁盘满/archive 读取） | **采纳** | 原子写链+幂等重跑；投影脏位重试不阻断；memory_read 默认 active、trace 可查归档链 |
| 文档产出建议（排障手册/配置/枚举） | **采纳** | §8 三模式完整配置；§16 故障排查手册；ScanVerdict/ForgetPlan 完整枚举已定，实现时随包发布 |
## 16. 故障排查手册（v0.2 随包发布）

| 症状 | 原因 | 处理 |
|---|---|---|
| pending 堆积 | 提炼噪声或长期不 review | 上限淘汰已自动生效；`/memory cost` 看提炼量；降低 `extract` 档位或 `off` |
| 索引里出现 `[冲突]` | 新记忆与你的偏好矛盾 | `/memory conflict` 一键三选（保留新/保留旧/两条都要）+ 批量 |
| 向量检索无效果 | embedding 端点不可用 | 自动降级纯文本（3 次失败停用）；检查 endpoint/model/dim；事件日志有降级记录 |
| 投影与原子库不一致 | 手动编辑了 MEMORY.md 或写入失败 | 投影回灌按逐条 diff；脏位自动重试；必要时 `/memory resync` |
| 记忆突然只写不读 | 7 天零使用自动降级（自保机制） | 提示行有说明；`/memory cost` 确认；手动重开 `injected` 或调 `autoDegradeDays` |
| 宿主升级后行为异常 | DSH 内部 seam 变更 | 查看 nexus 告警事件；§5.7 降级矩阵自动切换；升级前跑 holdout 回归 |
| 存储膨胀 | 归档不冷迁移（冷迁移与 `coldArchive` 已删除，见 §5.5） | 归档 + 回收站彻底清除（`/memory purge`、面板回收站「彻底清除」）；recalls 按 2000 条滚动 |
| 提取失败但会话正常 | fail-open 设计 | 日志可查；候选丢失不致命（确定性通道仍在工作） |

---