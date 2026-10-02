# guix-to-work — Guix-on-GitHub-Actions 经验记录

本文件是「CI 改造为 Guix 声明式工具链」（step-2）的活文档：每次试点运行后把
**实测事实、坑、纪律**追加到这里，直到覆盖面决定完成。它不是教程，是本项目
自己的踩坑账本。

## 设计基线（决策记录）

- **不自建 runner**（fleet 各机性能与负荷不允许），全部依托 GitHub Actions
  `ubuntu-latest`。
- **宿主 = ubuntu-latest；受管工具链 = Guix**。JS-based steps（actions/checkout、
  setup-node 等）用 runner 自带 node，不查 PATH —— 天然与 guix 隔离。
- **可复现锚点 = channel commit 钉死**（`guix time-machine -C channels.scm`），
  manifest 只声明"要哪些工具"，版本由 pin 决定。
- **范围**：先试点静态分析类 job（lint / quality / docs），bun、E2E(playwright)、
  build-image(Dockerfile) 暂不用 guix 碰。
- Node 版本差（guix 22.x vs 生产 26）**试点阶段接受**，Phase B（容器可复现）再解。

## 实测日志

### 2026-09-29 — smoke run #1（run 36563669515，失败）

**成功的部分（重要）：** `PromyLOPh/guix-install-action@v1.6` 在
`ubuntu-latest` 上安装 Guix **成功**，`guix describe` 亦成功 —— 最难的
"在 GitHub runner 上拿到 Guix" 这一步已验证可行。

**失败：** `guix time-machine -C channels.scm` →
`error: %default-channel: unbound variable`。

**根因与教训（1）：** 我用了 `(inherit %default-channel)`，但 channels 文件的
求值语境里继承目标写错了（正确变量是 `%default-channels`，复数，且那是
**列表**不是单个 channel）。不要"继承默认 channel"来改 commit —— 直接写出完整
的 channel 定义。

### 2026-09-29 — smoke run #2（run 36563831173，失败）

**失败：** `error: use-modules: unbound variable`
`hint: Did you forget '(use-modules (guile))'?`

**根因与教训（2，关键）：** channels 文件**不能**写 `use-modules`。Guix 用
受限求值读取该文件，`use-modules` 是宏、只存在于宏展开期，在那里被当普通函数
调用 → unbound。**上一轮的"修复"方向完全错了**：加 import 反而引入了新错误。

**正确形态**（据官方手册 _Specifying Additional Channels_ 与
`guix describe --format=channels` 输出）：

```scheme
(list (channel
        (name 'guix)
        (url "https://git.savannah.gnu.org/git/guix.git")
        (branch "master")
        (commit "<40-hex-sha>")))
```

即：裸 `list`/`cons` 表单 + **完整 channel 定义**，无 `use-modules`、
无 `inherit`。要钉死就用显式 `(commit ...)`；要叠加自定义 channel 才用
`(cons (channel ...) %default-channels)`。

### 教训汇总（三条通用纪律）

1. **channels.scm 是数据表单，不是模块** —— 不写 `use-modules`、不写
   `define`。这是它和 `guix.scm`/manifest 最大的语义差异。
2. **`%default-channels` 是列表**（复数），`%default-channel` 不存在。
3. **heredoc 里的 GitHub 表达式**：写 `${{ env.X }}` 时必须用**非引号**
   heredoc（`<<EOF`），`<<'EOF'` 会阻止替换、静默写出字面量。凡有替换的
   生成步骤都要加一句 `grep -q` 断言校验替换真的发生。

### 2026-09-29 — smoke run #3（run 36564030851，失败，但语法已通过）

**进步：** channels.scm **解析通过**了 —— 报错从 Scheme 语法错变成了网络错，
证明 `(list (channel ...))` 的形态正确。

**失败：** `Git error: SSL error: syscall failure: Resource temporarily
unavailable`（47 秒后），发生在
`Updating channel 'guix' from Git repository at 'https://git.savannah.gnu.org/...'`。

**根因与教训（4，最重要的一个）：我对这个 install action 的心智模型错了。**

日志揭示的真实行为：

- 该 action **只下载官方 nightly 二进制 tarball**
  （`wget ci.guix.gnu.org/.../guix-binary-nightly.tar.xz`）。
- 它的 **`channels:` 输入不 pin 安装版本**，而是**输出**一份描述"我装了什么"
  的完整 channel 定义（含 `introduction` + OpenPGP 指纹）。实测输出是
  `url https://git.guix.gnu.org/guix.git` / `commit 5ceffb60...`，
  **完全无视我传的 13becbdc...**。
