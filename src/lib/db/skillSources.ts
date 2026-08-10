/**
 * db/skillSources.ts — 用户登记的 skill 源实例表访问 (Phase 4 M0/M1)
 *
 * 对应 migration 138 的 skill_sources 表。M0 建立访问层，M1 由「用户登记源」
 * 流程实际使用。决策 5：源由用户登记，不自动扫全盘；auto_update 默认 0
 * （决策 4：以 Repo 为准 + 手动确认）。
 */
import { getAsyncDb } from "./core";
import { randomUUID } from "crypto";
import type { SkillSourceInstance, SkillSourceKind } from "../skills/sourceKind";

export interface SkillSourceInput {
  kind: SkillSourceKind;
  name: string;
  url?: string;
  skillsPath?: string;
  credentialRef?: string;
  autoUpdate?: boolean;
}

function rowToInstance(row: any): SkillSourceInstance {
  return {
    id: row.id,
    kind: row.kind as SkillSourceKind,
    name: row.name,
    url: row.url || undefined,
    skillsPath: row.skills_path || "skills",
    credentialRef: row.credential_ref || undefined,
    autoUpdate: row.auto_update === 1,
    lastSyncAt: row.last_sync_at || undefined,
    enabled: row.enabled === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** 登记一个新源实例（用户登记流程，决策 5）。 */
export async function createSkillSource(input: SkillSourceInput): Promise<SkillSourceInstance> {
  const db = await getAsyncDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO skill_sources (id, kind, name, url, skills_path, credential_ref, auto_update, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.kind,
      input.name,
      input.url || null,
      input.skillsPath || "skills",
      input.credentialRef || null,
      input.autoUpdate ? 1 : 0,
      now,
      now
    );
  const row = await db.prepare("SELECT * FROM skill_sources WHERE id = ?").get(id);
  return rowToInstance(row);
}

/** 列出所有已登记源（可含已禁用）。 */
export async function listSkillSources(): Promise<SkillSourceInstance[]> {
  const db = await getAsyncDb();
  const rows = (await db.prepare("SELECT * FROM skill_sources ORDER BY name").all()) as any[];
  return rows.map(rowToInstance);
}

/** 按 id 查询单个源。 */
export async function getSkillSource(id: string): Promise<SkillSourceInstance | undefined> {
  const db = await getAsyncDb();
  const row = await db.prepare("SELECT * FROM skill_sources WHERE id = ?").get(id);
  return row ? rowToInstance(row) : undefined;
}

/** 启用/禁用源。 */
export async function setSkillSourceEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE skill_sources SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, now, id);
}

/** 更新源的同步时间（discover/拉取后调用）。 */
export async function touchSkillSourceSync(id: string): Promise<void> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE skill_sources SET last_sync_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
}

/** 删除源实例。 */
export async function deleteSkillSource(id: string): Promise<void> {
  const db = await getAsyncDb();
  await db.prepare("DELETE FROM skill_sources WHERE id = ?").run(id);
}
