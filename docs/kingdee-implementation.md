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
      initial SO + guarded amendments <---------------------------------------------- sealed contract outbox
```

The network and TCP relay must already provide a reachable SQL endpoint. Existing TLS validation
and outbound network restrictions still apply. A local SQL probe does not establish that the
SQL Server's TLS stack/certificate is compatible with the deployed driver.

## Credentials and repeat deployment

Pair each Kingdee integration instance with its own SQL connection string in the native credential
fields. The endpoint is the Singapore relay, and the database/login identify the China account set.
Credentials remain sealed host-side; they never enter template source, seeds, bookmarks or browser
responses. Use a dedicated SQL login with SELECT access to the mapped source tables and, when
writes are enabled, only the required INSERT/UPDATE permissions on the mapped SO, line, amendment
archive and change-log tables, plus UPDATE on ICMaxNum. Initial creation needs fewer permissions
than amendments. Do not use `sa` for synchronization.

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

Owned orders are anchored by their original `SEOrder.FUUID` and retained source binding. Archive
families are verified within the account set and branch; bill number alone is never ownership.
Lines are fetched by captured `FInterID`, and complete owned-order reads also observe
changes that do not bump the header. Delivery and invoice lineage follows the physical source
order/entry references. Missing source orders or archives raise attention while local proofs
remain intact. Missing downstream documents may be marked void only after a complete, verified
listing; they remain retained locally.
No document links or PDFs are fabricated from SQL rows. Unapproved new DOs/invoices wait for
approval; unauditing already retained evidence fails visibly instead of silently withdrawing it.
An invoice may merge multiple deliveries of the same sealed line/lot; its local items aggregate
quantity and net amount while financial facts retain exact upstream lineage.

Financial reads use verified invoice-to-receipt settlement links and preserve missing facts as
inactive. Ambiguous allocations, unsupported reversals and unverified currency interpretations
fail visibly. A remaining balance of zero is never treated as proof of payment.

## Writes

The order is the stable container for customer, ownership, remarks, Kingdee linkage and filing.
Archive / Unarchive is reversible and local. It does not void the source SO, release stock,
remove financial facts or stop incoming synchronization. There is one Remarks field; archiving
does not require a separate reason.

Each contract version retains its complete commercial snapshot, supporting files, generated
document and seal. Sealing freezes that version. Order title and operational remarks can change
without rewriting a sealed contract. A replacement draft copies the current terms into a new
editor; it never reopens or deletes the previous sealed version. A sealed replacement remains
pending until the source amendment is accepted, and the previous contract remains current while
delivery is pending or fails. Superseded contracts remain available for historical documents.
Draft setup is resumable: an incomplete copy cannot be sealed or edited as a finished draft.
Copied lines retain explicit Kingdee entry identities even when the local editor needs new IDs.

An initial sealed sales agreement creates an **unapproved** SEOrder and its SEOrderEntry rows.
One serializable SQL batch takes a transaction-owned application lock, allocates the numeric
FInterID through ICMaxNum, and writes the complete header/line set. Existing FUUID provenance
makes retry identity independent of the nonunique bill number. A retry verifies the immutable
source header, line cardinality and financial values before acknowledging the existing order.
A lost response therefore retries the same order rather than creating a duplicate.

Amendments use the existing Kingdee SO lineage. The source batch verifies the expected previous
version and terms under lock, preserves the previous source header/lines as an amendment archive,
increments FVersionNo and updates the permitted live terms. Unsupported header changes and
quantities below existing fulfillment are refused before committing. A newer source version is
a conflict, never permission to overwrite a direct Kingdee edit.

Contract tracking is version-specific. It retains source account/branch, live and archive
identifiers, Kingdee version, content fingerprint, available source change metadata and observed
status events. A formal Kingdee amendment imports a new immutable version; known archive rows
can backfill prior versions. A non-versioned change to sealed terms needs attention. Rowversion
does not reconstruct overwritten intermediate edits, and missing source archives are recorded
as unavailable history rather than invented versions or proof that the entire SO was voided.
Source change timestamps are retained as the source's raw local value; observation timestamps
are UTC instants. The connector does not invent a timezone or historical approval time.

Previously accepted DOs and invoices keep their original contract linkage when the live SO is
amended. Source dates alone do not establish a contract version. An ambiguous first import or an
invoice spanning contract versions needs attention; it must not be assigned to the newest terms.
SQL imports create source term snapshots, not fabricated signed contract files.

Supporting files remain readable through their original native upload ownership. A draft selects
its own attachments while every sealed version retains its exact file list. The native form's
current limit is 20 retained supporting files across an order; history is never trimmed to make
room for a later upload.

A failed delivery preserves the sealed local SO and its lines, including mapping errors and
source conflicts. The native queue retries, then retains an actionable dead letter after eight
failed attempts. Correct the connection, mappings or source conflict and use **Replay dead letters**
in the integration settings; replay uses the same frozen submission and the current configuration.

If a document poll runs before the SO approval mirror catches up, it reports `parentPending`
and preserves the cursor and existing evidence. The next poll resumes after that counterpart is
issued; it does not attempt an invalid document upsert or reconcile rows as absent while waiting.

The reader observes subsequent Kingdee approval; the template does not call a fictional approval
procedure. Purchase-order creation, red-document reversals and a verified credit
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

The 27 October 2026 standalone acceptance run used a restricted login with neither `sysadmin`
nor `db_owner`. Application credential pairing, initial SO creation and a same-SO amendment were
exercised against SQL Server 2019 with CDC disabled:

| Local contract | Kingdee version | Quantity × net price | Gross CNY | Result |
| --- | --- | --- | --- | --- |
| v1 | `000` | 10 × 2 | 22.60 | Application-created SO; later retained as SQL archive. |
| v2 | `001` | 12 × 3 | 40.68 | Formal source amendment imported as a new immutable contract. |
| v3 | `002` | 14 × 4 | 63.28 | Application amendment updated the same live SO and retained v2's SQL archive. |

The live `FInterID` remained `9002`; archive rows `9003` and `9004` retained the earlier terms,
and `ICOrderAlter` retained the amendment log. The original delivery and CNY 4.52 invoice kept
their original local IDs and v1 seal. Direct edits to sealed terms and lines were refused, while
operational Remarks remained editable. A later Kingdee closure reached v3's tracker while the
order was archived. Unarchiving retained all three versions and still refused sealed-term edits.
These are synthetic fixture results, not validation of a
customer's Kingdee customization or the Alibaba network path.