- 我手写的 channels.scm 因此有两个致命缺陷：**缺 `introduction`**
  （日志：`warning: channel 'guix' lacks an introduction and cannot be
authenticated`）且**指向 savannah 原站**，导致 `time-machine` 要从头
  clone 整个 Guix 仓库（数百 MB）→ 超时。

**正确做法：** 不要手写 channels.scm。直接消费 action 的
`steps.guix.outputs.channels` 作为文件内容 —— 它与已安装的 Guix 自洽
（同 URL、同 commit、含认证信息），`time-machine` 无需重新 clone。
校验用 `grep -q commit` + `grep -q introduction` 双断言。

**元教训：** 用一个第三方 action 前，先读它**实际执行的命令**（日志里的
`wget`/`git` 行），而不是只读文档里的输入描述。我对 `channels:` 的误解
导致连错两轮。

### 2026-09-29 — smoke run #5/#6（探测方法本身出过错）

**run #5 的假阴性：** 我用 `guix search --exact "^\$pkg\$" | grep -q "^name: \$pkg\$"`
探测，10 个包**全部报 MISS**，连 `coreutils`、`bash` 都 MISS —— 这明显荒谬。
真因：`--exact` 不是 `guix search` 的有效参数（或输出格式不匹配），命令被
`2>/dev/null` 吞掉，`if` 恒假。**教训：加了 `2>/dev/null` 又用 `if` 判断的探测，
失败与"不存在"无法区分——必须把 stderr 打印出来。**

**run #6 的正面结论：** 改用 `guix shell <pkg>`（CLI 形式）逐个探测，
**10 个包名全部 OK**（含我本以为不存在的 `which`）。但 manifest 仍然报
`unknown package`。

**决定性根因（教训 5，最有价值的一条）：Guix 的变量名 ≠ 包名。**

CLI 走**包名**匹配（`(name "node")`），而 manifest 写的是 **Scheme 变量名**。
Guix 官方 2024-12 的提交把 `gnu/packages/node.scm` 的 `node` 变量
**重命名为 `node-bootstrap` 并隐藏**，现在该模块导出的是 `node-lts` 等。
于是：

- `guix shell node` → **成功**（匹配包名 "node"）
- manifest 里写 `node` → **unbound variable**（该变量已不存在）

这解释了为什么"包名全 OK 但 manifest 失败"。

**排查配方（下次直接照做）：**

1. CLI `guix shell <name>` 确认**包名**存在；
2. 到该包的 `Package source`（packages.guix.gnu.org 页面有 scm 路径）grep
   `define-public` 找到**真实变量名**；
3. manifest 里用变量名（如 `node-lts`），不是包名。

**诊断方法本身也要设计对：** 探测变量名要构造单条目 manifest 让 Guix 求值，
与真实 manifest 走同一路径——而不是用别的命令（`search`/`build` 引号形式）
间接推断，那只会产生新的假阴性。

### 2026-09-29 — smoke run #9（run 36574183617）**SUCCESS ✅**

全部 8 步通过，总耗时 **14 分 32 秒**（含 Guix 安装与首次 substitute 拉取）。

**真正的根因（教训 6，藏了 4 轮）：`-m` 与 `-f` 互斥，我把同一个文件传给了两者。**

```yaml
# 错的
guix shell -m .guix/manifest.scm -f .guix/manifest.scm -- true
#              └─ manifest ─┘   └─ 包定义文件 ─┘
```

`-f` 让 Guix 把该文件当**包定义文件**解析，而 manifest 里没有 `define-public`
→ "找不到包" → 报 `unknown package`。所有包名/模块/变量其实都是对的。

**为什么拖了 4 轮才找到：** 我一直盯着**内容**（包名、模块、变量）查，从没
质疑**命令本身**。而证据早就在眼前——单条目 probe 用 `-m` **单独**跑就成功，
真实步骤失败，两者的差别只在**命令形式**。**教训：当"内容正确但整体失败"
时，先对比成功样例与失败样例的调用形式，再怀疑内容。**

**修正方式：** 把 shell 调用抽成 `env.GUIX_SHELL` 单一来源，各步骤只引用变量，
从结构上杜绝再漂移回错误 flag 组合。

**实测数据（本 pilot 的核心产出）：**

| 项               | 值                                   |
| ---------------- | ------------------------------------ |
| runner 系统 node | `/usr/local/bin/node` **v22.23.2**   |
| guix 受管 node   | `/gnu/store/…/bin/node` **v24.18.0** |
| guix npm         | 11.16.0                              |
| guix git         | 2.54.0                               |
| guix ripgrep     | `/gnu/store/…/bin/rg`                |
| 总耗时           | 14m32s（冷缓存）                     |

**双轨隔离验证 —— 无需别名机制：**

```
outside shell: node -> /usr/local/bin/node            v22.23.2   (runner 自带)
inside  shell: node -> /gnu/store/…-profile/bin/node  v24.18.0   (guix 受管)
```

