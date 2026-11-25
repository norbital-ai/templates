# Portfolio Manager

![Portfolio Manager application](docs/screenshots/application.webp)

A portfolio tracking and daily research workspace for a family office or finance team. Maintain every
position — equities, funds, cash balances and credit facilities — alongside live market quotes,
technical signals and thesis notes, while a scheduled agent publishes one cited daily report with totals,
allocation, FX exposure and a decision call for every holding.

## Key capabilities

- **Unified multi-currency book:** Track securities, funds, cash balances and credit facilities (`loan`,
  enforced ≤ 0 by `loan_is_owed`) in one `holding` table. Revalue quoted holdings at live quotes and FX
  rates (handling London pence and precious-metal futures) and unquoted lines from their latest bank
  statement snapshot plus accrued interest.
- **Automated technical signals:** Compute 1-week, 1-month and 1-year returns, 50/200-session trend,
  20-session Chaikin money flow (buying vs selling pressure), 14-session RSI, distance from 52-week high,
  and annualised 63-session volatility directly from daily bars.
- **Cited daily agent report:** Every morning at 08:00 (or on demand), `portfolio_agent` fetches keyless
  quotes and FX rates, browses market and top-holding news (`ctx.browser` with feed fallback), drafts a
  concise call per position with strict source citations (dropping uncited claims), and records the day's
  immutable snapshot.
- **In-app & chat PDF delivery:** Renders each report's record view to PDF on demand (`ctx.convert.record`)
  and delivers it to subscribed users in-app and across every paired Envoy chat channel (WhatsApp,
  Telegram, Slack or Discord), plus unusual-volume alerts (> 2× 20-session average) to investors.

## Apps and roles

| App           | Pages                                               | Audience                                                                 |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| **Portfolio** | Dashboard, Reports, Holdings, Subscribers, Settings | `investors` (`portfolio_manage`), `portfolio_viewers` (`portfolio_read`) |

- **`portfolio_manage`** maintains holdings, settings and subscriber lists, deletes outdated reports, and
  triggers manual agent runs (optionally with `send: false`).
- **`portfolio_read`** inspects the book and daily reports read-only; clients manage their own report
  subscription from **Reports**.
- **`portfolio_automation`** grants the daily agent read access to the book, settings, subscribers and
  active Envoy channels, and write access to calculated metrics and reports.

## Data model

4 models:

- `holding` — securities, funds, `cash` balances and negative-value `loan` facilities, holding statement
  cost/quantity/accrued interest, user-supplied `sources to read`, and agent-calculated prices, signals
  and research.
- `report` — one daily snapshot (`one_per_day`) storing lead, executive bullets, markets table, book
  totals, currency `exposure`, `fx_used`, per-position calls and cited `sources`.
- `portfolio_settings` — single row configuring `base_currency` (defaults to `USD`) and benchmark quote
  symbols (e.g. `^GSPC`, `^STI`).
- `report_subscription` — one row per subscribed user (`one_per_user`) controlling daily PDF delivery.

## Automations and integrations

| Automation        | Trigger                 | Purpose                                                                                                           |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `portfolio_agent` | Daily 08:00; manual run | Fetches quotes/FX, computes signals, researches news, publishes the cited daily report, renders PDF and sends DMs |

Delivery uses Bolt's built-in chat integrations (`whatsapp`, `telegram`, `slack`, `discord`) deployed with
an Envoy under **Settings → Integrations → Envoys**; without an Envoy, reports deliver in-app only.

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

A fresh workspace starts empty (`seed/test/` contains a synthetic 4-line test book only). Configure base
currency and benchmarks in **Portfolio → Settings** and workspace timezone (`tz`) in `src/+workspace.ts`.
