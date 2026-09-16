# dsh-nexus

> **Nexus —— DeepSeek Harness 的记忆层：零配置、成本自保、可审计。**

记忆以「原子 + 门控 + 可审计」三层结构存在，而不是往文件里追加一段文本。默认**零 token、零外部服务**。

> ⚠️ **文档与实现的状态对照，以 [`docs/IMPLEMENTATION-STATUS.md`](docs/IMPLEMENTATION-STATUS.md) 为准。**
> 那份表由 `npm run docs:status` 从 `docs/status.json` 生成，`npm run docs:check` 用代码探针校验声明与实现是否一致
> （CI 与 pre-commit 都会跑）。它同时给出每条能力的**状态**（已实现 / 部分实现 / 与文档不一致 / 有代码未接线 / 未实现 / 已撤销）
> 与**处置**（改代码 / 改文档 / 删 / 推迟）及理由 —— 状态说「现在怎样」，处置说「打算怎么办」。
> 条目不写死在这份 README 里：数字每次增删能力都会变，一律以那份表为准。
> 本 README 与 `docs/NEXUS-DESIGN.md` 说明的是**设计与用法**；凡两者与状态表冲突，以状态表为准。
> 维护规约与裁定判据见 [`docs/DOC-MAINTENANCE.md`](docs/DOC-MAINTENANCE.md)。

## 安装

### 方式一：本机 tarball（离线可用，本仓库 `npm run build && npm pack` 的产物）

```bash
kill $(lsof -nP -iTCP:3080 -sTCP:LISTEN -t)     # 停掉正在跑的 dsh web（可选，但必须重启才算数）
dsh plugin --profile web remove @chenqiuyushuang/dsh-nexus   # 清掉旧依赖（首次安装可跳过）
dsh plugin --profile web add "file:/绝对路径/dsh-nexus-<版本>.tgz"
dsh web                                          # 打开终端打印的带 token 地址
```

### 方式二：GitHub（网络可达时）

```bash
dsh plugin --profile web add github:chenqiuyushuang/dsh-nexus
dsh web
```

### 方式三：npm（尚未发布）

```bash
dsh plugin --profile web add @chenqiuyushuang/dsh-nexus
```

### 装完必做：校验

```bash
npm run verify:install       # 对比本地构建 / 已安装副本 / 运行中服务返回的面板
```

**两个已踩过的坑（工具会替你发现）**：
1. **版本号不变则 pnpm 不会更新** —— `file:` 安装按「文件名 + 版本」判断，改了包体必须升版本号再 add；
2. **插件代码与面板 HTML 在 `dsh web` 启动时读入内存** —— 不重启就还是旧版。

## 你会得到什么

### 面板（设置 →「记忆」第 5 项🧠；或独立页 `/nexus`）

> **单一实现**：只有一套面板（BPanel），打包进 `lib/nexus.html`。0.6 的旧面板与样例复刻档
> 连同 `?panel=old` / `?panel=sample` 两个入口已删除，`check-pack` 与状态表的探针会拦住第二套实现。

- **注入真相**：顶部一条显示「进入上下文 N 条 / X B / 预算 Y B」，展开可看每条为什么进、为什么没进（六个原因：单条超预算 / 被挤掉 / 归属未知 / 属于其他项目 / 本会话 / 非活跃）；
  - **逐条一键修法**：每个未进入的条目按原因给对症动作 —— 超预算 → **缩短**（取全文后按预算 60% 截断）、归属未知 / 属于其他项目 → **指派到当前项目**、非活跃 → **确认**；
- **预算可见**：单条吃掉 ≥30% 预算会高亮（橙色）；运行时注入顺序是 pinned → weight → 最近更新（这是预算的真实分配顺序，不做字节数重排）；
- **可信度闭环**：设置页「运行状态」给出今日写入 / 待确认 / 已拒收 / 注入次数四行；
- **成本明细**：同一处给出注入 / 提炼 / 编码三项 token 与字节数；
- **一键清理**：识别子代理回执/提示词这类被误写的记忆（实测某次 33 条里 29 条是这种），归档 + 拉黑，5 秒内可撤销；
- **三态删除**：归档（可回溯）→ 回收站（可恢复）→ 彻底清除（真删并清边）。注意这是**面板专属**能力，`/memory purge` 命令只做归档；
- 搜索 / 按作用域与状态过滤 / 确认 / 编辑 / 关系 / 降级状态。
- **下拉自绘**：状态 / 作用域 / 提炼模型三处下拉是面板自绘的弹层（原生 `<select>` 的弹层是系统菜单，
  macOS 亮色模式下就是一张白底菜单，CSS 够不着）：深色卡片 + 圆角 + 选中打勾 + 键盘可选中，
  下方放不下整张列表时自动翻到触发器上方。

### 会话内命令

```
/memory list|search <q>|show <id>|edit <id> <新陈述>|delete <id...>
/memory confirm <id...>|reject <id...> [原因]|cost|doctor
/memory conflict [keep-new|keep-old|keep-both <id...>|--all]
/memory session [read-write|write-only|pause]
/memory import <file>|integrate [run]|skill-compile|purge
```

