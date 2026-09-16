# Nexus 实现状态总表（机器校验）

> **本文件由 `npm run docs:status` 生成，请勿手改。** 唯一事实源是 `docs/status.json`。
> 校验：`npm run docs:check`（CI 与 pre-commit 都会跑）——它同时检查
> ① 每条声明的探针与代码事实一致；② 本文件与注册表一致；③ 处置与状态相容、非 keep 必须写理由。

这份表回答两个问题：**文档里写的功能，代码里到底有没有、接没接线、和描述是否一致**（状态）；
以及 **发现不一致之后打算怎么办**（处置）。

## 状态图例（现在怎样）

| 状态 | 含义 |
|---|---|
| ✅ 已实现 | 文档描述与运行行为一致，探针可证 |
| ⚠️ 部分实现 | 功能在，但覆盖面或参数与文档不同（差异写在「实测差异」列） |
| ⚠️ 与文档不一致 | 两处描述互相矛盾，或描述的是非默认路径 |
| 🧟 有代码未接线 | 模块/配置存在甚至带单测，但生产路径没有调用点或消费者 |
| ❌ 未实现 | 文档承诺，代码里没有 |

## 处置图例（打算怎么办）

| 处置 | 含义 |
|---|---|
| 🔧 改代码 | 按文档（或按设计意图）把实现补齐 / 接线 / 修缺陷 |
| 📄 改文档 | 承认现状，把承诺降级为与代码一致的表述 |
| 🗑️ 删 | 删掉代码、配置项或文档承诺（与原则冲突、无消费者、或纯多余） |
| ⏸️ 推迟 | 保留但明确标注为「未做」，并写明触发条件 |
| — 保持 | 已实现且一致，无需动作 |

> 裁定顺序（先到先判，前两步是硬否决）：
> **Q1 现状是不是缺陷？**（安全缺口 / 自相矛盾 / 功能死胡同）→ 是 → 🔧 改代码，没有「以代码为准」的空间；
> **Q2 承诺与项目自己的原则/反目标冲突吗？** → 是 → 🗑️ 两边都删；
> **Q3 还有消费者或用户价值吗？** → 没有 → 🗑️ 删；
> **Q4 都不是** → 比成本，默认偏 📄 改文档（改文档可逆、零回归，改代码有回归风险）。

## 汇总

| 状态 | 条数 |
|---|---|
| ✅ 已实现 | 76 |
| ⚠️ 部分实现 | 3 |
| ❌ 未实现 | 1 |
| 🗑️ 承诺已撤销 | 12 |
| **合计** | **92** |

| 处置 | 条数 |
|---|---|
| — 保持 | 88 |
| ⏸️ 推迟 | 4 |

