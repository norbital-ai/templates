# 施工运营

![施工工作区界面](docs/screenshots/application.webp)

一个以项目为中心的施工运营工作区：项目、作业面、岗位、工人及其作业许可、质量缺陷、信息请求（RFI）、付款索赔、移交文档，以及用于成本和隐含碳基线的 BIM 参考矩阵；并由服务器强制执行一条规则：只有当工人今日有效的作业许可覆盖与该作业面关联的至少一个岗位所要求的全部认证时，才能将其分配到该作业面。它为项目交付提供运营模型和安全检查；它不替代 ERP、BIM 建模工具或监管许可机构。

## 应用与角色

| 应用                                     | 用户可以做什么                                    |
| ---------------------------------------- | ------------------------------------------------- |
| `construction_project_workspace`         | 浏览项目目录；打开项目记录查看交付详情。          |
| `construction_settings_workforce`        | 管理工人、认证与岗位。                            |
| `construction_settings_reference_matrix` | 维护 BIM 参考矩阵：编码、单位、单价、碳排放因子。 |

项目工作区应用有意只包含项目表格：深度内容都在项目记录本身。项目记录的表示组件打开三个标签页：**模型与协同**（IFC 查看器，旁边是该项目的信息请求和缺陷）、**人力分配**（限定于本项目的原生分配表格）以及**商务与管控**（合同金额与已索赔/已认证金额的对比、付款索赔、项目文档以及当前的作业许可）。工地位置、资产文档和作业许可在任何地方都没有自己的标签页，只能通过项目访问，因为只有在项目语境中它们才有实际意义。

团队（`src/access_control/team/+team.ts`）：

| 团队（handle）                                      | 策略                                                          |
| --------------------------------------------------- | ------------------------------------------------------------- |
| 项目交付（`project_delivery`）                      | `construction_read`、`construction_project_workspace`         |
| 参考矩阵管理员（`reference_matrix_administrators`） | `construction_read`、`construction_settings_reference_matrix` |
| 人员管理员（`workforce_administrators`）            | `construction_read`、`construction_settings_workforce`        |
| 施工管理员（`construction_administrators`）         | `construction_read` 以及全部三个应用策略                      |

`src/access_control/policy/+construction_read.policy.ts` 持有共享的读取授权。三个打开应用的策略只提供能力。`src/access_control/team/+team.ts` 中的源码团队显式关联这些策略。团队决定可用的应用；这些授权不允许业务写入。创建和修改记录需要原生的工作区管理员标志。团队名称中包含“管理员”并不会授予该标志。

团队和策略定义只存在于源码中。这些定义没有运行时编辑器，本模板也不声明任何审批流程。修改访问权限需要编辑源码并采用重新构建的发布版本。

## 数据模型

| 模型                                  | 用途                                            |
| ------------------------------------- | ----------------------------------------------- |
| `projects`                            | 施工项目及其运营背景。                          |
| `jobs`                                | 关联到工地位置和 BIM 参考的工作包。             |
| `workers`                             | 用于分配和合规的工人名册。                      |
| `certification_types`                 | 定义人员要求的认证库。                          |
| `site_locations`                      | 项目内的作业面和交付区域。                      |
| `defects`                             | 质量问题和收尾事项。                            |
| `rfis`                                | 设计与协调问题。                                |
| `payment_claims`                      | 带就绪状态和提交状态的商务索赔。                |
| `permits_to_work`                     | 许可和资质有效性记录。                          |
| `asset_documents`                     | 移交文档及与资产关联的文档。                    |
| `bim_reference_matrix`                | 用于成本和碳排放估算的 BIM 构件主数据表。       |
| `job_assignments`                     | 工人到岗位和工地位置的分配（受合规检查约束）。  |
| `jobs_certification_types`            | 关联表：jobs ↔ certification_types。            |
| `jobs_site_locations`                 | 关联表：jobs ↔ site_locations。                 |
| `permits_to_work_certification_types` | 关联表：permits_to_work ↔ certification_types。 |
| `permits_to_work_workers`             | 关联表：permits_to_work ↔ workers。             |

引用（持有键的模型上的 `ref` 字段）：`permits_to_work` ↔ `certification_types` 以及 ↔ `workers`（通过关联表实现多对多）；`jobs` ↔ `certification_types` 以及 ↔ `site_locations`（同上）；`job_assignments` → `workers` / `jobs` / `site_locations`（直接外键）。每个信息请求、缺陷、索赔、许可、文档、工地位置和岗位都属于一个项目。

### 岗位分配合规

`src/data/model/projects/jobs/job_assignments/+model.ts` 中的 `create.transform` 和 `update.transform` 共用一个检查，该检查通过一次原生键控读取获取工人-许可关联、工地岗位、其有效许可以及所需认证。依赖成员从同一读取组中较早的成员解析。

至少有一个工地岗位必须具有非空的资质集合，且该集合被工人今日有效的作业许可完全覆盖。否则整个批次都会被拒绝，不会产生部分分配。该检查在创建时以及工人或工地变化时运行。只修改岗位、角色、工时或日期而工人和工地不变的变更，会保留现有分配，不重新检查资格。

### 运营模式

1. 建立**项目**、其**工地位置**（作业面）以及 BIM 参考背景。
2. 配置**认证类型**并签发**作业许可**，以证明工人当前有效的授权及其覆盖的认证。
3. 定义**岗位**（工作包），将其关联到作业面和所需认证，然后创建工人**分配**；每项分配在存在之前都要通过服务器合规检查。
4. 在项目记录中开展交付：审阅 IFC 协同模型，按项目跟踪信息请求和缺陷，并按作业面分配人力。
5. 通过**付款索赔**跟踪商务工作，并保存支持每项索赔的文档。
6. 审阅每日定时生成的四份导出，涵盖许可、缺陷、信息请求和索赔就绪情况。

