# Portfolio Manager — System Architecture & Inner Mechanisms

This document details the runtime architecture, data ownership, valuation and signal engines, daily
agent orchestration, citation verification gate, dual screen/PDF rendering path, and access-control
enforcement implemented in `templates/portfolio-manager/src/`.

---

## 1. System Topology & Runtime Architecture

Portfolio Manager is a single-app, four-model, single-automation Bolt workspace (`src/+workspace.ts`).
It declares no custom fields and no custom integration definitions: external market data is read over
keyless public HTTP and headless browser facilities, and outbound chat delivery reuses Bolt's built-in
Envoy-deployed channel accounts (`whatsapp`, `telegram`, `slack`, `discord`).

```text
+--------------------------------------------------------------------------------------------+
|                                PRESENTATION & AGENT SURFACES                               |
|                                                                                            |
|  +----------------------------------------------------+   +-----------------------------+  |
|  | Portfolio App (src/app/portfolio/+app.ts)          |   | Norbius Assistant           |  |
|  |  - dashboard    (KPIs, 90d trend, bars, calls)     |   |  src/agent/+agent.md        |  |
|  |  - reports      (archive + self-subscribe toggle)  |   |  - Answers from holding &   |  |
|  |  - holdings     (book table + "Run the agent now") |   |    latest report            |  |
|  |  - subscribers  (roster + active Envoy banner)     |   |  - Edits research_direction |  |
|  |  - settings     (base_currency & benchmarks form)  |   |  - Starts portfolio_agent   |  |
|  +-------------------------+--------------------------+   +--------------+--------------+  |
|                            |                                             |                 |
|  +-------------------------v--------------------------+                  |                 |
|  | Report Record View (+representation.svelte)        |                  |                 |
|  |  - Interactive read-only view (RecordShell locked) |                  |                 |
|  |  - Print target: ?record=report/<id>&print         |                  |                 |
|  +-------------------------+--------------------------+                  |                 |
+----------------------------|---------------------------------------------|-----------------+
                             | PageBolt ctx.query / ctx.act / ctx.run      |
                             v                                             v
+--------------------------------------------------------------------------------------------+
|                                   BOLT HOST & ENGINE LAYER                                 |
|                                                                                            |
|  +------------------------+  +------------------------+  +------------------------------+  |
|  | Policy & Constraint    |  | Automation Runtime     |  | Host Facilities              |  |
|  | Guard                  |  | portfolio_agent        |  |  - ctx.web.read (HTTP/RSS)   |  |
|  |  - portfolio_manage    |  |  - cron: 0 8 * * *     |  |  - ctx.browser (nav/eval)    |  |
|  |  - portfolio_read      |  |    (tz: Asia/Singapore,|  |  - ctx.ai.sys_2.infer        |  |
|  |  - portfolio_automation|  |     rest: 7d)          |  |  - ctx.convert.record (PDF)  |  |
|  |  - DB checks/uniques   |  |  - manual: { send? }   |  |  - ctx.notify (inbox + Envoy)|  |
|  +------------+-----------+  +-----------+------------+  +---------------+--------------+  |
|               |                          |                               |                 |
+---------------|--------------------------|-------------------------------|-----------------+
                v                          v                               v
+--------------------------------------------+   +-------------------------------------------+
|       TENANT DATABASE (PGlite / PG)        |   |        EXTERNAL SERVICES & CHANNELS       |
|                                            |   |                                           |
|  Domain Models:                            |   |  Keyless Market & News HTTP:              |
|   - holding             (book + signals)   |   |   - open.er-api.com (FX rates)            |
|   - report              (1/day snapshot)   |   |   - query1.finance.yahoo.com (1y bars)    |
|   - portfolio_settings  (singleton config) |   |   - news.google.com/rss (7d news fallback)|
|   - report_subscription (1/user opt-in)    |   |                                           |
|                                            |   |  Browser Search & Reading:                |
|  System Tables Used:                       |   |   - Bing -> DuckDuckGo -> Mojeek cascade  |
|   - sys_user            (subscribers)      |   |   - Holding custom URLs (IR / filings)    |
|   - sys_integration     (Envoy accounts)   |   |                                           |
|   - sys_envoy           (channel bindings) |   |  Outbound Delivery (via active Envoys):   |
|   - sys_file            (holding docs)     |   |   - In-app inbox (always)                 |
|   - sys_notification / sys_message         |   |   - WhatsApp / Telegram / Slack / Discord |
+--------------------------------------------+   +-------------------------------------------+
```

