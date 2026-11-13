# Portfolio Manager source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file
says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership; only the leaf folder names the model.

```text
holding/
portfolio_settings/
report/
report_subscription/
```

## Surfaces

- App: `portfolio` — `dashboard`, `reports`, `holdings`, `settings`
- Automation: `portfolio_agent` (daily, 08:00 in the workspace zone, `src/+workspace.ts` `tz`)
- Policies: `portfolio_manage`, `portfolio_read`, `portfolio_automation`
- Teams: `investors`, `portfolio_viewers`
- Shared modules: `src/lib/portfolio/book.ts` (the totals), `src/lib/portfolio/market.ts` (rate, quote
  and headline readers, browser research, sources and citations)
- Record view: `src/data/model/report/+representation.svelte` is the client-facing report; the PDF sent
  is this view rendered
- Custom fields, integrations: none; delivery uses a built-in chat account named by the settings row

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the tests.
`bolt build` writes `.norbital/` and the release artifact. Migrations under `migrations/` are
generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- Four models. Cash and facilities are `holding` lines; a facility's base value is never positive.
- Currency, delivery account, recipients and benchmarks are the `portfolio_settings` row; subscribers
  are `report_subscription` rows, one per user, each client's own: configuration, not code.
- Every claim in a report links its source (`cite` in `market.ts`); an uncited section is dropped.
- One report per day: a second run that day updates it.
- The agent asks the model for no host tool.