数据模型将这些关注点分开：岗位描述工作包；工地位置描述作业面；许可证明工人当前有效的授权；分配只有在合规检查通过后才把工人与工作关联起来。

```
projects ─┬─ site_locations ── job_assignments ── workers ── permits_to_work ── certification_types
          ├─ jobs ────────────┘                         │             └── permit ↔ certification join
          ├─ rfis · defects · payment_claims            └── permit ↔ worker join
          └─ asset_documents · bim_reference_matrix   jobs ↔ certifications / site_locations (joins)
```

## 自动化与集成

四个服务器自动化每天 `06:00` 运行。它们为运营审阅生成有上限的 JSON 导出；它们不发送消息、不升级记录，也不修改业务状态。

| 自动化                          | 对象              | 导出文件                             |
| ------------------------------- | ----------------- | ------------------------------------ |
| `permit_expiry_watch`           | `permits_to_work` | `permit-expiry-watch.json`           |
| `defect_closeout_digest`        | `defects`         | `defect-closeout-digest.json`        |
| `rfi_followup_watch`            | `rfis`            | `rfi-followup-watch.json`            |
| `payment_claim_readiness_watch` | `payment_claims`  | `payment-claim-readiness-watch.json` |

四者结构相同：最多读取 25 行，将该数量作为汇总计数，并将同样的行作为文件内容导出。这些上限让审阅者能够读完；这项巡检是一份晨间摘要，而不是塞进 JSON 的整张表。这些只读巡检本身不通知任何人：需要提醒的部署可以在 `src/+workspace.ts` 中添加一个会话连接（例如 `{ integration: 'whatsapp' }`），将其指定为通知渠道，并在**设置 → 集成**下用企业自己的账号配对该实例。

## 源码结构

Bolt 从 `src/+workspace.ts` 开始，发现 `src/` 下的命名声明。`bolt check` 校验源码契约；`bolt build` 在 `.norbital/` 下生成类型、制品和种子数据包，并在 `migrations/` 下生成可编辑的结构迁移。

```text
src/+workspace.ts                     workspace locale, timezone and defaults
src/app/<app>/                        application declaration and pages
src/access_control/team/+team.ts      source teams and explicit policy links
src/access_control/policy/+*.policy.ts source grants and capabilities
src/data/model/<name>/                model (storage, refs, exposure, write callbacks) and optional representation
src/data/custom_field/<name>/         inline type definition and renderer
src/automation/                       four daily review watches
src/i18n/                             English and Chinese messages
src/lib/ifc-viewer/                    lazy viewer and converter worker
assets/                               media and the bundled sample IFC
```

各部分如何协作：

- **表示组件。** 模型文件夹包含 `+representation.svelte` 配套文件。表单复用原生的 `RecordShell`、`Form`、`Field`、`Section` 以及关系 `Picker` 控件。项目记录组合了 IFC 查看器、原生模型表格和按币种的商务合计。分配的筛选、操作和记录管理由原生表格工具栏和主管负责。
- **IFC 查看器。** `src/lib/ifc-viewer/` 包含一个延迟加载的 WebGL 查看器（`ifc_viewer.svelte`），以及一个在 worker 中运行 web-ifc 的转换器（`ifc_viewer.converter.worker.ts`），并为从 esm.sh 加载的查看器库提供环境声明（`ifc_viewer.runtime.d.ts`）。当关联的 `asset_documents` 行带有 `ifc_model` 文档（或 `.ifc` URL）时，它会挂载在项目记录内；新播种的租户显示的是 `assets/ifc/` 下的示例模型。
- **关联标签。** 每个关联模型的 `record_label` 向下读取一层，获取其两侧记录；不存储任何内容。
- **自定义类型。** 父记录拥有的结构化值使用 `project_address`、`site_coordinates`、`emergency_contact` 和 `permit_signatures`，每个都有一个定义和一个渲染器。金额是内置类型：`{ kind: 'money', currency: 'currency' }` 使用该行的币种字段和原生控件。
- **国际化。** 英文和中文消息声明提供本地化的应用和记录文案。

对不可协商的服务器规则使用模型的写入回调；当可复用字段需要自己的校验和渲染器时使用自定义类型；只有在基于结构生成的界面不够用时才使用模型表示组件。大型 BIM 文件应保存在文件存储设施中；`bim_reference_matrix` 是参考和基线模型，并不替代原生 BIM 文件。

## 种子数据

没有公开行：新工作区从空开始。`seed/+seeder.ts` 指定种子库中私有的 `construction` 树（项目、岗位、工人、许可、信息请求、缺陷、索赔、BIM 矩阵、文档），`bolt seed --bank=<checkout>` 将其中的行原样加载到演示环境中。`assets/ifc/` 下的示例 IFC 模型供项目记录的查看器使用。

## 检查

```bash
bun install
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run build   # bolt build
bun run test    # bolt test, including tests/e2e/surface-sweep.integration.test.ts
```

`.norbital/` 是生成的，从不提交。结构变更会在 `migrations/` 下生成下一个可编辑的 SQL 迁移，并对照声明校验完整历史。将 SQL、`snapshot.json` 和 `migrations.lock.json` 一起提交。重新构建不会重置现有数据库，也不会更新已采用的租户发布版本。参见[模板生命周期](../README.md#release-and-tenant-lifecycle)。

## 维护中的源码参考

当前的应用/页面、模型输出与写入、自动化策略、集成以及浏览器截图，请参见[源码参考](docs/source-reference.md)。该清单会对照本模板的声明进行检查；服务商配置和已部署发布版本的就绪状态仍是单独的检查。
