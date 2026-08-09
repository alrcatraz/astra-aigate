/**
 * adapters/index.ts — Skill 源适配器注册表 (Phase 4 M1)
 *
 * 集中注册所有 SkillSourceAdapter。支持两类：
 *   - 单实例源（skillssh / skillsmp / github-search / local…）按 kind 一个实例；
 *   - 多实例源（git 系：github-public / gitea）按用户登记的 SkillSourceInstance
 *     动态构建（M1「用户登记源」）。
 * 所有 adapter 只读（writable=false，单一数据源原则）。
 */
import type { SkillSourceAdapter, SkillSourceKind } from "../sourceKind";
import { skillsshAdapter } from "./skillsshAdapter";
import { GitRepoAdapter } from "./gitRepoAdapter";
import { OmnirouteBuiltinAdapter } from "./omnirouteBuiltinAdapter";
import type { SkillSourceInstance } from "../sourceKind";

/** 已注册的单实例 adapter（按 kind）。 */
const SINGLETONS: SkillSourceAdapter[] = [skillsshAdapter, new OmnirouteBuiltinAdapter()];
const byKind = new Map<SkillSourceKind, SkillSourceAdapter>(SINGLETONS.map((a) => [a.kind, a]));

/** 多实例 adapter（kind → 实例构建工厂）。 */
const FACTORIES = new Map<SkillSourceKind, (inst: SkillSourceInstance) => SkillSourceAdapter>([
  [
    "github-public",
    (i) =>
      new GitRepoAdapter({
        kind: "github-public",
        id: i.id,
        displayName: i.name,
        repoUrl: i.url ?? "",
        skillsPath: i.skillsPath,
      }),
  ],
  [
    "gitea",
    (i) =>
      new GitRepoAdapter({
        kind: "gitea",
        id: i.id,
        displayName: i.name,
        repoUrl: i.url ?? "",
        skillsPath: i.skillsPath,
      }),
  ],
]);

/** 可多实例化的源类型。 */
export function isMultiInstanceKind(kind: SkillSourceKind): boolean {
  return FACTORIES.has(kind);
}

/** 按用户登记的源实例构建 adapter（多实例源）。 */
export function buildAdapterFromInstance(
  inst: SkillSourceInstance
): SkillSourceAdapter | undefined {
  const factory = FACTORIES.get(inst.kind);
  return factory ? factory(inst) : getSourceAdapter(inst.kind);
}

/** 按源类型查找 adapter。未实现返回 undefined（不抛，调用方自行降级）。 */
export function getSourceAdapter(kind: SkillSourceKind): SkillSourceAdapter | undefined {
  return byKind.get(kind);
}

/** 列出所有已注册的单实例 adapter。 */
export function listSourceAdapters(): SkillSourceAdapter[] {
  return [...SINGLETONS];
}

/** 是否已有该源类型的 adapter（单实例或可多实例）。 */
export function hasSourceAdapter(kind: SkillSourceKind): boolean {
  return byKind.has(kind) || FACTORIES.has(kind);
}

/** 动态登记单实例 adapter（供后续里程碑 / 插件注册新源）。 */
export function registerSourceAdapter(adapter: SkillSourceAdapter): SkillSourceAdapter | undefined {
  const prev = byKind.get(adapter.kind);
  byKind.set(adapter.kind, adapter);
  const existing = SINGLETONS.findIndex((a) => a.kind === adapter.kind);
  if (existing >= 0) SINGLETONS[existing] = adapter;
  else SINGLETONS.push(adapter);
  return prev;
}
