# CHANGELOG · dsh-boolean

> 版本口径：patch 修 bug/补测试｜minor 新增用户可见功能｜major 破坏性变更。安装：`dsh plugin --profile web add github:TYEclipse/dsh-boolean`

## [0.2.0] — 2026-10-06
### Minor · R61
- 新增第五个工具 **`logic_minimize`**：Quine–McCluskey 最小化到和之积，输出素蕴含项、必要素蕴含项与**项数最少**的覆盖（并列按文字数、再按字典序定序，并如实报告 `unique`）。可选 `dontCare`（无关项最小项下标）——等价于卡诺图那一招：例如 `a & !b & c | a & !b & !c` 配 `dontCare: [6, 7]` 直接化简为 `a`。搜索穷尽（带节点预算），预算耗尽时标 `exact: false` 并返回「必要素蕴含项 + 贪心」，绝不谎称已最小。
- 期望值出处迁移到**仓内** oracle `test/oracle/anchors.py`：真值表用 `itertools` 暴力枚举、最小化用对 `{0,1,-}^n` 全部立方体的**穷尽集合覆盖搜索**（与插件不共享任何 QMC 代码），并新增 `--check` 自检与 `--write-fixture` 重建 fixture（重建结果与原 fixture 逐字节一致）。
- 测试 97 → **144**（新增 46 条最小化用例：并列、无关项、矛盾/重言、预算降级、工具校验与渲染），覆盖率 94.57% → **96.32%**。

### Added (EN)
- New fifth tool **`logic_minimize`**: Quine–McCluskey minimum sum of products with prime implicants, essential implicants and a cover of minimum term count (ties broken by fewest literals, then reading order, with an honest `unique` flag). The optional `dontCare` minterm list is the Karnaugh-map move — `a & !b & c | a & !b & !c` with `dontCare: [6, 7]` collapses to `a`. The search is exhaustive under a node budget; if the budget is ever hit the result is flagged `exact: false` and falls back to essentials + greedy instead of claiming minimality.
- Test anchors moved to an **in-repo** oracle (`test/oracle/anchors.py`): `itertools` enumeration for the fixture and an exhaustive set-cover search over `{0,1,-}^n` for minimization — no Quine–McCluskey code is shared with the plugin. `--check` re-verifies the anchors; `--write-fixture` regenerates the fixture byte-identically.
- Tests 97 → **144**, coverage 94.57% → **96.32%**.

## [0.1.3] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

## [0.1.2] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

## [0.1.1] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