### Key Runtime Configuration Anchors (`src/+workspace.ts`)

- **`tz: 'Asia/Singapore'`**: Single source of truth for the `0 8 * * *` cron firing time, `ctx.today`
  date on `report.for_date` and `holding.pnl_history[].date`, and the formatted `Data as of ...`
  timestamp in `report.market_view`.
- **`languages: ['en', 'zh']` & `locale: 'en-US'`**: Bilingual UI and error messages backed by
  `src/i18n/+messages.ts` and `src/i18n/+zh.messages.ts`.
- **`convert: { to: ['pdf'] }`**: Enables `ctx.convert.record('report', id, { to: 'pdf', ... })` so
  the host renders `+representation.svelte` into a PDF attachment.

---

## 2. Data Model & Ownership ER Diagram

All four domain models are independent root models under `src/data/model/`. Rather than spawning
normalized child tables for snapshot arrays, historical time series and daily report breakdowns are
stored as typed, key-validated JSONB object arrays (`many: true, key: '...'`) enforced at the
PostgreSQL layer via `store_json_valid(...)` check constraints.

```text
+-----------------------------------------------------------------+
|                            holding                              |
|  PK: id (uuid)    record_label: record.instrument               |
|  FTS index [find]: instrument, symbol, detail,                  |
|                    research_direction, research_summary         |
|  CHECK [loan_is_owed]: asset_class != 'loan' OR value_base <= 0 |
+-----------------------------------------------------------------+
| Statement & User-Authored Fields (17):                          |
|  - instrument (text)               - symbol (text?)             |
|  - isin (text?)                    - asset_class (enum[8])      |
|  - currency (ISO3)                 - quantity (dec:4, def 1)    |
|  - cost_value (dec:2?)             - market_value (dec:2,def 0) |
|  - value_base (dec:2)              - unrealised_pl (dec:2?)     |
|  - accrued_interest (dec:2?)       - risk_rating (int 1..5?)    |
|  - price_date (date?)              - detail (text?)             |
|  - documents (file[] <=32MiB?) -----> [sys_file]                |
|  - sources (obj[] key:url?)        - research_direction (text?) |
+-----------------------------------------------------------------+
| Agent-Calculated Fields (19):                                   |
|  - live_price (dec:4?)             - live_value_base (dec:2?)   |
|  - live_change_pct (dec:2?)        - price_updated_at (inst?)   |
|  - volume_ratio (dec:2?)           - movement (enum[4]?)        |
|  - change_1w_pct / 1m / 1y (dec:2?)- trend (up|sideways|down?)  |
|  - money_flow (dec:2?)             - pressure (buy|bal|sell?)   |
|  - rsi (dec:2?)                    - from_high_pct (dec:2?)     |
|  - volatility_pct (dec:2?)         - pnl_history (obj[] key:dt) |
|  - research_summary (markdown?)    - research_at (instant?)     |
|  - insights (obj[] key:url?)                                    |
+-----------------------------------------------------------------+

+-------------------------------------------+   +---------------------------------------------+
|            portfolio_settings             |   |                   report                    |
|  PK: id (uuid)                            |   |  PK: id (uuid)                              |
|  Runtime singleton guard:                 |   |  UNIQUE [one_per_day]: (for_date)           |
|   agent refuses if rows.length > 1        |   |  FTS [find]: headline, summary, market_view |
|   ('errors.settings_ambiguous')           |   |  record_label: 'Portfolio report' + date    |
+-------------------------------------------+   +---------------------------------------------+
|  - base_currency (ISO3; def USD if empty) |   |  - for_date (date)  - base_currency (ISO3)  |
|  - benchmarks (obj[] key:symbol?):        |   |  - headline (md)    - summary (md)          |
|      { name?: text, symbol: text }        |   |  - market_view (md?)- research_log (text?)  |
+-------------------------------------------+   |  - net_assets, invested, cash, liabilities, |
                                                |    unrealised_pl?, day_change? (all dec:2)  |
+-------------------------------------------+   |  - markets[]     (key: instrument)          |
|            report_subscription            |   |  - allocation[]  (key: label)               |
|  PK: id (uuid)                            |   |  - exposure[]    (key: currency)            |
|  UNIQUE [one_per_user]: (user)            |   |  - fx_used[]     (key: pair, scale 6)       |
|  record_label: record.user.name           |   |  - positions[]   (key: instrument)          |
+-------------------------------------------+   |  - sources[]     (key: url)                 |
|  - user (ref -> sys_user, def actor.id)   |   +---------------------------------------------+
|    FK ON DELETE RESTRICT                  |
+---------------------+---------------------+
                      | N:1 (unique 1:1)
                      v
+-------------------------------------------+   +---------------------------------------------+
|             sys_user (system)             |   |          sys_integration (system)           |
|  - id, name, email, phone, team           |   |  - id, integration, name, active, envoy     |
|  - whatsapp / telegram / slack / discord  |   |  Queried where envoy IS NOT NULL AND active |
|    handles used by ctx.notify fan-out     |   |  Filtered by is_instance(chat driver)       |
+-------------------------------------------+   +---------------------------------------------+
```

