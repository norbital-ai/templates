# Kingdee SQL integration

All integration code belongs to this template. `+integration.ts` declares the existing SQL Server
driver, sealed credentials, account-set configuration and connection test. The template issues
fixed SQL through the driver's existing `call` operation and SQL Server's built-in
`sys.sp_executesql`; business data is bound as parameters. Settings never accept SQL text.
No Store, Bolt, Colony host or OVH server configuration change is required by the code.

```text
China LAN                                    Alibaba private connection                 Singapore
+----------------------+      +------------------------------------------------+     +-------------------+
| Kingdee SQL Server   | <-->  | Shanghai IPsec -> CEN -> Singapore TCP relay    | <-> | Colony on OVH     |
| 2019                 |      | Restricted SQL endpoint; no on-prem script      |     | trade template    |
| dbo tables          |      +------------------------------------------------+     | keys + sync state |
+----------------------+                                                            +-------------------+
      SELECT rowversions/current rows  ---------------------------------------------> local model updates
      unapproved SEOrder + SEOrderEntry <--------------------------------------------- sealed order outbox
```

The network and TCP relay must already provide a reachable SQL endpoint. Existing TLS validation
and outbound network restrictions still apply. A local SQL probe does not establish that the
SQL Server's TLS stack/certificate is compatible with the deployed driver.

## Credentials and repeat deployment

Pair each Kingdee integration instance with its own SQL connection string in the native credential
fields. The endpoint is the Singapore relay, and the database/login identify the China account set.
Credentials remain sealed host-side; they never enter template source, seeds, bookmarks or browser
responses. Use a dedicated SQL login with SELECT access to the mapped source tables and, when
writes are enabled, only the required INSERT permissions on SEOrder/SEOrderEntry and UPDATE on
ICMaxNum. Do not use `sa` for synchronization.

Each instance has its own credentials, configuration, model scope, bookmark and outbox. A new China
counterpart uses the same template deployment and another configured instance/relay route.
The template adds no objects, CDC jobs, progress tables or scripts to Kingdee.

Read settings:

- `baseCurrency`: verified account-set base currency; the default is CNY for the reference ledger.
- `branchNo`: source branch; the reference value is `0`.
- `fullSnapshotMinutes`: master full-reconciliation interval, default 1440.
- `maxWindowMinutes`: unfinished-window age alert, default 15.

Writes additionally require `billerId`, `salespersonBindings` (owner ID to employee/department IDs),
`currencyBindings` (ISO currency to source ID and base flag) and `settlementRules` (source settlement
number to credit days/month-end rule). `packagingId` is optional. IDs and business rules must be
verified for each account set; there are no guessed exchange, employee or payment-term mappings.
`fromMonthEnd: true` selects the reference EPG rule: zero days means current month-end, and any
positive term means next month-end (including both 30 and 60). It does not add days to month-end.
A counterpart using a different rule needs its own verified rule binding.

## Reads without CDC

Parties, products and warehouses use the native `FModifyTime` markers on their actual master and
joined detail rows. The effective marker is the greatest dependency marker. SQL's type metadata
must confirm each declared marker is a native eight-byte rowversion, including a marker exposed
through a view. `FNumber` is a display number; stable master identities use `FItemID`.

Each window captures `U = MIN_ACTIVE_ROWVERSION()` before fetching data and selects
`bookmark <= effective_marker < U`. The ceiling remains fixed across keyset pages. The engine
commits each page and its continuation together; only completion advances the saved bookmark to U.
An in-flight transaction cannot be skipped by advancing past its uncommitted marker. Failed reads,
invalid rows or failed model writes leave the last committed page position unchanged.

This copies current state. It does not retain every intermediate edit as a transaction log would.
Periodic complete master listings repair missed dependency changes. After a successful complete
listing, bounded checks of existing local identities deactivate rows that have disappeared; no
partial scan triggers absence reconciliation. Master records and local product settings remain.

Stock is an aggregate complete read of ICInventory by item, warehouse and batch. Unknown cost,
commitments and source position remain null. Unknown product prices, tax and units are not
invented; order entry requires the missing commercial values before sealing.

Owned orders are identified by an existing `SEOrder.FUUID` derived from the local order and sealed
agreement. Lines are fetched by captured `FInterID`, and complete owned-order reads also observe
changes that do not bump the header. Delivery and invoice lineage follows the physical source
order/entry references. Missing owned orders/documents become void; they are retained locally.
No document links or PDFs are fabricated from SQL rows. Unapproved new DOs/invoices wait for
approval; unauditing already retained evidence fails visibly instead of silently withdrawing it.
An invoice may merge multiple deliveries of the same sealed line/lot; its local items aggregate
quantity and net amount while financial facts retain exact upstream lineage.

Financial reads use verified invoice-to-receipt settlement links and preserve missing facts as
inactive. Ambiguous allocations, unsupported reversals and unverified currency interpretations
fail visibly. A remaining balance of zero is never treated as proof of payment.

## Writes

Quotations remain local and can be edited or exported before confirmation. Confirmation converts
the quotation into an immutable SO: header and lines cannot reopen while delivery is queued or
after the Kingdee counterpart appears. Read-only source evidence can change its own status without
changing the sealed agreement. Cancellation and closure preserve that seal.

An initial sealed sales agreement creates an **unapproved** SEOrder and its SEOrderEntry rows.
One serializable SQL batch takes a transaction-owned application lock, allocates the numeric
FInterID through ICMaxNum, and writes the complete header/line set. Existing FUUID provenance
makes retry identity independent of the nonunique bill number. A retry verifies the immutable
source header, line cardinality and financial values before acknowledging the existing order.
A lost response therefore retries the same order rather than creating a duplicate.

A failed delivery preserves the sealed local SO and its lines, including mapping errors and
source conflicts. The native queue retries, then retains an actionable dead letter after eight
failed attempts. Correct the connection, mappings or source conflict and use **Replay dead letters**
in the integration settings; replay uses the same frozen submission and the current configuration.

If a document poll runs before the SO approval mirror catches up, it reports `parentPending`
and preserves the cursor and existing evidence. The next poll resumes after that counterpart is
issued; it does not attempt an invalid document upsert or reconcile rows as absent while waiting.

The reader observes subsequent Kingdee approval; the template does not call a fictional approval
procedure. Purchase-order creation, amendment writes, red-document reversals and a verified credit
hold/limit mapping remain unavailable and fail explicitly. They must not fall back to normalized
simulation tables or fabricate empty successful results.

## Local validation boundary

Focused template probes cover the SQL calls, mappings, fixed rowversion windows, continuation
validation, immutable submissions, source lineage and financial ambiguity guards. The optional
`kingdee-local-probe.test.ts` uses only a disposable loopback SQL database, synthetic Kingdee-shaped
tables and restricted SQL logins, with CDC disabled and compatibility level 150.

The standalone manual probe uses Microsoft SQL Server 2019 with synthetic Kingdee-shaped tables
and the normal application credential-pairing UI. Its loopback-only SQL adapter is a local test
transport, not a production policy change. SQL credentials remain sealed and masked. No real
installation, Alibaba provisioning, Realm reset or deployment is part of this validation.
