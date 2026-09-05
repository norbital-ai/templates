# HR 与薪资

![HR 与薪资 工作区缩略图](assets/thumbnail.svg)

## 这个工作区是什么

本模板是一个多国 HR 与薪资结算工作区。它把经审批的雇佣、考勤、休假与薪资事件转化为可审计的薪资结果：生效日期雇佣条款、按排班表的日分类、法定加班与缴款、还款计划、草稿重算、已发薪期锁定以及与来源关联的工资单行。它面向法律被引擎编码为数据的国家构建——马来西亚、菲律宾与印度尼西亚都有带引用的法规，以封存的法定档案版本化——而每一次发薪都能追溯到产生它的已审批输入。

## 心智模型

薪资是一个运行于已审批、按生效日期生效的事实之上的确定性结算引擎。它的两半从不共享同一张表：**输入**是运行读取的已审批记录，**输出**是由它们计算出的不可变值。每一条链接都是真正的外键——四个引擎拥有的输入连接集合把每张工资单与它消费的考勤日、组件条目、贷款还款和休假申请关联起来，而每项工资调整恰好指明其中一个捕获。

````text
APPROVED INPUTS                          SETTLED OUTPUT

employment_terms --+                  +-> payroll_runs [one policy + sealed statutory profile]
work_days ----------+                 |        |
leave_requests -----+--> calculator -+        v
component_entries --+                          payslips
loan_repayments ----+                          |
                                               |- base / proration / statutory（内联）
pay_components <-----------+                   |- payslip_work_day_inputs
 [policy + calculation]    |                   |- payslip_component_entry_inputs
                           |                   |- payslip_leave_request_inputs
loans -> loan_repayments <-+                   |- payslip_loan_repayment_inputs
                                               `- payslip_adjustments
                                                  |- input: 一个捕获的输入链接
                                                  |- label + bucket + amount（冻结）
                                                  `- statutory_rule_key（仅考勤日）

薪资核心由五个集合承载：

1. **`pay_components`** —— 一个可复用的定义，带严格的结算/法定策略与多态计算定义（`SCHEDULE`、`ENTRY`、`FORMULA`）。加班刻意不在其中：它由工作日按辖区自身的加班规则计价推导，其法定处理由征费的方案承担。
2. **`component_entries`** —— 已审批的员工级货币事实：报销、固定津贴、奖金、补发与更正。
3. **`payroll_runs`** —— 一次公司-期间计算，指明管辖它的封存法定档案与产出结果的计算版本。
4. **`payslips`** —— 一次运行中某雇佣的合计、内联的输出平面及其捕获的输入。
5. **`payslip_adjustments`** —— 每个捕获输入对应一项已结算内容，其溯源是真正的外键。

核心之外：`companies` 与 `jurisdictions` 划定法律实体；`employments`、`employment_terms` 与 `employment_statutory_facts` 描述一个人的工作事实；`shift_definitions`、`rosters`、`work_days`、`company_holidays`、`leave_types` 与 `leave_requests` 提供排班与休假事实；每一个封存的 `jurisdictions` 档案版本原子地拥有加班覆盖范围、计价、上限以及法定假期最低天数，并界定休假与薪资目录；`statutory_contributions` 与 `contribution_rates` 按档案界定范围并随之封存；`loans` 及其 `loan_repayments` 承载员工贷款与多付追回 —— 协议本身，以及其下到期的金额。

两条不变量塑造了一切：

- **加班、缴款、毛额与净额是计算出来的，从不存储或播种。** 运行根据输入记录推导它们，并与独立提供的来源工作簿比对。
- **审批是门槛。** `approval_id` 是平台拥有的系统列，而不是业务状态。`approval_id IS NULL` 表示已提交且未被审批请求锁定的记录。被暂存的新建申请尚无业务记录；薪资只读取已提交、未锁定的输入。

## 工作区包含什么

### 应用（10 个）

**`hr_employee`** —— 员工自助服务。员工查看自己的档案、公司与下一个发薪日，可以记录考勤、发起休假申请与报销（各自进入审批流），并查看自己的贷款协议与工资单。没有有效雇佣的人会被告知原因；有多份雇佣的人选择页面以哪份为范围。

**`hr_controller`**（组）—— HR 操作界面。法律实体在**实体**页选择，并由其他页面继承。

