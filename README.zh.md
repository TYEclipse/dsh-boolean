# dsh-boolean（布尔代数工具箱）

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的布尔代数插件：
解析命题逻辑表达式，一键给出**完整真值表 + 最小项/最大项摘要 + 规范 DNF/CNF + 最小和之积（支持无关项）+ NNF + 纯 NAND/纯 NOR 门网络**。
再也不用手工枚举 16 行真值表、不用担心 De Morgan 展开写错、也不用自己画卡诺图。

零运行时依赖，纯本地计算。

## 为什么需要它

模型做逻辑推导时经常在小事上翻车：展开 `¬(a∧b)`、列出三变量表达式的所有满足行、判断两个公式是否等价。
这套工具把簿记工作做到精确、确定。

## 安装

```bash
dsh plugin --profile web add github:TYEclipse/dsh-boolean
```

重启会话后五个工具即注册到 `tools`。需要 PATH 中有 `pnpm`。

## 工具一览

| 工具 | 功能 |
|------|------|
| `truth_table` | 逐行枚举全部赋值（上限 8 变量 / 256 行），输出结果、最小项/最大项下标、重言式/矛盾式/可满足性标记、规范 DNF 与 CNF 字符串。 |
| `logic_eval` | 在完整赋值下求值（`trueVars`/`falseVars` 两表）；缺变量时报错，绝不静默默认。 |
| `logic_equiv` | 在两个表达式合并后的全部行上比对等价性；不等价时报告差异行数并给出一个具体反例。 |
| `logic_convert` | 转为 `nnf` / `dnf` / `cnf` / `nand` / `nor` 规范形式。DNF/CNF 来自真值表（8 变量上限）；nnf/nand/nor 为结构化改写，不限规模。 |
| `logic_minimize` | 最小化到和之积（Quine–McCluskey）：列出素蕴含项、必要素蕴含项，并给出**项数最少**的覆盖（并列时按文字数最少、再按字典序定序）。可选 `dontCare` 无关项下标，替代手画卡诺图。 |

## 表达式语法

| 含义 | 符号 | 单词 | Unicode |
|------|------|------|---------|
| 非（前缀） | `!` | `not` | `¬` |
| 与 | `&` | `and` | `∧` |
| 异或 | `^` | `xor` | `⊕` |
| 或 | `\|` | `or` | `∨` |
| 蕴含 | `->` `=>` | `implies` | `→` |
| 等价 | `<->` `<=>` | `iff` | `↔` |

- 变量为单字母 `a`–`z`（大写自动归一）；括号 `()` 分组。
- 优先级从高到低：`NOT` → `AND` → `XOR` → `OR` → `IMPLIES` → `IFF`。
- 二元运算符**左结合**；`->` / `<->` 连写时建议加括号。
- XOR/IMPLIES/IFF 在解析期即按教科书恒等式展开为 NOT/AND/OR
  （`a^b ≡ (a&!b)|(!a&b)`、`a->b ≡ !a|b`、`a<->b ≡ (a&b)|(!a&!b)`）。
- 表达式限 512 字符；真值表枚举限 8 变量。

## 示例（均为 v0.1.0 实测输出）

异或的真值表与规范形：

```
truth_table { expr: "a ^ b" }
→ 行: m0(00)=0 m1(01)=1 m2(10)=1 m3(11)=0
  最小项 [1,2]  DNF = (!a & b) | (a & !b)
  最大项 [0,3]  CNF = (a | b) & (!a | !b)
```

只看一行而不是整张表：

```
logic_eval { expr: "a -> (b | c)", trueVars: ["a"], falseVars: ["b","c"] }
→ a -> (b | c) with a=true, b=false, c=false = false
```

验证改写恒等式（De Morgan）：

```
logic_equiv { exprA: "!(a | b)", exprB: "!a & !b" }
→ equivalent: !(a | b) == !a & !b (all 4 rows agree)
```

否定下推、单门网络、规范 DNF：

```
logic_convert { expr: "!(a & b)", operation: "nnf" } → !a | !b
logic_convert { expr: "a & b",   operation: "nand" } → NAND(NAND(a,b),NAND(a,b))
logic_convert { expr: "a | b",   operation: "nor"  } → NOR(NOR(a,b),NOR(a,b))
logic_convert { expr: "a -> b",  operation: "dnf"  } → (!a & !b) | (!a & b) | (a & b)
```

非法输入带位置与原因报错，而不是给个错答案：`a &` →
`unexpected end of expression (at position 3)`；`foo & a` → 变量必须是单字母 `a`–`z`。

最小化——最小的和之积，附素蕴含项与必要素蕴含项：

```
logic_minimize { expr: "((a & b) | (a & c)) | (b & c)" }
→ a & b | a & c | b & c   （3 项、6 文字，已证明最小、唯一）
  素蕴含项: a & b m[6, 7]; a & c m[5, 7]; b & c m[3, 7]
```

无关项就是卡诺图那一招：把不关心的行标出来，覆盖就能跨过它们。

```
logic_minimize { expr: "a & !b & c | a & !b & !c", dontCare: [6, 7] }
→ a   （1 项、1 文字；该素蕴含项覆盖 m[4,5]，并跨过无关项 dc[6,7]）
```

并列时按固定规则判定（先比项数、再比文字数、最后按字典序），并如实说明存在并列，而不是假装只有唯一答案：

```
logic_minimize { expr: "a & (b | c)", dontCare: [1, 2] }
→ a & b | a & c   （已证明最小，存在并列——共 3 个 2 项覆盖）
```

## 说明与限制

- 真值表类工具上限 **8 变量**（256 行）；`nnf`/`nand`/`nor` 结构化转换无此限制。
- `logic_eval` 要求表达式每个变量恰好出现在 `trueVars` 或 `falseVars` 之一；同列两表或非法变量名均报错。
- 门输出用函数调用语法：`NAND(a,b)` / `NOR(a,b)`，`NOT(x)` 写作 `NAND(x,x)` 或 `NOR(x,x)`；
  输入语法不接受门名——转换用本工具，手写门网络是另一回事。
- 矛盾式的规范 DNF、重言式的规范 CNF 为空字符串，并附 `note` 说明。
- `logic_minimize` 对恒假函数返回 `""`、对常数覆盖返回 `1`。搜索是穷尽的（带节点预算）；万一
  预算耗尽，结果会标 `exact: false`，返回「必要素蕴含项 + 贪心」的覆盖，而不会谎称已最小。
  并列按「项数 → 文字数 → 字典序」固定判定，同一输入永远给同一字符串。

## 开发

```bash
pnpm install
pnpm build      # tsc -> dist/（dist 提交入库：git 安装不跑构建）
pnpm test       # 144 测试：解析器语义、独立 Python oracle 锚点真值表、最小化、门网络、schema 守卫、lossless-JSON 纪律
pnpm lint       # oxlint src test
python3 test/oracle/anchors.py --check   # 复核 oracle 自身的锚点
```

测试锚点由独立 Python oracle（`test/oracle/anchors.py`）生成：真值表用 `itertools` 暴力枚举，
最小化用对 `{0,1,-}^n` 全部立方体的**穷尽集合覆盖搜索**——与插件**不共享任何 QMC 代码**，
因此「两边一致」是证据而不是同义反复。测试里的每条 DNF/CNF、每个真值行、每个最小覆盖、素蕴含项
清单与唯一性标记都由该 oracle 打印（重新生成 fixture：`python3 test/oracle/anchors.py --write-fixture`）。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
