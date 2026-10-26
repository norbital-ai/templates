# Jurisdiction trackers

One CSV per jurisdiction, `docs/inventory/<CODE>.csv` (`SG`, `MY`, `PH`, `ID`, `VN`, `TW`, `CN`, `JP`, `TH`), describing
the public seed configuration and its dated research baseline at `seed/jurisdiction/<CODE>/version_*/`.

Test names in `evidence` refer to the inventory's verification baseline. The jurisdiction suites were removed when
the test suite switched to synthetic mechanism fixtures, so these historical references do not describe current
automated country coverage. The trackers retain the configuration and audit evidence.

Columns: `id,area,provision,citation,url,status,config,evidence`.

- `id` — `<CODE>-<AREA>-<n>`, stable once written.
- `area` — `contribution`, `tax`, `leave`, `claim`, `adhoc`, `loan`, `allowance`, `work`, `obligation`,
  `settings`.
- `status` — `CONFIGURED` (seeded and checked at that research baseline), `SEEDED` (seeded, not checked there), `GAP` (the law
  applies and nothing is seeded), `OUT_OF_SCOPE` (deliberately not modelled; say why in `evidence`).
- `config` — the seed row it lives in, `<table>:<code>` (for example `statutory_contribution_catalog:CPF`).
- `evidence` — historical verification notes, sources, or the rationale for a gap or an out-of-scope decision;
  historical test names are provenance rather than requirements for the current mechanism suite.

One row per operative provision. A row that does not say where the provision is configured, or why it is not,
does not belong here.