两条路径天然隔离：JS-based steps 用 runner 自带 node（不查 PATH），
`run:` 步骤内的命令解析到 guix store。**用户构思的"别名方案"实际不需要** ——
`guix shell` 的 PATH 前置已经达成同样效果，且更干净。

**意外收获：** guix 的 node 是 **24.18.0**（不是预估的 22.x），与生产容器
node 26 只差 2 个大版本 —— CI↔生产的版本落差比预想小。

**下一步（扩面前必须解决）：**

1. **缓存**：14m32s 冷启动对每个 job 都是不可接受的。需要 `/gnu/store`
   的 actions/cache 层（按 channels.scm 内容哈希做 key），目标降到 ~1-2 分钟。
2. 缓存落地后再决定扩面到哪些 job（Lint / Quality Gates / Docs）。

**⚠️ 2026-10-01 更正：上面第 1 条的形态已被证伪。** `actions/cache` 无法
恢复 `/gnu/store`——它**解成绝对路径**（`-P -C <ws>`），而 runner 用户不是
`/gnu/store` 的属主/写主，解包即 `Permission denied`（install action 自己的
测试写明 _"Cannot use a cache for /gnu/store, since restore fails"_；actions/
cache issue #133/#792/#845/#12194 全是同一权限模型的重复报告）。缓存目标必须
**换路径**，不是"怎么给 store 加 sudo"。真正可行的方向在下一条实测里。

### 2026-09-30 — 接入自有 substitute 缓存（只读），随后确认网络墙

**分工结论（质控 vs 构建）：** 本 workflow 属质量控制，**只读** substitute、
不上传。理由：测试的产物不是构建产物，若让 job 自行决定上传什么，缓存内容就
变成"job 何时跑过"的函数——破坏可复现性。写属于构建类 job（其产物即 artifact）。

**实测确认的 Guix 行为：** substitute 按列表顺序查询、命中即止；store 是内容
寻址，同路径即同内容。所以"自动跳过重复"是**两层**的：构建前查 substitute
（命中则下载而非构建），以及 store 本身已存在则连查都不查。pilot 日志实证：
`looking for substitutes... 100%` 之后只对未命中的 `.drv` 才 `building`。

**三个静默失效（都靠本地彩排抓出，没烧 CI）：**

| 坑                             | 后果                                                                                       | 实测依据                              |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| `env:` 里写 `"$OTHER_ENV_VAR"` | **不展开**（Actions 不嵌套展开、shell 只展开一层）→ 命令里是字面 `$NAME`，配置全废且不报错 | `sh -c 'echo $GUIX_SHELL'` 看到字面量 |
| `$GITHUB_ENV` 写 `NAME=a b c`  | 下一步骤读回被**空格切断**                                                                 | 多词值必须用 heredoc `NAME<<EOF…EOF`  |
| 上一 `run:` 步骤的 `export`    | **不跨步骤保留**（每步骤新 shell）                                                         | `env -i bash -c` 对比验证             |

对应加固：装配后的命令做 `case *'$'*` 断言（宁可失败也别静默失配）。

**合规：** 泄漏 grep 抓到我把内部缓存域名写进 workflow（4 处）——Public-release
Guard 适用于 CI 配置。改存 **secret**（不用 variable）：secret 不可经 API 读、
且 runner 在日志里打码；variable 两者皆无，诊断步骤一打印就可能外泄。
诊断改为只报 URL 数量、不报文本。

**🛑 最终确认：GitHub-hosted runner 无法访问本缓存。**

- `getent ahosts <cache>` → **只有 AAAA**（家宽 WANv4 是 CGNAT，无 port-forward）
- GitHub-hosted runner **完全没有 IPv6 egress**（官方限制，issue runner-images#668，
  多年不变），表现为立刻 `Network is unreachable`，不是可调超时的慢
- 本机 curl 得 200（fleet 机器有 IPv6）不能推断 runner 也能——**两者结果相反是
  正常的**

**结论：** 接入代码已就绪且降级干净（secret 未设 → 仅公开镜像，不失败）。
要真正用上自有缓存，需要**一个 IPv4/双栈可达的前端**（公网代理、带 IPv4
出口的隧道、或有 IPv4 的镜像机）。在缓存填入自有 channel 产物之前这事不紧急
（官方源已覆盖当前 manifest，接上也是零增益）。

### 2026-10-01 — 共享 composite action 上线（run #10-#13，4 轮 3 个自伤 bug）

**动机：** 装配形态（channel pin、flag 组合、substitute 拼装、`$GITHUB_ENV`
传递）每一条都是烧过 CI 的坑。真实 job 若各写一份副本，副本间一漂移就复现
同样的静默失效。**抽成 `.github/actions/guix-toolchain` 单一定义**，
`guix-smoke` 降为它的回归测试，Docs Lint 首个消费。