## 写入与提取

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 触发词确定性捕获（记住／以后都／习惯是…） | NEXUS-DESIGN §5.1 | `src/extraction.ts:143, src/scheduler.ts:226` | 零 token 直写，user-declared 0.98；问句与「讨论助手记性」的句子会被挡掉 |
| ✅ 已实现 | — 保持 | 工具失败教训捕获 | NEXUS-DESIGN §5.1 | `src/extraction.ts:177, src/scheduler.ts:257-262` | 无 diff 门控，同一失败重复发生会重复入库 |
| ✅ 已实现 | — 保持 | goal／todo 状态事件捕获 | NEXUS-DESIGN §5.1（确定性通道②） | `src/scheduler.ts:257-274` | 已修两处：① 这两个事件 DSH 是作为 session 事件走 session/event firehose 发的，旧实现 ctx.on('goal/change') 挂在错的 bus 上从未触发；② 旧实现落库写死 sessionId='host'，episode 记忆只在本会话注入 → 即便触发也永不注入。现在从 firehose 取真实 session，并把 projectRef 传给抽取器 |
| ✅ 已实现 | — 保持 | LLM 收尾提炼（分窗 + 预算双闸） | NEXUS-DESIGN §5.1, V0.5-DESIGN D1/D2 | `src/scheduler.ts:392-463, src/budget.ts:63-80` | 触发条件是会话 dispose 且 user 消息 ≥2；文档写的「≥3 轮 AND 冷却 AND ≥1 工具」并未实现 |
| ✅ 已实现 | — 保持 | 默认零 token：未配置 extractorLlm 即不注册提取器 | README 成本契约 | `src/index.ts:82-84, src/scheduler.ts:398` | 「extract: reminder」是档位名，LLM 是否真调用取决于 extractorLlm 是否配置 |
| ✅ 已实现 | — 保持 | 硬拒绝规则（文档 5 条） | NEXUS-DESIGN §5.1/§5.2 | `src/extraction.ts:250-300, src/scheduler.ts:280` | 已补齐：临时话题（显式当下性标记，保守判定）与代码可推导（自述来源是仓库文件）两条规则真正返回；rulesText 由 scheduler 从 cwd 的 AGENTS.md/CLAUDE.md 读取并传入（按 cwd 缓存、fail-open）—— 规则文件已有那条不再永不触发。实际只有 `source` 入参仍无生产调用方（外部来源由 textOfUser 在更上游过滤） |
| ✅ 已实现 | — 保持 | RejectLog 拒收样本 | NEXUS-DESIGN §5.1/§5.2 | `src/facility.ts（logReject）, src/scheduler.ts:recordReject` | 已补齐：扫描器拒收与门控拒收现在也写 RejectLog（此前只有触发词硬拒与用户拒绝两条路径），样本表覆盖写入侧全部拒收 |
| ✅ 已实现 | — 保持 | fp 幂等去重 | NEXUS-DESIGN §5.7 | `src/facility.ts:170-177` | 已实现：saveAtom 先按 fp 查既有记录，命中即返回原记录（幂等 put）。此前 fp 只写不读 |
| ✅ 已实现 | — 保持 | pending 上限淘汰（pendingMax=200） | NEXUS-DESIGN §5.2 | `src/facility.ts:249-259` | 按 createdAt 淘汰最老；pinned 保护在此路径未被查询 |
| ✅ 已实现 | — 保持 | 待确认过期（单一 30 天；三档分级已收敛） | NEXUS-DESIGN §5.5（已按简化后的口径更正） | `src/lifecycle.ts:PENDING_TTL_DAYS, tests/lifecycle.test.ts` | 已实现：pending 超过 30 天由生命周期 tick 归档（reviewNote=pending-expired），pinned 候选豁免。**主动收敛为单一档**：设计稿的三档（14/30/60）需要三份常量与三份解释，当前样本量支撑不起这个精细度 —— 等有真实分布再加档 |
| ✅ 已实现 | — 保持 | 价值密度门（影子期：只记录不拦截） | README 设计要点, V0.9-VALUE-GATE | `src/value-gate.ts:53, src/facility.ts（recordValueShadow，saveAtomInner 内）, tests/facility.test.ts` | 打分口径与文档逐项一致。影子计数的覆盖面已修：调用点从 scheduler 的**触发词分支**移进 `Facility.saveAtom`（`recordValueShadow`，在 `buildAtom` 之后、gate/forgetter 分支之前），于是触发词、工具失败、goal/todo、`/memory` 命令、面板新增、导入、集成器八条写入路径全都记到，每条候选只记一次（重复内容在 fp 去重那步就返回，不重复计数；被安全扫描/黑名单拦下的候选不计）。回归背景：此前只有触发词一条路径记，而切换条件写的是「连续 7 天 / reject ≥50 条 / 误拦率 0」——样本只从一条路径来，那两个阈值根本测不到 |
| ❌ 未实现 | ⏸️ 推迟 | 价值门切换为拦截 | V0.9-VALUE-GATE「下一步」 | `无实现` | 仍是纯影子（`assessValue` 只记判定、不改写入行为）。回放证据（2026-09，真实库 34 条）：accept 0 / review 3 / reject 31，被拦的绝大多数是子代理回执与提示词这类历史垃圾，活跃条目里没有误拦 —— 即「误拦率 0」这条达标，但样本量与观察期（连续 7 天）都不够，且样本本身以垃圾为主 |
| ✅ 已实现 | — 保持 | 写入侧安全扫描（提示注入／密钥／身份证／危险指令） | NEXUS-DESIGN §5.2, README 安全 | `src/scanner.ts:24-60, src/index.ts:78` | 命中即拒、不落盘；缺 PEM／OpenSSH 私钥专用规则 |
| ✅ 已实现 | — 保持 | 子代理回执／提示词识别 | README 一键清理 | `src/noise.ts:12,19,26` | 用于写入拦截与面板「一键清理」横幅 |
| ✅ 已实现 | — 保持 | 问句形态判定（结尾「么」不再一律当问句） | NEXUS-DESIGN §5.1（模糊句硬拒） | `src/extraction.ts:QUESTION_RE, tests/extraction.test.ts, tests/golden.test.ts` | 本轮修批次 5 时实测发现：语气词类原为 [吗呢么]，于是**任何以「么」结尾的陈述句**都被判为问句 —— 「提交信息要用中文说明改了什么」这类正常约定会被 ambiguous-sentence 拦掉，并连带让排在后面的「规则文件已有」对一整类句子不可达。金标集里的 xf-03（A-16）早已登记此缺陷，现已转正 |