### Modeling Invariants

1. **Unified book (`holding`)**: Cash (`asset_class = 'cash'`) and credit facilities (`asset_class = 'loan'`)
   are rows in `holding`, not separate tables. The database constraint `loan_is_owed` enforces
   `value_base <= 0` for loans so balance-sheet totals remain unambiguous.
2. **Non-position boundary (`isPosition`)**: `book.ts` defines `isPosition(row)` as
   `asset_class !== 'cash' && asset_class !== 'loan'`. Non-positions are excluded from web research,
   LLM calls, `pnl_history`, and `report.positions`, though tickered lines still receive `live`
   pricing updates if quoted.
3. **Singleton configuration (`portfolio_settings`)**: There is intentionally no synthetic key column;
   `+settings.page.svelte` edits row 0 (or opens create mode if 0 rows exist), and `portfolio_agent`
   queries `limit: 2` and refuses (`errors.settings_ambiguous`) if multiple rows exist.

---

## 3. Valuation, FX Normalization & Portfolio Metrics Engine

Core valuation and aggregation live in two pure modules: `src/lib/portfolio/market.ts` (wire parsing
and normalization) and `src/lib/portfolio/book.ts` (exact `BigDecimal` arithmetic).

```text
  holding.symbol                                   open.er-api.com/v6/latest/{base}
        |                                                         |
        v                                                         v
+------------------------------+                     +-----------------------------+
| quoteSymbol(symbol)          |                     | parseRates(payload, base)   |
|  - "AAPL"     -> "AAPL"      |                     |  - Requires result="success"|
|  - "AAPL UW"  -> "AAPL"      |                     |  - Inverts every quoted > 0:|
|  - "700 HK"   -> "0700.HK"   |                     |      rate = 1 / quoted      |
|  - "D05 SP"   -> "D05.SI"    |                     |    (base per 1 foreign unit)|
|  - "VOD LN"   -> "VOD.L"     |                     |  - Forces rates[base] = 1   |
|  - unknown ex -> null (skip) |                     |  - Parse error -> empty Map |
+--------------+---------------+                     +--------------+--------------+
               |                                                    |
               v                                                    |
  Yahoo Finance v8 chart (range=1y, interval=1d)                    |
               |                                                    |
               v                                                    |
+----------------------------------------------------+              |
| parseQuote(payload)                                |              |
|  1. quoted = regularMarketPrice ?? closes.at(-1)   |              |
|  2. Compute signalsOf(quoted, bars) on RAW scale   |              |
|  3. Check MINOR currency map:                      |              |
|       GBp/GBX -> GBP, ZAc -> ZAR, ILA -> ILS       |              |
|     If minor: price = quoted / 100                 |              |
|     Else:     price = quoted                       |              |
|  4. currency = major ?? meta.currency (optional)   |              |
+----------------------+-----------------------------+              |
                       |                                            |
                       +---------------------+----------------------+
                                             |
                                             v
+--------------------------------------------------------------------------------------------+
|                 3-TIER VALUATION PRECEDENCE: lineValue(row, quote, rateOf)                 |
|                                                                                            |
|  Precompute:                                                                               |
|    statementRate = (market_value == 0) ? null : value_base / market_value                  |
|    own           = rateOf(row.currency) ?? statementRate                                   |
|    accrued       = (accrued_interest != null && own != null) ? accrued_interest * own : 0  |
|                                                                                            |
|  [Tier 1] Live quote answered AND rateOf(quote.currency ?? row.currency) is defined?       |
|           YES --> round2( quantity * quote.price * rateOf(quote.currency) + accrued )      |
|                   (Handles cross-currency lines: e.g. XAG metal quoted in USD -> SGD base) |
|           NO  |                                                                            |
|               v                                                                            |
|  [Tier 2] Cached live_value_base != null AND price_updated_at != null                      |
|           AND (price_date == null OR price_updated_at[0..9] >= price_date)?                |
|           YES --> decimal(live_value_base)                                                 |
|                   (Keeps last priced value; a newer statement price_date supersedes it)    |
|           NO  |                                                                            |
|               v                                                                            |
|  [Tier 3] Statement snapshot fallback:                                                     |
|           own != null --> round2( market_value * own + accrued )                           |
|           own == null --> round2( value_base + accrued )                                   |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
|                   BOOK AGGREGATION: computeMetrics(rows) & costInBase(row)                 |
|                                                                                            |
|  Per position (asset_class not in {'cash', 'loan'}):                                       |
|    costInBase(row) = round2( (cost_value ?? 0) * (statementRate ?? 1) )                    |
|    unrealised_pl   = lineValue - costInBase(row)       [non-positions contribute 0]        |
|                                                                                            |
|  Buckets:                                                                                  |
|    loan  lines  --> liabilities += (-row.value)        [positive debt magnitude; excluded  |
|                                                         from allocation & FX exposure]     |
|    cash  lines  --> cash        += row.value           [allocation['cash'], exposure[ccy]] |
|    other lines  --> invested    += row.value           [allocation[class],  exposure[ccy]] |
|                                                                                            |
|  Totals (all BigDecimal rounded scale 2, half-from-zero):                                  |
|    total_assets  = cash + invested                                                         |
|    net_assets    = total_assets - liabilities                                              |
|    weight(part)  = (total_assets > 0) ? round2((part.value * 100) / total_assets) : 0      |
|    day_change    = net_assets - previous_report.net_assets   (null on first report)        |
+--------------------------------------------------------------------------------------------+
```

