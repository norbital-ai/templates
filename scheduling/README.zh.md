# 服务排程

![服务排程应用界面](docs/screenshots/application.webp)

面向各类上门与预约制服务企业的通用预约、人员排程与路径感知调度工作区——适用于暖通空调、水电维修、保洁、汽车美容、设备维保或任意按次排程的现场服务团队。客户可通过在线门户或调度台预约服务，系统结合技能、工作时段与路程缓冲自动匹配服务人员，并全程跟踪班前确认、实时 GPS 预计到达与完工记录。

## 核心能力

- **客户自助预约门户：** 支持嵌入官网的手机号验证门户（**在线预约**与**我的预约**），涵盖地址定位、重复周期、偏好人员选择、实时档期询价、`.ics` 日历导出及自动成单或转调度跟进。
- **运行时可配置服务目录：** 在**系统配置**中自由定义服务项目、分类、时长、价格与标准化技能标签，源码不写死任何行业枚举或地域分区。
- **路径感知排程与智能派单：** 自动校验服务人员在岗状态、技能匹配、工作日与班时、休假记录以及车程（Google Routes 缓存与直线距离回退）加周转缓冲，并按最小新增车程与周工作量均衡排序。
- **班前确认、实时到达预警与改派恢复：** 首单前自动发起出勤确认，实时监测 GPS 预计到达时间并标记 `eta_risk`，调度台可一键刷新或批准替补方案。
- **多渠道通知追踪：** 预约确认、改期、改派与取消通知通过 WhatsApp 与邮件同步发送，并回写邮箱的已发送、已送达、已阅读、退信与回复状态。

## 应用与角色

| 应用             | 页面                                                                                                                  | 受众                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **排程调度**     | 排班表（按服务人员看板 + 列表）、预约（全部预约 + 门户申请）、调度提醒（需处理 + 班前确认）、实时地图、客户、服务人员 | `Operations`              |
| **系统配置**     | 服务项目目录、排程规则（时段间隔、周转缓冲、提前天数、班前/到达阈值）、外部连接（WhatsApp、邮件、Google Routes）      | `Operations`              |
| **今日行程**     | 按时间排序的每日路线、班前确认、后台 GPS 共享、地图导航及开始/完工登记                                                | `Providers`、`Operations` |
| **在线预约门户** | 三步自助预约（**在线预约**）、**我的预约**                                                                            | 访客 / 已验证 `customer`  |

## 数据模型

共 13 个模型，包含四组父子归属树与四个独立顶层模型：

- **服务目录（`services`）：** `services` → `openings`。
- **客户与通知（`customers`）：** `customers` → `customer_notices`（含 `+mail.sync.ts`）。
- **预约与派单（`bookings`）：** `bookings` → `booking_providers`、`appointments`。
- **服务人员（`providers`）：** `providers` → `provider_time_off`。
- **询价、申请与规则（顶层）：** `availability_requests`、`booking_requests`、`scheduling_settings`、`drive_times`。

## 自动化与集成

共 18 个自动化与 3 项集成：

| 模块           | 自动化 / 集成                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **门户与预约** | `publish_openings`（定时 `3,18,33,48 * * * *`）、`prepare_availability`、`portal_intake`、`bookings_book`、`bookings_cancel`                                                                              |
| **调度与恢复** | `appointments_rebook`、`appointments_recommend`、`appointments_accept_proposal`、`appointments_report_unavailable`、`appointments_cancel`、`providers_deactivate`、`check_drives`（`8,23,38,53 * * * *`） |
| **班次与通知** | `appointments_confirm_shift`、`appointments_decline_shift`、`shift_watch`（`2,12,22,32,42,52 * * * *`）、`eta_watch`（`*/5 * * * *`）、`eta_check`、`deliver_notices`                                     |
| **外部集成**   | 内置 `whatsapp` 与 `email`（含 `customer_notices` `+mail.sync.ts` 邮件状态回写）；自定义 `google_routes` 路程查询                                                                                         |

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**系统配置**中维护服务目录与排程规则，在**排程调度 → 服务人员**中关联员工登录账号，并按需在**系统配置 → 外部连接**配置 WhatsApp、邮件和 Google Routes。

- [工作流指南](docs/README.md)
- [源码参考](docs/source-reference.md)
