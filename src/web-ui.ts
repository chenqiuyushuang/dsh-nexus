/**
 * WP-4 workbench: /nexus standalone page + API routes on the host webServer
 * (third-party register pattern proven by the plugin hub). Reads are open;
 * mutations require same-origin. Zero frontend build: inline HTML/JS.
 *
 * @module @chenqiuyushuang/dsh-nexus/web-ui
 */
import type { Context } from '@deepseek-ai/cordis'
import type { NexusFacility } from './facility.ts'
import type { Atom, CandidateAtom, MemoryKind, MemoryScope } from './atom.ts'
import { deriveSlot, normalizeStatement } from './atom.ts'
import { deterministCues, hash16 } from './extraction.ts'
import { summarizeCosts, shouldAutoDegrade } from './cost.ts'
import { neighborsOf } from './edges.ts'
import { DEFAULT_EXTRACT_BUDGET } from './budget.ts'
import { DEFAULT_INDEX_BUDGET_BYTES } from './projection.ts'
import { injectionTruth, defaultProjectRef, projectRefs } from './injection-truth.ts'
import { collectNoise } from './noise.ts'

/** 列表页单页上限（B2）：超过这个数量的库必须分页。 */
const MEMORY_PAGE_MAX = 200;
/** 列表里 statement 的预览长度；完整内容走 /nexus/api/memory/get。 */
const MEMORY_STATEMENT_PREVIEW = 400;