### Precision & Rounding Details

- **`book.ts` and `+portfolio_agent.automation.ts`**: Use Effect `BigDecimal` rounded with
  `mode: 'half-from-zero'` — scale `2` for currency amounts, percentages, weights, and signals;
  scale `4` for `live_price`; scale `6` for `report.fx_used[].rate`.
- **`market.ts` (`round2` and `parseQuote`)**: Rounds JS floating-point bar statistics via
  `BigDecimal.round(..., { scale: 2, mode: 'half-ceil' })` before returning numeric `Quote` fields.
- **`report.fx_used` filtering**: Only foreign currencies (`code !== base`) actually referenced by at
  least one holding's `row.currency` or `quote.currency` are recorded in `report.fx_used`.

---

## 4. Technical Signals & Volume Activity Pipeline

When `parseQuote` decodes a Yahoo Finance 1-year daily chart payload (`range=1y&interval=1d`), it
derives nine technical signals in `signalsOf(quoted, bars)` plus `change_pct`, `volume_ratio`, and
`movementOf(volume_ratio)`. Missing or short histories return `null` per metric rather than synthetic
zeros.

```text
                       Yahoo Finance 1y Daily Chart JSON
                  (meta: regularMarketPrice, previousClose, currency)
                  (indicators.quote[0]: close[], high[], low[], volume[])
                                        |
              +-------------------------+-------------------------+
              |                                                   |
              v                                                   v
+----------------------------------------+      +----------------------------------------+
| PRICE & RETURN SIGNALS                 |      | VOLUME & LIQUIDITY SIGNALS             |
|                                        |      |                                        |
|  Day Move (change_pct):                |      |  Volume Ratio (volume_ratio):          |
|    prev = previousClose ?? closes[-2]  |      |    1. Filter positive volumes          |
|    (quoted - prev) / prev * 100        |      |    2. Drop last bar (may be partial):  |
|                                        |      |         complete = vols.slice(0, -1)   |
|  Multi-Session Returns (pctFrom):      |      |    3. last  = complete.at(-1)          |
|    1W: vs closes.at(-6)  (5 bars back) |      |    4. prior = last 20 before `last`    |
|    1M: vs closes.at(-22) (21 bars back)|      |    5. ratio = last / mean(prior)       |
|    1Y: vs closes[0]  (req >=200 closes)|      |                                        |
|                                        |      |  Movement Tier (movementOf):           |
|  52-Week High Distance (from_high_pct):|      |    ratio >= 2.0  --> 'surge'  (ALERT!) |
|    req >= 200 closes;                  |      |    ratio >= 1.3  --> 'active'          |
|    hi = max(quoted, last 252 highs)    |      |    ratio <= 0.5  --> 'quiet'           |
|    (quoted - hi) / hi * 100            |      |    otherwise     --> 'normal'          |
+----------------------------------------+      +----------------------------------------+
              |                                                   |
              v                                                   v
+----------------------------------------+      +----------------------------------------+
| TREND, MOMENTUM & VOLATILITY           |      | CHAIKIN MONEY FLOW & PRESSURE          |
|                                        |      |                                        |
|  Trend (req >= 200 closes):            |      |  Window: last 20 bars where            |
|    sma50  = mean(closes[-50..])        |      |    high != null, low != null,          |
|    sma200 = mean(closes[-200..])       |      |    volume > 0, high > low              |
|    price>sma200 && sma50>sma200 -> up  |      |  Guard: >= 10 valid bars & sum(vol)>0  |
|    price<sma200 && sma50<sma200 -> down|      |                                        |
|    otherwise               -> sideways |      |  Formula (range -1.00 .. +1.00):       |
|                                        |      |    clv = ((close-low)-(high-close))    |
|  Wilder RSI(14) (req >= 15 closes):    |      |           / (high - low)               |
|    Seed: 14-bar simple avg gain & loss |      |    money_flow = sum(clv*vol)/sum(vol)  |
|    Step: g = (g*13 + max(d,0)) / 14    |      |                                        |
|          l = (l*13 + max(-d,0)) / 14   |      |  Pressure Classification:              |
|    RSI = (l==0) ? 100                  |      |    money_flow >  0.05 --> 'buying'     |
|                 : 100 - 100/(1 + g/l)  |      |    money_flow < -0.05 --> 'selling'    |
|                                        |      |    otherwise          --> 'balanced'   |
|  Annualised Volatility (volatility_pct)|      +----------------------------------------+
|    Last 64 closes -> up to 63 log rets |
|    r[i] = ln(close[i] / close[i-1])    |
|    Guard: >= 20 returns                |
|    std_sample(r) * sqrt(252) * 100     |
+----------------------------------------+
```