- `/memory delete` 走的是**回收站**（归档 + user-deleted，可恢复），不是真删；真删在面板回收站；
- `/memory conflict` 支持一键三选：`keep-new`（新转 active、旧转 superseded 并留指针）· `keep-old`（新归档 + 写墓碑）· `keep-both`（两条都留、清冲突标记），也可 `--all` 批量；
- `/memory purge` 是**归档**垃圾记忆（可回溯），彻底清除只有面板回收站那一条路径；
- `/memory doctor` 是自检：库计数、待裁决冲突、注入占用与未进入数、LLM 提炼开关、降级状态、价值门影子计数，最后给一句结论（✖ 不可写 / ⚠ 需处理 / · 正常）。

## 设计要点

- **三条不可动摇的约束**：数据与指令分离（记忆永远是数据，注入块带声明并做扁平化）· 零配置默认零成本 · 写入宁缺毋滥、删除可回溯。⚠️ 项目里共有三组「不可动摇的原则」，条目互不相同（本 README 三条 / `NEXUS-DESIGN.md` §1 四条 / `V0.5-DESIGN.md` §一 四条），尚未收敛；
- **反死机制**：每条机制必须有指标 + 回归测试，否则不上线 ⚠️ **仍未完全做到** —— 死代码只剩 `linkCluster`（`src/edges.ts`，全仓零调用点；`runLifecycle` 已在 0.8.9 接到 `Facility.tickLifecycle`），另有 10 个模块零测试引用。这两个数字不写死在这里：清单见状态表末尾「零测试引用的模块」（`npm run docs:status` 现算）与 `quality-anti-dead`；
- **价值密度门（影子期）**：给每条候选记忆打 0–100 分（身份/偏好 +30、约定/规范 +20、路径与技术标识 +15、长度合适 +15；子代理回执与提示词 −100 一票否决），**目前只记录不拦截** —— 先用真实库回放验证，误拦率 0 才切换 ✅ 打分口径与代码逐项一致；影子计数已覆盖**全部写入路径**（0.8.9 起在 `Facility.saveAtom` 里记，此前只有「触发词」一条分支，样本量根本攒不够），而 `scripts/value-gate-replay.mjs` 是手动无断言脚本，不在 CI；
- **面板实现**：**只剩一套**（BPanel），构建产物也只有 `lib/nexus.html` 一份 —— 0.8.9 已删除旧面板与 `?panel=old` / `?panel=sample` 入口。`check-pack` 的文件白名单（`package.json.files` 只有 4 个文件）拦「多出一个面板产物」，状态表探针 `panel-single-impl` 拦「旧面板回来」（旧组件文件、旧 CSS 类名、路由命中数）。⚠️ 两者都是文件/符号级：**在同一份 bundle 里塞第二套实现仍然拦不住**。

## 成本契约（默认值）

| 项 | 默认 |
|---|---|
| 注入预算 | `indexBudgetBytes: 1024`（首轮注入；此后仅当内容变化、跨轮、且超过 `injectIntervalMs` 才刷新） |
| 刷新间隔 | `injectIntervalMs: 15000`（毫秒） |
| 提炼 | `extract: reminder`（LLM 提炼默认关闭 = 纯确定性零 token 档） |
| 提炼预算 | 窗口由 `maxInputBytes` 反推 · 每会话 ≤8 窗 · 每日 ≤20 万输入 token，超限跳过并记账 |
| 自动降级 | `autoDegradeDays: 7`（7 天零使用 → 只写不读） |
| 会话模式 | `sessionModeDefault: read-write`（可 `/memory session` 临时改） |

上下文压缩后会自动重新注入（依据 DSH 的 `compaction/end|prune` 事件），不会因压缩而静默消失。

## 安全

- 写操作要求 `Origin == Host`（含端口）精确匹配；读操作要求 loopback Host（防 DNS rebinding）；远程访问需显式 `webuiAllowRemote: true`。**所有** `/nexus/api/*` 端点都走这道守卫（`settings` / `models` 曾漏掉，已补）；
- 密钥 / 身份证 / 私钥出厂扫描（规则集可选 `scannerRules: minimal|recommended`）；注入内容做 NFKC + 控制字符扁平化；
- **两类存储，位置与权限不同，别混为一谈**：
  - **投影目录** `~/.dsh/nexus`（可用 `projectionDir` 改）：人类可读的 `MEMORY.md` / `USER.md`，目录 0700、文件 0600、内含 `.gitignore`（防误提交），由本插件负责；
  - **原子库**：走宿主 storage-domain 后端（web 默认 json，可换 sqlite），**路径与文件权限由宿主决定，本插件不 chmod、也不放 `.gitignore`**。要收紧权限请从 DSH 存储后端配置入手。

## 开发与工具

```bash
npm install && npm run typecheck && npm test && npm run build
npm run check:pack        # 包体门禁：白名单 / 必需文件 / 与构建逐字节一致 / 体积上限（CI 也跑）
npm run panel             # 宽屏实测：真实 Chrome 量行高、行距、首屏行数并截图
npm run panel:preview     # 窄栏实测：复刻设置弹窗尺寸，支持 --dark --font 17 --stub-state --expand-inject
npm run value:replay      # 价值门回放：对线上库跑判定，输出混淆矩阵与拦下原因分布
npm run doctor            # 用线上真实库数据预演 /memory doctor 输出
npm run verify:install    # 安装校验
```

