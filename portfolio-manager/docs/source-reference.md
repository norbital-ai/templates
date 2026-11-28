# Portfolio Manager — Source Reference

Complete inventory of `templates/portfolio-manager` verified directly against `src/`, `seed/`,
`tests/`, `migrations/`, and workspace manifests.

---

## 1. Workspace & Template Manifest

### `norbital.template.json`

| Key                | Value                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `key`              | `norbital-portfolio-manager`                                                                                                         |
| `name` / `name_zh` | `Portfolio Manager` / `投资组合管理`                                                                                                 |
| `industry`         | `Finance`                                                                                                                            |
| `visibility`       | `public`                                                                                                                             |
| `counts`           | `models: 4`, `apps: 1`, `automations: 1`                                                                                             |
| `capabilities`     | `data_modeling`, `browser_automation`, `ai_classification`, `document_intelligence`, `channel_integrations`, `scheduled_automations` |
| `tags` / `tags_zh` | `Finance`, `Portfolio`, `Family office` / `财务`, `投资组合`, `家族办公室`                                                           |

### `src/+workspace.ts`

| Option      | Value              | Notes                                                                                    |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `tz`        | `'Asia/Singapore'` | Governs `portfolio_agent` cron timing, `ctx.today`, and report timestamps                |
| `locale`    | `'en-US'`          | Default formatting locale                                                                |
| `languages` | `['en', 'zh']`     | Backed by `src/i18n/+messages.ts` and `src/i18n/+zh.messages.ts`                         |
| `currency`  | `'USD'`            | Workspace currency default (`portfolio_settings.base_currency` overrides book valuation) |
| `apps`      | `['portfolio']`    | Single application                                                                       |
| `convert`   | `{ to: ['pdf'] }`  | Enables `ctx.convert.record('report', id, { to: 'pdf' })`                                |

Custom fields (`src/data/custom_field/`): **none**.
Custom integrations (`src/integration/`): **none** (uses built-in Envoy-deployed chat integrations).

---

## 2. Data Models (`src/data/model/`)

### 2.1 `holding` (`src/data/model/holding/+model.ts`)

- **Icon:** `lucide:trending-up`
- **Record label:** `record.instrument`
- **Constraint:** `loan_is_owed` — `CHECK (asset_class != 'loan' OR value_base <= 0)` (`errors.loan_is_owed`)
- **Index:** `find` — full-text search on `['instrument', 'symbol', 'detail', 'research_direction', 'research_summary']`
- **Output:** `default: { fields: 'all' }`
- **Verbs:** `create` (all 36 fields), `update` (all 36 fields), `delete`

#### Statement & User-Authored Fields (17)

| Field                | Kind & Parameters                                                                                          | Optional | Default    | Notes                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------ |
| `instrument`         | `text`                                                                                                     | No       | —          | Instrument / account / facility display name                                   |
| `symbol`             | `text`                                                                                                     | Yes      | —          | Exchange-suffixed (`AAPL`, `0700.HK`) or Bloomberg-style (`AAPL UW`, `700 HK`) |
| `isin`               | `text`                                                                                                     | Yes      | —          | International Securities Identification Number                                 |
| `asset_class`        | `enum` (`equity`, `structured`, `fund`, `bond`, `metal`, `cash`, `loan`, `other`)                          | No       | `'equity'` | `cash` and `loan` are excluded from `isPosition()`                             |
| `currency`           | `currency` (ISO 4217 3-letter)                                                                             | No       | —          | Line denomination currency                                                     |
| `quantity`           | `decimal`, `scale: 4`                                                                                      | No       | `1`        | Share / unit / ounce count                                                     |
| `cost_value`         | `decimal`, `scale: 2`                                                                                      | Yes      | —          | Historical cost in line currency                                               |
| `market_value`       | `decimal`, `scale: 2`                                                                                      | No       | `0`        | Statement market value in line currency                                        |
| `value_base`         | `decimal`, `scale: 2`                                                                                      | No       | —          | Statement value in base currency (`<= 0` when `asset_class = 'loan'`)          |
| `unrealised_pl`      | `decimal`, `scale: 2`                                                                                      | Yes      | —          | Statement unrealised P&L in line currency                                      |
| `accrued_interest`   | `decimal`, `scale: 2`                                                                                      | Yes      | —          | Accrued unpaid interest in line currency; added to `lineValue`                 |
| `risk_rating`        | `int`, `min: 1`, `max: 5`                                                                                  | Yes      | —          | Internal 1–5 risk score                                                        |
| `price_date`         | `date`                                                                                                     | Yes      | —          | Date of the statement snapshot (`YYYY-MM-DD`)                                  |
| `detail`             | `text`                                                                                                     | Yes      | —          | Terms / instrument notes                                                       |
| `documents`          | `file`, `many: true`, `max: '32MiB'`, `accept: ['application/pdf', 'image/png', 'image/jpeg', 'text/csv']` | Yes      | —          | Supporting statements, contract notes, confirmations                           |
| `sources`            | `object[]`, `key: 'url'`: `{ label: text, url: text }`                                                     | Yes      | —          | Custom URLs fetched every run via `readPage()`                                 |
| `research_direction` | `text`                                                                                                     | Yes      | —          | Thesis, catalysts, risks, or peers passed into LLM prompt                      |