---

## 5. `portfolio_agent` Execution Pipeline & Citation Gate

`src/automation/+portfolio_agent.automation.ts` is the sole automation in the workspace. It runs
under policy `portfolio_automation`, triggered either daily by cron (`0 8 * * *`, `rest: '7d'`) or
manually by a portfolio owner (`input: { send?: boolean }`, default `true`). It executes strictly
sequentially in nine phases and records an execution transcript in `report.research_log` (truncated
to 8,000 characters).

```text
  TRIGGER: Cron 08:00 (workspace tz, rest 7d)  OR  Manual ctx.run('portfolio_agent', { send })
                                              |
                                              v
  [Phase 1] PREFLIGHT & CONTEXT
   - Query holding (order_by value_base desc, limit 200), portfolio_settings (limit 2),
     report_subscription (limit 1000)
   - Guard: portfolio_settings.rows.length > 1  --> ctx.refuse('errors.settings_ambiguous')
   - Guard: holding.rows.length == 0            --> early return (no-op)
   - base = settings?.base_currency ?? 'USD'
   - subscribers = (input.send === false) ? [] : report_subscription.rows.map(r => r.user)
   - Query active Envoy integrations (sys_integration where envoy != null & active = true)
     filtered by is_instance('whatsapp' | 'telegram' | 'slack' | 'discord') --> via[]
                                              |
                                              v
  [Phase 2] FX & MARKET VALUATION
   - Fetch open.er-api.com/v6/latest/{base} --> parseRates()
   - For each holding: quoteSymbol() -> Yahoo v8 chart -> parseQuote() -> lineValue()
   - Build live{} update payload only if quote != null AND rateOf(quoteCurrency) != undefined
   - Compute book-wide metrics via computeMetrics()
                                              |
                                              v
  [Phase 3] MARKET & POSITION RESEARCH
   - Market search: search(ctx, 'stock market today', keep=3)
   - For each position (ordered largest value_base first):
       if index < RESEARCHED (6):
           pages = browser search("${name} stock news", keep=2)
       if pages.length == 0 (index >= 6 OR browser unavailable OR 0 readable hits):
           fetch Google News RSS ("${name} stock when:7d") -> parseHeadlines(limit=4)
           (filters out "stock price/quote/chart" boilerplate; stored with text='')
       for each user-saved URL in holding.sources:
           readPage(ctx, url)  [browser.navigate -> fallback web.read; clipped 1800 chars]
                                              |
                                              v
  [Phase 4] PER-POSITION LLM SYNTHESIS & CITATION GATE
   - For each position: compute pnl & pnl_pct
   - If pages.length > 0 OR quote != null:
       sources = [ [1] Yahoo Finance, [2..N] read pages (snippets sliced to 900 chars) ]
       ctx.ai.sys_2.infer({ headline, happened, matters, call, reason, confidence? })
       Verify happened, matters, reason through cite(text, sources)
       - ALL 3 pass --> section joins positions[] & sections[]; cited URLs collected
       - ANY fails  --> section DROPPED ('dropped, uncited'); quantitative line stays
                                              |
                                              v
  [Phase 5] BATCHED HOLDING PERSISTENCE (ctx.act 'holding.update')
   - Non-positions: update live fields only (if quoted)
   - Positions: update live fields + upsert today in pnl_history (sorted, slice(-90) days)
                + if pages.length > 0: research_at, top 6 insights (title<=300 chars),
                  and research_summary (only overwritten if section passed citation gate)
                                              |
                                              v
  [Phase 6] BENCHMARKS & PROVENANCE LINE
   - Fetch each settings.benchmarks symbol -> append quoted holdings -> report.markets[]
   - Build dataLine: "Data as of <tz timestamp>; holdings per statement <max price_date>;
                      prices per [Yahoo Finance](...); rates per [ExchangeRate-API](...)."
                                              |
                                              v
  [Phase 7] LEAD & MARKET VIEW SYNTHESIS
   - Query latest <= today reports (limit 2) -> identify `existing` (today) & `previous`
   - day_change = metrics.net_assets - previous.net_assets (null if no previous report)
   - leadSources = unique([QUOTE_SOURCE, RATES_SOURCE, ...market, ...cited])
   - ctx.ai.sys_2.infer({ lead, market }) -> validate both via cite(text, leadSources)
   - headline = cited lead ?? deterministic totals sentence (+ Yahoo Finance link if quoted)
   - summary  = deterministic "- Markets: <totals>" + up to 3 top cited section headlines
   - market_view = dataLine + "\n\n" + cited market paragraph (if present)
                                              |
                                              v
  [Phase 8] IDEMPOTENT DAILY REPORT UPSERT
   - If existing (for_date == ctx.today) --> ctx.act 'report.update'
   - Else                                --> ctx.act 'report.create'
   - If answer.kind != 'committed'       --> ctx.refuse('errors.report_not_filed')
   - (No-op identical rewrite keeps `written = existing`)
                                              |
                                              v
  [Phase 9] PDF RENDER & DEDUPLICATED NOTIFICATIONS
   - If subscribers.length > 0:
       pdf = ctx.convert.record('report', written.id, { to: 'pdf',
                                 name: 'portfolio-report-<today>.pdf' })
       ctx.notify({ to: subscribers, via, attachments: [pdf],
                    description: unlinked(headline) + "\n\n" + unlinked(summary),
                    once: 'report-sent-<today>' })
   - Always notify team 'investors':
       1. Summary notification  (once: 'report-<today>')
       2. Surge alerts for every holding with live.movement == 'surge' (volume >= 2x 20d avg)
          (once: 'movement-<holding.id>-<today>')
```

