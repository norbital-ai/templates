# Kingdee custom integration

Trading Operations owns `src/integration/kingdee/+integration.ts`, its CDC polling, projections,
SQL bootstrap and verified order submissions. Bolt's SQL Server driver executes bounded
parameterized requests through an integration instance. It contains no accounting or CDC rules.

## Source and runtime configuration

`+workspace.ts` names the `kingdee` connection; more ledgers are added as further `kingdee`
instances in Settings → Integrations. Each instance pairs with its SQL Server connection string,
which the host seals and never exposes to source execution. Its runtime configuration sets
`maxLagMinutes`, `retentionMinutes` and `minRetentionMinutes`; the definition holds their
defaults, which every instance starts with. Commercial Settings holds only business controls.
Pausing an instance (`active`) stops its feeds and keeps its approved order commands queued;
resuming it sends each immutable command once without changing the sealed order or its history.

Each inbound feed declares its collection, remote key, schedule and removal behavior, and runs
for every active instance. A feed page commits its rows, cursor and row markers together. Every
fed model's key is its ledger (`source`) and the remote identity, and every reference a feed or
transform resolves is looked up inside that ledger. An order takes its party's ledger
(`ledger`); its warehouse and products must come from the same one, and its submission goes to
that ledger only. Products expose only commission settings for local updates; the feed alone
writes source fields. `projections.ts` and `sql-rows.ts` hold the SQL, `cdc.ts` reads a projection
into a feed page, `+integration.ts` turns each SQL row into its record, and `submission.ts` and
`order-batch.ts` create the approved order in the ledger.

## CDC and submission invariants

- Capture IDs, object creation dates, database identity and recovery fork identify the source.
  Snapshot pages retain a fixed baseline. Delta pages retain a fixed upper LSN and resume the
  inclusive `(LSN, sequence, operation, event key)` tuple in binary order.
- Decimal and money columns are selected as text. Rows and parameters are bounded. A missing
  capture, unavailable source clock or invalid position fails before acknowledging progress.
- A source replacement or cleanup gap requires a fresh snapshot and reconciliation; a poll
  never jumps past missing deltas. Partial snapshot recovery is also an acceptance requirement.
- Native feed writes and their cursor commit together. A row the feed cannot read or a
  transform refuses, or a rolled-back transaction, does not acknowledge the source event. Replay
  preserves model revisions.
- Removed master data, payments and sales facts become inactive. Removed issued orders and
  transactions become void. Stock rows may be deleted. Retention reconciliation preserves these
  same business semantics and local product configuration fields.
- A source submission serializes its immutable key, verifies any existing hash, writes a complete
  header and its items, invokes the source's approval routine and verifies the matching receipt
  in one transaction. Retrying a lost acknowledgement finds the same source order.
- Native outbound receipts update the command timeline without editing a sealed order or adding
  domain history. There is no two-way order identity adoption.
- A submission receipt is separate from business confirmation. Only a matching issued external
  order with the original agreement seal enables its linked delivery/invoice records.

Local orders remain editable agreements. Issued external orders and transactions are read-only
source evidence. Synchronize external parents before transactions, payments and sales facts;
reject cross-agreement relationships. There is no separate inbox, mirror or ingestion pipeline.

## Local acceptance

`tests/fixtures/kingdee-simulation.sql` describes normalized mock tables, not actual Kingdee
physical names. The accepted fallback target is SQL Server 2017 Developer, version 14.0.3550.4,
inside the local `colima-trade-sql` Docker context on loopback port 14340. The separate browser
simulation uses SQL Server 2022 on loopback port 14339. Test helpers reject connections outside
a dedicated local `TradeSimulation_*` database.

Use a fresh dedicated fixture database and a privately supplied
`BOLT_TRADE_SQL_SIMULATION_DSN`. Run `bolt test -- tests/sql-simulation.test.ts` and
`bolt test -- tests/sql-stock-posting.test.ts`. The first covers snapshot/delta, complete sales
and purchase orders, amendments, lost remote/local acknowledgements, replay, payments and
stock deletes. The second covers real source FIFO posting, delivery/invoice deduplication,
supplier receipts, actual quantities above forecast and commissions tied to the original seal.
`tests/custom-cdc.test.ts` independently probes bounded pages, fixed LSN ranges, source restore,
cleanup gaps, precise amounts, tombstones and transactional submission.

Capture, lag and retention health is recorded on the integration instance, and the
`source_health` automation notifies configuration holders when it needs attention. A failed
source request keeps the cursor unchanged. Template probes cover source algorithms and real
database behavior. The rendered integration-sync test checks retry recovery after a successful
receipt, followed by Confirmed only when matching issued source evidence arrives. Sync metadata changes preserve the sealed order's revision and
history. Local UI probes remain a separate acceptance gate.

## Business and live-source checks

Forecast quantity does not cap source actuals. Physical invoices issued without a delivery count
once; paired delivery/invoice documents do not post stock or commissions twice. Transaction
items retain captured supplier net values. Commissions use source business dates, actual net and
quantity, the original sealed rule and floor. The default is converted quantity rate plus positive
above-floor spread; lot-cost profit remains a separate reporting measure. Returns reverse
commission; saved statements stay immutable.

Teams, policies and approval fallback are source declarations. Sales and procurement submit
through native approval when direct sealing permission is absent. A manager with direct
permission seals normally. Read-only source credit does not gate local sealing; source credit
rules remain authoritative.

Live activation requires verified SQL Server version/edition, selected and supporting captures,
cleanup retention, source keys, private connectivity and privileges. The historical Sales Bridge
reference targets `SEOrder`/`SEOrderEntry`, omits checker fields and documented a missing sales
style that prevented downstream deliveries. Those reference findings are not a live-source
measurement. Verify actual sales/purchase approval, amendment and downstream document
semantics instead of copying its allocation/report pipeline.

Manual acceptance must cover each affected view, EN/ZH, role scope, external read-only records,
partial/over-forecast fulfillment, document download, approval fallback and configuration.
Local mock success does not establish live Kingdee behavior. Staging remains untouched.
