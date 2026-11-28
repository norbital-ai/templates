# Portfolio Manager

![Portfolio Manager application](docs/screenshots/application.webp)

Portfolio Manager is a unified investment book and daily research workspace built for family offices, treasury committees, and private finance teams. Instead of reconciling monthly bank statements across disconnected spreadsheets, chasing currency conversions by hand, and manually scanning financial news every morning, the workspace brings every asset, cash account, and credit facility into one structured book and publishes a cited morning briefing automatically.

Each morning—or whenever a portfolio owner triggers a fresh run—a built-in research agent revalues listed securities at current market quotes, translates multi-currency balances and unquoted holdings into the portfolio's base currency, measures trading momentum and volume activity, reviews relevant market and position news, and compiles a clean, immutable daily report. Every analytical claim links directly to its source, unverified claims are excluded, and the finished briefing is delivered as a formatted PDF to subscribed stakeholders in the app and over their connected messaging channels.

## Expected Business Impact

- **Eliminate daily spreadsheet reconciliation:** Consolidate equities, funds, bonds, structured products, precious metals, cash accounts, and credit facilities into one multi-currency book that tracks net assets, allocation, currency exposure, and unrealised profit and loss consistently.
- **Cut morning preparation time:** Replace manual quote checks, foreign-exchange lookups, and headline scanning with an automated 08:00 briefing that summarises portfolio totals, benchmark moves, and position-level calls in a one-minute read.
- **Enforce research discipline and auditability:** Every commentary sentence in the daily briefing must cite a verified source, and every published daily report is locked against manual edits—creating a trustworthy historical record of what the team knew on each date.
- **Spot unusual market activity early:** Automatic trading signals highlight multi-period returns, trend direction, buying versus selling pressure, momentum, volatility, and sudden trading-volume surges (more than double the 20-session average) without requiring separate charting tools.
- **Keep stakeholders aligned without manual forwarding:** Principals and viewers can self-subscribe to receive the same formatted PDF briefing every morning inside the workspace or directly on WhatsApp, Telegram, Slack, or Discord.

## Roles & Access

The workspace separates book management from read-only oversight through two business roles plus a dedicated background research agent:

- **Portfolio Owners:** Manage the entire investment book—adding and updating holdings from bank statements, attaching supporting documents (statement pages, contract notes, confirmations), setting position-level research priorities and reference URLs, configuring the portfolio's base currency and benchmark indices, managing the subscriber roster, deleting obsolete reports, and triggering on-demand valuation and research runs. Even portfolio owners cannot edit a published daily report, preserving the integrity of the daily snapshot.
- **Portfolio Viewers:** Inspect the live dashboard, holdings book, and daily reports on a read-only basis. Viewers cannot modify positions, change settings, view other subscribers, or trigger research runs, but they can subscribe or unsubscribe themselves from daily report delivery directly from the Reports page.
- **Daily Research Agent (Automated):** Operates in the background with scoped authority to read holdings, settings, subscribers, and active messaging accounts, update calculated market metrics and daily profit-and-loss history on each position, and publish the day's report. It cannot add or delete holdings or change workspace settings.

## Apps & Functionality

The workspace centres on the **Portfolio** application, supported by the built-in **Norbius** workspace assistant for answering questions about the book and updating research focus on request.