### Browser Search Cascade (`search` & `readPage` in `market.ts`)

```text
  search(reader, query, keep, log)
       |
       +--> Try engines in strict order:
       |      1. Bing        (li.b_algo h2 a)
       |      2. DuckDuckGo  (a.result__a)
       |      3. Mojeek      (ul.results-standard h2 a)
       |
       +--> reader.browser.navigate(engine.url + query)
       |      - Unavailable     --> log "no browser", immediately return [] (caller uses RSS)
       |      - FacilityFailure --> skip to next engine
       |      - Open            --> evaluate selector (slice 0..keep), filter non-empty http*
       |                            for each link: readPage(reader, url)
       |                              [browser.navigate -> catch -> web.read -> clip 1800]
       |                            if >= 1 readable page obtained -> return pages
       |
       +--> All engines exhausted with 0 readable pages --> return [] (caller uses RSS)
```

### Strict Citation Verification Gate (`cite(text, sources)`)

Every AI-generated prose block (`happened`, `matters`, `reason`, `lead`, `market`) passes through
`cite()` before entering `report` or `holding.research_summary`:

```text
  Raw LLM prose ("Acme won an order, per [2].\n\nIt is the largest line, per [1].")
        |
        v
  Split on blank lines (/\n\s*\n/), trim, drop empty strings
        |
        +-- Zero non-empty paragraphs? ----------------------------> RETURN null (DROP)
        |
        v
  For EACH paragraph:
    Find all /\[(\d+)\]/g markers -> resolve sources[n - 1]
        |
        +-- Zero markers in this paragraph? -----------------------> RETURN null (DROP)
        +-- Any marker index out of bounds (undefined)? -----------> RETURN null (DROP)
        |
        v
    Replace [n] with Markdown link: [publisher](url with ')' escaped as '%29')
    Collect referenced Source into `used` Set
        |
        v
  ALL paragraphs valid --> RETURN { text: linked.join('\n\n'), sources: [...used] }
```

