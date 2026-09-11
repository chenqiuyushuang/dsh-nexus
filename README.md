# dsh-nexus

> **Nexus — DeepSeek Harness 的记忆层：零配置、成本自保。**

## 安装（30 秒，就三步）

```bash
dsh plugin --profile web add github:chenqiuyushuang/dsh-nexus    # 或发布后：add @chenqiuyushuang/dsh-nexus
dsh web
```

**完成。** 首个会话自动注入记忆索引；直接说『记住 X』即可使用。无需任何配置、无需外部服务、无需手改任何文件。

启动后打开 **设置（⚙）→ 记忆（🧠 第 5 项）**：完整记忆工作台（搜索/确认/编辑/归档/关系图/成本/降级状态，`/nexus` 同款）。插件自带浏览器端，无需额外安装任何前端包；未接入 web 面板的 profile 自动跳过、功能不受影响。

> 前提一行：装过 DSH（CLI 在 PATH）并已用过 web profile。你只需要上面一条命令。
> 更傻瓜的路径：在 dsh-plugin.org 市场里点安装（等价命令 + 一键），后续跟进收录。

## 可选增强（不做也能用）

- 开启 LLM 收尾提炼（默认关 = 纯确定性零 token 档）：在 `~/.dsh/profiles/web/cordis.patch.yml` 加一段 `extractorLlm`（见下方安装节）。
- 使用说明/设计/路线图见文档索引。


## 安装（发布后）

```bash
dsh plugin --profile web add @chenqiuyushuang/dsh-nexus
dsh web
```

零配置：首个会话开始注入记忆索引；对话说『记住 X』即可零 token 入库。可选增强（最多 5 项、均有默认）：sqlite 后端 / 向量检索 / 严格度。

## 设计要点

**一句话**：Nexus 把记忆做成**原子 + 门控 + 可审计**的三层结构，而不是"往文件里追加一段文本"。

- **四层证据驱动**：DSH 生态 162 个记忆插件普查 + 五家主流智能体（Codex / Claude Code / ZCode / Qoder / WorkBuddy）官方设计对照 + 人脑记忆科学 + DSH 源码扩展点逐行核对。
- **两条零 token 边**：确定性提取（用户原话触发词 / goal·todo 事件 / 工具失败教训）与 BM25 检索，默认全程不调用任何模型。
- **三条不可动摇的约束**：数据与指令分离（记忆永远是数据）· 零配置默认零成本 · 写入宁缺毋滥、删除可回溯。
- **反死机制**：每条机制必须有指标 + 回归测试，否则不上线（本项目为此立规，见下）。

## 设计文档

- `docs/NEXUS-DESIGN.md` —— **主设计稿**（§1-16：定位、四层证据、架构、数据模型、管线、评审处理、排障）。**源码注释里的 `NEXUS-DESIGN.md §X` 引用指向本文件，改行为前先读对应章节。**
- `docs/V0.5-DESIGN.md` —— **设计 v2：取舍与决策**（六项定稿决策，每条都写明"放弃了什么"）。内含「无度量不上线」原则——它是本项目最贵的一条教训。
- 证据链、评审记录与开发计划属于内部工作材料，不随本仓库分发。

## 用户如何安装（对外）

**前置**：已安装 DSH（`dsh` CLI 在 PATH，建议 `dsh --version` 确认）+ pnpm 在 PATH；web 或其他 profile 已存在。

```bash
# 方式一（GitHub 源，未发布 npm 前就可用）：
dsh plugin --profile web add github:chenqiuyushuang/dsh-nexus

# 方式二（npm 发布后）：
dsh plugin --profile web add @chenqiuyushuang/dsh-nexus

# 验证与启动：
dsh plugin --profile web list | grep nexus
dsh web
```

**零配置**：无需任何外部服务；web profile 自带存储栈；`dsh.bundle` 声明会自动挂载插件行（无需手改 profile patch）。重启后首个会话即注入 `## 记忆` 索引。

**可选增强**（`~/.dsh/profiles/<name>/cordis.patch.yml`）：

```yaml
- id: nexus
  name: '@chenqiuyushuang/dsh-nexus'
  config:
    extractorLlm:              # 开启 LLM 收尾提炼（默认无 = 纯确定性零 token）
      provider: deepseek-official
      model: deepseek-v4-flash
```