/** 列表项投影：只回面板要用的字段（去掉 cues/sources/fp/provenance 这些大字段）。 */
function toMemoryListItem(atom: Atom): Record<string, unknown> {
  const truncated = atom.statement.length > MEMORY_STATEMENT_PREVIEW;
  return {
    id: atom.id,
    scope: atom.scope,
    slot: atom.slot,
    kind: atom.kind,
    status: atom.status,
    subject: atom.subject,
    statement: truncated ? atom.statement.slice(0, MEMORY_STATEMENT_PREVIEW) : atom.statement,
    statementLength: atom.statement.length,
    truncated,
    weight: atom.weight,
    confidence: atom.confidence,
    pinned: atom.pinned === true,
    ...(atom.projectRef !== undefined ? { projectRef: atom.projectRef } : {}),
    ...(atom.conflictWith !== undefined ? { conflictWith: atom.conflictWith } : {}),
    ...(atom.supersededBy !== undefined ? { supersededBy: atom.supersededBy } : {}),
    ...(atom.reviewNote !== undefined ? { reviewNote: atom.reviewNote } : {}),
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

declare interface NexusWebServer {
  register(route: { kind: "exact"; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void;
}

/** 安装 /nexus 路由（host 无 webServer 时安全跳过）。 */
export function installNexusWeb(ctx: Context, facility: NexusFacility, options: { readonly allowRemote?: boolean; readonly indexBudgetBytes?: number } = {}): void {
  const webServer = ctx.get('webServer') as NexusWebServer | undefined;
  if (webServer === undefined) {
    console.warn("nexus: webServer 不可用，/nexus 面板跳过（功能不受影响）");
    return;
  }
  const allowRemote = options.allowRemote === true;
  const config_indexBudget = (): number => options.indexBudgetBytes ?? DEFAULT_INDEX_BUDGET_BYTES;
  const guard = (mutation: boolean) => (req: unknown, res: unknown): boolean => {
    if (isLocalPanelRequest(req, mutation, allowRemote)) return true;
    sendJson(res, 403, { error: "untrusted origin" });
    return false;
  };
  const guardRead = guard(false);
  const guardWrite = guard(true);
  const route = (path: string, handler: (req: any, res: any) => void | Promise<void>): void => {
    webServer.register({ kind: "exact", path, handler });
  };
  route("/nexus", (req, res) => { if (!guardRead(req, res)) return; sendHtml(res, renderShell()); });
  route("/nexus/api/state", async (req, res) => {
    if (!guardRead(req, res)) return;
    const store = await facility.store();
    const all = [...store.atomEntries()].map(([, a]) => a);
    const active = all.filter(a => a.status === "active");
    // B4 注入真相：按运行时同一套规则复算（此前用 buildIndex(active) → 别的项目/归属未知的
    // 记忆被算成"已注入"，而它们永远不会进上下文）
    const url = new URL((req as { url?: string }).url ?? "/", "http://localhost");
    const requested = (url.searchParams.get("project") ?? "").trim();
    const project = requested !== "" ? requested : defaultProjectRef(all);
    const truth = injectionTruth(all, { budgetBytes: config_indexBudget(), projectRef: project, conflicted: all.filter(a => a.status === "needs-review").length });
    sendJson(res, 200, {
      active: active.length,
      pending: all.filter(a => a.status === "pending").length,
      conflicts: all.filter(a => a.status === "needs-review").length,
      byScope: { user: active.filter(a => a.scope === "user").length, project: active.filter(a => a.scope === "project").length, episode: active.filter(a => a.scope === "episode").length },
      // 回收站 = 用户显式移入的（与系统归档区分），UI 需要独立计数
      trash: all.filter(a => a.status === "archived" && a.reviewNote === "user-deleted").length,
      archivedBySystem: all.filter(a => a.status === "archived" && a.reviewNote !== "user-deleted").length,
      // 子代理噪音（P0）：历史数据里被写进来的子代理提示词，面板给一键清理入口
      noise: collectNoise(active),
      // 注入真相（B4）：每条为什么进/不进，面板据此分组并给一键动作
      project,
      projects: projectRefs(all),
      injection: {
        budgetBytes: truth.budgetBytes,
        header: truth.header,
        bytes: truth.bytes,
        textBytes: truth.textBytes,
        lines: truth.lines,
        omitted: truth.omitted,
        pinned: truth.pinnedInjected,
        project: truth.projectRef,
        shown: truth.shown,
        dropped: truth.dropped,
        counts: truth.counts,
        archived: truth.archived,
      },
      cost: summarizeCosts(store),
      degraded: shouldAutoDegrade(store, 7),
      lastSummary: store.getState().lastSummary,
      valueGateShadow: store.getState().valueGateShadow,
    });
  });
  // B2：分页 + 只回面板需要的字段（此前返回全部原子 → 1000 条库首屏一次拉几十万字节）
  route("/nexus/api/memory", async (req, res) => {
    if (!guardRead(req, res)) return;
    const store = await facility.store();
    const url = new URL((req as { url?: string }).url ?? "/", "http://localhost");
    const scope = url.searchParams.get("scope") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const reviewNote = url.searchParams.get("reviewNote") ?? "";
    const query = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(MEMORY_PAGE_MAX, Math.max(1, Number(url.searchParams.get("limit") ?? 80) || 80));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    // 服务端筛选（专家实测：此前前端在 limit 截断后过滤 → 库 >80 静默漏报）
    const matched = [...store.atomEntries()].map(([, a]) => a)
      .filter(a => scope === "" || a.scope === scope)
      .filter(a => status === "" || a.status === status)
      .filter(a => reviewNote === "" || a.reviewNote === reviewNote)
      .filter(a => query.length === 0 || (a.subject + a.statement).toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    sendJson(res, 200, {
      items: matched.slice(offset, offset + limit).map(toMemoryListItem),
      total: matched.length,
      offset,
      limit,
    });
  });
  // B2：编辑/缩短前取全文（列表里的 statement 只给前 400 字，避免"编辑一次删掉 2.8KB"）
  route("/nexus/api/memory/get", async (req, res) => {
    if (!guardRead(req, res)) return;
    const url = new URL((req as { url?: string }).url ?? "/", "http://localhost");
    const store = await facility.store();
    const atom = store.getAtom(url.searchParams.get("id") ?? "");
    if (atom === undefined) { sendJson(res, 404, { error: "not found" }); return; }
    sendJson(res, 200, atom);
  });
  route("/nexus/api/decisions", async (req, res) => {
    if (!guardRead(req, res)) return;
    const store = await facility.store();
    const rejects = [...store.rejectEntries()]
      .map(([, record]) => record)
      .sort((a, b) => b.at - a.at)
      .slice(0, 50);
    const autoChanges = [...store.atomEntries()]
      .map(([, atom]) => atom)
      .filter(atom => atom.reviewNote !== undefined && atom.reviewNote !== "")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30)
      .map(atom => ({ id: atom.id, statement: atom.statement, status: atom.status, reviewNote: atom.reviewNote, updatedAt: atom.updatedAt }));
    sendJson(res, 200, { rejects, autoChanges, lastSummary: store.getState().lastSummary });
  });
  route("/nexus/api/neighbors", async (req, res) => {
    if (!guardRead(req, res)) return;
    const url = new URL((req as { url?: string }).url ?? "/", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    const store = await facility.store();
    sendJson(res, 200, neighborsOf(store, id, 8).map(({ edge, other }) => ({ edge, other, atom: store.getAtom(other) })));
  });
  for (const action of ["confirm", "reject"] as const) {
    route("/nexus/api/memory/" + action, async (req, res) => {
      if (!guardWrite(req, res)) return;
      const body = await readJson(req);
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      const changed = await facility.review(ids, action, "workbench");
      sendJson(res, 200, { changed: changed.length });
    });
  }
  route("/nexus/api/memory/update", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const id = String(body?.id ?? "");
    const store = await facility.store();
    const current = store.getAtom(id);
    if (current === undefined) { sendJson(res, 404, { error: "not found" }); return; }
    const statement = body?.statement !== undefined ? String(body.statement).slice(0, 4000) : current.statement;
    const rawScope = body?.scope;
    const scope: MemoryScope = rawScope === "user" || rawScope === "episode" || rawScope === "project" ? rawScope : current.scope;
    const slot = scope === current.scope ? current.slot : deriveSlot({ kind: current.kind, provenance: current.provenance, scope });
    // B4：指派/清除项目归属（归属未知的项目记忆永不注入，面板要能一键修好）
    const rawProject = body?.projectRef;
    const trimmedProject = rawProject === undefined ? undefined : String(rawProject ?? "").trim().slice(0, 300);
    const projectRef = scope === "user" ? undefined
      : rawProject === undefined ? current.projectRef
      : trimmedProject === "" || trimmedProject === "unknown" ? undefined
      : trimmedProject;
    await store.updateAtom(id, at => ({ ...at, statement, scope, slot, projectRef, updatedAt: Date.now() }));
    sendJson(res, 200, { ok: true });
  });
  route("/nexus/api/memory/create", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const statement = String(body?.statement ?? "").trim().slice(0, 4000);
    if (statement.length < 2) { sendJson(res, 400, { error: "statement too short" }); return; }
    const rawScope = body?.scope;
    const scope: MemoryScope = rawScope === "user" || rawScope === "episode" ? rawScope : "project";
    const kind: MemoryKind = /(?:习惯|喜欢|偏好|一直用)/i.test(statement) ? "preference" : "fact";
    const candidate: CandidateAtom = {
      fp: "fp_" + hash16(normalizeStatement(statement)),
      kind, scope, provenance: "user-declared",
      slot: deriveSlot({ kind, provenance: "user-declared", scope }),
      projectRef: undefined,
      subject: statement.slice(0, 24),
      statement,
      cues: deterministCues(statement),
      weight: 1, pinned: false, injected: false, confidence: 0.98, sources: [],
    };
    const atom = await facility.saveAtom(candidate);
    sendJson(res, 200, { ok: true, id: atom.id });
  });
  route("/nexus/api/memory/pin", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const id = String(body?.id ?? "");
    const pinned = body?.pinned === true;
    const store = await facility.store();
    if (store.getAtom(id) === undefined) { sendJson(res, 404, { error: "not found" }); return; }
    await store.updateAtom(id, current => ({ ...current, pinned, updatedAt: Date.now() }));
    sendJson(res, 200, { ok: true, pinned });
  });
  route("/nexus/api/memory/merge", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const keep = String(body?.keep ?? "");
    const drop = String(body?.drop ?? "");
    const store = await facility.store();
    const keepAtom = store.getAtom(keep);
    const dropAtom = store.getAtom(drop);
    if (keepAtom === undefined || dropAtom === undefined || keep === drop) {
      sendJson(res, 400, { error: "merge 需要有效的 keep/drop 两条记忆" });
      return;
    }
    await store.updateAtom(drop, current => ({ ...current, status: "superseded" as const, supersededBy: keep, updatedAt: Date.now(), reviewNote: "merged" }));
    await store.updateAtom(keep, current => ({ ...current, status: "active" as const, updatedAt: Date.now() }));
    sendJson(res, 200, { ok: true, keep, drop });
  });
  route("/nexus/api/memory/purge", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    const store = await facility.store();
    let purged = 0;
    for (const id of ids) {
      const atom = store.getAtom(id);
      // 回收站是唯一真删入口：系统归档的条目不允许被"彻底清除"（交互/IA 专家共识）
      if (atom === undefined || atom.reviewNote !== "user-deleted") continue;
      await store.deleteAtom(id);
      for (const [edgeId, edge] of [...store.edgeEntries()]) {
        if (edge.from === id || edge.to === id) await store.deleteEdge(edgeId);
      }
      // 彻底清除要连带删掉 reject 样本（否则原句仍留在磁盘上）
      const sample = atom.statement.slice(0, 500);
      for (const [rejectId, record] of [...store.rejectEntries()]) {
        if (record.sample === sample) await store.deleteReject(rejectId);
      }
      purged += 1;
    }
    // 同步投影，避免已删内容仍写在 MEMORY.md/USER.md 里
    await facility.touch();
    sendJson(res, 200, { purged });
  });
  route("/nexus/api/memory/delete", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    // D4：删除 = 移入回收站（可恢复，且写黑名单防复活）；彻底清除走 /memory/purge
    const changed = await facility.review(ids, "reject", "user-deleted");
    sendJson(res, 200, { deleted: changed.length });
  });
  route("/nexus/api/memory/restore", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    // any=true 仅用于「撤销刚做的归档」（5 秒内）——系统归档仍需用户显式确认才可复活
    const any = body?.any === true;
    const store = await facility.store();
    let restored = 0;
    let skipped = 0;
    for (const id of ids) {
      const atom = store.getAtom(id);
      // 只恢复"用户移入回收站"的条目：系统归档（去重/过期/清理）不因一次点击复活（IA/交互专家共识）
      if (atom === undefined || atom.status !== "archived" || (!any && atom.reviewNote !== "user-deleted")) { skipped += 1; continue }
      await store.updateAtom(id, current => ({ ...current, status: "active" as const, updatedAt: Date.now(), reviewNote: undefined }));
      // 撤销必须连黑名单一起回滚，否则重提同句会被静默再归档（交互专家实测）
      const sample = atom.statement.slice(0, 500);
      for (const [rejectId, record] of [...store.rejectEntries()]) {
        if (record.source === "user-reject" && record.sample === sample) await store.deleteReject(rejectId);
      }
      restored += 1;
    }
    await facility.touch();
    sendJson(res, 200, { restored, skipped });
  });
  route("/nexus/api/settings", async (_req, res) => {
    const store = await facility.store();
    const thresholds = await facility.getEffectiveThresholds();
    const extractorLlm = store.getState().extractorLlm;
    sendJson(res, 200, { ...thresholds, extractorLlm: extractorLlm ?? undefined });
  });
  route("/nexus/api/models", async (_req, res) => {
    const llm = (ctx as unknown as { get?: (name: string) => unknown }).get?.("llm") as
      | { listProviders?: () => { id: string; name: string }[]; listModels?: (provider: string) => Promise<{ id: string; name: string }[]> }
      | undefined;
    if (llm?.listProviders === undefined || llm.listModels === undefined) { sendJson(res, 200, []); return; }
    const rows: { provider: string; providerName: string; model: string; modelName: string }[] = [];
    for (const provider of llm.listProviders()) {
      try {
        const models = await llm.listModels(provider.id);
        for (const model of models) rows.push({ provider: provider.id, providerName: provider.name, model: model.id, modelName: model.name });
      } catch (error) { /* provider-local failure, keep the rest */ }
    }
    sendJson(res, 200, rows);
  });
  route("/nexus/api/settings/extractor", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const provider = String(body?.provider ?? "").trim();
    const model = String(body?.model ?? "").trim();
    const store = await facility.store();
    const current = store.getState();
    const next = provider !== "" && model !== "" ? { provider, model } : undefined;
    await store.setState({ ...current, extractorLlm: next });
    facility.configureLlmExtractor(next === undefined
      ? undefined
      : { provider: next.provider, model: next.model, maxTokens: 2048, timeoutMs: 90000, maxInputBytes: DEFAULT_EXTRACT_BUDGET.maxInputBytes });
    sendJson(res, 200, { ok: true, extractorLlm: next ?? undefined });
  });
  route("/nexus/api/settings/threshold", async (req, res) => {
    if (!guardWrite(req, res)) return;
    const body = await readJson(req);
    const store = await facility.store();
    const current = store.getState();
    const next: { autoAcceptThreshold?: number; modelAutoThreshold?: number } = { ...(current.thresholds ?? {}) };
    if (typeof body?.auto === "number") next.autoAcceptThreshold = Math.min(1, Math.max(0, body.auto));
    if (typeof body?.model === "number") next.modelAutoThreshold = Math.min(1, Math.max(0, body.model));
    await store.setState({ ...current, thresholds: next });
    sendJson(res, 200, await facility.getEffectiveThresholds());
  });
}

