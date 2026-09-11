/**
 * Skill compiler (WP-6): lessons reinforced ≥3 times compile into SKILL.md
 * DRAFTS (never auto-installed, never modifies originals).
 *
 * @module @chenqiuyushuang/dsh-nexus/skill-compiler
 */
import type { Atom } from './atom.ts'
import type { MemoryStore, StoreSnapshot } from './store.ts'
import { writeProjectionAtomic } from './projection.ts'
import { normalizeStatement } from './atom.ts'

export const SKILL_MIN_WEIGHT = 3;

export interface SkillDraft {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly memberIds: readonly string[]
}

/** 收集强化充分的 lesson（weight ≥ minWeight）并按主题分组。 */
export function collectReinforcedLessons(snapshot: StoreSnapshot, minWeight: number): Map<string, Atom[]> {
  const groups = new Map<string, Atom[]>();
  for (const atom of snapshot.allActive()) {
    if (atom.kind !== "lesson" || atom.weight < minWeight) continue;
    const key = normalizeStatement(atom.subject);
    const list = groups.get(key) ?? [];
    list.push(atom);
    groups.set(key, list);
  }
  return groups;
}

/** 由分组编译 SKILL.md 草稿（不写物料、不碰原文）。 */
export function compileDraft(subject: string, atoms: readonly Atom[]): SkillDraft {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "skill";
  const description = atoms[0]?.statement.slice(0, 100) ?? subject.slice(0, 100);
  const body = atoms.map(atom => "- " + atom.statement).join("\n");
  const markdown = "---\nname: " + slug + "\ndescription: " + description + "\n---\n\n# " + subject + "\n\n" + body + "\n";
  return { slug, name: slug, description, body: markdown, memberIds: atoms.map(atom => atom.id) };
}

/** 编译并写入草稿目录（默认 nexus 目录 skills.draft/，绝不进正式 skills）。 */
export async function compileSkills(store: MemoryStore, draftDir: string, minWeight = SKILL_MIN_WEIGHT): Promise<SkillDraft[]> {
  const groups = collectReinforcedLessons(store.snapshot(), minWeight);
  const drafts: SkillDraft[] = [];
  for (const [subject, atoms] of groups) {
    const draft = compileDraft(subject, atoms);
    await writeProjectionAtomic(draftDir, draft.slug + ".md", draft.body);
    drafts.push(draft);
  }
  return drafts;
}

/** 失败回滚契约：编译失败不改原文、不产生未完成文件（原子写）。 */
export const SKILL_ROLLBACK_CONTRACT = "compile writes only to skills.draft/ via atomic write; originals untouched on failure";
