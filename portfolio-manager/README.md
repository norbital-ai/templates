# Portfolio Manager

A portfolio workspace for a family office or a finance team: every line of the book with the research
kept on it, and a daily report — totals, allocation, the rates used and one call per position —
written by one agent.

## Apps and roles

| App         | Pages                                  | Who                                                                      |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `portfolio` | Dashboard, Reports, Holdings, Settings | `investors` (`portfolio_manage`), `portfolio_viewers` (`portfolio_read`) |

- `portfolio_manage` reads and maintains the book, the reports and the settings, and may start the agent by hand.
- `portfolio_read` reads the book and the reports and changes nothing.
- `portfolio_automation` is what the agent holds: it reads the book, the settings and the account they name, and
  writes the research and the report.

## Data model

| Model                | Purpose                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `holding`            | One line of the book: a security, a fund, a cash balance (`cash`) or a facility (`loan`, negative value)                            |
| `report`             | One per day (`one_per_day`): totals, allocation, rates used, the market view, one call per position and the messages it was sent as |
| `portfolio_settings` | One row: the base currency, the paired account the report is sent through, and its recipients                                       |

Cash and facilities are holdings, so the totals add up without models of their own; the
`loan_is_owed` constraint keeps a facility's base value at zero or below. The agent's figures
(price now, value now, change today, volume against the 20-session average, P&L by date, research)
are fields on the holding marked _calculated_.

## Automations

`portfolio_agent` runs every morning at 08:00 in the workspace's zone, or by hand from Holdings. It
reads exchange rates and quotes from free, keyless sources over plain HTTP; searches the market and
the largest lines in its own browser tab (`ctx.browser`) and reads the _sources to read_ stored on
each line; files each line's P&L for the day; asks the model for the market view and one call per
position; files the day's report (a second run that day rewrites it); sends it as text to each
recipient in the settings through the account they name (`ctx.send`); and notifies `investors`
in-app, with a separate notice for a line trading at more than twice its usual volume. Without a
browser a line falls back to its news feed and a source to a plain read; a source or model that does
not answer leaves the run on the recorded values. Recipients with no active account to send through
refuse the run before it starts work. A run by hand may skip sending (`send: false`).

## Configuration

- **Base currency** — the `portfolio_settings` row's `base_currency` (USD without a row). Keep one
  row; two refuse the run.
- **Delivery** — create a shared WhatsApp, Telegram, Slack or Discord account under Settings →
  Connections and pair it, then name it in _Send through_ and list the _Recipients_ (a WhatsApp number
  or JID, a Telegram chat, a channel). The report keeps each queued message id in `deliveries`; the
  message's own status says whether it arrived.
- **Zone** — the platform's workspace zone, `tz` in `src/+workspace.ts` (America/New_York here): the
  cron and the report date follow it. It is the one setting that lives in source.

## Seed

Test rows only (`seed/test/holding.json`): a fictional book of one equity, one fund, a cash account
and a credit facility.

## Checks

```bash
bun install
bunx bolt check
bun run test
```

`tests/market.test.ts` covers the quote, rate and headline parsers and the totals;
`tests/research.test.ts` covers browser research over a fake browser and its fallback;
`tests/portfolio.test.ts` covers access, the refusals and the agent end to end with a scripted model,
including an SGD book sent through a fake paired WhatsApp account and its delivery report.