#### Agent-Calculated Fields (19)

| Field              | Kind & Parameters                                                                  | Optional | Notes                                                                      |
| ------------------ | ---------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `live_price`       | `decimal`, `scale: 4`                                                              | Yes      | Latest major-unit market price (minor currencies divided by 100)           |
| `live_value_base`  | `decimal`, `scale: 2`                                                              | Yes      | Live valuation in base currency (including accrued interest)               |
| `live_change_pct`  | `decimal`, `scale: 2`                                                              | Yes      | 1-day percentage move vs `previousClose` / prior close                     |
| `price_updated_at` | `instant`                                                                          | Yes      | Timestamp of last live price update (`ctx.now`)                            |
| `volume_ratio`     | `decimal`, `scale: 2`                                                              | Yes      | Last complete session volume ÷ prior 20-session mean                       |
| `movement`         | `enum` (`surge`, `active`, `normal`, `quiet`)                                      | Yes      | Volume tier from `movementOf(volume_ratio)`                                |
| `change_1w_pct`    | `decimal`, `scale: 2`                                                              | Yes      | Return vs 5 sessions prior (`closes.at(-6)`)                               |
| `change_1m_pct`    | `decimal`, `scale: 2`                                                              | Yes      | Return vs 21 sessions prior (`closes.at(-22)`)                             |
| `change_1y_pct`    | `decimal`, `scale: 2`                                                              | Yes      | Return vs earliest bar (`closes[0]`, requires >= 200 closes)               |
| `trend`            | `enum` (`up`, `sideways`, `down`)                                                  | Yes      | Price & SMA50 vs SMA200 (requires >= 200 closes)                           |
| `money_flow`       | `decimal`, `scale: 2`                                                              | Yes      | 20-session Chaikin Money Flow (`-1` to `1`, requires >= 10 valid bars)     |
| `pressure`         | `enum` (`buying`, `balanced`, `selling`)                                           | Yes      | `> 0.05` buying, `< -0.05` selling, else balanced                          |
| `rsi`              | `decimal`, `scale: 2`                                                              | Yes      | 14-session Wilder RSI (`0` to `100`)                                       |
| `from_high_pct`    | `decimal`, `scale: 2`                                                              | Yes      | Percentage distance from 252-bar high (requires >= 200 closes)             |
| `volatility_pct`   | `decimal`, `scale: 2`                                                              | Yes      | Annualised sample std dev of up to 63 daily log returns                    |
| `pnl_history`      | `object[]`, `key: 'date'`: `{ date: date, pnl: decimal(2), pnl_pct?: decimal(2) }` | Yes      | Rolling 90-day (`PNL_DAYS = 90`) base-currency P&L history                 |
| `research_summary` | `text`, `format: 'markdown'`                                                       | Yes      | Latest cited position analysis (`What happened`, `Why it matters`, `Call`) |
| `research_at`      | `instant`                                                                          | Yes      | Timestamp of last news/source read (`ctx.now`)                             |
| `insights`         | `object[]`, `key: 'url'`: `{ headline: text, source_name?: text, url: text }`      | Yes      | Top 6 read headlines/pages (`headline` clipped to 300 chars)               |

---

### 2.2 `report` (`src/data/model/report/+model.ts`)

