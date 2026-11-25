# 施工管理

![施工管理应用界面](docs/screenshots/application.webp)

面向**总承包商管理专业分包商**及**分包商/专业承包商管理自身项目**的工程项目管理工作区。将来自
**WhatsApp** 与 **邮件** 的现场信息，与 **3D BIM IFC 模型**、**层级 WBS 进度计划**以及以订单为核心的
**SO / PO / VO 与送货单/发票台账**整合到同一工作台中。

## 行业与 Bolt 核心能力

- **适用行业：** 建筑施工（Construction）
- **Bolt 能力标签：** `data_modeling`、`complex_files`、`ai_classification`、`channel_integrations`、`third_party_saas`、`scheduled_automations`

## 核心能力

- **统一 BIM 工作台（`BIM`）：** 通过嵌套标签页整合 **3D 模型与问题**、**成本估算**与 **BIM 文件**；内置基于 `web-ifc` + Three.js 的浏览器端三维剖切视图与 4D/严重度高亮，可按专业工种直接在三维构件上钉选现场缺陷。
- **视觉 AI BIM 构件分类与造价：** 上传 `.ifc` 后自动触发 `analyze_bim_file`，提取几何并对同类构件去重为唯一原型，生成多角度独立等轴测快照，由视觉 AI 对照**计价矩阵（`cost_matrix`）**分类计价；未入库或错误归类的代理构件明确标记为 `unknown_unseen_catalog` 供商务复核，并与**非 BIM 附加费用**汇总至 `cost_estimates`。
- **层级 WBS 进度计划（`Programme & Tasks`）：** 支持父子层级 WBS 工作包汇总与里程碑菱形，提供虚拟化 **4D 时间轴**、**表格**与**看板**视图，支持 **Autodesk ACC/APS** 双向同步及 **Primavera P6（`.xer`）**、**MS Project（`.xml`）**、CSV/XLSX 导入。
- **订单与单据台账（`Orders`）：** 按方向区分上游**销售订单（SO）**、下游**采购订单（PO）**与**变更令（VO）**（含单价明细、版本留痕与工期延期），嵌套**往来单据（送货单 DO / 发票 / 进度请款 / 贷项通知单）**，内置 `BigDecimal` 三单匹配与一键请款草稿（`generate_payment_claim`）。
- **商业伙伴与多渠道消息接入：** 在**商业伙伴（Business Partners）**模块分类管理**客户**、**供应商**与**分包商**；在独立隔离的**系统配置**接入 WhatsApp、邮件与 Autodesk ACC，自动同步消息、转写语音、提取项目更新并推送每日 06:00 摘要。

## 系统运作方式

1. **项目与伙伴：** 每个项目声明角色（总包/分包/专业分包）、商务条款与分区；外部单位统一维护于**商业伙伴**并按客户/供应商/分包商分类。
2. **BIM 解析与视觉算量：** 上传 `.ifc` 至 `project_files` 后，浏览器端解析几何并渲染多角度构件快照，`analyze_bim_file` 执行视觉分类与矩阵计价，输出匹配明细与待复核项。
3. **WBS 进度与问题联动：** `tasks` 通过 `parent_task_id` 与 `wbs_path` 构建层级树并汇总进度，关联 BIM 构件编号与三维缺陷 `issues`。
4. **商务履约与对账：** 订单（`contracts`）生效即锁定；子单据（`commercial_documents`）以精确 `BigDecimal` 执行 PO → DO → 发票三单校验。
5. **渠道自动化：** `sync_messages`、`classify_messages` 与 `extract_project_updates` 将现场消息结构化为进度、缺陷或商务记录，`daily_project_digest` 定时推送异常早报。

## 应用与角色

| 应用         | 页面                                         | 受众 / 角色                                    |
| ------------ | -------------------------------------------- | ---------------------------------------------- |
| **工程运营** | 工程项目（项目工作台）、商业伙伴、消息收件箱 | `项目经理`、`商务`、`现场主管`、`分包商`       |
| **系统配置** | 外部连接、计价矩阵                           | `项目经理`、`商务`（独立隔离的集成与费率配置） |

项目工作台采用四组主标签页：**项目总览**、**进度计划与任务**、**BIM**（嵌套：`3D 模型与问题` · `成本估算` · `BIM 文件`）以及 **订单**（`SO / PO / VO` 及其嵌套 `往来单据：送货单与发票`）。

## 数据模型

共 11 个模型与 6 个自定义字段（`bim_takeoff`、`bim_pin`、`priced_lines`、`revision_trail`、`project_zones`、`project_address`）：

- **项目主根（`projects`）：** `project_role`、商务条款、`autodesk_project_id`、`zones` 与 `capture_rules`。
  - 归属子模型：`contracts`（SO/PO/VO）、`commercial_documents`（DO/发票/请款/贷项）、`tasks`（层级 WBS）、`issues`、`project_files`、`cost_estimates`。
- **伙伴、消息与配置：** `contacts`（客户/供应商/分包商）、`project_messages`、`cost_matrix`、`communication_settings`。

## 自动化与集成

| 自动化 / 集成             | 触发方式 / 类型                         | 用途                                                         |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `analyze_bim_file`        | `project_files` 上传 IFC / 手动         | 去重 IFC 构件原型、执行视觉 AI 分类并生成 `cost_estimates`   |
| `sync_messages`           | `sys_message` 到达 / 15 分钟兜底 / 手动 | 同步 WhatsApp 与邮件消息并转写语音至 `project_messages`      |
| `classify_messages`       | 消息接入 / 手动                         | 将非结构化消息自动路由至对应项目                             |
| `extract_project_updates` | 路由完成后 / 手动                       | AI 提取任务进度、BIM 问题、变更草稿与商务单据                |
| `generate_payment_claim`  | 手动（项目内触发）                      | 基于生效订单与单据生成 `BigDecimal` 进度请款草稿             |
| `daily_project_digest`    | 每日 06:00                              | 推送项目进度与异常摘要早报                                   |
| `autodesk_acc` 集成       | 双向同步（`tasks`、`project_files`）    | 同步 Autodesk ACC/APS 计划与模型，并配合内置 WhatsApp 与邮件 |

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**商业伙伴**与**系统配置**中维护往来单位、计价矩阵并连接 WhatsApp、邮件或 Autodesk ACC。

- [工作流指南](docs/README.md)
- [源码参考](docs/source-reference.md)