| 应用             | 用户在其中做什么                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **实体**         | 选择所有其他 HR 控制器页面使用的法律实体                                                                                                      |
| **人员**         | 劳动力：员工档案、雇佣、按生效日期的条款、法定事实，以及劳动力结构图                                                                          |
| **排班**         | 在月度排班板规划并发布班次，管理工作模式与节假日，并从操作菜单导入考勤                                                                          |
| **休假**         | 复核休假申请，管理按生效日版本化的公司休假计划，查看已封存的年度账户及追加式台账，并提交一次经理复核的例外余额更正                    |
| **贷款**         | 复核还款协议及其推导出的未偿余额，每期回收按工资单追踪                                                                                        |
| **薪资组成部分** | 薪资目录与条目流：报销、津贴、奖金、补发与更正及其缴款处理                                                                                    |
| **薪资核算**     | 运行薪资周期：发薪日看板（逾期/当期/即将）、创建与重算运行、锁定发薪、导出银行文件、工资单 PDF 与报告工作簿                                   |
| **法定档案**     | 管理版本化辖区档案（DRAFT → SEALED → VOIDED）、法定休假下限、缴款方案与费率                                                                    |
| **考勤机**       | 通过人脸识别或人工输入打卡并登记人脸；设备账户只看到此无外壳页面                                                                                |

### 策略（9 条）

- **`employee`** —— 员工自助服务及本人范围内须审批的考勤、报销与休假创建。
- **`supervisor`** —— 查看团队并复核、记录其考勤与休假。
- **`manager`** —— 查看公司人员运营并管理直属团队的考勤与休假。
- **`hr_controller`** —— 管理人员、排班、申请、贷款与条目；薪资可见但不可结算。
- **`hr_manager`** —— HR 管理权限加创建、运行与删除薪资运行。
- **`senior_management`** —— 完整人员运营视图加薪资运行权限。
- **`statutory_drift_automation`** —— 读取封存法定档案并记录法定漂移研究与后继事实。
- **`leave_reconciliation_automation`** —— 仅供系统创建年度休假账户并追加幂等台账变动。
- **`kiosk`** —— 仅供考勤机打卡、人脸登记及其必要的受限读取。

策略按 `hr_controller` 应用*组*命名而非逐页命名，因此新增控制器页面无需改动任何角色声明。

### 实时分析

控制器的休假、薪资组件与考勤图表直接通过 `client.db` 读取相关集合。这些查询由工作区同步引擎自动保持最新；组件在本地派生有界的五年热力图与八周考勤趋势，无需轮询、手动刷新或查询函数。

### 代理上下文

`src/+agents.md` 为网页与 envoy 对话提供共享的 HR/薪资上下文：如实引用工具结果、集合含义、金额与日期规则，以及法定建议边界。它本身不授予任何权限；网页代理仍完全受登录人员的策略约束。

### 自动化、集成与种子数据

本模板包含 `statutory_profile_drift` 及十个休假账户/台账自动化，不附带外部集成。租户**不存在 `+seed.ts` 编译器角色**：法定与敏感夹具种子存放在仓库的种子库中（见下文），薪资输入属于 [`docs/data.md`](docs/data.md) 所述的对账工作流。

## 运营边界

只播种薪资输入。绝不播种薪资运行、工资单、已计算的加班金额、法定缴款、毛额、净额或来源激励加班结果。运行必须根据输入记录计算这些值，然后与独立提供的来源工作簿比对。这条规则正是引擎在无法产生某个数字时拒绝运行而非近似处理的原因，也是已发薪期不可变的原因——更正永远是后续草稿中的新审批事件。

## 底层原理

### 源码布局

编译器知道的工作区一切都在 `src/` 中：