/** loopback 字面量（含端口）：127.0.0.1 / localhost / [::1]。 */
const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i

/**
 * 面板同源校验（专家实测：此前 startsWith 前缀匹配，任意本机端口页与
 * `localhost.evil.com` 都能通过并真实改删记忆）。
 *  - mutation：必须带 Origin，且 Origin 必须与 Host **精确相等**（含端口）；
 *  - 读：同源 GET 不发送 Origin，因此只校验 Host 是 loopback；
 *  - 默认拒绝非 loopback Host（防 DNS rebinding）；显式放开远程时才允许 Host==Origin 的任意主机。
 */
function isLocalPanelRequest(req: unknown, mutation: boolean, allowRemote: boolean): boolean {
  const headers = (req as { headers?: Record<string, string | undefined> }).headers
  const host = headers?.host ?? ''
  if (host.length === 0) return false
  const loopback = LOOPBACK_HOST_RE.test(host)
  if (!loopback && !allowRemote) return false
  const origin = headers?.origin
  if (origin === undefined || origin === '') return !mutation
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.host !== host) return false
    return loopback || allowRemote
  } catch {
    return false
  }
}

function sendJson(res: unknown, status: number, value: unknown): void {
  const response = res as { writeHead: (s: number, h: Record<string, string>) => void; end: (s: string) => void };
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendHtml(res: unknown, text: string): void {
  const response = res as { writeHead: (s: number, h: Record<string, string>) => void; end: (s: string) => void };
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(text);
}

async function readJson(req: unknown): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of (req as { [Symbol.asyncIterator](): AsyncIterator<Buffer> })) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { return {} }
}

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let shellCache: string | undefined