`.githooks/pre-commit` 会硬拦截本地测试环境、包管理器缓存、凭据与会话数据 —— clone 后请执行一次：

```bash
git config core.hooksPath .githooks
```

## 文档

**先看这两份（新增，机器校验）：**

- [`docs/IMPLEMENTATION-STATUS.md`](docs/IMPLEMENTATION-STATUS.md) —— **实现状态总表**：所有能力逐条标注 ✅ 已实现 / ⚠️ 部分实现 / ⚠️ 与文档不一致 / 🧟 有代码未接线 / ❌ 未实现 / 🗑️ 已撤销，每条附代码证据与实测差异（条数见文首统计，不在这里写死）；
- [`docs/DOC-MAINTENANCE.md`](docs/DOC-MAINTENANCE.md) —— **文档维护规约**：改了代码怎么知道该改哪份文档、探针怎么写、门禁接在哪。

设计与历史：

- `docs/NEXUS-DESIGN.md` —— 主设计稿（§1-16 定位、证据、架构、数据模型、管线、排障）。源码注释里的 `NEXUS-DESIGN.md §X` 指向本文件。**这是设计意图，不是实现状态**；
- `docs/V0.5-DESIGN.md` —— 取舍与决策定稿（每条都写明放弃了什么，「无度量不上线」的来源）；
- `docs/V0.7-PANEL-DESIGN.md` —— 面板设计（B1–B7 批次、验收标准、§6 落地时的规范修正）；
- `docs/V0.8-PANEL-B.md` —— 面板 B 交接说明（注意其中宽度、统计行位置、归因分组已被 V0.8.3+ 推翻）；
- `docs/V0.8-UI-REVIEW-PANEL.md` —— 八人专家团对一份外部 UI 评估报告的裁决（含事实纠错与一致采纳/否决）；
- `docs/V0.9-VALUE-GATE.md` —— 价值密度门：打分口径、影子回放结果、切换拦截的条件；
- `docs/V0.9-SURFACE-AUDIT.md` —— 功能面审计：哪些是真死代码、哪些是待决策的功能（注意其 goal/todo 一项的结论已过期）；
- `CHANGELOG.md` —— ⚠️ 最新条目停在 **0.4.1**，0.5 → 0.8.x 的变更没有记录。

> `docs/` 下现有 27 份文件，上面只索引了与设计/状态相关的主要几份。

## 已知限制

**完整清单见 [`docs/IMPLEMENTATION-STATUS.md`](docs/IMPLEMENTATION-STATUS.md)**（机器校验，条数与统计以该表文首为准）。最容易被误读的几类：

- **删除旧面板时曾丢掉一项能力，已补回**：**手动合并近义重复**。检测把疑似重复标为待确认（`reviewNote: 'suspected-duplicate'`），库详情栏据此给出「合并重复」按钮，调用既有的 `/nexus/api/memory/merge`（保留被怀疑的那条，当前这条转已取代、可 trace 回溯）；
- **未实现项都是「显式推迟」**（不是欠债，见状态表的 ⏸️ 分组）：价值门切换为拦截（等真实样本）、向量检索与 RRF（V0.9 审计待决定）、回收站 7 天自动清除（有风险）、integrator 聚类 + `skill-compile`（同属「记忆 → 技能」方向，零使用待决定）；
- **承诺已撤销**（不再是待办）：`mode` 三模式、`coldArchive` 冷迁移、`edges` 配置、`memory_trace` 工具、索引 ≤200 行截断、`bench/golden.jsonl` 的 112 条、CI 的 L0/L1 两层、投影脏位重试、`dsh-inject-scheduler` 回退、`status:'deleted'` 枚举、episode 90 天 TTL、MRR/假阳/注入命中等 5 条无数据源的指标线 —— 这些已从代码与文档中一并删除，见状态表的「🗑️ 承诺已撤销」分组；
- **可测的指标线现已强制**：写入精确率 P≥0.9、误记率≤2%、scope≥0.98（金标集）、检索 Recall@5（holdout 门槛 0.8）；价值门的混淆矩阵回放也进了 CI，**误拦率 0** 这条切换前置条件由测试守着；
- **价值门仍在影子期**：只记录不拦截，需要真实使用样本才能切换；
- **向量检索默认关闭**（需要外部 embedding 服务，本部署从未配置），其去留见功能面审计；`integrator` / `skill-compiler` 同样零使用、零测试，V0.9 审计列为待决定项；
- **长多主题查询排序**：检索做了 IDF 与预分词缓存，但完整 BM25（tf 饱和 + 长度归一）未做 —— 设计稿已改称「文本检索」，不再自称 BM25；
- **窄栏字号**：设置弹窗内控件字号用相对单位跟随宿主，但内边距固定以保密度 —— 17px 宿主下工具栏会多占一行；
- **npm 未发布**：目前只能走 `file:` tarball 或 GitHub 源。

## License

MIT
