# Portfolio Manager

A portfolio workspace for a family office or a finance team: every line of the book with the research
kept on it, and a daily report — totals, allocation, the rates used and one call per position —
written by one agent.

## Apps and roles

| App         | Pages                        | Who                                                                      |
| ----------- | ---------------------------- | ------------------------------------------------------------------------ |
| `portfolio` | Dashboard, Reports, Holdings | `investors` (`portfolio_manage`), `portfolio_viewers` (`portfolio_read`) |

- `portfolio_manage` reads and maintains the book and the reports and may start the agent by hand.
- `portfolio_read` reads both and changes nothing.
- `portfolio_automation` is what the agent holds: it reads the book and writes the research and the report.

## Data model

| Model     | Purpose                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `holding` | One line of the book: a security, a fund, a cash balance (`cash`) or a facility (`loan`, negative value) |
| `report`  | One per day (`one_per_day`): totals, allocation, rates used, the market view and one call per position   |

Cash and facilities are holdings, so the totals add up without models of their own; the
`loan_is_owed` constraint keeps a facility's base value at zero or below. The agent's figures
(price now, value now, change today, volume against the 20-session average, P&L by date, research)
are fields on the holding marked _calculated_.

## Automations

`portfolio_agent` runs every morning at 08:00 New York time, or by hand from Holdings. It reads
exchange rates, quotes and news headlines from free, keyless sources over plain HTTP, plus the
_sources to read_ stored on each line; files each line's P&L for the day; asks the model for the
market view and one call per position; files the day's report (a second run that day rewrites it);
and notifies `investors`, with a separate notice for a line trading at more than twice its usual
volume. A source or model that does not answer leaves the run on the recorded values.

The base currency is `USD` (`src/lib/metrics.ts` and `src/+workspace.ts`).

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
`tests/portfolio.test.ts` covers access, the two refusals and the agent end to end with a scripted model.
