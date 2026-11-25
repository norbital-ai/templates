# 客户关系管理（CRM）

![客户关系管理应用界面](docs/screenshots/application.webp)

覆盖从线索获取到签约交付全周期的公司 CRM 与项目运营工作区。线索与客户共用同一张去重公司表，多渠道客户消息与会议录音汇入统一活动时间线，AI 自动从归档证据中提取项目工作范围（SOW），可版本化的文档模板支持实时预览、PDF 发送与签署归档。

## 行业与 Bolt 核心能力

- **适用行业：** 专业服务（Professional Services）
- **Bolt 能力标签：** `data_modeling`、`channel_integrations`、`third_party_saas`、`ai_classification`、`browser_automation`、`document_intelligence`、`scheduled_automations`

## 系统运作方式

1. **线索入库与网络调研：** 支持手动、CSV/XLSX 与 `apollo` 集成导入并自动去重；`research_lead` 通过 `ctx.web` 执行带出处的网络调研并匹配产品目录与外联批次。
2. **多渠道消息与会议沉淀：** WhatsApp、邮件、Telegram、Slack、Discord 与 `google_calendar` 双向同步汇入统一 `activities`；`classify_messages` 自动路由至项目，`transcribe_meeting` 与 `meeting_notes` 生成会议纪要与跟进事项。
3. **需求提取与签约闭环：** `update_requirements` 从归档证据中提炼结构化工作范围并保留人工修订；版本化 `template_documents` 生成 PDF 协议，上传签署件后线索正式转为客户。

## 核心能力

- **统一线索与客户目录：** 支持手动录入、CSV/XLSX 或 **Apollo** 导入线索（按域名、标准化公司键与联系人邮箱去重）；新线索自动执行带引用的网络调研、匹配产品目录、生成潜在项目提案并编入 Apollo 外联批次。
- **多渠道消息接入与 AI 范围提取：** 绑定个人 **Gmail**、**WhatsApp** 及工作区渠道（**Telegram**、**Slack**、**Discord**、邮件），自动分类归档客户联系人消息、图片与语音，并更新项目工作范围同时保留人工修改。
- **会议录音、转写与声纹识别：** 支持录音或上传音视频（上限 20 MiB）、服务端说话人分离、浏览器端 CAM++ 授权声纹匹配，并自动生成会议纪要、决策与跟进任务。
- **Google 日历双向同步与节奏提醒：** 与 Google 日历双向同步会议，并按销售节奏在应用内及工作区私信渠道发送每日跟进提醒。
- **可版本化文档与签约门禁：** 在模板目录维护 NDA、MSA、SOW、外联邮件与调研提示，实时渲染 A4 PDF 并通过工作区邮箱发送；上传已签署的承诺类文档（如 SOW）后冻结签署快照并自动转为客户。

## 应用与角色

| 应用         | 页面                                         | 受众    |
| ------------ | -------------------------------------------- | ------- |
| **CRM**      | 仪表盘、线索与客户、任务                     | `Sales` |
| **系统配置** | 消息规则、外部连接、产品目录、模板、外联序列 | `Sales` |

- **销售团队（`hq-sales` → `sales`）** 拥有 CRM 记录、项目、文档与外联批次权限；个人连接（Gmail、WhatsApp、Google 日历）与接入规则按成员隔离，工作区外发渠道与 Apollo 由管理员配置。
- **`hq_automation`** 与 **`calendar_activities`** 为同步、调研、提取、转写与提醒自动化提供系统权限。

## 数据模型

共 22 个模型，按四组归属结构组织：

- **公司与交付（`companies`）：** `companies`、`contacts`、`potential_projects`、`projects`、`project_documents`、`issues`、`signed_documents`、`activities`、`meeting_recordings`、`meeting_speakers`。
- **冷外联（`cohorts`、`sequences`）：** `sequences`、`cohorts`、`cohort_members`。
- **文档与产品目录（`agreement_settings`）：** `agreement_settings`、`template_documents`、`offering_settings`、`products`。
- **日程与配置：** `tasks`、`calendar_entries`、`communication_settings`、`outreach_settings`、`notes`。

## 自动化与集成

| 模块           | 自动化 / 集成                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **线索与外联** | `import_leads`（每日 07:00 / CSV / Apollo）、`research_lead`、`launch_cohort`、`sync_cohort`、`remind_follow_ups`（09:00）                     |
| **消息接入**   | `sync_messages`（每分钟）、`classify_messages`、`activities_classify`、`activities_file`、`replay_message_routes`、`refresh_job_capture_rules` |
| **会议与日历** | `transcribe_meeting`、`meeting_speakers_save_voice`、`meeting_notes`、`sync_calendar_activities`、`replay_calendar_activities`                 |
| **范围与外发** | `update_requirements`、`send_message`、`template_documents_new_version`                                                                        |
| **外部集成**   | 内置 `whatsapp`、`email`、`telegram`、`slack`、`discord`；自定义 `google_calendar`（双向同步）与 `apollo`                                      |

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**系统配置**中维护公司信息、产品目录、文档模板并绑定外部连接（`seed/test/` 仅含合成测试数据）。

- [文档目录](docs/README.md)
- [操作指南](docs/operator-guide.md)（连接配对、消息规则、声纹配置、外联批次与故障排查）
- [活动时间线设计](docs/design/activity-timeline.md)
- [源码参考](docs/source-reference.md)
