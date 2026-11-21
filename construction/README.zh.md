# 施工管理 (`norbital_construction`)

![施工管理应用界面](docs/screenshots/application.webp)

面向**总承包商的一体化工程项目管理系统（PMS）**，采用就近聚合的强类型值（co-location）、不可变商务台账、精确 `BigDecimal` 计算与原生 Bolt 视图。

## 核心能力

1. **3D BIM IFC 视图与构件问题/照片标注**
   - 在 `project_files` 中上传 `.ifc` 模型（内置自动版本历史 `revision_trail`）。
   - 查看 IFC 构件属性、拖动 **X / Y / Z 三轴剖切滑块**、按问题严重程度或 4D 计划日期高亮构件，点击任意 3D 构件即可标注带 `seq` 自动编号的问题（`bim_pin` 内联保存构件 ID、名称、GlobalId、3D 坐标与相机视角）并附带现场照片。
2. **4D 进度时间轴、里程碑与结构化 WBS 任务**
   - 在 `tasks` 工具栏一键切换 **时间轴**（4D 日期滑块、里程碑菱形标记、变更节点）、**表格** 与 **看板**。
   - 提交追加式 **现场进度**（`progress_updates`），原子推进关联任务（`actual_range`、`progress_pct`）并重算清单产值。
3. **WhatsApp / Telegram / 邮件 / Slack / Discord 自动同步**
   - 在 **配置 → 消息连接** 中接入个人或公司共享频道并配置接入规则。
   - 自动同步消息（`sync_messages`）、语音转写、AI 项目路由（`classify_messages`）、结构化提取（`extract_project_updates`）以及每日 06:00 SGT 异常早报通知（`daily_project_digest`）。
4. **总包商务与现金流（精确 `BigDecimal`）**
   - **工程量清单（`cost_items`）**：支持按百分比、实测工程量或里程碑（0%/100%）计价。
   - **报价与修订（`quotes`）**：复用 `priced_lines` 精确明细；已发报价自动锁定，经 `sent -> revised` 自动归档历史至 `revision_trail`，接受后永久锁定。
   - **工程变更 / VO / 工期延长（`change_orders`）**：复用 `priced_lines` 自动汇总变更额并支持 `bim_pin`；提交即锁定，批准后永久锁定。
   - **统一现金流与请款台账（`payment_claims`）**：追加式 `seq` 编号台账，提供**分步多态新建表单**（业主请款流入 + `claim_valuation` 计价快照 vs 分包/供应商账单流出）及冲销调整项（`adjustment`），提交即锁定；原生 `<Chart>` 展示月度流入/流出对比，并支持一键**生成进度请款草稿**（`generate_payment_claim`）。

## 导航与项目工作台

全系统设 2 个应用，每个模型仅有一个主入口：

- **项目运营**：`项目`（项目列表与工作台）、`消息流`（全局同步收件箱）。
- **配置**：`消息连接`（频道连接 / 接入与自动提取规则）、`联系人`。

项目工作台每个标签仅承载单一职责与单一滚动容器：`项目概览`、`BIM 与问题`、`BIM 与图纸文件`、`进度与任务`、`现场进度`、`商务与现金流`（BOQ / 报价 / 变更 / 请款）、`现场通讯`。

## 数据模型（12 个模型，6 个自定义字段）

- `projects`（内联空间区域 `zones`、付款账期、保留金/税率、消息路由规则与地址）
  - 归属子模型（`owned: true`）：`project_files`、`issues`、`tasks`、`progress_updates`、`cost_items`、`quotes`、`change_orders`、`payment_claims`。
- 根级共享模型：`project_messages`、`contacts`、`communication_settings`。
- 可复用自定义字段：`project_zones`、`bim_pin`、`priced_lines`、`revision_trail`、`claim_valuation`、`project_address`。

更多细节见 [docs/README.md](docs/README.md) 与 [docs/source-reference.md](docs/source-reference.md)。