**run #10（`16e870ea`，失败）—— composite action 里没有 `secrets`。**
`Unrecognized named-value: 'secrets'`：复合 action 的表达式上下文只有
`inputs`/`env`/`steps`/`runner`/`github` 等，**没有 `secrets`**，action.yml
根本加载不了。改法：cache URL 走**输入参数**，由调用方 `with: cache-url:`
传入（调用方是 workflow，那边有 secrets）。**教训 7：secrets 只能在
workflow/job 层解析，不能下沉到 composite action 内部。**

**run #11（`46223562`→`5eab03ab`，失败 ×2 同一错）—— 双层 time-machine 是错的。**
我当时以为 `extraneous argument` 来自"选项位置异质"，修成单层；但**同一错误
第三次原样复现**，证明两次修复都没碰到病因。**教训 8（方法论）：当一个修复
没改变错误，说明根因不在我改的地方——继续在同处打转是浪费，必须换假设。**

**run #12（`69b91af2`，失败但进度大）—— 真因：引号不随展开重新解释。**
wrapper 原是**预拼命令字符串**、URL 列表用单引号包着。消费方一律写**不带引号**
的 `$GUIX_SHELL true`——shell 对**展开后的值**做词分割时，值里的单引号只是
普通字符（`'` 不会变成语法）。于是列表被切开，最后一个 URL 带尾引号成多余参数，
正是报错原文 `https://ci.guix.gnu.org': extraneous argument`（Guix bug #29814
同构）。**改法：生成可执行脚本**——引号在脚本内部才是真语法，列表恒为一个
argv 元素；`$GUIX_SHELL` 退化成单个路径，无法被词分割打散。
**教训 9：多词值绝不能装进"会被不带引号展开"的命令串；要么装进脚本文件
（引号在文件内是真语法），要么接受它被拆开。**

**run #13（`6708ecd4`）SUCCESS ✅（8/8，13 分钟）：**

```
manifest resolved OK
node  /gnu/store/…-profile/bin/node v24.18.0   npm 11.16.0
git 2.54.0   rg 15.1.0   jq 1.8.2   eval ok v24.18.0
outside: /usr/local/bin/node v22.23.2  →  inside: /gnu/store/…/node v24.18.0
```

（中途 run #12 暴露 `no public interface (gnu packages jq)`——我扩 manifest 加
jq 时**凭记忆**写了模块名，实际在 `(gnu packages web)`。**这恰是 manifest 注释
里自己写的警告**："变量必须验证、不能猜"。教训 10：**注释里的警告不等于我会
遵守——每次新增条目都要当场查证，包括我已经写过警告的那类错误。**）

**方法论教训 11（比修复本身值钱）：本地彩排必须复现 runner 的展开方式，
不是复现字符串。** 上一版彩排用 `eval` 重解析字符串——那会把引号当真语法，
**恰好绕过 runner 的词分割**，所以彩排绿而 CI 红。新彩排改为：执行 action
真实 `run:` 体 → 按 GH 方式注入环境 → **不带引号**展开 `$GUIX_SHELL` →
假 `guix` 抓真实 argv 断言。并做**双向对照**：旧形态过同一断言必须复现 CI
报错（证明断言会响）、坏 token 形态必须触发 FATAL（证明探测不空转——原探测
grep `\$SUBS` 带反斜杠，真实残留是 `$SUBS`，**永远匹配不到，形同虚设**）。

**教训 12（探测的探测）：写完一个断言/probe，先问"它能不能失败"。**
不能失败的 probe 比没有 probe 更危险，因为它制造了"已验证"的假象。

### 2026-10-01 — pin 归属 + checkout 缓存 + 漂移哨兵（run #14 数据定案）

**run #14（`36863496262`，SUCCESS）实测的归属：**

```
~/.cache/guix   owner=runner  571M   ← channel checkout 在 runner HOME，可缓存 ✅
/root/.cache/guix             不存在
/var/guix       owner=root     15M
/gnu/store      owner=root     3.4G  ← 不可缓存（绝对路径恢复必失败，已证伪）
```

**定案 1：pin 进仓库（`.guix/channels.scm`），不再消费 installer 的 channels
输出。** 原形态跟随 nightly tarball **每日漂移**——可复现性不成立、缓存 key
天天失效。现在 time-machine 钉仓库 pin，installer 二进制只是引导。
（实测发现：9-30 与 10-1 两轮 nightly commit 相同 `5ceffb60`，漂移节奏比
设想的不规则——更说明隐式跟随不可靠。）