- **Icon:** `lucide:newspaper`
- **Record label:** `'Portfolio report · ' + string(record.for_date)`
- **Constraint:** `one_per_day` — `UNIQUE (for_date)` (`errors.report_exists`)
- **Index:** `find` — full-text search on `['headline', 'summary', 'market_view']`
- **Output:** `default: { fields: 'all' }`
- **Verbs:** `create` (all 18 fields), `update` (all 18 fields), `delete`
- **Record representation:** `src/data/model/report/+representation.svelte`

| Field           | Kind & Parameters                                                                                                                                      | Optional | Notes                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `for_date`      | `date`                                                                                                                                                 | No       | Workspace-timezone date (`ctx.today`)                                                                                   |
| `base_currency` | `currency`                                                                                                                                             | No       | Reporting currency used on the run                                                                                      |
| `headline`      | `text`, `format: 'markdown'`                                                                                                                           | No       | One-sentence cited lead (or deterministic totals fallback)                                                              |
| `summary`       | `text`, `format: 'markdown'`                                                                                                                           | No       | Deterministic bullet list (`- Markets: ...` + top 3 cited section headlines)                                            |
| `markets`       | `object[]`, `key: 'instrument'`: `{ instrument, level(dec:2), change_pct?, change_1w_pct?, change_1m_pct?, change_1y_pct?, trend?, pressure? }`        | Yes      | Configured benchmarks followed by every quoted holding                                                                  |
| `market_view`   | `text`, `format: 'markdown'`                                                                                                                           | Yes      | Provenance `dataLine` + optional cited market paragraph                                                                 |
| `research_log`  | `text`                                                                                                                                                 | Yes      | Run transcript joined by `\n`, capped at 8,000 chars                                                                    |
| `net_assets`    | `decimal`, `scale: 2`                                                                                                                                  | No       | `total_assets - liabilities`                                                                                            |
| `invested`      | `decimal`, `scale: 2`                                                                                                                                  | No       | Sum of non-cash, non-loan holdings in base currency                                                                     |
| `cash`          | `decimal`, `scale: 2`                                                                                                                                  | No       | Sum of `cash` holdings in base currency                                                                                 |
| `liabilities`   | `decimal`, `scale: 2`                                                                                                                                  | No       | Positive magnitude of `loan` holdings (`-sum(loan.value)`)                                                              |
| `unrealised_pl` | `decimal`, `scale: 2`                                                                                                                                  | Yes      | Aggregate unrealised P&L across positions in base currency                                                              |
| `day_change`    | `decimal`, `scale: 2`                                                                                                                                  | Yes      | `net_assets - previous_report.net_assets` (`null` on first report)                                                      |
| `allocation`    | `object[]`, `key: 'label'`: `{ label, value(dec:2), weight(dec:2) }`                                                                                   | Yes      | Asset-class breakdown (including `cash`, excluding `loan`), sorted desc by `value`                                      |
| `exposure`      | `object[]`, `key: 'currency'`: `{ currency, value(dec:2), weight(dec:2) }`                                                                             | Yes      | Currency breakdown (excluding `loan`), sorted desc by `value`                                                           |
| `fx_used`       | `object[]`, `key: 'pair'`: `{ pair, rate(dec:6) }`                                                                                                     | Yes      | `{CCY}/{BASE}` rates used to value foreign holdings or foreign quotes                                                   |
| `positions`     | `object[]`, `key: 'instrument'`: `{ instrument, symbol?, value?, weight?, change_pct?, call?, headline?, pnl?, pnl_pct?, analysis?(md), confidence? }` | Yes      | Every position's quantitative metrics; `call`/`headline`/`analysis`/`confidence` present only when citation gate passed |
| `sources`       | `object[]`, `key: 'url'`: `{ title, publisher, url(format: 'url'), at(instant) }`                                                                      | Yes      | Deduplicated set of all sources cited in `positions`, `headline`, and `market_view`                                     |

---

### 2.3 `portfolio_settings` (`src/data/model/portfolio_settings/+model.ts`)

- **Icon:** `lucide:settings`
- **Record label:** `'Portfolio settings'`
- **Output:** `default: { fields: 'all' }`
- **Verbs:** `create` (`base_currency`, `benchmarks`, `report_channel`), `update` (`base_currency`, `benchmarks`, `report_channel`), `delete`

