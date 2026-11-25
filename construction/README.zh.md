# 施工管理

![施工管理应用界面](docs/screenshots/application.webp)

面向**总承包商管理专业分包商**及**分包商/专业承包商管理自身项目**的通用工程项目管理工作区。将来自 **WhatsApp**、**邮件**与结构化 **BIM IFC** 模型的零散信息沉淀为三大核心主线：**现金流**、**进度推进**与**文档及 BIM 造价**。

## 核心能力

- **自动化 BIM IFC 算量与造价：** 在 `project_files` 上传 `.ifc` 模型（自动维护版本留痕并支持 Autodesk ACC 同步）；`analyze_bim_file` 自动解析 ISO-10303-21 IFC STEP 文件、按可量化**计价矩阵（`cost_matrix`）**分类计价、标出未匹配构件，并在 `cost_estimates` 中合并 BIM 算量与可编辑的**非 BIM 附加费用**。
- **3D BIM 视图与缺陷标注：** 支持 X/Y/Z 轴剖切与 4D/严重程度高亮，按专业工种（屋面、地坪、机电、电气、给排水、暖通、结构、幕墙、桩基等）在 3D 构件上钉选现场**问题与缺陷（`issues`）**。
- **大型进度计划与推进：** 支持 **4D 进度轴**、**表格**与**看板**视图，提供 **Autodesk ACC/APS** 双向同步（`autodesk_schedule`）以及 **Primavera P6（`.xer`）**、**MS Project（`.xml`）**、CSV/XLSX 计划导入。
- **合同管理、PO/DO/发票三单匹配与现金流：** 统一管理上游与下游 `contracts`（含单价明细、版本归档、工期延期与生效锁定），搭配精确 `BigDecimal` 商务台账（`commercial_documents`），内置 **PO → DO → 发票三单匹配**与一键生成进度请款草稿（`generate_payment_claim`）。
- **WhatsApp 与邮件自动接入：** 在独立隔离的**系统配置**应用接入个人或工作区 **WhatsApp**、**邮件**与 **Autodesk ACC**，自动同步消息、转写语音、路由项目、AI 提取进度/问题/商务更新并推送每日 06:00 异常早报。

## 应用与角色

| 应用         | 页面                                   | 受众 / 角色                                        |
| ------------ | -------------------------------------- | -------------------------------------------------- |
| **工程运营** | 工程项目（单层项目工作台）、消息收件箱 | `项目经理`、`商务`、`现场主管`、`分包商`           |
| **系统配置** | 外部连接、联系人与分包商、计价矩阵     | `项目经理`、`商务`（独立隔离的基础数据与集成配置） |

打开项目进入单层**项目工作台**标签页：**项目总览**、**进度计划与任务**、**BIM 与问题**、**成本估算**、**BIM 与文档**、**合同与变更**、**PO / DO / 发票**。

## 数据模型

共 11 个模型与 6 个自定义字段（`bim_takeoff`、`bim_pin`、`priced_lines`、`revision_trail`、`project_zones`、`project_address`）：

- **项目主根（`projects`）：** 含 `project_role`（总包/分包/专业分包）、商务条款、`autodesk_project_id`、`zones` 与 `capture_rules`。
  - 归属子模型：`contracts`、`commercial_documents`、`tasks`、`issues`、`project_files`、`cost_estimates`。
- **消息与配置：** `project_messages`、`contacts`、`cost_matrix`、`communication_settings`。

## 自动化与集成

| 自动化 / 集成             | 触发方式 / 类型                         | 用途                                                         |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `analyze_bim_file`        | `project_files` 上传 IFC / 手动         | 解析 IFC 构件、按计价矩阵自动算量并生成 `cost_estimates`     |
| `sync_messages`           | `sys_message` 到达 / 15 分钟兜底 / 手动 | 同步 WhatsApp 与邮件消息并转写语音至 `project_messages`      |
| `classify_messages`       | 消息接入 / 手动                         | 将非结构化消息自动路由至对应项目                             |
| `extract_project_updates` | 路由完成后 / 手动                       | AI 提取任务进度、BIM 问题、变更草稿与 PO/DO/发票记录         |
| `generate_payment_claim`  | 手动（项目内触发）                      | 基于生效合同与商务台账生成 `BigDecimal` 进度请款草稿         |
| `daily_project_digest`    | 每日 06:00                              | 推送项目进度与异常摘要早报                                   |
| `autodesk` 集成           | 双向同步（`tasks`、`project_files`）    | 同步 Autodesk ACC/APS 计划与模型，并配合内置 WhatsApp 与邮件 |

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**系统配置**中维护分包商目录、计价矩阵规则并连接 WhatsApp、邮件或 Autodesk ACC。

- [工作流指南](docs/README.md)
- [源码参考](docs/source-reference.md)
