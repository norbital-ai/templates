# Jurisdiction trackers

One CSV per jurisdiction, `docs/inventory/<CODE>.csv` (`SG`, `MY`, `PH`, `ID`, `VN`, `TW`, `CN`, `JP`, `TH`), describing
what the public seed at `seed/jurisdiction/<CODE>/version_*/` configures today. The earlier obligation
registers and capability ledger were deleted on 2026-10-06; they tracked purged models and are not restored.

Columns: `id,area,provision,citation,url,status,config,evidence`.

- `id` — `<CODE>-<AREA>-<n>`, stable once written.
- `area` — `contribution`, `tax`, `leave`, `claim`, `adhoc`, `loan`, `allowance`, `work`, `obligation`,
  `settings`.
- `status` — `CONFIGURED` (seeded and asserted by a test), `SEEDED` (seeded, not asserted), `GAP` (the law
  applies and nothing is seeded), `OUT_OF_SCOPE` (deliberately not modelled; say why in `evidence`).
- `config` — the seed row it lives in, `<table>:<code>` (for example `statutory_contribution_catalog:CPF`).
- `evidence` — the test name that asserts it, or the reason for a gap.

One row per operative provision. A row that does not say where the provision is configured, or why it is not,
does not belong here.