/**
 * Serve the standalone /nexus panel: prefer the packaged web/nexus.html (kept
 * outside the bundle so its inline JS never fights the build), fall back to a
 * minimal inline shell when the file is missing (dev checkouts).
 */
function renderShell(): string {
  if (shellCache !== undefined) return shellCache
  const here = dirname(fileURLToPath(import.meta.url))
  // Build 产物（lib/nexus.html，内联 token CSS + React bundle）优先；源码模板
  // （web/nexus.html）与内联降级面板依次回退。
  for (const file of ['../lib/nexus.html', '../web/nexus.html']) {
    try {
      shellCache = readFileSync(join(here, file), 'utf8')
      return shellCache
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
        console.warn(`nexus: ${file} 读取失败，使用降级面板`, error)
      }
    }
  }
  console.warn('nexus: 面板产物缺失，使用内联降级面板')
  shellCache = renderShellFallback()
  return shellCache
}

function renderShellFallback(): string {
  return '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Nexus 记忆</title></head><body style="font:14px/1.6 -apple-system,sans-serif;margin:24px"><h1>Nexus 记忆</h1><p>静态面板未随包分发（web/nexus.html），数据接口不受影响：</p><ul><li><a href="/nexus/api/state">/nexus/api/state</a></li><li><a href="/nexus/api/memory">/nexus/api/memory</a></li></ul></body></html>'
}