## 检索

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 默认文本检索（文档称 BM25） | NEXUS-DESIGN §2.1/§5.4（已改为「文本检索」） | `src/text.ts:148-164, src/retriever-text.ts:126-152` | 已对齐：设计稿不再称其为 BM25。实际算法是加权重叠 + IDF 稀有度因子（无 tf 饱和、无长度归一） |
| ✅ 已实现 | — 保持 | 标题 2.5× 加权 + cues 命中加权 | NEXUS-DESIGN §5.4 | `src/text.ts:153-155` | subject 命中 +2.5，cues 命中 +1.5，statement +1 |
| ✅ 已实现 | — 保持 | epoch 感知查询缓存（1 小时桶 + 库版本入键） | NEXUS-DESIGN §5.4 | `src/retriever-text.ts:22-47` | 库版本入键是后续修复，避免写入后 1 小时内仍返回旧结果 |
| ⚠️ 部分实现 | ⏸️ 推迟 | 向量检索 + RRF 融合（默认关） | NEXUS-DESIGN §5.4, V0.9-SURFACE-AUDIT | `src/retriever-vector.ts, src/config.ts 的 vector 解析, tests/retriever-vector.test.ts` | 代码完整（HttpEncoder + cosine + RRF 融合 + 降级契约），默认关闭：不传 / 传 false / 传 true 都得到 false（传 true 还会 warn 缺 endpoint/model/dim），要开启必须显式给 `vector: { endpoint, model, dim }`。2026-09 复核：宿主 DSH 没有 embeddings seam（checkout 的 packages/*/src 里搜不到 embedding 相关代码），所以它只能直连第三方 embedding HTTP 端点；而本机的 provider 里有 zai（智谱），其 embedding-3 是现成端点 —— 「没有 embedder」的准确说法是「从没配过」。本轮补了 tests/retriever-vector.test.ts（9 例：降级契约 / RRF 名次融合 / 余弦边界 / 三种回退），并因此抓出一个真缺陷：`HttpEncoder.encode` 抛错时不自增失败计数，「连续 3 次失败降级」实际由调用方代记 —— 单独用 encode 的那条路永远不会降级。已改成编码器自己计数（调用方不再补记）。 |
| ✅ 已实现 | — 保持 | holdout 检索质量门禁 | NEXUS-DESIGN §5.4/§11（已对齐） | `bench/holdout.ts:75, bench/bench.test.ts:9` | 已对齐：文档写明门槛 0.8、只有召回命中一个指标、端到端完成度未做；§5.4 与 §11 的矛盾已消除 |
| ✅ 已实现 | — 保持 | memory_search 单次 ≤1.5KB | V0.5-DESIGN D3 | `src/tools.ts:88-104` | 逐条截断 statement + 总量封顶，超出的条数会显式提示 |

## 注入

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 会话冻结索引注入（## 记忆） | NEXUS-DESIGN §5.3 | `src/scheduler.ts:294-348, src/projection.ts:51-67` | 按字节预算逐条判定，单条超预算直接跳过不截断 |
| ✅ 已实现 | — 保持 | 注入节流：指纹 + 跨轮 + injectIntervalMs | README 成本契约 | `src/scheduler.ts:319-328` | 修掉了「每 15s 重复注入同一块」的旧缺陷 |
| ✅ 已实现 | — 保持 | 上下文压缩后重新注入 | README:79 | `src/scheduler.ts:138-140, :247-249` | 监听 compaction/end 与 compaction/prune |
| ✅ 已实现 | — 保持 | 冲突尾行轻量提示 | NEXUS-DESIGN §5.3.1 | `src/scheduler.ts:87` | 被动可见、零打断，符合评审折中方案 |
| ✅ 已实现 | — 保持 | 索引行格式（★ / [slot] / subject：statement / （weight）） | NEXUS-DESIGN §5.3 | `src/atom.ts:179-186` | 主语与正文重复时只打印一次 |
| ✅ 已实现 | — 保持 | 用量表头 [n% — x/y chars] | NEXUS-DESIGN §5.3 | `src/projection.ts:42-45` | MEMORY.md / USER.md 各自也带一行表头 |
| 🗑️ 承诺已撤销 | — 保持 | 索引 ≤200 行截断（已撤销） | NEXUS-DESIGN §5.3 | `src/projection.ts:51-67` | 🗑️ 承诺撤销：字节预算已是更强约束（1KB 下不可能到 200 行）。文档已改为「只有字节预算，没有行数上限」 |
| ✅ 已实现 | — 保持 | 注入真相：六个未进入原因 | README:45 | `src/injection-truth.ts:20,146` | 枚举与文档一一对应；但「一键修法」只在旧面板（见面板组） |
| ✅ 已实现 | — 保持 | 数据与指令分离声明 + NFKC 扁平化 | V0.5-DESIGN D5 | `src/scheduler.ts:83, src/atom.ts:162-170` | 行/段分隔符、零宽与双向控制符全部折叠，防伪造段头 |

## 生命周期与删除

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 权重衰减（30 天 −1，下限 1） | NEXUS-DESIGN §5.5 | `src/lifecycle.ts:37-70, src/facility.ts:128-160` | 已修：`NexusFacility` 的写入路径（saveAtom / review）会驱动 tick，模块内 6 小时节流、无后台定时器。此前 runLifecycle 全仓零调用点 → 衰减从未执行 |
| 🗑️ 承诺已撤销 | — 保持 | episode 90 天 TTL 归档（已撤销） | NEXUS-DESIGN §5.5 未提及；与「active 永不受时间影响」冲突 | `src/lifecycle.ts（TTL 分支已删除）, tests/lifecycle.test.ts` | 已按 Q2 撤销承诺并删除代码：它按时间归档 active 记忆，与 §5.5「已确认的 active 记忆永不受时间影响——有效期只由冲突与人工裁决驱动」直接冲突，也贴近 §12 反目标「时间衰减判失效」。回归测试断言 900 天前的 episode 记忆仍是 active |
| ✅ 已实现 | — 保持 | recall 账本裁剪 | NEXUS-DESIGN §5.5 | `src/facility.ts:285, src/store.ts:147-153` | 走的是 facility 路径（上限 2000），不是 lifecycle 路径 |
| ✅ 已实现 | — 保持 | 回收站与恢复 | README:49, V0.5-DESIGN D4（已按实际表示法更正） | `src/web-ui.ts:316-333, src/ui/MemoryRow.tsx:147` | 已对齐：文档记录实际表示法 archived + reviewNote='user-deleted'（不采用 D4 设计的 status: deleted），并写明入口只在面板 |
| ✅ 已实现 | — 保持 | 彻底清除（真删 + 清边） | README:49 | `src/web-ui.ts:287-310, src/commands.ts:128-138` | 彻底清除（真删 + 清边）在面板回收站实现且只对用户移入回收站的条目生效；/memory purge 的语义已改为如实说明「归档可回溯，彻底清除在面板回收站」，不再与 README 的三态删除混淆 |
| 🗑️ 承诺已撤销 | — 保持 | status:'deleted' + deletedAt 状态（已撤销） | V0.5-DESIGN D4 | `src/atom.ts:52` | 🗑️ 承诺撤销：现有 5 态枚举 + reviewNote 已实现同等语义，为对齐 D4 而改枚举属纯迁移成本 |
| 🗑️ 承诺已撤销 | — 保持 | 回收站 7 天自动清除 | V0.5-DESIGN D4 | `无实现` | 不做了。回收站现有的两段式（归档 → 回收站 → 彻底清除）加面板二次确认已经够，而时间驱动的自动清除不可逆 —— 与「删除可回溯」这条不可动摇的约束直接冲突。按 Q2（与原则冲突 → 两边一起删）撤销该承诺：V0.5-DESIGN D4 与本条都标注为已撤销，不再作为待办。 |
| 🗑️ 承诺已撤销 | — 保持 | coldArchive 归档冷迁移（已删除） | NEXUS-DESIGN §5.5/§8/§16 | `src/config.ts（键已移除）` | 🗑️ 按 Q3 删除：该键被解析后无任何消费者，冷迁移代码也不存在。已从 Config schema、ResolvedConfig 与文档移除；旧配置里带着它仍能加载（schemastery 透传未知键） |
| ✅ 已实现 | — 保持 | 归档即黑名单（同句不再复活） | V0.5-DESIGN D4（已按实际口径更正） | `src/facility.ts:142-150, :304-310` | 已对齐：文档记录实际口径 —— 按归一化 statement 比对（不是 fp），且只有 user-reject 墓碑会拦 |
| ✅ 已实现 | — 保持 | 「已确认 active 记忆永不受时间影响」 | NEXUS-DESIGN §5.5 | `src/lifecycle.ts:1-15, tests/lifecycle.test.ts` | 已成立：episode TTL 删除后，没有任何按时间归档 active 记忆的路径（权重衰减只动 weight，不判失效） |

## 成本与降级

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 成本账本（inject／extract／encode 分类） | NEXUS-DESIGN §5.6 | `src/cost.ts:10-26, src/scheduler.ts:332, :443-447` | 提炼的输出侧也记账（此前恒 0 是已修缺陷） |
| ✅ 已实现 | — 保持 | 7 天零使用自动降级为只写不读 | NEXUS-DESIGN §5.6, README 成本契约 | `src/cost.ts:32-47, src/scheduler.ts:303-309` | 判定基准是最近一次「命中」优先、否则任意 recall 记录；降级只暂停注入并 console.warn 一次 |
| ✅ 已实现 | — 保持 | 提炼预算：每会话 ≤8 窗、每日 ≤20 万 token | V0.5-DESIGN 成本契约 | `src/budget.ts:21-25,63-80, src/config.ts:174-177` | 超限窗口计入 skippedWindows 并在会话小结里显示；在途预留防并发越闸 |
| ✅ 已实现 | — 保持 | 会话三态（read-write / write-only / pause） | README:77 | `src/scheduler.ts:55-68, src/commands.ts:184-193` | 面板三按钮改的是全局默认，/memory session 改的是会话覆盖 |
| ✅ 已实现 | — 保持 | sessionModeDefault 配置项 | README:77 | `src/scheduler.ts:164` | 已修：SessionModeControl 的默认值改读 config.sessionModeDefault（此前硬编码 read-write，配置永不生效） |

## 配置面

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 成本契约默认值（1024 B / 15000 ms / 7 天 / 200） | README 成本契约表 | `src/config.ts:153-162` | 与 README 表格逐项一致 |
| 🗑️ 承诺已撤销 | — 保持 | mode: strict | standard | loose 三模式（已删除） | NEXUS-DESIGN §8「三模式差异」 | `src/config.ts（NexusMode 与 schema 键已移除）` | 🗑️ 按 Q3 删除：零行为分支，只被解析并打进启动日志；三模式矩阵正是 §12 反目标排斥的复杂度。已从类型、schema、ResolvedConfig、启动日志与文档一并移除 |
| ✅ 已实现 | — 保持 | scannerRules: minimal | recommended | NEXUS-DESIGN §8/§15 | `src/config.ts:47,104,175, src/index.ts:78` | 已修：scannerRules 进入 Config schema（默认 minimal），createScanner 读它 —— RECOMMENDED_RULES 不再是运行时不可达的死规则集 |
| 🗑️ 承诺已撤销 | — 保持 | edges: { provenance, cooccurrence, semantic } 配置（已删除） | NEXUS-DESIGN §8 | `src/config.ts（该键从未进入 schema）` | 🗑️ 该键从未进过 Config schema，文档里的承诺已删除（边功能整体仍待决，先不留空旋钮） |
| ✅ 已实现 | — 保持 | 可调旋钮数量的三处口径 | NEXUS-DESIGN §8（不再写死数字） | `src/config.ts Config 接口；探针即事实源` | 已对齐：三处口径收敛为一处 —— §8 标题去掉「≤5 项」、config.ts 注释不再写死数字，实际数量由本探针数并核对（当前 18；mode 与 coldArchive 已按 Q3 删除） |
| ⚠️ 部分实现 | ⏸️ 推迟 | integrator 聚类配置（默认 dry-run） | NEXUS-DESIGN §11, V0.9-SURFACE-AUDIT | `src/config.ts:167-171, src/commands.ts:116` | 可触发（/memory integrate）但从未执行、零测试；V0.9 审计列为待决定项 |

## 安全

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 写操作 Origin == Host 精确匹配 | V0.5-DESIGN D5, README 安全 | `src/web-ui.ts:417-433, :74-80` | 所有 mutation 路由都走 guardWrite，失败 403 |
| ✅ 已实现 | — 保持 | 读操作要求 loopback Host | V0.5-DESIGN D5, README 安全 | `src/web-ui.ts:408, :360-367` | 已修：/nexus/api/settings 与 /nexus/api/models 补上 guardRead —— 此前这两个端点完全没有守卫，任意 Host/Origin 可读阈值与 extractor 配置 |
| ✅ 已实现 | — 保持 | 远程访问默认禁止（webuiAllowRemote） | V0.5-DESIGN D5 | `src/config.ts:173, src/index.ts:100` | 放开后仍只对 mutation 做 Origin==Host |
| ✅ 已实现 | — 保持 | 存储目录 0700 / 文件 0600 / .gitignore | V0.5-DESIGN D5, README 安全（已区分两类存储） | `src/projection.ts:97-124` | 已对齐：README 明确 0700/0600/.gitignore 只覆盖投影目录，并说明原子库权限归宿主 |
| ✅ 已实现 | — 保持 | 原子库自身的权限与位置 | README 安全（已更正） | `src/store.ts:100-113, README.md 安全节` | 已对齐：README 不再把投影目录说成记忆存放处，明确原子库走宿主 storage-domain、路径与权限不由本插件保证 |

## 面板与用户面

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ⚠️ 部分实现 | ⏸️ 推迟 | /memory skill-compile：生成 SKILL.md 草稿 | V0.9-SURFACE-AUDIT | `src/skill-compiler.ts, src/commands.ts:212, src/config.ts 无对应旋钮` | 命令接线完整（`/memory skill-compile [minWeight]` → `compileSkills(store, projectionDir/skills.draft, minWeight)`），但**从未执行**：`~/.dsh/nexus/` 下没有 `skills.draft/`，且 61 行代码零测试引用（见生成物「零测试引用的模块」）。决定（2026-09）：与 integrator 一起**保留**，标注为「记忆 → 技能」的待用方向 —— 删代码可逆（git），放弃方向不可逆；但零测试意味着它不算「已上线」，不上线就不许进任何「已实现」叙事。 |
| ✅ 已实现 | — 保持 | 单一实现：面板只有一份构建产物与一套实现 | README:66 | `src/ui/index.tsx, scripts/build.mjs, lib/nexus-ui.js` | 已实现：0.6 的 NexusPanel 与样例复刻档 SamplePanel 连同其专属依赖（InjectionBar / MemoryRow / RefLayout / ScopeBar / components / keyboard / replica.css / sample-palette.css）与 7 个测试文件一并删除，?panel=old / ?panel=sample 路由移除，index.tsx 里旧面板的 .nx-app/.nx-list 死分支清掉，theme.css 里 145 个旧面板类（43 KB → 8.7 KB）也一并清空。面板 HTML 从 348 KB 降到 223 KB，bundle 从 254 KB 降到 186 KB |
| ✅ 已实现 | — 保持 | 下拉筛选是自绘弹层，不再是原生 <select> | README:63 | `src/ui/Select.tsx, src/ui/BPanel.tsx, scripts/panel-select-shot.mjs, tests/panel-b.test.ts, tests/contrast-b-panel.test.ts` | 已实现：状态筛选 / 作用域筛选 / 提炼模型三处下拉换成 Select.tsx（button + 自绘列表）。原生 <select> 的弹层是系统菜单，macOS 亮色模式下就是一张白底 NSMenu —— CSS 够不着，color-scheme: dark 也只在部分平台生效；另外原生 select 的宽度由最长选项决定，同样 padding 下雪佛龙与文字的间距时宽时窄（「全部状态」空一截、「全部作用域」几乎贴住），一排两个控件不像一套。自绘后触发器与 --bg-input/--border/--radius 同一套语言；弹层 position: fixed 逃出 .panel-body 的滚动裁剪，两轮实测定位：下方放不下整张列表且上方更宽裕时翻到触发器上面，越出右边缘时右边缘对齐触发器；键盘 ↑↓ Home End Enter Space Esc Tab，role=combobox/listbox/option。0.8.10 只做到 appearance:none + 自绘雪佛龙，用户复看后反馈仍不搭 —— 露馅的正是够不着的弹层 |
| ✅ 已实现 | — 保持 | 默认面板为 BPanel | V0.8-PANEL-B | `src/ui/index.tsx:49` | 默认面板是 BPanel（src/ui/index.tsx 只渲染 <BPanel />）。0.8.9 起 ?panel=old / ?panel=sample 两个入口与两套旧面板已一并删除（见 panel-single-impl）—— 本条此前写的「三份并存，确认后再删」是那次删除之前的旧状态，已过期。 |
| ✅ 已实现 | — 保持 | 注入真相的逐条一键修法（缩短／置顶／指派项目／改为跨项目／确认） | README:45 | `src/ui/BPanel.tsx（quickFix / FIX_LABEL）, tests/panel-b.test.ts` | 已移植到默认面板：按未进入原因给对症动作 —— oversize/budget → 缩短（取全文后按预算 60% 截断）、unknown-project/other-project → 指派到当前项目、inactive → 确认。此前这些入口只在 ?panel=old 有，默认面板的记忆「没有出路」 |
| ✅ 已实现 | — 保持 | 注入条目按字节降序 | README:46（已标注面板归属） | `src/projection.ts:35-39, src/ui/InjectionBar.tsx:188` | 已对齐：README 写明运行时注入顺序是 pinned → weight → 最近更新，「按字节降序」只属于旧面板 |
| ✅ 已实现 | — 保持 | 单条 ≥30% 预算高亮 + 就地缩短 | README:46（已更正颜色与面板归属） | `src/ui/BPanel.tsx:455, src/ui/b-panel.css:171` | 已对齐：README 写明高亮是橙色、「就地缩短」仅旧面板 |
| ✅ 已实现 | — 保持 | 可信度闭环（今日写入 · 待确认 · 拒收 · 注入次数） | README:47（已标注仅旧面板） | `src/today.ts:50-53, src/ui/BPanel.tsx:645-653` | 已对齐：README 说明一行式仅旧面板，默认面板是设置页「运行状态」的四行 |
| ✅ 已实现 | — 保持 | 面板展示成本 | README:50 | `src/ui/BPanel.tsx（设置页成本明细）, tests/panel-b.test.ts` | 已移植到默认面板：设置页「运行状态」下新增成本明细三行（注入 / 提炼 / 编码）。/nexus/api/state 一直在返回 cost，只是默认面板从不渲染 |
| ✅ 已实现 | — 保持 | 一键清理误写记忆 + 5 秒可撤销 | README:48 | `src/ui/BPanel.tsx:196, :423-432, src/facility.ts:304-310` | 归档同时写黑名单，撤销走 restore {any:true} |
| ✅ 已实现 | — 保持 | 产物缺失时的诚实说明页 | README:66 | `src/web-ui.ts:484-486` | 已修：兜底页不再指向 0.4.1 就已删除的 web/nexus.html，改为 lib/nexus.html |
| ✅ 已实现 | — 保持 | 15 个 /memory 子命令 | README:55-56 | `src/commands.ts:54-193` | list/search/show/edit/delete/confirm/reject/conflict/import/integrate/skill-compile/purge/doctor/cost/session 全部注册（本轮新增 edit 与 delete） |
| ✅ 已实现 | — 保持 | /memory edit 与 /memory delete | NEXUS-DESIGN §7 | `src/commands.ts（case edit / case delete）, tests/commands.test.ts` | 已实现：`/memory edit <id> <新陈述>`（重算指纹与线索，撞指纹则拒绝保存）与 `/memory delete <id...>`（走回收站路径，与面板同一条：归档 + user-deleted） |
| ✅ 已实现 | — 保持 | 冲突一键三选（保留新／保留旧／两条都要）+ 批量 | NEXUS-DESIGN §7/§10-13 | `src/commands.ts:resolveConflicts, tests/commands.test.ts` | 已实现一键三选 + 批量：keep-new（新转 active、旧转 superseded 并留指针）/ keep-old（新归档 + 写墓碑）/ keep-both（两条都留、清冲突标记），支持 `--all` |
| ✅ 已实现 | — 保持 | reject 的可选原因参数 | README:55 | `src/commands.ts:90-100` | 已修：按 nex_ 前缀区分 id 与原因，原因不再被当成 id 吞掉，也不再恒为 'user rejected via command' |
| ✅ 已实现 | — 保持 | /memory doctor 的「✖ 不可写」结论 | README:59 | `src/store.ts:198-209, src/commands.ts:170` | 已修：storeWritable 走真实写探测（把当前状态原样写回，不产生脏数据）—— 只读探测证明不了可写；✖ 分支现在可达 |
| ✅ 已实现 | — 保持 | 模型面工具清单 | NEXUS-DESIGN §7（已列入第五个工具） | `src/tools.ts:36,62,73,109,128` | 已对齐：§7 工具清单补齐 memory_feedback 并说明其 good/bad 语义 |
| ✅ 已实现 | — 保持 | memory_feedback 的 good／bad 分支 | 工具自带描述「good 提升权重，bad 降低权重（下限 1）」 | `src/tools.ts:127-151, tests/tools.test.ts` | 已修：kind 真正参与分支 —— good 加权并刷新 updatedAt（视作一次「被用到」）；bad 降权且**不刷新**时间（纠正不是使用，刷新反而会让它在注入排序里往前挤）。权重夹在 1..20 |
| ✅ 已实现 | — 保持 | memory_read 默认只读 active | NEXUS-DESIGN §7 | `src/tools.ts:memory_read, tests/tools.test.ts` | 已实现：默认只读 active（非 active 给出带 trace 提示的说明），`trace: true` 沿 supersedes/supersededBy 双向走完整 lineage（有环与长度保护） |
| 🗑️ 承诺已撤销 | — 保持 | memory_trace(id) 工具（已撤销） | NEXUS-DESIGN §5.5 | `src/tools.ts（无该工具）` | 🗑️ 承诺撤销：独立工具不存在，能力并入 memory_read 的指针字段（supersedes / supersededBy） |
| ✅ 已实现 | — 保持 | 面板指派项目归属（编辑与新增都回传 projectRef） | README:45（一键修法·指派项目）, NEXUS-DESIGN §7 | `src/ui/BPanel.tsx:309-330, :768-786, src/web-ui.ts:245-256` | 「归属未知」的项目记忆永不注入。此前改作用域为「本项目」也不补 projectRef（服务端沿用旧值 undefined），新建更是恒写 undefined —— 这类记忆在默认面板里没有出路。现在两处都回传，且面板无从得知归属时明确提示而不是静默保存 |
| ✅ 已实现 | — 保持 | 手动合并近义重复 | README:50 | `src/ui/BPanel.tsx（库详情「合并重复」）, src/web-ui.ts:/nexus/api/memory/merge, tests/panel-b.test.ts` | 已补：库详情栏对 reviewNote=suspected-duplicate 的条目给出「合并重复」按钮，调用既有 /nexus/api/memory/merge（keep=被怀疑的那条，drop=当前这条 → 当前这条转 superseded，可 trace 回溯）。检测逻辑与后端接口一直都在，缺的只是入口 |
| ✅ 已实现 | — 保持 | 噪声横幅的扫描范围（非 active 的垃圾也要能被发现） | README:50（一键清理） | `src/web-ui.ts:/nexus/api/state, src/commands.ts:doctor, tests/web-ui.test.ts` | 本轮**用真实浏览器验收时发现并修掉**的缺陷：`collectNoise` 此前只接收 `active` 记忆，而垃圾常常正躺在 pending / needs-review 里 —— 实测本机 34 条库中 29 条是垃圾，27 条已归档、**2 条卡在 needs-review**，于是横幅计数为 0、一键清理入口不出现，用户反而会在归因页看到邀请他点「确认」的垃圾卡片。现改为扫描所有非 archived/superseded 的记忆，面板与 `/memory doctor` 同口径 |

## 质量门与工程

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| 🗑️ 承诺已撤销 | — 保持 | bench/golden.jsonl 112 条（已撤销） | V0.5-DESIGN D6 | `tests/golden.test.ts 内联 22 例` | 🗑️ 承诺撤销：实际是内联用例（12 条 bug 复现 + 泛化 + 负例，共 22 例，其中 5 例 it.fails）。补到 112 条的成本高于收益，文档已写明实际形态 |
| 🗑️ 承诺已撤销 | — 保持 | CI 两层 L0/L1（已撤销） | V0.5-DESIGN D6 | `.github/workflows/ci.yml` | 🗑️ 承诺撤销：CI 仍是单 job（typecheck / test / build / docs:check / check:pack）。L1 回放需要持久化模型输出夹具，明确不做 |
| ✅ 已实现 | — 保持 | 写入质量指标线（9 条收敛为 3 条可测） | V0.5-DESIGN D6（已按可测性收敛） | `tests/golden.test.ts（P / 误记率 / scope）, bench/holdout.ts（Recall@5）` | 已收敛：**9 条里只保留有数据源的**。现在 CI 强制 4 条 —— 写入精确率 P≥0.9、误记率≤2%、scope≥0.98（均由金标集算，见 tests/golden.test.ts）与检索 Recall@5（bench/holdout 门槛 0.8）。其余 5 条（残留、MRR、假阳、注入命中、每会话次数）**没有数据源，已从文档删除**，不再当门面 |
| ✅ 已实现 | — 保持 | 包体门禁（白名单／必需文件／逐字节一致／体积上限） | README 开发与工具, package.json | `scripts/check-pack.mjs:22-55, .github/workflows/ci.yml:23-24` | 四项都在，CI 会跑 |
| ✅ 已实现 | — 保持 | pre-commit 路径硬拦截 | README:99 | `.githooks/pre-commit:11-13` | 按路径/扩展名拦截，无内容扫描；--no-verify 可绕过（已在注释说明） |
| ✅ 已实现 | — 保持 | 反死机制：每条机制必须有指标 + 回归测试 | README:86, V0.5-DESIGN §一.4（已如实写明） | `scripts/docs-status.mjs（untestedModules + deadExports 现算 + 叙述门禁）, docs/status.json` | 已对齐：两个数字都不再写死在文档里，由 docs-status.mjs 现算并写进生成物的独立小节 —— 「零测试引用的模块」（6 个）与「零调用点的导出」（1 个，且是测试辅助 resetExtractionBudgetForTests）。历史：runLifecycle 与 linkCluster 都曾是全仓零调用点，前者 0.8.9 接到 Facility.tickLifecycle、后者 0.8.12 接到 integrator（聚类成员两两建 semantic 边，面板「相关邻里」才看得到聚类关系）；sessionToPanelMode 曾是唯一的零调用点导出，模式映射收敛到 src/modes.ts 后 web-ui 与面板都在用。防复发由 docs:check 门禁承担（CI + pre-commit），叙述门禁另拦「活文档把已删除的符号当现有功能」。 |
| ✅ 已实现 | — 保持 | 价值门回放脚本作为回归 | V0.9-VALUE-GATE, README:94 | `tests/value-gate.test.ts（混淆矩阵回放）` | 已补：混淆矩阵回放进入 CI（按线上库真实分布生成 22 回执 + 7 提示词 + 4 真记忆，断言垃圾 100% 拦下、真记忆零误拦、总数 29/33）。**误拦率 0 就是切换为拦截的前置条件**，所以这条测试同时守住那道门槛。手动脚本 scripts/value-gate-replay.mjs 保留为「对真实库跑」的便利工具，但不再是唯一的回放手段 |

## 事件与宿主契约

| 状态 | 处置 | 能力 | 文档出处 | 代码证据 | 实测差异 |
|---|---|---|---|---|---|
| ✅ 已实现 | — 保持 | 文档声明的 11 个事件 | NEXUS-DESIGN §6（已按实际 7 个事件重写） | `src/events.ts, src/facility.ts` | 已对齐：§6 只列实际 emit 的 7 个；6 个从未 emit 的已从清单移除，并注明其中 5 个连类型声明都没有（尚未设计） |
| ✅ 已实现 | — 保持 | nexus/memory/recalled 事件 | NEXUS-DESIGN §6（已补入） | `src/facility.ts:288, src/events.ts:28` | 已对齐：nexus/memory/recalled 已进入 §6 清单 |
| 🗑️ 承诺已撤销 | — 保持 | dsh-inject-scheduler 探测与回退（已撤销） | NEXUS-DESIGN §5.7 | `src/degrade.ts, src/scheduler.ts` | 🗑️ 承诺撤销：该 seam 在本仓库宿主版本里不存在，`agent/pre-step` 是唯一注入路径，「回退」无对象。§2.4 与 §5.7 的相应条款已删除 |
| ✅ 已实现 | — 保持 | 每个 seam 降级都发 nexus/degraded 事件 | NEXUS-DESIGN §5.7（已记录实际行为） | `src/degrade.ts:30-38` | 已对齐：文档写明只有一个启动期聚合事件，cwd 与 sessionProjections 降级只 console.warn，并声明「以本行为准」 |
| ✅ 已实现 | — 保持 | Schema 迁移：compatibleVersions + 逐版脚本 + 迁移前备份 | NEXUS-DESIGN §5.7（已记录实际范围） | `src/migrate.ts:11,49-91, src/store.ts:61-69` | 已对齐：文档写明实际范围是「域 version + 拒绝更高版本 + 幂等清扫游标」，compatibleVersions/逐版脚本/迁移前备份明确未实现 |
| 🗑️ 承诺已撤销 | — 保持 | 投影／写入失败置脏位并重试（决定不做） | NEXUS-DESIGN §5.7 | `src/index.ts:127-129, src/commands.ts:170` | 🗑️ 决定不做：写入 fail-open、崩溃最多丢当前一条已在设计取舍内。文档已明确写出这一点，并说明 storeWritable 已改为真实写探测 |

## 待办：按处置分组

处置的**理由**逐条写在 `docs/status.json` 的 `rationale` 字段里；这里只列清单。

### ⏸️ 推迟（4 条）

- **价值门切换为拦截** — 按设计要等「连续 7 天、reject ≥50 条、误拦率 0」才切换。0.8.9 起影子计数已覆盖全部写入路径（见 write-value-gate-shadow），但样本量仍远未达标：当前库里 34 条、其中 29 条是历史垃圾，`scripts/value-gate-replay.mjs` 回放为 accept 0 / review 3 / reject 31。结论：先攒真实写入样本，再谈切换
- **向量检索 + RRF 融合（默认关）** — 保留为「待验证」而不是删：缺陷是零证据而非代码多余 —— 测试已补（不再在零测试名单里），下一步是影子对比（关键词 Top-K vs +向量 Top-K，不改行为）。只有在对比证明「向量确实多召回了该召回的条目」后才值得配真 embedder；否则届时再删，那才是有证据的删除。反方也认：若目标是配置面最小，5 个旋钮 + 一条走不到的分支就是负债，删掉同样可接受（git 可取回）
- **integrator 聚类配置（默认 dry-run）** — V0.9-SURFACE-AUDIT 已列为待决定
- **/memory skill-compile：生成 SKILL.md 草稿** — 「记忆 → 技能」是待用方向而非欠债：保留实现与命令，明确标注零使用/零测试，不补测试也不删。等这个方向真的要做时再补测试与实测（届时它才算上线）

