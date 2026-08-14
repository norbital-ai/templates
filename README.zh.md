# HR 与薪资

![HR 与薪资 工作区缩略图](assets/thumbnail.svg)

## 这个工作区是什么

本模板是一个多国 HR 与薪资结算工作区。它把经审批的雇佣、考勤、休假与薪资事件转化为可审计的薪资结果：生效日期雇佣条款、按排班表的日分类、法定加班与缴款、还款计划、草稿重算、已发薪期锁定以及与来源关联的工资单行。它面向法律被引擎编码为数据的国家构建——马来西亚、菲律宾与印度尼西亚都有带引用、按生效日期生效的法定数据行——而每一次发薪都能追溯到产生它的已审批输入。

## 心智模型

薪资是一个运行于已审批、按生效日期生效的事实之上的确定性结算引擎。输入与输出从不共享同一张表：已审批输入进入计算器，而工资单与产生它的内容之间唯一的连接点是 `payslip_lines` 行。

```text
APPROVED INPUTS                         SETTLED OUTPUT

employment_terms --+                 +-> payroll_runs [one policy snapshot]
time_entries -------+                 |        |
leave_requests -----+--> calculator -+        v
component_entries --+                          payslips
       |                                        |
       v                                        v
pay_components <-------------------------- payslip_lines
 [policy + calculation +                    [the only junction]
  entitlement union]                        |- pay_component_id
                                             |- component_entry_id (when entry-backed)
                                             `- statutory_contribution_id (when statutory)