**定案 2（bump 策略，用户确认方向）：事件驱动 + release 做提醒不做闸门。**
触发：漂移哨兵红（上游改名/移除）、生产 node 代差需要抹平、guix-daemon
安全公告（修复只进 rolling，无稳定分支——这正是 Guix 被移出 Debian 的直接
原因，LWN《Removing Guix from Debian》）。下限：每次 Guix release（1.5.0 =
2026-01；GCD 已通过 ≈每年 6 月一次）后两周内 bump 一次防 pin 腐烂。**绝不
定时自动 bump**——那等于回到漂移模式。
诚实标注：release 制度太新（首个年度周期还没走完一轮），1.6.0 是否已按
2026-06 发布本次未能核实，以 release 页为准。

**定案 3：缓存 `~/.cache/guix`，key = pin 文件的 sha256 前 16 位。**
单一来源：改 pin → key 自动跟。`restore-keys` 含裸前缀 `guix-checkouts-v1-`
→ bump 后旧 checkout 增量 fetch，不全量重 clone。**配对约束：action 只能
restore，save 必须在消费 job 的末尾**（checkout 在 action 返回之后、job 步骤
之中才生成——composite 步骤在调用点按序执行，不存在"job 结束后再回到 action"
的生命周期）。忘配 save 的 job 不会坏，只是每轮付冷 clone。

**新踩的坑（教训 13）：行式 grep 与 pretty-print 冲突。** 断言
`\(commit[[:space:]]*"sha"\)` 是行式的，而 `guix describe -f channels` 习惯把
字符串换行另起——手写 pin 照抄该排版，验证必挂。修：pin 数据部分改单行式，
文件头写明排版约束；双向对照（真文件必须过、多行式必须挂）实测通过。
**凡行式断言，先想清楚被断言文件的排版由谁决定。**

**漂移哨兵 `guix-drift.yml`**（周一 03:17 UTC，advisory，continue-on-error）：
同一份 manifest 用**最新 nightly** 身份 time-machine。上游改名/移除在这里
提前几周暴露，而不是等 bump 那天一起炸。它**故意不复用** composite action
——action 的职责是强制仓库 pin 与 pin 键缓存，正是漂移探针要绕开的东西。

### 2026-10-01 — pin verified, cache proven, bump policy closed

**run #15 (`36872872830`, SUCCESS 9/9, first run on the repo pin):**
checkout cache MISS (key `guix-checkouts-v1-ad8bcdfd3d1feb35`), Save banked
~455 MB. Total ~16.2 min (upload included).

**run #15 rerun (warm):** `Cache restored from key: …ad8bcdfd3d1feb35` —
Manifest resolves **971s → 473s**, whole job **~8.4 min**. The 8-min
channel clone is gone; what remains is the fresh-VM substitute fetch for
/gnu/store (uncacheable by design — see the store falsification above).
Honest floor without a reachable own-substitute service: ~8 min.

**Bump policy (owner, closed this round):**

- Must not depend on an external agent or any OS outside the runner → **no schedule
  anywhere**. The weekly cron draft was REMOVED; guix-drift.yml now fires
  on push/pull_request touching `.guix/**` + workflow_dispatch only — a
  bump PR carries its own anchor and drift leg as review context.
- build/test should run the SAME guix environment (owner expectation) →
  gated by measured evidence first, migrated job by job after it.

