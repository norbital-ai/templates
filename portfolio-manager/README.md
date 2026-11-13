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

| Model                 | Purpose                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `holding`             | One line of the book: a security, a fund, a cash balance (`cash`) or a facility (`loan`, negative value)                                                                            |
| `report`              | One per day (`one_per_day`): the lead, what is in it, the markets table and the move, one section per line with cited news, the sources, the totals and the messages it was sent as |
| `portfolio_settings`  | One row: the base currency, the benchmarks, the paired account the report is sent through, and the chats it goes to                                                                 |
| `report_subscription` | One per subscribed user (`one_per_user`): a client subscribes and unsubscribes themselves from Reports; owners manage all under Settings                                            |

Cash and facilities are holdings, so the totals add up without models of their own; the
`loan_is_owed` constraint keeps a facility's base value at zero or below. The agent's figures
(price now, value now, change today, volume against the 20-session average, P&L by date, research)
are fields on the holding marked _calculated_.

## Automations

`portfolio_agent` runs every morning at 08:00 in the workspace's zone, or by hand from Holdings. It
reads exchange rates and quotes from free, keyless sources over plain HTTP; searches the market and
the largest lines in its own browser tab (`ctx.browser`) and reads the _sources to read_ stored on
each line; files each line's P&L for the day; asks the model for a section on each line it read
something on and for the lead and the market paragraph; files the day's report (a second run that day rewrites it); renders the report's own record
view to PDF (`ctx.convert.record`, never stored) and sends it with a short summary to each chat in the
settings (`ctx.send`) and directly to each `report_subscription` user (a notice `via` the account, to the user's
own number or Telegram); and notifies `investors` in-app, with a separate notice for a line trading at
more than twice its usual volume. Without a browser a line falls back to its news feed and a source to a plain read; a source or model that does
not answer leaves the run on the recorded values. Recipients with no active account to send through
refuse the run before it starts work; subscribers without one are logged as not sent, so a client's own
subscription never stops the run. A run by hand may skip sending (`send: false`).

### The report

The report's record view (`src/data/model/report/+representation.svelte`) is what a client reads and
what the PDF shows, in this order: the date and a one-sentence lead; _In today's report_ in two to four
bullets; the markets table (every benchmark and every line of the book: level, change, ▲/▼) with a
_data as of_ line naming the providers and one paragraph on the move; then one section per line with
cited news, with _What happened_, _Why it matters for the book_ and _Call_. The model writes to six
numbered rules (plain words, no hype or filler, units and dates, every claim cited, cut what does not
change a decision, invent nothing). It cites a numbered source as `[n]`; `cite` in
`src/lib/portfolio/market.ts` turns each into a link with the publisher as its text and drops any
section or lead whose paragraph cites nothing (a lead falls back to the book's totals, cited to the
quote provider). Market figures cite the data provider. Every cited source is kept in `sources`.

## Configuration

- **Base currency** — the `portfolio_settings` row's `base_currency` (USD without a row). Keep one
  row; two refuse the run.
- **Delivery** — create a shared WhatsApp, Telegram, Slack or Discord account under Settings →
  Connections and pair it, then name it in _Send through_, list the _Recipients_ (a WhatsApp number
  or group JID, a Telegram chat or group, a Slack or Discord channel); subscribers get it
  directly at their own chat on the account (WhatsApp at their profile phone, Telegram at their linked
  Telegram). Clients subscribe themselves from Reports; owners add or remove anyone under Settings. The report keeps each
  chat message id in `deliveries`; the message's own status says whether it arrived.
- **Benchmarks** — the indices the markets table leads with, by quote symbol (`^GSPC`, `^STI`).
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

`tests/market.test.ts` covers the quote, rate and headline parsers, the citations and the totals;
`tests/research.test.ts` covers browser research over a fake browser and its fallback;
`tests/portfolio.test.ts` covers access, the refusals and the agent end to end with a scripted model
(a cited section kept as links, an uncited one dropped), including an SGD book whose rendered view goes to a number, a group and a subscriber through a fake paired
WhatsApp account, and its delivery report.
