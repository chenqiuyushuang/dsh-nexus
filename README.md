# dsh-nexus

> **Nexus —— DeepSeek Harness 的记忆层：零配置、成本自保、可审计。**

记忆以「原子 + 门控 + 可审计」三层结构存在，而不是往文件里追加一段文本。默认**零 token、零外部服务**。

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

- **注入真相**：顶部一条显示「进入上下文 N 条 / X B / 预算 Y B」，展开可看每条为什么进、为什么没进（单条超预算 / 被挤掉 / 归属未知 / 属于其他项目 / 本会话 / 非活跃），并给一键修法（缩短 / 置顶插队 / 指派项目 / 改为跨项目 / 确认）；
- **预算可见**：条目按字节降序，单条吃掉 ≥30% 预算标黄 + 就地缩短 ——「再加一条会挤掉谁」有量感；
- **可信度闭环**：一行回答「今天写进了几条 · 待确认几条 · 拒收几条 · 注入几次」；
- **一键清理**：识别子代理回执/提示词这类被误写的记忆（实测某次 33 条里 29 条是这种），归档 + 拉黑，5 秒内可撤销；
- **三态删除**：归档（可回溯）→ 回收站（可恢复）→ 彻底清除（真删并清边）；
- 搜索 / 按作用域与状态过滤 / 确认 / 编辑 / 合并近义重复 / 关系 / 成本 / 降级状态。

### 会话内命令

```
/memory list|search <q>|show <id>|confirm <id...>|reject <id...> [原因]|conflict [--all]|cost|doctor|session [read-write|write-only|pause]
/memory import <file>|integrate [run]|skill-compile|purge
```

`/memory doctor` 是自检：库计数、待裁决冲突、注入占用与未进入数、LLM 提炼开关、降级状态、价值门影子计数，最后给一句结论（✖ 不可写 / ⚠ 需处理 / · 正常）。

## 设计要点

- **三条不可动摇的约束**：数据与指令分离（记忆永远是数据，注入块带声明并做扁平化）· 零配置默认零成本 · 写入宁缺毋滥、删除可回溯；
- **反死机制**：每条机制必须有指标 + 回归测试，否则不上线；
- **价值密度门（影子期）**：给每条候选记忆打 0–100 分（身份/偏好 +30、约定/规范 +20、路径与技术标识 +15、长度合适 +15；子代理回执与提示词 −100 一票否决），**目前只记录不拦截** —— 先用真实库回放验证，误拦率 0 才切换；
- **单一实现**：面板只有构建产物 `lib/nexus.html` 一份，产物缺失时给诚实的内联说明页（包体门禁会拦住第二套实现）。

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

- 写操作要求 `Origin == Host`（含端口）精确匹配；读操作要求 loopback Host（防 DNS rebinding）；远程访问需显式 `webuiAllowRemote: true`；
- 密钥 / 身份证 / 私钥出厂扫描；注入内容做 NFKC + 控制字符扁平化；
- 记忆存本机 `~/.dsh/nexus`（目录 0700、文件 0600、内含 `.gitignore`），另同步人类可读的 `MEMORY.md` / `USER.md`。

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

- `docs/NEXUS-DESIGN.md` —— 主设计稿（§1-16 定位、证据、架构、数据模型、管线、排障）。源码注释里的 `NEXUS-DESIGN.md §X` 指向本文件；
- `docs/V0.5-DESIGN.md` —— 取舍与决策定稿（每条都写明放弃了什么，「无度量不上线」的来源）；
- `docs/V0.7-PANEL-DESIGN.md` —— 面板设计（B1–B7 批次、验收标准、§6 落地时的规范修正）；
- `docs/V0.8-UI-REVIEW-PANEL.md` —— 八人专家团对一份外部 UI 评估报告的裁决（含事实纠错与一致采纳/否决）；
- `docs/V0.9-VALUE-GATE.md` —— 价值密度门：打分口径、影子回放结果、切换拦截的条件；
- `docs/V0.9-SURFACE-AUDIT.md` —— 功能面审计：哪些是真死代码、哪些是待决策的功能；
- `CHANGELOG.md` —— 逐版本变更（含每个 bug 的根因）。

## 已知限制

- **价值门仍在影子期**：只记录不拦截，需要真实使用样本才能切换；
- **向量检索默认关闭**（需要外部 embedding 服务，本部署从未配置），其去留见功能面审计；
- **长多主题查询排序**：检索做了 IDF 与预分词缓存，但完整 BM25（tf 饱和 + 长度归一）未做；
- **窄栏字号**：设置弹窗内控件字号用相对单位跟随宿主，但内边距固定以保密度 —— 17px 宿主下工具栏会多占一行；
- **npm 未发布**：目前只能走 `file:` tarball 或 GitHub 源。

## License

MIT