| Field            | Kind & Parameters                                            | Optional | Notes                                                                                                 |
| ---------------- | ------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `base_currency`  | `currency`                                                   | No       | Reporting currency for book valuation (defaults to `USD` if no row exists)                            |
| `benchmarks`     | `object[]`, `key: 'symbol'`: `{ name?: text, symbol: text }` | Yes      | Market index quote symbols leading `report.markets` (e.g., `^GSPC`, `^STI`)                           |
| `report_channel` | `ref` -> `sys_integration` (`ON DELETE SET NULL`)            | Yes      | Explicit Envoy-bound chat channel for daily PDF delivery (selected via `Combobox` on **Subscribers**) |

---

### 2.4 `report_subscription` (`src/data/model/report_subscription/+model.ts`)

- **Icon:** `lucide:bell`
- **Record label:** `record.user.name`
- **Constraint:** `one_per_user` — `UNIQUE (user)` (`errors.already_subscribed`)
- **Output:** `default: { fields: 'all', user: { fields: ['name'] } }`
- **Verbs:** `create` (`user`), `delete` (no `update`)

| Field  | Kind & Parameters                          | Optional | Default               | Notes                                        |
| ------ | ------------------------------------------ | -------- | --------------------- | -------------------------------------------- |
| `user` | `ref` -> `sys_user` (`ON DELETE RESTRICT`) | No       | `{ var: 'actor.id' }` | Subscribed user receiving daily report + PDF |

---

## 3. Shared Domain Libraries (`src/lib/portfolio/`)

### 3.1 `src/lib/portfolio/book.ts`

| Export                          | Kind     | Purpose                                                                                                                                                                                         |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Statement`                     | Type     | Subset of `holding` fields required for valuation (`currency`, `quantity`, `value_base`, `market_value`, `cost_value`, `accrued_interest`, `price_date`, `live_value_base`, `price_updated_at`) |
| `RateOf`                        | Type     | `(currency: string) => number \| undefined` returning base per unit of foreign currency                                                                                                         |
| `BookLine`                      | Type     | `{ asset_class, currency, value: BigDecimal, unrealised_pl: BigDecimal }`                                                                                                                       |
| `Metrics`                       | Type     | `{ total_assets, invested, cash, liabilities, net_assets, unrealised_pl, allocation, exposure }`                                                                                                |
| `lineValue(row, quote, rateOf)` | Function | 3-tier base-currency valuation (live quote + FX -> fresher cached `live_value_base` -> statement revalued at run FX), always including `accrued_interest`                                       |
| `costInBase(row)`               | Function | Local `cost_value` converted at implicit `statementRate = value_base / market_value`                                                                                                            |
| `isPosition(row)`               | Function | `row.asset_class !== 'cash' && row.asset_class !== 'loan'`                                                                                                                                      |
| `computeMetrics(rows)`          | Function | Exact `BigDecimal` totals (`scale: 2`, `half-from-zero`), asset-class `allocation`, and currency `exposure`                                                                                     |

### 3.2 `src/lib/portfolio/market.ts`

| Export                                                     | Kind      | Purpose                                                                                                                                                               |
| ---------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATES_URL(base)`                                          | Function  | `https://open.er-api.com/v6/latest/${base}`                                                                                                                           |
| `QUOTE_URL(ticker)`                                        | Function  | `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`                                                                |
| `NEWS_URL(query)`                                          | Function  | `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:7d')}&hl=en-US&gl=US&ceid=US:en`                                                            |
| `QUOTE_SOURCE`, `RATES_SOURCE`                             | Constants | Canonical `Source` objects for Yahoo Finance and ExchangeRate-API                                                                                                     |
| `Source`, `Signals`, `Quote`, `Headline`, `Read`, `Reader` | Types     | Market, signal, citation, and reader interfaces                                                                                                                       |
| `sourceOf(read)`                                           | Function  | Maps a `Read` page to `{ title, publisher (stripped host), url }`                                                                                                     |
| `numbered(sources)`                                        | Function  | Formats `[1] Publisher: Title` list for LLM prompts                                                                                                                   |
| `cite(text, sources)`                                      | Function  | Validates every non-empty paragraph has valid `[n]` citation(s); converts `[n]` -> `[publisher](url)` or returns `null`                                               |
| `unlinked(text)`                                           | Function  | Strips Markdown links `[label](url)` -> `label` for plain-text chat messages                                                                                          |
| `parseRates(payload, base)`                                | Function  | Schema-decodes ExchangeRate-API JSON and inverts positive rates (`1 / quoted`), setting `base -> 1`                                                                   |
| `quoteSymbol(symbol)`                                      | Function  | Normalizes tickers (`HK` -> 4-digit `.HK`, `SP` -> `.SI`, `LN` -> `.L`, `U[ANPQRSW]` -> bare ticker, unknown exchange -> `null`)                                      |
| `signalsOf(price, bars)`                                   | Function  | Computes 9 technical indicators from daily bars (`1w/1m/1y`, `trend`, `money_flow`, `pressure`, `rsi`, `from_high_pct`, `volatility_pct`)                             |
| `parseQuote(payload)`                                      | Function  | Schema-decodes Yahoo v8 chart JSON, runs `signalsOf` on raw scale, scales minor currencies (`GBp`, `GBX`, `ZAc`, `ILA` ÷ 100), computes `change_pct` & `volume_ratio` |
| `movementOf(ratio)`                                        | Function  | Classifies volume ratio: `>= 2` `surge`, `>= 1.3` `active`, `<= 0.5` `quiet`, else `normal`                                                                           |
| `parseHeadlines(payload, limit=4)`                         | Function  | Extracts RSS `<item>` titles/links, decodes HTML entities, filters quote/chart boilerplate                                                                            |
| `readPage(reader, url)`                                    | Effect    | Reads readable text via `browser.navigate(url)` with fallback to `web.read(url)`, collapsed and clipped to 1,800 chars                                                |
| `search(reader, query, keep, log)`                         | Effect    | Searches Bing -> DuckDuckGo -> Mojeek in browser, extracts `keep` result links, reads pages via `readPage`                                                            |

