# 现场运营

![现场运营应用界面](docs/screenshots/application.webp)

专注于现场派单与施工证据核验的作业工作区。调度员可按日排布现场任务、指派承包商、通过看板与地图掌握进度，并借助确定性照片完整性校验与有界 AI 存疑复核验证完工凭证，而不混杂造价或薪酬模块。

## 核心能力

- **按日调度看板与路线规划：** 将当日任务按**待处理**与**已完成**分组并与现场地图并排呈现，支持最多 5 个站点排线并跳转 Google 地图导航，支持 CSV/XLSX 工单批量校验与去重导入。
- **角色隔离的承包商工作台：** 承包商仅可查看并汇报本人名下任务的进度、费用、位置与现场照片；完整性标记与存疑日志仅向调度员可见。
- **自动照片完整性校验：** 每张上传照片（JPEG/PNG/HEIC，上限 20 MiB）自动计算 SHA-256 精确哈希、256 位 PDQ 感知哈希、场景向量复用、EXIF GPS 与站点距离（500 米容差）及元数据异常。
- **可审计的 AI 存疑复核：** `review_job_assignment_suspicion` 结合照片事实、精选样本与消息记录评估待检任务，在不可变 `suspicion_reviews` 中留存每次判定，仅对存疑任务生成需调度员显式结案的 `suspicious_activity_logs`。
- **WhatsApp 使者与站点交接包：** 承包商可通过私有 WhatsApp 使者（`field_ops_whatsapp`）汇报完工并传图，调度员可一键导出所选站点的 JSON 与 CSV 交接包。

## 应用与角色

| 应用                                       | 页面           | 受众                                       |
| ------------------------------------------ | -------------- | ------------------------------------------ |
| **调度中心**（`field_ops_controller`）     | 调度排班、站点 | `现场运营调度员`、`承包商（调度员）`       |
| **承包商工作台**（`field_ops_contractor`） | 派发任务       | `承包商`（仅本人任务）、调度员（全部任务） |

- **调度员（`field_ops_controller`）** 管理站点、派单、导入、复核、结案与交接导出；沟通记录、复核记录与存疑日志均为只追加台账。
- **承包商（`field_ops_contractor`）** 仅可读取受派站点并更新本人任务进度或上传照片，不可查看完整性标记与存疑日志。
- **WhatsApp 使者（`field_ops_whatsapp`）** 仅可更新已有任务状态/摘要并归档照片与消息，不可新建、删除、改派任务或读取存疑数据。

## 数据模型

共 6 个模型，全部归属于站点树：

- `sites` — 物理站点（必填地图坐标、可选单元号、派生名称）。
  - `job_assignments` — 按日派发工单，按邮箱或手机号关联成员（`pending` → `completed`，幂等键 `external_ref` / `source_message_id`）。
    - `photo_evidence` — 不可变现场照片证据（含 `photo_source` 自定义字段）、SHA-256/PDQ/场景向量及完整性事实。
    - `communication_logs` — 不可变入站沟通记录。
    - `suspicion_reviews` — 每次 AI 复核的不可变审计记录。
      - `suspicious_activity_logs` — 仅可通过调度员显式结案关闭的存疑判定。

## 自动化与集成

| 自动化                               | 触发方式                    | 用途                                                  |
| ------------------------------------ | --------------------------- | ----------------------------------------------------- |
| `inspect_photo_evidence`             | `photo_evidence` 创建触发   | 计算 SHA-256、PDQ 与场景向量、EXIF 定位核验与跨单查重 |
| `review_job_assignment_suspicion`    | `job_assignments` 触发/手动 | 核验待检照片、执行多模态 AI 复核并写入审计与存疑日志  |
| `job_assignments_import_work_orders` | 手动（CSV/XLSX 导入）       | 整表校验并幂等导入调度工单                            |
| `suspicious_activity_logs_resolve`   | 手动（调度员结案）          | 写入不可变结案结论并关闭存疑日志                      |
| `site_handover`                      | 手动（选中站点）            | 导出每个站点的 JSON 包以及任务与照片 CSV 文件         |

WhatsApp 汇报通过 Bolt 内置 `whatsapp` 集成绑定持有 `field_ops_whatsapp` 策略的 `sys_envoy` 实现。

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**控制中心 → 人员**邀请调度员与承包商，并按需在**设置 → 使者**配置 WhatsApp 使者。

- [文档目录](docs/README.md)
- [操作指南](docs/operator-guide.md)（完整流程、照片校验、存疑复核与 WhatsApp 使者配置）
- [派单导入模板](assets/job-assignments-import.template.csv) 与 [字段说明](assets/job-assignments-import.README.md)
- [源码参考](docs/source-reference.md)
