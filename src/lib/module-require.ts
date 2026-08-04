import { createRequire } from "node:module";

declare global {
  /** webpack 逃逸标识符：打包后 = Node 原生 require（从 bundle 文件位置向上解析 node_modules）。 */
  const __non_webpack_require__: NodeRequire;
}

/**
 * 运行时 require。为什么不能直接用 createRequire(import.meta.url)（2026-08-03 实测）：
 * webpack / Next standalone 打包时
 *  1. `createRequire(import.meta.url)` 被替换为 `createRequire("/")` —— 从文件系统根解析，
 *     永远找不到 node_modules（`Cannot find module 'better-sqlite3'`）；
 *  2. `createRequire(<动态参数>)`（如 path.join(process.cwd(), ...)）触发
 *     `module.createRequire failed parsing argument` —— webpack 静态分析失败，模块损坏，
 *     运行时 TypeError（压缩名 `h is not a function` / `d is not a function`）。
 * 打包环境改用 webpack 逃逸标识符 `__non_webpack_require__`（webpack 编译为 Node 原生
 * require，从 bundle 位置向上解析：容器内 /app/.build/next/server/ → /app/node_modules ✓）；
 * 非打包（tsx/dev/test）无该标识符，回退 createRequire(import.meta.url)（真实文件路径，正常）。
 */
export const nativeRequire: NodeRequire =
  typeof __non_webpack_require__ !== "undefined"
    ? __non_webpack_require__
    : createRequire(import.meta.url);
