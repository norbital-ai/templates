# Portfolio Manager source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file
says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership; only the leaf folder names the model.

```text
holding/
report/
```

## Surfaces

- App: `portfolio` — `dashboard`, `reports`, `holdings`
- Automation: `portfolio_agent` (daily, 08:00 America/New_York)
- Policies: `portfolio_manage`, `portfolio_read`, `portfolio_automation`
- Teams: `investors`, `portfolio_viewers`
- Shared modules: `src/lib/metrics.ts` (the totals), `src/lib/market.ts` (rate, quote and headline readers)
- Custom fields, integrations: none

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the tests.
`bolt build` writes `.norbital/` and the release artifact. Migrations under `migrations/` are
generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- Two models. Cash and facilities are `holding` lines; a facility's base value is never positive.
- One report per day: a second run that day updates it.
- The agent asks the model for no host tool.
