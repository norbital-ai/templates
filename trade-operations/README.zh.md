# 贸易运营

![贸易运营应用界面](docs/screenshots/application.webp)

以订单为核心的 B2B 贸易、分销与制造商务工作区，内置与**金蝶 KIS** SQL Server 的双向集成。报价单、销售订单与采购订单共用同一协议模型：确认同步后原位成为受管 ERP 订单，出库单、发票、收付款、批次库存、信用拦截与毛利分析均直接关联回原订单。

## 行业与 Bolt 核心能力

- **适用行业：** 贸易与制造（Trading & Manufacturing）
- **Bolt 能力标签：** `data_modeling`、`complex_business_logic`、`workflow_approvals`、`third_party_saas`、`document_intelligence`、`scheduled_automations`

## 系统运作方式

1. **统一订单与底价审批：** 销售与采购在 `orders` + `order_lines` 录入报价、销单与采单；低于 `pricing_floors` 的明细或草稿删除通过原生 `ctx.approve` 自动流转商务经理审批。
2. **金蝶 KIS 双向同步：** 20 余个 `+kingdee.sync.ts` 同步管道按有界行版本窗口拉取基础资料、批次库存、出库、发票、收付款与账龄，并将确认订单通过幂等出箱写回 ERP。
3. **信用放行、合同与毛利：** 信用拦截出库单经 `商务经理 → 财务` 两级审批并核验金蝶 `t_Log`；支持中英双语 PDF 合同生成，并按批次加权成本与 CEL 佣金规则自动核算毛利与提成。

## 核心能力

- **统一销售与采购协议：** 在同一模型（`orders` + `order_lines`）管理内外贸报价、销售与采购订单，支持底价校验与经理审批、中英双语可定制 PDF 合同预览与批量导出（含可选自定义打印 HTML 与电子公章），以及 CSV/XLSX 订单导入导出。
- **金蝶 KIS 双向同步：** 通过有界 SQL Server 行版本窗口轮询基础资料、批次库存、出库、发票、收付款与账龄（不在 ERP 建触发器或 CDC），并通过幂等出箱写回未审/已审订单的新增与变更。
- **信用控制与放行审批：** 展示只读 ERP 信用快照，并对受信用拦截的未审出库单提供两级放行审批（`商务经理` → `财务`），同时通过 `t_Log`（`XS100016`）核验金蝶放行与绕过记录。
- **批次库存、毛利与账龄分析：** 将销售净价与同 SKU 批次加权成本比对，按仓区汇总在手库存与在途承诺，并呈现不虚构核销关系的应收/应付账龄。
- **动态提成与月度结算：** 按订单日期锁定生效的 CEL 提成规则，并通过统一的月度 `commission_statements` 完成审批。

## 应用与角色

| 应用                         | 页面                 | 受众                                         |
| ---------------------------- | -------------------- | -------------------------------------------- |
| **仪表盘**（`operations`）   | 仪表盘               | 待办队列（待同步草稿、审批、信用与逾期）     |
| **贸易订单**（`operations`） | 订单                 | `销售`（本人）、`采购`（本人）、经理、`财务` |
| **往来伙伴**（`operations`） | 客户与供应商         | 往来单位、联系人与信用快照                   |
| **仓储库存**（`operations`） | 库存                 | `物流`（商业金额脱敏）、运营                 |
| **经营分析**（`operations`） | 报表                 | `商务经理`、`财务`                           |
| **贸易配置**                 | 单据模板、底价与提成 | `配置员`、`商务经理`                         |

- 六大团队一一对应策略：`销售`（`sales`）、`采购`（`procurement`）、`商务经理`（`manager`）、`财务`（`finance`）、`物流`（`logistics`）与 `配置员`（`configuration`）。
- 低于底价的销售明细与草稿删除需 `商务经理` 审批；信用放行依次经 `商务经理` → `财务` 审批。

## 数据模型

共 26 个模型，清晰区分本地商务协议与只读 ERP 镜像：

- **协议与履约（`orders`）：** `orders`、`order_lines`、`activities`、`order_files`、`transactions`（出库/入库/发票）、`source_payments`、`source_sales_lines`。
- **基础资料与库存：** `parties`（`contacts`、`credit_snapshots`）、`products`（`pricing_floors`、`stock_snapshots`）、`warehouses`、`settlements`。
- **商务治理：** `commercial_settings`（`document_templates`、`commission_rules`）、`commission_statements`、`credit_releases`。
- **ERP 报表镜像：** `source_lot_costs`、`source_payables`、`source_purchase_lines`、`source_purchase_orders`、`source_receivables`、`source_stock_commitments`。

## 自动化与集成

- **`kingdee` 集成（`src/integration/kingdee/`）：** 在**设置 → 集成 → 连接**按账套动态添加多账套 SQL Server 连接，激活前自动校验读写权限与表映射。
- **`source_health` 自动化：** 账套连接状态异常或同步失败时自动通知工作区管理员。

## 快速开始

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

公共基础种子（`seed/public/`）包含通用商务设置及报价单、销售合同、采购合同的中英模板，不含任何凭据或真实 ERP 数据。

- [文档目录](docs/README.md)（按 `0000-objective.md` 至 `0008-manual-probe-matrix.md` 顺序阅读）
- [系统架构](docs/0001-architecture.md) 与 [金蝶集成边界](docs/0002-integration.md)
- [金蝶实施手册](docs/0004-kingdee-implementation.md) 与 [订单生命周期](docs/0005-kingdee-order-lifecycle.md)
- [打印模板指南](docs/0007-print-layouts.md) 与 [源码参考](docs/0003-source-reference.md)
