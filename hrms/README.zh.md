# HRMS

![HRMS 工作区缩略图](assets/thumbnail.svg)

一个多国人力资源与薪酬工作区，涵盖雇佣记录、排班、休假、报销、贷款、
薪酬核算和法定义务。司法辖区的法律是按日期生效的数据；引擎不包含任何
特定国家的计算。

## 应用与角色

人事主管组持有主管应用；员工自助是独立的应用。考勤终端是无界面外框的考勤设备。

| 应用     | 页面                                                 | 面向                                       |
| -------- | ---------------------------------------------------- | ------------------------------------------ |
| 实体     | 实体                                                 | 法人实体及其按日期的变更、节假日、班次模式 |
| 事件     | 工作、假期、报销、临时项目、贷款、职场事件、工作事件 | 按日期的员工活动、职场事件及其证据         |
| 格式     | —                                                    | 共享的导出格式配置（无独立页面）           |
| 薪酬     | 薪酬                                                 | 创建核算、工资单和导出                     |
| 义务     | 义务                                                 | 法律效果所产生的任务和提醒                 |
| 人员     | 人员                                                 | 员工档案、雇佣期、条款、参数和家属         |
| 设置     | 设置                                                 | 某一司法辖区在某天的法律、其变更和研究     |
| 员工自助 | 自助服务                                             | 每位员工自己的记录                         |
| 考勤终端 | 打卡                                                 | 考勤采集与人脸录入                         |

团队是源码声明。**Employee** 持有 `employee`；**Supervisor** 和 **Production
Manager** 增加 `supervisor`；**L1 Manager** 增加 `manager`；**HQ Payroll HR** 和 **Manager (HR
Controller)** 持有 `hr_controller`；**HR Manager** 持有 `hr_manager`；**Senior Management** 持有
`senior_management`；**Attendance Kiosk** 持有 `kiosk`。

## 工作原理

法律、公司和个人的条款都是按日期的行：某一天生效的内容，就是日期在当天或之前的行，按从旧到新的顺序应用。一次核算读取雇佣关系、条目和法律，沿一条小计链计算到实发工资，并在一次写入中写出工资单和台账行。已支付周期中的错误在其记录处更正；下一次核算会结转差额。模型、自动化和策略详见[架构文档](docs/0001-hrms-calculation-architecture.md)。

## 种子数据

- **公共基础数据** — `seed/public/jurisdiction/<CODE>/` 收录九个司法辖区（CN、ID、
  JP、MY、PH、SG、TH、TW、VN）各自在 2025 年 12 月 1 日的完整法律及此后按日期的变更：
  目录、小计、登记的规则和效果。`bolt build` 将它们写为发布版本的 `base` 包。
- **私有演示数据** — `seed/+seeder.ts` 通过 `bolt seed` 加载私有演示行。它们永远不会
  进入发布版本。

## 检查

```bash
bun install --frozen-lockfile
bunx bolt check   # declarations, schema history, policies and types
bun run test      # standalone mechanism and edge-case tests
bunx bolt build   # writes .norbital/ and the release artifact
```

数据库结构变更会在 `migrations/` 下生成可编辑的 SQL。请将 SQL、`snapshot.json`、
`migrations.lock.json` 和 `physical.json` 一起提交。`.norbital/` 为生成内容，永不提交。

## 文档

[文档索引](docs/README.md)列出了每份文档，每份一行。

工作区智能体读取 [`src/agent/+agent.md`](src/agent/+agent.md)；编码智能体从
[`src/agent/AGENTS.md`](src/agent/AGENTS.md) 开始。