---

## 4. Automation (`src/automation/+portfolio_agent.automation.ts`)

| Property                 | Value                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identifier               | `portfolio_agent`                                                                                                                                            |
| Triggers                 | `on: [{ cron: '0 8 * * *', rest: '7d' }]` (in workspace `tz`), plus manual `ctx.run('portfolio_agent', { send? })`                                           |
| Input schema             | `{ send: { kind: 'bool', optional: true, default: true } }`                                                                                                  |
| Policies                 | `['portfolio_automation']`                                                                                                                                   |
| Internal constants       | `PNL_DAYS = 90`, `RESEARCHED = 6`, `DEFAULT_CURRENCY = 'USD'`                                                                                                |
| Refusal error keys       | `errors.settings_ambiguous`, `errors.report_not_filed`                                                                                                       |
| Notification `once` keys | `report-sent-${ctx.today}` (subscribers + PDF), `report-${ctx.today}` (investors summary), `movement-${line.id}-${ctx.today}` (investors volume surge alert) |

---

## 5. Application, Pages & Record Views

### `src/app/portfolio/+app.ts`

- **App ID:** `portfolio` (`lucide:briefcase`, banner `assets/app-media/portfolio-banner.svg`)
- **Pages:** `dashboard`, `reports`, `holdings`, `subscribers`, `settings`