This guarantees two hard invariants:

1. No uncited claim or hallucinated citation index can ever appear in a published report.
2. Same-day reruns remain safe and noise-free: `report` is updated in place (`one_per_day`),
   `holding.pnl_history` replaces only today's date slot, and `ctx.notify(..., { once })` suppresses
   duplicate PDF sends and volume alerts for that calendar date.

---

## 6. Report Immutability, Record Representation & Dual Rendering Path

Unlike transactional workflows that move through draft/approved states, `report` has no state machine:
every report is born as a finalized daily snapshot. Immutability for humans is enforced at two layers,
while one shared Svelte component drives both interactive reading and PDF generation.

```text
                         +-----------------------------------------+
                         |             report record               |
                         |  UNIQUE (for_date)  - 1 row per day     |
                         +--------------------+--------------------+
                                              |
                 +----------------------------+----------------------------+
                 | Write Authority                                         | Read / Render
                 v                                                         v
+----------------------------------------+     +---------------------------------------------+
| Policy & UI Immutability               |     | src/data/model/report/+representation.svelte|
|                                        |     |  - RecordShell lock="...not edited."        |
|  - portfolio_automation (agent):       |     |  - Queries <=30 recent reports for trend    |
|      create + update (same-day rerun)  |     |  - Renders top-to-bottom:                   |
|  - portfolio_manage (owners):          |     |      1. Bold cited headline                 |
|      read + delete ONLY (no create/upd)|     |      2. "In today's report" bullets         |
|  - portfolio_read (viewers):           |     |      3. 3 charts (30d trend, alloc, P&L)    |
|      read ONLY                         |     |      4. Currencies & FX table               |
|  - Admin can still seed/create in test |     |      5. Markets table + market_view         |
+----------------------------------------+     |      6. Full Positions summary table        |
                                               |      7. Cited per-position analyses         |
                                               +----------------------+----------------------+
                                                                      |
                      +-----------------------------------------------+---------------+
                      | Interactive Browser                                           |
                      v                                                               v
  +---------------------------------------+       +------------------------------------------+
  | User clicks row in Reports            |       | Headless Print (ctx.convert.record)      |
  |  -> renders inside workspace shell    |       |  -> opens ?record=report/<id>&print      |
  |     with live theme & interactive     |       |  -> produces portfolio-report-<date>.pdf |
  |     charts                            |       |  -> ctx.notify() strips Markdown links   |
  +---------------------------------------+       |     via unlinked() for chat text body    |
                                                  |     and attaches rendered PDF file       |
                                                  +------------------------------------------+
```