**Node parity facts (channel search endpoint, control-validated, 2026-10-01):**
this pin AND upstream master expose NO `node-25`/`node-26` variable (only
node / node-lts / node-bootstrap; pin's node-lts = v24.18.0). package.json
engines `>=22 <23 || >=24 <27` → the pinned node IS inside the supported
range today; matching production's node 26 needs a custom package
definition — recorded as NODE PARITY NOTE in .guix/channels.scm.

**Native gate (new, advisory):** lockfile carries 19 install-script
packages; better-sqlite3 v13 ships per-platform prebuilds (no gyp), and
sqlite-vec is a .so loaded via `sqliteVec.load(db)` on the raw handle —
the ABI worry is narrower than feared but STILL UNPROVEN under the pinned
node. Added job `native` to guix-smoke.yml: `$GUIX_SHELL npm ci` +
scripts/guix-native-probe.mjs (mirrors vectorStore.ts's load path; critical
= better-sqlite3 / sqlite-vec / tsx; exit-1 on critical failure; the JOB is
continue-on-error so it reports, never gates).

### 2026-10-01 — npm-ci class migrates (Build canary first, batch after)

**dispatch #1 (run 36886388353, commit 3c004853) audited the four
node-only migrations:** docs-lint GREEN, i18n UI Coverage GREEN, glossary
step executed the script correctly under the pinned node and reported 5
REAL content violations ("提供商" vs canonical "提供者") — reproduced
verbatim on the local machine and red on main for three consecutive
runs ⇒ pre-existing content debt (step-3), not a migration regression.
PR Test Policy skipped by design (PR-only event). NOTE: dispatch #1 was
CANCELLED near the end by dispatch #2 through the workflow concurrency
group — never overlap dispatches; completed jobs' conclusions survive.

**Build canary (run 36888454046): Build job GREEN end-to-end** — shared
action, npm-ci-retry running `npm ci` with the pinned npm (GUIX_SHELL
detection), check:node-runtime, the full Next webpack build, artifact
upload. That gated the batch migration of the remaining 11 npm-ci jobs
(same pattern; 57 wrapped command lines).

Boundary rules the batch had to respect (both are silent-breakage traps):

1. NEVER wrap a command's ARGUMENTS: `$GUIX_SHELL npx c8 … npm run test…`
   wraps only c8 — the wrapper's PATH already resolves the inner npm, and
   wrapping the argument would hand c8 a script path as the instrumented
   target (coverage would record the wrapper, not the suite).
2. External-binary install blocks (quality-extended's gitleaks/osv/…)
   stay runner-side on purpose: guix shell PREPENDS its profile and keeps
   the inherited PATH, so pinned npm scripts still find ~/.local/bin
   binaries. "Full guix purity" here would only break the scanners.

`changes` (fan-out root) and `test-e2e` (browser binaries belong to the
runner image) remain on setup-node — both deliberate, documented in-file.

### 2026-10-01 — batch validation: zero new failure classes (step 2 closes)

Dispatch #3 (run 36892571301, head 152fdc1e = all 11 npm-ci jobs on the
pinned toolchain) compared conclusion-by-conclusion against the
pre-batch baseline (dispatch #1, run 36886388353):

- Every red in #3 exists identically in #1 — same job, and where the
  runner gives the step name, the SAME script (Package Artifact:
  `check:pack-artifact` failed pre- and post-migration, the only
  difference being the `$GUIX_SHELL` prefix — same debt, wrapped).
- Unit shards red in #3 (1,3,5,7,8 + 2/4/6 cancelled mid-flight) match
  #1's set exactly — the earlier worry that 7/8 were NEW was wrong:
  #1's fuller list already had them.
- One baseline red turned GREEN under guix: Quality Gates (Extended).
- Green in both: Build, Security Tests, Docs Lint, i18n UI Coverage,
  CI Dashboard, E2E 1/3/5/6 (e2e unmigrated by decision).
- Quality Ratchet (aggregate) failed only in #3 because #1 was
  cancelled before it produced a verdict — an aggregation of the
  unchanged underlying debts, not a new class.

Conclusion: migrating lint/quality/build/test/package to the pinned
declarative toolchain introduced NO new failures; all remaining reds
are the pre-existing debt tracked for step 3 (which now also inherits:
glossary 提供商/提供者 content debt ×2 locales; Bun-SQLite compat under
guix PATH is a genuine step-3 item — guix does not package bun, this
job's red is baseline but its fix must decide runner-vs-channel for
bun; ubuntu-latest → Ubuntu 26 migration on 2026-10-19, runner-images
issue #14748, watch for it landing between steps 3 and 4).

**Step 2 complete.** Toolchain: repo pin (.guix/channels.scm,
event-driven bumps, checkout cache restore/save pair), 15 of 17 CI jobs
on the declarative toolchain (changes + test-e2e remain on setup-node
by documented decision), shared action + smoke + native probe + drift
anchor as the standing regression net.

### 2026-10-01 — CD boundary agreed: distro base stays, builder gets pinned

Owner decision on "migrate the build too": the **base image stays an
ordinary distro** (openSUSE Leap 16.0 — easy maintenance, zypper security
patches, CN-friendly mirrors, no source rewiring). Reproducibility lives
in the BUILD TOOLCHAIN, not the base. Plan, in order:
A. Pin the base-image tag to an exact point release (today `leap:16.0`
floats with the registry; patches become explicit tag bumps — same
discipline as the channel pin).
B. Unify CI and image on one node closure. Measured facts: the
Dockerfile already pins node by tarball version (26.7.0, exact);
Guix at the CI pin ships node-lts v24.18.0 and NO node-25/26
variable (bump-anchor evidence) — so matching 26.7.0 in guix means
a custom package definition. The native probe already ran `npm ci`
under v24.18.0 with all critical bindings green (better-sqlite3 +
sqlite-vec load + tsx), so a version unification is a consistency
gain, not an ABI necessity. Decision pending owner taste:
keep-24-allow-range vs define-node-26-7-0 (build-time risk:
guix does not package bun; substitutes for a fresh source-hash
node may not exist on the mirrors).
C. (separate, later) builder-stage toolchains from a guix profile
COPY layer — image runtime stays Leap; the build step becomes
declaratively pinned. Canary as a shadow tag, prod untouched.

## Runtime unification: node/npm as first-class pins (2026-10-02)

Three directives from the operator, all executed:

1. **"CI and build must behave identically" (own node 26).** The pinned
   channel CANNOT deliver it: probe run `36945680396` → `node@26.7.0:
package not found`, and a cgit search of the pin's `gnu/packages/node.scm`
   for the literal `26.7.0` returns no results (the channel tops out at the
   24.x/25-era catalogue: `node` / `node-lts` / `node-bootstrap`). A
   hand-written package for the official tarball was drafted and DISCARDED —
   a Guix-BUILT node of the same version links a different glibc/OpenSSL and
   would NOT be the image's bytes; parity can only mean "same distribution".
   **Architecture adopted**: `.github/actions/node-dist` (new composite)
   downloads the official tarball, double-verifies it (in-file hex digest +
   nodejs.org SHASUMS256.txt of the release — two independent statements),
   and exports `NODE_DIST_*` + a PATH head. `guix-toolchain` embeds it as
   its FIRST step (single-point opt-in: 15 migrated jobs get it with zero
   edits), and `.guix/manifest.scm` **dropped node-lts entirely** — support
   tools (git/rg/jq/python/bash/coreutils…) stay in the profile, and with
   no node in the profile PATH falls through to the dist: one node (26.7.0)
   everywhere.
2. **Leap 16 survey (operator: "investigate first").** Findings: `leap:16.0`
   IS the security-update delivery mechanism (zypper at build time pulls the
   patched set); pinning a snapshot tag would FREEZE the CVE set. The tag
   is already pinned at the release-line level ("钉16" = stay on 16).
   Reproducibility instead = evidence: `build-image.yml` gained a step that
   records the tag's registry manifest digest into the step summary before
   every build (local proof: anonymous HEAD works, `/v2/token` 400s here;
   survey-time digest `sha256:cd9aac11608afabc96a10074619cf2a65ccf60ff4b72d09d4e4e125af409035d`).
3. **npm pinned like uv.** `npm@latest` (both image and CI) was a live
   drift: registry latest = 12.2.0 while node 26.7.0 bundles 11.19.0.
   Now: `ARG NPM_VERSION=12.2.0` in the Dockerfile (with a build-time
   `npm --version | grep -qx` assertion), and node-dist reads that SAME ARG
   and refreshes its own npm to match — one source, two consumers.

### Residual surface closed in the same pass

- `setup-node` retired repo-wide: `changes`, `test-e2e`, `dast-smoke` now
  use node-dist standalone (dast had been running the server on node 24 —
  a version the image never shipped). `CI_NODE_VERSION` env deleted; the
  Dockerfile ARGs are the only version statements left.
- guix-drift's "manifest node under pin" probe removed (the manifest has no
  node now); it prints channel `node-lts` via `package --show` as catalog
  info + the Dockerfile ARG as the actual runtime pin.

### Local proofs before push

- `npm ci` under node 26.7.0 / npm 11.19.0: exit 0 (118 s).
- `scripts/guix-native-probe.mjs` under 26.7.0: **all critical bindings OK**
  (better-sqlite3 3.53.3, sqlite-vec vec0, onnxruntime, tsx, esbuild;
  libxmljs2 optional-absent as on CI) — closes the ABI question for 26.
- Digest pipeline executed verbatim locally against the real registry.

### Pitfalls hit while building this

- **`awk -F': '` truncates digests**: splits `sha256:abc` at the colon →
  prints `sha256`. Use `awk '$1=="docker-content-digest:"{print $2}'`.
- **Composite checkout SHA near-miss**: while replacing setup-node in
  dast-smoke the checkout line briefly carried the setup-node SHA — caught
  by the post-edit verification pass, not by review. Verify `uses:` refs
  mechanically after ANY action-line edit.
- **Invalid local repro ≠ CI bug**: `GUIX_SHELL=x "$GUIX_SHELL" npm` on one
  shell line expands `$GUIX_SHELL` BEFORE the assignment applies (empty →
  `: command not found`). CI's real shape is env-exported-then-expanded and
  works; don't "confirm" a bug from a broken repro.
- **Inline python heredoc inside YAML**: indentation-broken at parse time —
  keep embedded snippets flat or move the digest to a plain hex constant.

### Bump ceremony (single commit, three files)

`Dockerfile`: `ARG NODE_VERSION` + its digest case in node-dist's case
block + `ARG NPM_VERSION`. guix-smoke's identity step asserts node AND npm
against both ARGs, so a one-sided edit goes red immediately.

### Fix round (same day): smoke/bump-anchor red on the first push — 2 root causes

- **npm self-refresh landed in the wrong tree** (`FATAL: npm is 11.19.0
after refresh, want 12.2.0`): npm derives its global prefix from
  `process.execPath` — the node `env` finds on PATH — NOT from npm's own
  location. Reproduced locally: without the dist on PATH, `npm config get
prefix` = the outside node's directory; `npm install -g npm@12.2.0`
  updated THAT tree, the dist kept 11.19.0. Fix: `export PATH="$BIN_DIR:$PATH"`
  inside the fetch step before any npm invocation (proven: with the export
  the install yields 12.2.0). The Dockerfile never hit this because inside
  the image the only node IS the dist node.
- **drift's "Node catalogue" called guix before the installer**, and the
  shape `guix … 2>/dev/null | awk | sed` masked the command-not-found (under
  `set -e` a pipeline reports the LAST command). The step died one line
  later on an empty checkout fed to grep — far from the real cause. Fix:
  moved the step after Install Guix; `SHOW=$(guix time-machine …)` command
  substitution so set -e sees guix itself; empty-checkout guard; dropped
  the `2>/dev/null` masking in smoke's identity step too.

**Lesson 14 — pipelines eat probe failures.** Any step whose purpose is to
DETECT (not merely display) must capture with `$(cmd)` or check
`PIPESTATUS`; `cmd | formatter` reports the formatter's exit code and turns
a dead probe into a silent empty success that explodes downstream.

### Lesson 15 — PATH silently swallows broken entries; assert RESOLUTION, not values

Smoke `36980228554` went green while a real bug lived in it: the export step
appended `/bin` to a variable that already WAS the bin dir → `NODE_DIST_RUN`,
`NODE_DIST_NPM`, and the exported PATH head all pointed at a nonexistent
`…/bin/bin`. PATH lookups skip missing directories without complaint, so
every `$GUIX_SHELL node/npm` step fell through to the RUNNER's node — while
the identity assertions, written against the correct `NODE_DIST_BIN`, stayed
green. Two rules:

- derived exports must be exercised by an assertion (`command -v` equality
  against the expected path), never just printed;
- `test -x` on every path a step exports before writing GITHUB_ENV (added).

The full CI dispatch was cancelled before running on the broken PATH rather
than letting it produce an uninterpretable red/green mix.

### Lesson 16 — channel catalogue probes: read the SOURCE, not the CLI

`guix time-machine -C pin -- package --show=node-lts` → "package not found"
even though `(… node-lts …)` resolves fine inside a manifest: the CLI
resolves the **name field**, which need not equal the Scheme variable, and
every time-machine CLI call _rebuilds guix itself_ at the pinned revision
(an 11-minute informational line). For catalogue questions (which node
versions does the pin carry?) grep the pinned checkout's
`gnu/packages/node.scm` directly — verified against the real file: vars
`node`/`node-lts`/bootstraps, versions include 24.18.0 and **no 26.x**,
closing the "does the channel have our node" question permanently. Same
rule applied in smoke's identity step (informational channel line only).

Also caught pre-push by local replay: BRE `sed 's/^\(define-public //'` —
an **unclosed `\(` group** is a runtime sed error; to strip a literal
`(` write it bare (`s/^(define-public //`). Grep/sed pipelines for summary
output must be executed against a real sample file, not eyeballed.

## Focus trio closed (2026-10-02) — final verdict on dispatch CI 36981976435

**Zero-new-failure-class re-confirmed** (node 26.7.0 + npm 12.2.0 everywhere):
the failing-job set is name-for-name IDENTICAL to baseline dispatch#3
(36892571301) — 18 jobs, and the per-step audit matches too: Quality Gates
(Extended) fails at the SAME step (`Bundle size` REGRESSÃO 7667 > baseline
6762, both runs, both toolchains — npm 12.2.0 lays byte-identical
`bin/*.mjs`); scanners skipped by the same precondition. E2E/Unit/integration
red families are the step-3 debt list unchanged.

Guix workflows all green on the final head `2e54811b`: smoke (in/out-shell
node+npm assert dist equality; catalogue from source; native probe 26 all
critical OK), bump-anchor dispatch (catalogue step now reads the pinned
source — no CLI name-field trap, no 11-minute guix self-rebuild), Build
Image (base-digest evidence step ran on the real runner).

### Scope clarification for the record (operator question, verbatim intent)

"Wasn't node handled in step-2?" — step-2 pinned CI's node AGAINST THE
RUNNER (was: drift whatever GitHub baked in → became: channel node-lts
24.18.0, deterministic). The focus trio pinned it AGAINST THE IMAGE (CI ran
24 while the production artifact shipped 26.7.0 — determinism on both sides,
but not the same bytes). Same variable, different question — the second
round is what makes "build and test share one environment" true in the
artifact sense, and it also killed the last unpinned manager (`npm@latest`).