| Page / Module               | Functionality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**               | Executive view of the latest daily snapshot: net assets and change since the prior report, invested capital, cash, liabilities, and unrealised P&L; net-asset trend line over recent reports; asset-class allocation and currency-exposure breakdowns (with the exchange rates used); position-by-position P&L bar chart; and a summary table of every position's value, weight, daily move, P&L, call (Buy, Sell, Hold, or Watch), and cited analysis.                                                                         |
| **Reports**                 | Chronological archive of immutable daily reports showing the report date, one-sentence lead, net assets, daily change, and market view. Includes a one-click **Subscribe / Unsubscribe** button so any authorised reader can opt in or out of daily delivery.                                                                                                                                                                                                                                                                   |
| **Daily Report View & PDF** | Client-ready reading layout for any single day's report: lead headline, executive bullets, net-asset trend chart, allocation and P&L charts, currency-exposure and exchange-rate table, benchmark and quoted-holdings market table, full positions summary, and cited per-position analyses (_What happened_, _Why it matters for the book_, _Call_). This exact layout is rendered to PDF for distribution.                                                                                                                    |
| **Holdings**                | Complete multi-currency ledger covering securities, funds, bonds, structured products, precious metals, cash accounts, and credit facilities (enforced as zero or negative values). Displays statement values alongside agent-calculated live values, multi-period returns, trend, buying/selling pressure, volume activity, and last-researched timestamp. Owners can add/edit lines, attach financial files, define custom reading sources and research directions, and click **Run the agent now** for an immediate refresh. |
| **Subscribers**             | Roster of stakeholders enrolled to receive the daily report and PDF, paired with a delivery-channel selector (`portfolio_settings.report_channel`) listing active Envoy-bound chat channels (WhatsApp, Telegram, Slack, or Discord) — letting owners pick one channel explicitly, auto-falling back only when a single connected Envoy channel exists, or showing in-app-only delivery when none is connected.                                                                                                                  |
| **Settings**                | Single-form workspace configuration for the portfolio's reporting base currency (defaults to USD) and the market benchmark indices (such as the S&P 500 or Straits Times Index) shown at the top of every daily report's Markets table (the delivery channel `report_channel` is selected on **Subscribers**).                                                                                                                                                                                                                  |
| **Norbius Assistant**       | Conversational assistant briefed on the workspace's investment rules: answers book and report questions using recorded figures and cited sources, refers to holdings by name or ticker, and can update research directions on specific positions before running a fresh report.                                                                                                                                                                                                                                                 |

## Automations & Connections

- **Daily Valuation, Research & Briefing Run:** Runs automatically every morning at 08:00 (workspace time zone) and can also be triggered on demand by portfolio owners—including an optional dry-run mode that refreshes the book and files the report without sending messages to subscribers.
- **Automated Market & FX Revaluation:** Pulls free, keyless foreign-exchange rates and 1-year daily market price/volume histories for quoted securities and benchmarks (including automatic handling of minor-unit exchange quotes such as London pence and cross-currency precious-metal quotes). Unquoted assets and deposits retain their latest statement snapshot plus accrued interest, revalued daily at current exchange rates.
- **Web Research & Source Verification:** Researches overall market developments and the largest portfolio positions via automated web browsing (with news-feed fallback for broader coverage) plus any investor-relations or filing URLs saved on individual holdings. Every generated paragraph is checked for inline source citations; any unsupported claim is discarded before publication.
- **PDF Distribution & Volume Alerts:** Renders the day's report to PDF and sends it to every subscriber's in-app inbox and through the selected Envoy chat channel (`portfolio_settings.report_channel` — WhatsApp, Telegram, Slack, or Discord; auto-selected only when a single connected Envoy channel exists, otherwise in-app only until chosen in **Subscribers**). Portfolio owners also receive a summary alert and dedicated notifications whenever any holding trades above twice its 20-session average volume.

## Scope & Boundaries

**Included out of the box:**

- Unified tracking of quoted and unquoted holdings, cash balances, accrued interest, and negative-value credit facilities in any reporting currency.
- Automated daily valuation, technical trading signals, 90-day per-position P&L tracking, cited research summaries, immutable daily reports, PDF generation, and multi-channel briefing delivery.
- Clear role separation between portfolio owners and read-only viewers with self-service report subscriptions.

**Outside the software boundary:**

- **Trade execution and brokerage routing:** The workspace records holdings and produces cited research calls, but does not place orders, connect to broker execution desks, or move cash.
- **Automated bank custody feeds:** Statement quantities, cost basis, accrued interest, and unquoted valuations are maintained from periodic bank statements and supporting documents rather than live custodian APIs.
- **Regulated investment advice and fiduciary sign-off:** AI-synthesised calls and summaries support human review and decision-making; investment approvals, suitability assessments, and fiduciary decisions remain the responsibility of the family office or licensed advisors.
- **Statutory accounting, tax, and real-time trading:** Realised tax-lot accounting, general-ledger entries, regulatory filings, and tick-by-tick intraday trading analytics sit outside this workspace.

## Documentation

- [Technical Documentation Index & Developer Quickstart](docs/README.md) — local setup, verification commands, workspace configuration, and migration/seed workflows.
- [System Architecture & Inner Mechanisms](docs/architecture.md) — deep technical walkthrough with ASCII diagrams covering runtime topology, data model ownership, valuation and FX formulas, technical signal calculations, research and citation gating, report rendering, and access control.
- [Source Reference](docs/source-reference.md) — complete inventory of models, fields, constraints, shared calculation modules, automation hooks, app pages, policies, teams, and localisation keys.