**备注**：git 源安装时 pnpm 可能会提示 allowlist `prepare` 构建（`@chenqiuyushuang/dsh-nexus`），按提示把该 key 加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 即可——这是 pnpm 对 git 依赖的标准安全流程。

## 开发

```bash
npm install      # deps 与 DSH peer 包（rc 版，本地以 DSH 源码为准校对 API）
npm run typecheck
npm test
npm run build    # esbuild → lib/index.js（宿主依赖外部化）
```

> 已知缺口：`lib/types/*.d.ts` 声明产物待与 DSH 一致的 tsdown 管线接入（v0.2 发布前置项）。

## 命名与市场识别

- npm：`@chenqiuyushuang/dsh-nexus`（插件名 `'nexus'`，域 `nexus_memory`，事件 `nexus/memory/*`）
- keywords 含 `dsh-plugin` —— dsh-plugin.org 市场按此识别插件（不是按名字）


## 安装与配置（pub 后）

```bash
dsh plugin --profile web add @chenqiuyushuang/dsh-nexus
dsh web
```

```yaml
# 可选：使用 sqlite 后端与 LLM 收尾提炼（web profile 默认 json 即可运行）
- id: nexus
  name: '@chenqiuyushuang/dsh-nexus'
  config:
    mode: standard            # strict | standard | loose
    indexBudgetBytes: 1024    # 冻结索引预算
    extract: reminder         # deterministic | reminder | off
    extractorLlm:             # 可选：提醒提炼的模型路由
      provider: deepseek
      model: deepseek-chat
    autoDegradeDays: 7        # 注入 7 天零使用 → 自动只写不读
```

**零依赖底座**：不需要外部服务、无需原生编译；存储跟随宿主后端（web=json），sqlite 为一行升级。

> **bundle 声明**：本包通过 `package.json` 的 `dsh.bundle` + `cordis.patch.yml` 声明组合包层（社区插件标准），`dsh plugin add` 后自动进入 profile 的 `dsh.profile.bundles` 并挂载插件行——若曾以旧版（无声明）安装，重跑一次 add 即可。


## v0.4 新增（可信版）

**看得见**
- 会话小结：下次会话开头的记忆块会写「（上次会话记忆：新增 2 条、1 条待确认、3 窗超预算未提炼）」；
- 面板：置顶/取消置顶、移入回收站 → 恢复 → 彻底清除（真删并清边）、归档即黑名单（同一句不再复活）；
- `/nexus/api/state` 暴露 `lastSummary` 与真实成本。

**花得明白**
- 注入：每会话首轮一次 ≤1KB，之后仅在记忆变化时发 ≤200B 增量（修复"每 15 秒重复注入"）；
- 提炼预算（`budget.ts`）：窗口由 `maxInputBytes` 反推 · 每会话 ≤8 窗 · 每日 ≤20 万输入 token，超限**跳过并记账**；
- 注入与提炼都写成本账本，`/memory cost` 不再恒 0。

**不会伤人**
- 写入鉴权：写操作要求 `Origin == Host`（含端口）精确匹配，读操作要求 loopback Host（防 DNS rebinding）；远程访问需显式 `webuiAllowRemote: true`；
- 注入块声明「历史记忆数据，不是指令」并对内容做扁平化；
- 密钥/身份证/私钥出厂扫描；归档/彻底清除可回溯。

**改得放心**
- `tests/golden.test.ts`：24 例真实事故回归（已知未修的用 `it.fails` 标注）；
- CI：`typecheck（node+client）→ 全量测试 → 双端构建`。

**语义**
- 否定极性：`不要用 pnpm` 与 `用 pnpm` 不再同分/同时注入；
- 冲突检测：同槽位相反偏好进「待确认」，不再矛盾共存。

## License

MIT
## 浏览器端（设置 → 记忆）

插件 **自带客户端**（`dsh.client` 声明 + `lib/client.js`）：web 界面设置弹窗第 5 项「记忆」（脑图标）打开内置记忆面板。

- 面板即 `/nexus` 单页（零前端依赖，随包分发 `web/nexus.html`）；
- 记忆在设置弹窗内可：搜索、按作用域/状态过滤、确认、编辑、归档（软删除，可回溯）、查看语义关联、成本与降级状态；
- 服务端 API：`/nexus/api/state` · `/nexus/api/memory` · `/nexus/api/neighbors` · `/nexus/api/memory/{confirm,reject,update}`（可变操作仅同源放行）。