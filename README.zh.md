# HR 与薪资

![HR 与薪资工作区缩略图](assets/thumbnail.svg)

用于多辖区雇佣记录、排班、休假、报销、贷款、薪资和法定缴款的 Bolt 工作区。每次薪资批次为每份雇佣合同生成一张工资单，并关联其结算的记录。

## 应用与角色

| 应用     | 用途                                     |
| -------- | ---------------------------------------- |
| 员工自助 | 本人排班、休假、报销和工资单             |
| 实体     | 法律实体、班次模式与定义、假日           |
| 人员     | 档案、雇佣合同、人脸登记和离职           |
| 事件     | 排班与考勤、休假、报销、一次性付款、贷款 |
| 薪资     | 常规与非周期批次、工资单和导出           |
| 设置     | 辖区版本、目录、规则和行为               |

五个 HR 应用位于 `src/app/hr_controller/`，员工自助位于 `src/app/hr_employee/`。团队（`src/access_control/team/+team.ts`）关联以下策略：

| 团队                                   | 策略                | 应用                   |
| -------------------------------------- | ------------------- | ---------------------- |
| Employee                               | `employee`          | 员工自助               |
| Supervisor、Production Manager         | `supervisor`        | 员工自助、人员         |
| L1 Manager                             | `manager`           | 全部 HR 应用与员工自助 |
| Senior Management                      | `senior_management` | 全部 HR 应用与员工自助 |
| HQ Payroll HR、Manager (HR Controller) | `hr_controller`     | 全部 HR 应用与员工自助 |
| HR Manager                             | `hr_manager`        | 全部 HR 应用与员工自助 |
| Attendance Kiosk                       | `kiosk`             | `attendance` 终端      |

自动化以 `hr_controller`（`calendar_tick`，以及与 `payslip_hold_automation` 一起的 `behaviour_taps`）或各自的 `*_automation` 策略运行；`src/access_control/policy/grants.ts` 存放各策略共用的授权片段。种子包在 `sys_user.team` 中记录员工所属团队。

**终端。** `attendance`（`/kiosk/attendance`）：无界面框架的考勤打卡设备，由 Attendance Kiosk 团队打开。

## 数据模型

各国法规是数据而非代码。每个辖区是一组带生效日期、已封存的 `jurisdiction_settings` 版本，附带目录行（`statutory_contribution`、`leave`、`claim`、`adhoc`、`loan`、`allowance`、`work`）和 `rule_set` 行。费率、档位、资格和计价都是这些行上的 CEL 表达式，行为（例如离职休假兑现）是设置版本上的规则。`src/lib/payroll_engine/` 下的引擎只负责求值，不含任何辖区专属逻辑。法规变更即新版本，无需改动源代码。

各辖区的配置内容及缺口记录在[各辖区跟踪表](docs/inventory/README.md)。

辖区版本以经校验的自定义字段持有停工类别定义。工作区共有 27 个模型；薪资变动、结算/付款记录以及独立复核的运营记录各自保留身份。

## 自动化与集成

| 自动化                | 触发方式                                 | 结果                                                             |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `behaviour_taps`      | 创建薪资批次；雇佣合同离职事实或期间更新 | 执行版本的行为规则：每条规则读取其声明的记录并返回写入。         |
| `statutory_drift`     | 每月或按需                               | 为每个已封存且生效的谱系排队一次 `statutory_lineage`。不会封存。 |
| `statutory_lineage`   | 由 `statutory_drift` 排队或按需          | 对照官方来源检查一个谱系；变更生成一个未封存草稿供复核。         |
| `late_arrival_notice` | 每五分钟                                 | 排班超过实体宽限时间仍无打卡时，每人每日提醒一次。               |
| `calendar_tick`       | 每日                                     | 为每个在职雇佣执行行为规则，使按日期触发的义务生成任务。         |
| `invitation_profile`  | 邀请员工；创建员工用户或其联系方式变更   | 为受邀员工创建雇佣档案，并在接受邀请后关联其身份。               |

### 薪资热线

员工通过 WhatsApp 查询自己的工资单，每个法人实体一个号码。源角色为 `src/agent/envoy/+payroll_hotline.envoy.ts`，
其全部权限即 `payroll_hotline` 策略。管理员在“设置 → 集成”中添加并配对 WhatsApp 实例；HR 在实体的“常规”页签中将该号码选为
薪资热线（`entity.hotline`），保存后点击“在此号码上应答薪资问题”。员工的 WhatsApp 号码由管理员记录在其账号上。私信只持有
`payroll_hotline`（`dm: 'envoy'`，管理员亦然）：只读取发信人自己、且属于其所联系号码对应实体的工资单，不做任何写入。未知号码
收到一条固定提示，群组消息一律忽略。

## 种子

- **base**：`seed/jurisdiction/<CODE>/version_*/` 中九个已封存的辖区谱系（SG、MY、PH、ID、VN、TW、CN、JP 和 TH）及其目录与规则集；`seed/overtime_policies.ts` 为每个版本补充加班规则。
- **sample**（私有）：`seed/seed.ts` 在 `bolt build --bank=<checkout>` 时读取种子库的 `norbital_hr` 树：实体、人员、合同、排班及其记录。排班日的加班与奖励工时由打卡超出计划班次的部分推导，因此种子库中手填的工时不会读入。

## 检查

```bash
pnpm install
pnpm check      # bolt check
pnpm test       # bolt build --bank=$SEED_BANK（默认 ../../seed_bank）、bolt test，然后 test:node
pnpm test:node  # vitest.node.config.ts：tests/ 中的 Node 端测试
pnpm lint       # prettier --check .
```