---

## 7. Access Control, Teams, Policies & Self-Subscription Guard

Access control uses two teams (`src/access_control/team/+team.ts`) and three policies
(`src/access_control/policy/`). There are no approval flows; governance relies on strict read/write
segregation, policy-level report immutability, row-scoped subscriber self-service, and database check
and unique constraints.

```text
+-----------------------+      +-----------------------+      +-----------------------------+
| Team: investors       |      | Team:                 |      | Automation:                 |
| ("Portfolio owners")  |      | portfolio_viewers     |      | portfolio_agent             |
+-----------+-----------+      +-----------+-----------+      +--------------+--------------+
            |                              |                                 |
            v                              v                                 v
+-----------------------+      +-----------------------+      +-----------------------------+
| portfolio_manage      |      | portfolio_read        |      | portfolio_automation        |
|                       |      |                       |      |                             |
| Capabilities:         |      | Capabilities:         |      | Capabilities:               |
|  apps: [portfolio]    |      |  apps: [portfolio]    |      |  (system identity; none)    |
|  automations:         |      |  automations: NONE    |      |                             |
|   [portfolio_agent]   |      |                       |      |                             |
+-----------+-----------+      +-----------+-----------+      +--------------+--------------+
            |                              |                                 |
            v                              v                                 v
+-------------------------------------------------------------------------------------------+
|                               MODEL & VERB AUTHORITY MATRIX                               |
|                                                                                           |
|  Model                | portfolio_manage      | portfolio_read        | portfolio_auto    |
|  ---------------------+-----------------------+-----------------------+------------------ |
|  holding              | R, C, U, D            | R                     | R, U              |
|  report               | R, D  (no C/U!)       | R                     | R, C, U           |
|  portfolio_settings   | R, C, U, D            | -                     | R                 |
|  report_subscription  | R, C, D               | R(self), C*, D*       | R                 |
|  sys_integration      | R                     | -                     | R                 |
|  sys_user             | R                     | -                     | -                 |
|                                                                                           |
|  Legend: R = outputs.default, C = create, U = update, D = delete, - = no grant            |
+-------------------------------------------------------------------------------------------+
                                           |
                                           v
+-------------------------------------------------------------------------------------------+
|              * SELF-ONLY SUBSCRIPTION GUARD (portfolio_read.policy.ts)                    |
|                                                                                           |
|  Read filter:   SELF = { user: { eq: { var: 'actor.id' } } }                              |
|  Create verdict: memberOf(ctx.actor) must equal every change.after.user                   |
|                  else ctx.refuse('errors.own_subscription', { row })                      |
|  Delete verdict: memberOf(ctx.actor) must equal every change.before.user                  |
|                  else ctx.refuse('errors.own_subscription', { row })                      |
|  Default value: report_subscription.user defaults to { var: 'actor.id' } so creating `{}` |
|                 on Reports subscribes the signed-in user without exposing other users.    |
+-------------------------------------------------------------------------------------------+
```

### Database-Level Guardrails

| Constraint / Guard   | Model / Location                  | Enforcement Rule                                       | Error Key                   |
| -------------------- | --------------------------------- | ------------------------------------------------------ | --------------------------- |
| `loan_is_owed`       | `holding` (DB CHECK)              | `asset_class <> 'loan' OR value_base <= 0`             | `errors.loan_is_owed`       |
| `one_per_day`        | `report` (DB UNIQUE)              | Unique `(for_date)`                                    | `errors.report_exists`      |
| `one_per_user`       | `report_subscription` (DB UNIQUE) | Unique `(user)`                                        | `errors.already_subscribed` |
| `own_subscription`   | `portfolio_read` policy verdict   | `actor.kind === 'member' && row.user === actor.id`     | `errors.own_subscription`   |
| `settings_ambiguous` | `portfolio_agent` preflight       | `portfolio_settings.rows.length <= 1`                  | `errors.settings_ambiguous` |
| `report_not_filed`   | `portfolio_agent` post-upsert     | `answer.kind === 'committed' && written !== undefined` | `errors.report_not_filed`   |