```

薪资核心由五个集合承载：

1. **`pay_components`** —— 一个可复用的定义，带严格的结算/法定策略与多态计算定义（`SCHEDULE`、`ENTRY`、`FORMULA`、`OVERTIME`、`OVERTIME_EXCESS`）。
2. **`component_entries`** —— 已审批的货币事件：报销、津贴、调整、贷款分期。
3. **`payroll_runs`** —— 一次公司-期间计算，带一份捕获的配置快照。
4. **`payslips`** —— 一次运行中某雇佣的合计。
5. **`payslip_lines`** —— 工资单与组成部分之间的直接连接点与完整明细。

核心之外：`companies` 与 `jurisdictions` 划定法律实体；`employments`、`employment_terms` 与 `employment_statutory_facts` 描述一个人的工作事实；`shift_definitions`、`work_patterns`、`rosters`、`roster_entries`、`time_entries`、`company_holidays`、`leave_types`、`leave_requests`、`rest_break_rules`、`overtime_rules`、`overtime_limits` 与 `overtime_coverage_rules` 提供排班与法律；`statutory_contributions` 与 `contribution_rates` 承载缴款方案；`repayment_agreements` 承载员工贷款与多付追回。

两条不变量塑造了一切：

- **加班、缴款、毛额与净额是计算出来的，从不存储或播种。** 运行根据输入记录推导它们，并与独立提供的来源工作簿比对。
- **审批是门槛。** 本工作区任何地方都没有审批列：`norbital_approval_id IS NULL` 是"有效行"的唯一定义。薪资只读取已审批行；仍被审批请求持有的记录会被锁定并排除。

## 工作区包含什么

### 应用（9 个）

**`hr_employee`** —— 员工自助服务。员工查看自己的档案、公司与下一个发薪日，可以记录考勤、发起休假申请与报销（各自进入审批流），并查看自己的贷款协议与工资单。没有有效雇佣的人会被告知原因；有多份雇佣的人选择页面以哪份为范围。

**`hr_controller`**（组）—— HR 操作界面，八个页面：

| 应用             | 用户在其中做什么                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **人员**         | 劳动力：员工档案、雇佣、按生效日期的条款、法定事实，以及劳动力结构图                                                                          |
| **排班**         | 在排班板上规划当月——每人一行、每天一个字形——按法定规则发布，并管理班次、工作模式与节假日                                                      |
| **考勤**         | 复核打卡数据：概览图表与按日期的考勤台账                                                                                                      |
| **休假**         | 对照年初至今的审批计数，复核休假申请及其对应的休假类型                                                                                        |
| **贷款**         | 复核还款协议及其推导出的未偿余额，每期回收按工资单追踪                                                                                        |
| **薪资组成部分** | 薪资目录与条目流：报销、津贴、调整及其缴款处理                                                                                                |
| **薪资核算**     | 运行薪资周期：发薪日看板（逾期/当期/即将）、创建与重算运行、锁定发薪、导出银行文件、工资单 PDF 与报告工作簿                                   |
| **法定档案**     | 每次薪资计算所依据的制度——辖区的方案、费率、加班规则、上限与覆盖行，以及绑定到各辖区的公司（文件名为 `+settings.svelte`：文件名决定应用身份） |

### 策略（3 条）

- **`employee`** —— 把自助服务限定到请求者本人：自己的档案、雇佣及九个从属集合，外加考勤、报销与休假的"创建须审批"。
- **`hr`** —— 管理人员、排班、申请、贷款与薪资：只读法定法律，写入公司自己的配置，并发起经审核的考勤、休假与薪资运行事件。
- **`management`** —— 读取 HR 能读的一切，几乎不写任何东西：例外是创建/运行薪资，以及对下属考勤与休假的处理，各自进入审批流。

策略按 `hr_controller` 应用*组*命名而非逐页命名，因此新增控制器页面无需改动任何角色声明。

### 远程函数（1 个）

**`approval_analytics`** 为控制器页面汇总的三个主题——薪资运行、休假申请与报销——提供年初至今的审批计数与五年趋势。值得一读的是它如何表述这些计数：每个计数都以 `norbital_approval_id IS NULL` 表达，因为这是"有效行"的唯一定义。

### 代理

`src/+agent.ts` 把工作区代理声明得十分克制——只对 `companies` 有写权限、一个宿主工具，以及有界的迭代与令牌。代理在这里获得的是授权（grant），而非整个工作区。

### 自动化、集成与种子数据

本模板不附带任何自动化与集成。租户同样**没有 `+seed.ts`**：法定与敏感夹具种子归 Core 所有（见下文），薪资输入属于 [`docs/data.md`](docs/data.md) 所述的对账工作流。

## 运营边界

只播种薪资输入。绝不播种薪资运行、工资单、已计算的加班金额、法定缴款、毛额、净额或来源激励加班结果。运行必须根据输入记录计算这些值，然后与独立提供的来源工作簿比对。这条规则正是引擎在无法产生某个数字时拒绝运行而非近似处理的原因，也是已发薪期不可变的原因——更正永远是后续草稿中的新审批事件。

## 底层原理

### 源码布局

编译器知道的工作区一切都在 `src/` 中：

```text
src/
├── apps/                     # 每个应用一个 +<app>.svelte；hr_controller/+group.ts 归属组
├── collections/              # 26 个集合：+model.ts、+hooks.ts、+pipelines.ts、+representation.svelte
│   └── payroll_runs/lib/     # 结算引擎（阶段、加班、覆盖、导出）
├── custom-types/             # 24 个结构化值（money、component_definition、eligibility_rules、……）
├── policies/                 # employee、hr、management
├── remotes/                  # approval_analytics
├── i18n/                     # messages.en.json / messages.zh.json（相同的键集）
├── lib/                      # 共享辅助：日历、显示格式化、策略授权、排班月
└── +agent.ts
```

- **模型**只描述存储；呈现属于应用与 representation。`src/collections/+relationship.ts` 拥有关系图——外键由它推导，绝不在模型中声明。
- **钩子**负责校验与推导。薪资创建钩子解析运行的考勤窗口、发薪日与配置哈希；排班钩子强制可发布性；还款钩子让分期计划与本金精确对账。
- **流水线**（`roster_entries`、`time_entries` 与 `payroll_runs` 上的 `+pipelines.ts`）塑造工作簿导入/导出：排班与考勤导入器把来源工作簿映射为行，薪资导出器生成应用提供的银行文件、工资单 PDF 与报告工作簿。
- **Representation** 决定每个集合的创建/展示/编辑。`payroll_runs` 与 `payslips` 拒绝手工创建输出；工资单由引擎写出，绝不手工生成。
- **i18n** —— 两个目录都承载相同的 867 个键；`<svelte:head>` 中的应用元数据保持静态英文，按语言环境的侧边栏标签来自目录。

### 文档

- [`docs/architecture.md`](docs/architecture.md) —— 实时薪资引擎：模型地图、八个计算阶段、截算与期间、排班到日类型分类、加班与 12 小时/104 小时控制、法定处理、调整与台账、溯源、锁定，以及法定法律中已编码与未编码的部分。
- [`docs/data.md`](docs/data.md) —— 原始来源 → 清洗来源 → 种子数据的契约、防止派生输出回流到输入的检查，以及如何把独立来源工作簿与生成的工作簿对账。

## 验证

模板内置聚焦的算术与导出检查。它们全部针对源码运行，因此 `pnpm test` 就是完整故事，而 `pnpm build` 只负责构建：

```bash
pnpm sync     # 重新生成 .norbital（切勿手工编辑生成输出）
pnpm lint     # prettier + svelte-check
pnpm test     # 以下全部内容，外加还款协议与排班表单元测试
pnpm build    # 仅生产构建
node scripts/verify-payroll-arithmetic.mjs   # 长篇算术验收运行
node scripts/verify-fixture-shapes.mjs       # 针对真实 API 形状审计该运行的测试夹具
```

`node scripts/generate-import-templates.mjs` 把排班与考勤导入模板写到 `~/Desktop`——一个法人实体 × 一个月、一人一行、一日一列，并带简短 Settings 表。长表（一人一天一行）仍可导入；发给操作人员的是这两种月网格。`Read me first` 表只陈述读取器实际执行的规则。

算术运行过去是按需执行、独立于 `pnpm test` 之外的。现在它已纳入 `pnpm test`，因为正是不在其中的状态让一个夹具在无人察觉中腐坏，直到它上面的断言不再有意义。没人运行的检查就是不存在的检查。

`verify-fixture-shapes.mjs` 会在插桩下重跑算术脚本，并报告两件事：引擎读取过但夹具从未提供的字段，以及 `src/` 中任何地方都不存在的夹具键。它存在是因为一个夹具曾描述过 API 并不具备的响应形状——在臆造的 `componentType` 上加了 `nature`——使一个通过的断言证明不了任何事。已删除的集合会残留在陈旧构建产物（`graphify-out/cache/stat-index.json`、`.norbital/dist/`）中，因此针对其中之一编写的夹具看似正确实则不然；请改查 `src/collections/<name>/+model.ts`。在信任一次绿色运行前先读该脚本的头部注释：它对自己看不到的东西是诚实的，而且除非完成其中描述的变更检查，否则绿色运行说明不了任何事。

机密来源对账在 Core 中为可选启用；参见
[`docs/data.md`](docs/data.md#reconciliation-method)。

## 修改模板

这是一个 Pod 租户工作区：Pod 文件系统编译器只从 `src/` 推导出 `.norbital/` 下的注册表、工作区、客户端与本地类型。工作流：

```bash
pnpm sync     # 编辑 src/ 下的任何内容之后——重新生成 .norbital（已提交的迁移保持不变）
pnpm lint     # 对整个工作区运行 prettier + svelte-check
pnpm build    # 生产构建
```

- **模型** —— 不要随意更改模型模式：每次模式变更都会在 `.norbital/migrations/` 下产生一条已提交的迁移。编辑 `+model.ts`、运行 `pnpm sync`，然后审阅编译器产出的迁移。
- **种子数据** —— 新租户的夹具行为属于 `src/+seed.ts`；它不演进已部署的数据。对既有租户，用 `pnpm exec pod migration create <name> --custom` 创建已提交迁移、编辑其 SQL，并在 Organization Studio → 模板更新中解决冲突。敏感法定种子（加班阶梯、覆盖与休息行）仍归 Core 所有，位于 `norbital/apps/core/seed/norbital_hr/statutory/rows.ts`。
- **发布** —— 模板在自己的 `package.json` 与锁文件中固定 `@norbital-ai/pod` 版本。刻意调整依赖后，请通过仓库的模板锁定流程刷新模板锁。在 Core 中用 `pnpm tenant:update --org=<org-slug> --template=hr-payroll` 消费新的模板版本，然后硬刷新 iframe；仅在刻意重播种时才使用 `pnpm env:reset --target dev --template hr-payroll`。
