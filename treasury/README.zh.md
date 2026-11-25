# 资金管理

![资金管理应用界面](docs/screenshots/application.webp)

面向通过银行授信额度融资采购的企业资金、贸易融资与外汇套保工作区。资金团队集中管理银行授信、子额度与费率规则，结合 AI 解析的银行通知单推动每笔融资从预留额度流转至结清，管理外汇套保与定盘，并与采购和财务协同处理采购订单、供应商发票及融资申请。

## 行业与 Bolt 核心能力

- **适用行业：** 金融（Finance）
- **Bolt 能力标签：** `data_modeling`、`complex_business_logic`、`workflow_approvals`、`document_intelligence`、`third_party_saas`、`scheduled_automations`

## 系统运作方式

1. **授信结构与融资流转：** 银行、额度、子额度与计息规则（`Actual/360` / `Actual/365`）决定可用余额；采购创建 `purchase_order` 并通过 `facility_form_pack` 打包 PDF 融资申请，财务与资金推进 `drawdown` 从 `预留 → 申请 → 在用 → 结清`。
2. **文档智能识别与原生审批：** 上传银行通知单、采购订单、融资申请或外汇条款书即触发 OCR/AI 提取自动化，核验利息与扣款后通过原生 `ctx.approve` 提交资金复核。
3. **汇率同步、预警与月末封账：** `fx_rates_fetch` 通过 `mas_rates` 同步工作日官方汇率，`daily_alerts` 每日 08:00 推送到期与额度预警，`month_end_lock` 冻结月末快照确保历史账目不可漂移。

## 核心能力

- **银行额度与提款全周期：** 管理多银行额度、子额度、费用规则、计息基准（`Actual/360` / `Actual/365`）与取整方式；融资台账按 `预留 → 申请 → 在用 → 结清/取消` 流转，支持信用证与远期汇票转融资并保留关联采购订单与发票且不重复计账。
- **AI 银行通知单解析与审批：** 上传提款或结清通知单 PDF 后自动提取金额、利率与期限，校核利息与扣款总额，匹配未结融资并连同实际费用一并提交资金原生审批。
- **采购与发票三方校核：** 从供应商 PDF 自动填充采购订单，生成含签批页与全部附件的 T/T 或信用证融资申请合并 PDF 包，并校核发票单价、数量及融资本金。
- **资金成本、预警与锁定月末：** 跨行比选综合融资成本，实时监控到期、额度占用与待开证预警（每日 08:00 推送），并锁定月末快照防止后续汇率或规则变动改写历史结账数据。
- **外汇套保与情景规划：** 管理远期、TRF、敲出远期及 DCI 等结构，支持条款书自动解析、工作日官方汇率同步（MAS 接口）、风险观察名单、±2/4/6% 情景测算与方案对比。

## 应用与角色

| 应用         | 页面                                         | 受众                                    |
| ------------ | -------------------------------------------- | --------------------------------------- |
| **资金管理** | 总览、融资、银行通知单、关注事项、成本、月末 | `资金`（管理）、`财务` / `只读`（查看） |
| **外汇套保** | 总览、交易结构、定盘、规划                   | `资金`（管理）、`财务` / `只读`（查看） |
| **采购协同** | 往来伙伴、采购订单、融资申请                 | `采购`（本人订单）、`财务` / `资金`     |
| **系统配置** | 银行、授信额度、汇率                         | `资金`（管理）、`财务` / `只读`（查看） |

- **资金团队**负责银行、额度、费率、提款操作、套保、汇率与月末锁定；**财务**负责预留计划与供应商发票；**采购**维护本人采购订单与融资申请；**只读**可浏览全工作区页面。

## 数据模型

共 26 个模型，分属九组主根：

- **银行与额度：** `bank`（`letter_of_offer`、`watch_point`）、`facility`（`facility_fee`、`sub_limit`）、`fx_rate`。
- **融资与结账：** `drawdown`（`bank_document`、`drawdown_charge`）、`month_end`（`month_end_line`）。
- **采购与发票：** `business_partner`（`supplier_bank`）、`purchase_order`（`po_line`、`po_document`、`po_financing`、`invoice` → `invoice_line`、`facility_form` → `facility_attachment`）。
- **外汇套保：** `fx_deal`（`fx_document`、`fx_fixing`）、`fx_proposal`。

## 自动化与集成

| 模块           | 自动化 / 集成                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **融资流转**   | `drawdown_allocate`、`drawdown_cancel`、`drawdown_record_advice`、`drawdown_settle`、`drawdown_close_bill`、`drawdown_earmark_po`                      |
| **单证解析**   | `bank_document_read`、`bank_document_apply`、`facility_form_read`、`purchase_order_read`、`facility_form_pack`、`fx_document_read`、`fx_proposal_read` |
| **结账与监控** | `month_end_lock`、`month_end_unlock`、`daily_alerts`（08:00）、`fx_rates_fetch`（工作日通过 `mas_rates` 集成同步官方汇率）                             |

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

新工作区初始为空：可在**系统配置**录入银行、授信额度与汇率，并在**设置 → 外部连接**启用 `mas_rates` 汇率源。

- [文档目录](docs/README.md)
- [业务与计算参考](docs/reference.md)（术语表、产品代码、利息/成本/月末公式、外汇套保与预警规则）
- [源码参考](docs/source-reference.md)
