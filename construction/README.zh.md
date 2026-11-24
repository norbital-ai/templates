# 施工管理 (`norbital_construction`)

![施工管理应用界面](docs/screenshots/application.webp)

面向**总承包商、分包商与专业分包商通用**的一体化工程项目管理系统（PMS）。将来自 **WhatsApp**、**邮件** 与结构化 **BIM IFC** 模型的零散信息沉淀为三大主线：**现金流（Cashflow）**、**进度推进（Progression）** 与 **文档及 BIM 造价（Documentation & BIM Costing）**。

## 核心能力

1. **自动化 BIM IFC 算量与造价流水线**
   - 在 `project_files` 中上传 `.ifc` 模型（自动维护 `revision_trail` 并支持 Autodesk ACC 同步）。
   - 上传 IFC 后自动触发 `analyze_bim_file` 服务端流水线：解析 ISO-10303-21 IFC STEP 文件、按可量化 **计价矩阵（`cost_matrix`）** 自动分类计价、标出未匹配构件，并在 `cost_estimates` 中合并 BIM 算量与可编辑的 **非 BIM 附加费用**（临设、吊装、检测、不可预见费等）。
   - 配套 3D IFC 视图（X/Y/Z 剖切滑块、按问题或 4D 计划高亮、点击构件标注 `issues` 及现场照片）。
2. **大型项目进度计划与问题跟踪（`tasks` / `issues`）**
   - 支持 **4D 进度轴**、**列表** 与 **看板** 视图，涵盖 16 类专业分包工种（屋面、地坪、机电 M&E、电气、给排水、暖通、结构、幕墙、桩基等）。
   - 支持 **Autodesk ACC/APS** 双向同步（`autodesk_schedule`），以及 **Primavera P6 (`.xer`)**、**MS Project (`.xml`)**、CSV/XLSX 计划文件导入（`schedule_file`）。
   - 将与 3D BIM 绑定的现场缺陷/RFI（`issues`）纳入进度推进闭环。
3. **合同管理、PO / DO / 发票三单匹配与现金流（精确 `BigDecimal`）**
   - **合同管理（`contracts`）**：统一管理上游总包/分包合同与下游分包/供应合同及工程变更（VO / EOT），含 `priced_lines`、版本归档与生效锁定。
   - **商务与现金流台账（`commercial_documents`）**：统一处理采购单（PO）、送货单（DO）、发票（Invoice）、进度请款（Progress Claim）与贷项通知单，内置 **PO → DO → Invoice 三单匹配**、SQL 聚合商务 `<Chart>` 及一键生成进度请款草稿（`generate_payment_claim`）。
4. **WhatsApp 与邮件自动同步与 AI 提取**
   - 在独立的 **系统配置** 应用中接入个人或共享 **WhatsApp**、**邮件** 与 **Autodesk ACC**。
   - 消息到达时即时触发同步（配合每 15 分钟兜底扫描 `sync_messages`）、自动路由项目（`classify_messages`）、AI 结构化提取进度/问题/变更/发票（`extract_project_updates`）并推送每日 06:00 SGT 异常早报（`daily_project_digest`）。

## 导航与独立配置应用

全系统设 2 个应用，配置完全隔离：

- **工程运营**：`工程项目`（项目列表与单层项目工作台）、`消息收件箱`（WhatsApp 与邮件同步、分类与提取）。
- **系统配置**（独立隔离）：`外部连接`（WhatsApp / 邮件 / Autodesk ACC 及接入规则）、`联系人与分包商`（专业分包工种目录）、`计价矩阵`（BIM 自动分类与单价规则）。

项目工作台采用单层标签结构：`项目总览`、`进度计划与任务`、`BIM 与问题`、`成本估算`、`BIM 与文档`、`合同与变更`、`PO / DO / 发票`。

更多细节见 [docs/README.md](docs/README.md) 与 [docs/source-reference.md](docs/source-reference.md)。