| File                                           | Queries                                                                                                                                      | Key UI Elements & Actions                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/portfolio/+dashboard.page.svelte`     | `report` (desc, limit 90), `holding` (`instrument`, `symbol`, `asset_class`, `pnl_history`, limit 200)                                       | Net assets KPI card + `day_change` + 4 sub-metrics (`invested`, `cash`, `owed`, `unrealised`); 3-series trend line chart (`net_assets`, `invested`, `cash`); stacked Allocation & Currencies bars (annotated with `fx_used`); horizontal P&L bar chart; embedded Positions & Calls table (`call` badges, directional `change_pct`, clamped Markdown `analysis`). |
| `src/app/portfolio/+reports.page.svelte`       | `report_subscription` (`where user = actor.id`, limit 1); `Table` over `report` (`for_date` desc)                                            | Columns: `for_date`, `headline`, `net_assets`, `day_change`, `market_view`. `new: false`. Header action toggles user's own `report_subscription` (`create({})` / `delete`).                                                                                                                                                                                      |
| `src/app/portfolio/+holdings.page.svelte`      | `portfolio_settings` (`base_currency`, limit 1); `Table` over `holding` (`value_base` desc)                                                  | Columns: `instrument`, `symbol`, `asset_class`, `quantity`, `value_base`, `live_value_base`, `live_change_pct`, `change_1m_pct`, `trend`, `pressure`, `movement`, `research_at`. Toolbar includes `new: true` and **"Run the agent now"** action (`ctx.run('portfolio_agent', {})`).                                                                             |
| `src/app/portfolio/+subscribers.page.svelte`   | `portfolio_settings`, active `sys_envoy`, active `sys_envoy_channel`, active workspace `sys_integration`; `Table` over `report_subscription` | Top delivery bar with `<Combobox>` selecting `portfolio_settings.report_channel` across Envoy-bound chat channels (`__auto__` auto-selects when a single connected channel exists, or warns when unpaired/ambiguous). Table shows `user` column with `new: true`.                                                                                                |
| `src/app/portfolio/+settings.page.svelte`      | `portfolio_settings` (limit 1)                                                                                                               | Renders `RecordShell` in `create` mode (if 0 rows) or edit mode (if 1 row) over `['base_currency', 'benchmarks']`.                                                                                                                                                                                                                                               |
| `src/data/model/report/+representation.svelte` | `report` (`for_date <= record.for_date`, desc, limit 30)                                                                                     | Locked `RecordShell` (`component.report_locked`). Renders headline, summary, 3 charts (30-report trend, allocation, P&L), Markdown tables (currencies + FX, markets, positions), and per-position cited sections. Dual-used for interactive display and PDF print (`?record=report/<id>&print`).                                                                 |

---

## 6. Access Control (`src/access_control/`)

### Teams (`seed/public/sys_team.json`)

Teams are `sys_team` rows an administrator edits; these are the seeded ones.

| Team Id             | Name                | Policies               |
| ------------------- | ------------------- | ---------------------- |
| `investors`         | `Portfolio owners`  | `['portfolio_manage']` |
| `portfolio_viewers` | `Portfolio viewers` | `['portfolio_read']`   |

### Policies (`src/access_control/policy/`)

| Policy File                       | Capabilities                                              | Grants                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+portfolio_manage.policy.ts`     | `apps: ['portfolio']`, `automations: ['portfolio_agent']` | `holding` (R/C/U/D), `report` (R/D only), `portfolio_settings` (R/C/U/D), `report_subscription` (R/C/D), `sys_integration` (R), `sys_envoy` (R), `sys_envoy_channel` (R), `sys_user` (R) |
| `+portfolio_read.policy.ts`       | `apps: ['portfolio']`                                     | `holding` (R), `report` (R), `report_subscription` (R where `user == actor.id`; C/D with member verdict refusing `errors.own_subscription` on non-self rows)                             |
| `+portfolio_automation.policy.ts` | None (system identity)                                    | `holding` (R/U), `report` (R/C/U), `portfolio_settings` (R), `report_subscription` (R), `sys_integration` (R), `sys_envoy` (R), `sys_envoy_channel` (R)                                  |

---

## 7. Agent Briefs, Localisation, Seeds, Tests & Migrations

| Area               | Files                                                                                                                    | Notes                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent instructions | `src/agent/+agent.md`, `src/agent/AGENTS.md`                                                                             | Norbius domain rules & writing style (6 citation/clarity rules); coding-agent source map & invariants                                                                                                                                                       |
| Localisation       | `src/i18n/+messages.ts`, `src/i18n/+zh.messages.ts`                                                                      | Full English and Simplified Chinese labels, help text, component copy, and all 6 error keys (`errors.settings_ambiguous`, `errors.report_not_filed`, `errors.own_subscription`, `errors.already_subscribed`, `errors.loan_is_owed`, `errors.report_exists`) |
| Seeds              | `seed/+seeder.ts`, `seed/public/sys_team.json`, `seed/test/holding.json`                                                 | Optional external demo seeder (`tree: 'portfolio-manager'`); the two starting teams; 4-line synthetic test fixture for `bolt test`                                                                                                                          |
| Tests              | `tests/market.test.ts`, `tests/research.test.ts`, `tests/portfolio.test.ts`                                              | Pure math/parsing unit tests, Effect browser/fallback tests, and full PGlite `TestWorkspace` integration tests                                                                                                                                              |
| Migrations         | `migrations/0001_initial.sql`, `snapshot.json`, `migrations.lock.json`, `physical.json`                                  | Rebased initial SQL migration capturing the 4 domain models, constraints, search indexes, and platform tables                                                                                                                                               |
| Static assets      | `assets/app-media/portfolio-banner.svg`, `docs/screenshots/application.webp`, `docs/screenshots/workspace-overview.webp` | App card banner and verified workspace/application screenshots                                                                                                                                                                                              |