```text
src/
├── apps/                     # 每个应用一个 +<app>.svelte；hr_controller/+group.ts 归属组
├── collections/              # 29 个集合：+model.ts、+hooks.ts、+pipelines.ts、+representation.svelte
│   └── payroll_runs/lib/     # 结算引擎（阶段、加班、覆盖、导出）
├── datatypes/                # 30 个结构化值（statutory_regime、statutory_leave_profile、component_entry_event、……）
├── access/                   # +teams.ts、匿名限流与九个策略
├── i18n/                     # messages.en.json / messages.zh.json（相同的键集）
├── automations/              # 法定漂移与休假账户/台账对账
├── lib/                      # 共享辅助：日历、显示格式化、策略授权、排班月
└── +agents.md
````

- **模型**只描述存储；呈现属于应用与 representation。`src/collections/+relationship.ts` 拥有关系图——外键由它推导，绝不在模型中声明。
- **钩子**负责校验与推导。薪资创建钩子解析运行的考勤窗口、发薪日与配置哈希；排班钩子强制可发布性；还款钩子让分期计划与本金精确对账。
- **流水线**（`work_days` 与 `payroll_runs` 上的 `+pipelines.ts`）塑造工作簿导入/导出：排班与考勤导入器把来源工作簿映射为行，薪资导出器生成应用提供的银行文件、工资单 PDF 与报告工作簿。
- **Representation** 决定每个集合的创建/展示/编辑。`payroll_runs` 与 `payslips` 拒绝手工创建输出；工资单由引擎写出，绝不手工生成。
- **i18n** —— 两个目录都承载相同的 867 个键；`<svelte:head>` 中的应用元数据保持静态英文，按语言环境的侧边栏标签来自目录。

### 文档

- [`docs/architecture.md`](docs/architecture.md) —— 实时薪资引擎：模型地图、八个计算阶段、截算与期间、排班到日类型分类、加班与 12 小时/104 小时控制、法定处理、调整与台账、溯源、锁定，以及法定法律中已编码与未编码的部分。
- [`docs/data.md`](docs/data.md) —— 原始来源 → 清洗来源 → 种子数据的契约、防止派生输出回流到输入的检查，以及如何把独立来源工作簿与生成的工作簿对账。
- [`docs/leave.md`](docs/leave.md) —— 当前申请、单次审批、已封存年度账户、追加式台账、结转、政策变更与薪资行为。

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

`verify-fixture-shapes.mjs` 会在插桩下重跑算术脚本，并报告两件事：引擎读取过但夹具从未提供的字段，以及 `src/` 中任何地方都不存在的夹具键。它存在是因为一个夹具曾描述过 API 并不具备的响应形状——在臆造的 `componentType` 上加了 `nature`——使一个通过的断言证明不了任何事。已删除的集合会残留在陈旧构建产物（`.norbital/dist/`）中，因此针对其中之一编写的夹具看似正确实则不然；请改查 `src/collections/<name>/+model.ts`。在信任一次绿色运行前先读该脚本的头部注释：它对自己看不到的东西是诚实的，而且除非完成其中描述的变更检查，否则绿色运行说明不了任何事。

机密来源对账在宿主端为可选启用；参见
[`docs/data.md`](docs/data.md#reconciliation-method)。

## 修改模板

这是一个 Bolt 租户工作区：Bolt 文件系统编译器只从 `src/` 推导出 `.norbital/` 下的注册表、工作区、客户端与本地类型。工作流：

```bash
pnpm sync     # 编辑 src/ 下的任何内容之后——重新生成 .norbital（已提交的迁移保持不变）
pnpm lint     # 对整个工作区运行 prettier + svelte-check
pnpm build    # 生产构建
```

- **模型** —— 不要随意更改模型模式：每次模式变更都会在 `.norbital/migrations/` 下产生一条已提交的迁移。编辑 `+model.ts`、运行 `pnpm sync`，然后审阅编译器产出的迁移。
- **种子数据** —— 测试夹具在 `tests/fixtures/seed/`。宿主演示用私有种子库远程，不是本树；不存在 `src/+seed.ts` 角色，播种也不会演进已部署的数据。对既有租户，用 `pnpm exec bolt migrate --name <name>` 写入下一条迁移谱系条目、编辑其 SQL，再经由 Colony 部署。敏感法定种子留在宿主种子库，不是测试输入。
- **发布** —— 模板在自己的 `package.json` 与锁文件中固定 `@norbital-ai/bolt` 版本。刻意调整依赖后，请通过仓库的模板锁定流程刷新模板锁。要在本地测试 OSS 依赖，请在 Norbital 检出中运行 `pnpm run env -- link`；如需启动 Colony UI，则运行 `pnpm run env -- dev --ui`。Colony 的 dev 引导每次启动都会收敛，因此不存在单独的租户更新或环境重置步骤。