## 零测试引用的模块（现算，不是手写的）

口径：`src/` 下的 `.ts/.tsx`（不含 `src/index.ts`），文件名在 `tests/` 里一次都没出现过。README 的「反死机制」条目指向本节 —— 数字写死在文档里下次增删模块就会过期。

共 **6** 个：

- `src/degrade.ts`
- `src/events.ts`
- `src/extractor-llm.ts`
- `src/importer.ts`
- `src/skill-compiler.ts`
- `src/ui/index.tsx`

## 零调用点的导出（现算：有实现、没接线的机器清单）

口径：`export function|class X` 的 `X` 在整个 `src/` 里（含自己文件的其余部分）一次都没被用到；排除 `src/index.ts` 与 `src/ui/index.tsx`（宿主/HTML 加载的入口）。标注「仅测试引用」的说明生产路径没人调、但至少被测试钉着。

共 **1** 个：

- `src/budget.ts` 的 `resetExtractionBudgetForTests`（仅测试引用 3 处，生产路径零调用）

## 维护规则

1. 改了 `src/` 行为 → 跑 `npm run docs:check`；探针失败说明本表已过期。
2. 新增/删除能力 → 先在 `docs/status.json` 增删条目、探针与处置，再跑 `npm run docs:status`。
3. 探针必须查**运行事实**（调用点 / 消费者 / 字面量），不要查注释——注释会撒谎，这正是本表存在的理由。
4. 状态从 ❌ 变 ✅ 的那次提交，必须同时删掉文档里对应的「未实现」表述，并把处置改回 `keep`。
