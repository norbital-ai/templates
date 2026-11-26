# Blank — Architecture & Inner Mechanisms

Technical architecture reference for `@template/blank` (`norbital_blank`). Although Blank ships with only one read-only starter model (`notes`), zero authored applications, and zero authored automations, it compiles into a complete Norbital Bolt workspace substrate with full schema history verification, multilingual search indexing, row-level audit trails, approval queues, localization, and Norbius Studio authoring support.

Every file path, table, constraint, SQL function, and trigger in this document is verified directly against `src/`, `seed/`, `migrations/`, `package.json`, and `norbital.template.json`.

---

## 1. System Topology & Runtime Architecture

Blank cleanly separates **authored source declarations** (`src/`, `seed/`), **compile-time verification and artifact packaging** (`@norbital-ai/bolt-cli`), and **host runtime execution** (`@norbital-ai/bolt` + `@norbital-ai/ui` over PGlite locally or PostgreSQL in deployed environments).

```text
+--------------------------------------------------------------------------------------------+
|  1. AUTHORED WORKSPACE SOURCE (templates/blank/)                                           |
|                                                                                            |
|  src/+workspace.ts              tz: 'Asia/Singapore', locale: 'en-SG', languages: en, zh   |
|  src/data/model/notes/+model.ts 1 read-only model (title, body?, outputs.default)          |
|  src/i18n/+messages.ts (+zh)    English & Simplified Chinese model/field labels            |
|  src/agent/+agent.md, AGENTS.md Norbius system brief & coding-agent structural map         |
|  seed/+seeder.ts                seeder({ bank: { tree: 'blank' } })  [0 public rows]       |
|  migrations/0001..0003 + lock   Editable SQL history, snapshot.json, physical.json         |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
|  2. BUILD & VERIFICATION PIPELINE (@norbital-ai/bolt-cli)                                  |
|                                                                                            |
|  +------------------+   +---------------------+   +------------------+   +---------------+ |
|  | Discovery Scanner|-->| Manifest & TS Gen   |-->| Migration Replay |-->| Release Pack  | |
|  | scans src/ files |   | writes .norbital/   |   | scratch DB check |   | bundle + seed | |
|  | & validates rules|   | tsconfig + names.ts |   | vs physical.json |   | updates counts| |
|  +------------------+   +---------------------+   +------------------+   +---------------+ |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
|  3. HOST RUNTIME (@norbital-ai/bolt + @norbital-ai/ui)                                     |
|                                                                                            |
|  +------------------------------------------+   +----------------------------------------+ |
|  | Host Shell UI (Svelte 5 / @norbital/ui)  |   | Bolt Engine & Guest Boundary           | |
|  |  - Workspace Home (0 apps -> Norbius CTA)|   |  - Model Engine (notes: read-only)     | |
|  |  - Norbius Assistant (Cmd+K / Studio)    |<->|  - Policy & Approval Evaluator (0 auth)| |
|  |  - Approvals Inbox & Notifications       |   |  - Automation / Sync / Envoy Runners   | |
|  |  - Global Search & Settings/Integrations |   |    (ready in schema; 0 active decls)   | |
|  +------------------------------------------+   +--------------------+-------------------+ |
|                                                                      |                     |
|                                                                      v                     |
|  +---------------------------------------------------------------------------------------+ |
|  | Tenant Database (Local/Tests: PGlite  |  Deployed: PostgreSQL per tenant)             | |
|  |  - 1 Authored Table:  notes (audit + search triggers enabled)                         | |
|  |  - 20 System Tables:  sys_* (18), approval_request, requestor                         | |
|  |  - 5 Engine Tables:   bolt_history*, bolt_approvals, bolt_approval_effect             | |
|  +---------------------------------------------------------------------------------------+ |
+--------------------------------------------------------------------------------------------+
```

### Architectural Properties

- **Isolated toolchain:** `package.json` pins `@norbital-ai/bolt` (`0.0.10`), `@norbital-ai/ui` (`0.0.10`), `svelte` (`5.57.3`), `vite` (`8.3.5`), and `effect` (`4.0.6`), while `@norbital-ai/bolt-cli` (`0.0.10`), `typescript` (`6.0.3`), `@typescript/native`, `svelte2tsx`, `vitest`, and `@effect/vitest` stay in `devDependencies` and never enter a deployed release.
- **Generated `.norbital/` bridge:** `tsconfig.json` extends `./.norbital/tsconfig.json`. `.norbital/` is produced locally by `bolt check`, `bolt dev`, and `bolt build` and is git-ignored.
- **Zero-footprint dormancy:** Because Blank declares `0` apps, `0` automations, `0` policies, and `0` custom integrations, runtime schedulers, outbox dispatchers, and sync pollers remain idle while the full platform schema and shell stay immediately operable.

---

## 2. Bolt Filesystem Discovery & Extension Map

Bolt discovers declarations strictly by filesystem convention. Blank populates only the minimal core files and leaves every domain extension directory ready to be created on demand.

```text
templates/blank/
|
+-- POPULATED STARTER FILES (Active Today)
|   +-- norbital.template.json            Catalogue metadata (key: norbital_blank, counts)
|   +-- src/
|   |   +-- +workspace.ts                 workspace({ tz, locale, languages })
|   |   +-- data/model/notes/+model.ts    model('notes', { fields, outputs }) [read-only]
|   |   +-- i18n/
|   |   |   +-- +messages.ts              Default 'en' message overrides (Notes / Note)
|   |   |   +-- +zh.messages.ts           'zh' overrides (label, singular, title, body)
|   |   +-- agent/
|   |       +-- +agent.md                 Norbius brief (domain-neutral workspace assistant)
|   |       +-- AGENTS.md                 Coding-agent map, folder ownership rule, gates
|   +-- seed/+seeder.ts                   seeder({ bank: { tree: 'blank' } })
|   +-- migrations/                       0001..0003 SQL + snapshot + lock + physical.json
|
+-- STANDARD BOLT EXTENSION SLOTS (Empty in Blank -- Add Incrementally)
    +-- src/data/model/<owner>/<child>/   Nested folders mirror ownership; LEAF folder = name
    |   +-- +model.ts                     Fields, refs, states, locks, outputs, verbs, effects
    |   +-- +<sync>.sync.ts               External sync definition bound to owning model
    +-- src/data/custom_field/<name>/
    |   +-- +custom_field.ts              Reusable custom datatype validator/renderer
    +-- src/app/<app>/
    |   +-- +app.ts                       App manifest, navigation, shell registration
    |   +-- +<page>.page.svelte           Svelte 5 page consuming PageBolt.query / ctx.run
    +-- src/access_control/
    |   +-- policy/+<name>.policy.ts      Read outputs, row filters, write fields, approvals
    +-- src/automation/
    |   +-- +<name>.automation.ts         System-identity jobs (cron, event, schedule, call)
    +-- src/integration/<name>/
        +-- +integration.ts (+svelte)     Custom connector contract & optional settings UI
```

### Authoring Invariants (from `src/agent/AGENTS.md`)

1. **Ownership directory rule:** A child model sits inside its parent owner's folder under `src/data/model/`, but only the **leaf folder name** names the model. Moving a model folder does not rename the model.
2. **Placeholder lifecycle:** `notes` is deliberately read-only (no write verbs). Replace or delete `src/data/model/notes/` once the first real business model is authored; `bolt build` automatically recomputes `norbital.template.json` `counts`.
3. **Incremental evolution:** Introduce one model, one page, and one policy at a time, proving each increment with `bunx bolt check`.

---

## 3. Data Model & Physical ER Diagram

Even with a single authored model, Blank's compiled schema (`migrations/snapshot.json` and `migrations/0001_initial.sql`–`0003_schema.sql`) materializes **26 physical tables**: 1 authored model table (`notes`), 20 platform system tables (`approval_request`, `requestor`, and 18 `sys_*` tables), and 5 engine-internal tables (`bolt_history*`, `bolt_approvals`, `bolt_approval_effect`).

```text
=================================== AUTHORED DOMAIN MODEL ====================================
+--------------------------------------------------------------------------------------------+
| notes  [PK: id (uuid)]  audit: true  |  read output: default (all)  |  writes: NONE        |
|--------------------------------------------------------------------------------------------|
|  title: text (NOT NULL)    |  revision, created_at, created_by, updated_at, updated_by     |
|  body:  text (NULL)        |  GEN bolt_record_label (from title), GEN bolt_search (GIN)    |
+--------------------------------------------------------------------------------------------+

=================================== PLATFORM IDENTITY & CORE =================================
+-------------------------------+       +----------------------------------------------------+
| sys_workspace [PK: id (text)] |       | sys_user  [PK: id (text)]                          |
|  singleton id = ...0001       |       |  name, email (UX lower), phone -> phone_key (UX)   |
|  name (max 120), revision     |       |  kind (staff|external|anonymous), admin, active    |
+-------------------------------+       |  team, party -> party_id, preferences (JSON check) |
+-------------------------------+       |  CK admin_staff: admin=false OR kind='staff'       |
| sys_config    [PK: key]       |       +------+------------+--------------+-----------------+
| sys_challenge [PK: addr_mac]  |              |            |              |
+-------------------------------+              |            |              |
                                    +----------+            |              +-----------+
                                    v (1:N)                 v (1:N)                    v (1:N)
+-------------------------------------+  +-----------------------------+  +------------------+
| sys_session  [PK: id]               |  | sys_invitation  [PK: id]    |  | sys_api_key      |
|  user -> sys_user (CASCADE)         |  |  invited_by -> sys_user     |  |  created_by ->   |
|  impersonated_by -> sys_user (RESTR)|  |  (RESTRICT), email, phone   |  |  sys_user (RESTR)|
|  token_hash (UX), via, expires_at   |  |  CK addressed: email|phone  |  |  prefix (UX)     |
+-------------------------------------+  +-----------------------------+  +------------------+

=========================== INTEGRATIONS, MESSAGING, SYNC & RUNS =============================
+----------------------------------------------------------+    +----------------------------+
| sys_integration  [PK: id (text)]                         |    | Standalone Platform Tables |
|  owner -> sys_user (RESTRICT)                            |    |  sys_envoy       [PK: uuid]|
|  UX one_per_member: (owner, integration) WHERE owner!=N  |    |   policies (GIN text[])    |
|  integration, name, envoy, active, configuration, status |    |  sys_run         [PK: text]|
+---+----------+----------+----------+----------+----------+    |   key (UX), state, due_at  |
    |          |          |          |          |               |  sys_notification[PK: text]|
    | CASCADE  | CASCADE  | CASCADE  | CASCADE  | CASCADE       |   once (UX), (member, at)  |
    v          v          v          v          v               |  sys_file        [PK: text]|
+----------+ +----------+ +--------+ +--------+ +------------+  |   sha256, size, mime, key  |
| sys_conv | | sys_msg  | | sys_   | | sys_   | | sys_sync & |  +----------------------------+
| ersation | | (seq id) | | inbox  | | outbox | | sys_sync_  |
|          | |          | | (UX 1  | | writer | | row (UX    |
|          | |          | | deliv) | | ->user | | partition, |
|          | |          | |        | | SETNUL)| | record,rmt)|
+----------+ +----------+ +--------+ +--------+ +------------+

============================= APPROVALS & ENGINE AUDIT SUBSTRATE =============================
+------------------------------------+      +------------------------------------------------+
| approval_request  [PK: id (uuid)]  |      | bolt_approvals  [PK: id (uuid), seq identity]  |
|  collection_name, record_id, action|      |  state: Pending|ChangesRequested|Approved|     |
|  status: ONGOING|CHANGES_REQUESTED||      |         Rejected|Superseded|Withdrawn          |
|   APPROVED|REJECTED|SUPERSEDED|WDR |      |  step, route, records, log                     |
|  UX one_ongoing_request (ONGOING)  |      +-----------------------+------------------------+
+-----------------+------------------+                              | FK (CASCADE)
                  | FK (RESTRICT)                                   v
                  v                         +------------------------------------------------+
+------------------------------------+      | bolt_approval_effect                           |
| requestor  [PK: id (text)]         |      |  PK: (request, operation, automation)          |
|  approval_request_id, user_id      |      |  state: queued | failed, due_at, input, error  |
+------------------------------------+      +------------------------------------------------+

+------------------------------------+      +------------------------------------------------+
| bolt_history_schema  [PK: id uuid] |<-----| bolt_history_current  [PK: model (text)]       |
|  lineage, model, definition, fields|  FK  |  schema -> bolt_history_schema(id), active     |
+------------------------------------+      +------------------------------------------------+
                  ^ (meta->>'schema' validated by bolt_history_matches)
+--------------------------------------------------------------------------------------------+
| bolt_history  (append-only audit log: collection, record, revision, op, cause, changes)    |
|  op: create|update|delete  |  cause: direct|cascade|derived|seed|erased|restored           |
+--------------------------------------------------------------------------------------------+
```

### Key Enforced Database Constraints & Indexes (Verified from `migrations/`)

| Table              | Constraint / Index                       | Rule Enforced                                                                                                      |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `notes`            | `notes__gin__73732636`                   | GIN index on generated `bolt_search` (`tsvector` derived from `title`)                                             |
| `sys_user`         | `sys_user__ck__477bc0d2` (`admin_staff`) | `admin = false OR kind = 'staff'` (external/anonymous accounts can never be admin)                                 |
| `sys_user`         | `sys_user__ck__5ef80452`                 | `store_json_valid(preferences, ...)` validating `appearance`, `email_notifications`, `locale` (`max 35`), `sounds` |
| `sys_user`         | `sys_user__ux__08e69363`, `1c9f4db2`     | Unique `lower(email)` and unique digit-stripped computed `phone_key`                                               |
| `sys_workspace`    | `sys_workspace__ck__4e7b428e`            | Singleton row `id = '00000000-0000-0000-0000-000000000001'`                                                        |
| `sys_invitation`   | `addressed` check                        | At least one of `email` or `phone` must be non-null                                                                |
| `sys_integration`  | `one_per_member`                         | Partial unique `(owner, integration) WHERE owner IS NOT NULL`                                                      |
| `approval_request` | `one_ongoing_request`                    | Partial unique `(collection_name, record_id) WHERE status = 'ONGOING'`                                             |
| `sys_inbox`        | `one_inbound_delivery`                   | Unique `(sync, instance, delivery)` deduplicating inbound webhooks                                                 |
| `sys_outbox`       | `key`, `coalesce`                        | Unique `key` + partial unique `(sync, instance, record) WHERE attempts = 0 AND status = 'queued'`                  |
| `sys_sync_row`     | `one_record`, `one_remote_id`            | Unique `(sync, instance, record)` and partial unique `(sync, instance, remote_id) WHERE remote_id IS NOT NULL`     |

---

## 4. Write Guard, Trigger, Search & Audit Pipeline

Because `notes` omits all write verb declarations (`create`, `update`, `delete`, `import`), the Bolt runtime engine rejects any API write to `notes` before SQL is ever issued. Underneath that API layer, every table in Blank still carries compiled PostgreSQL/PGlite validation, search-indexing, and audit triggers from `0001_initial.sql`.

```text
  API / Page / Automation Request targeting `notes` (or any future authored model)
       |
       v
+--------------------------------------------------------------------------------------------+
| LAYER 1: BOLT ENGINE VERB & POLICY GATE                                                    |
|  - Checks declared verb contract (`create` / `update` / `delete` / `import`)               |
|  - For `notes`: NO write verbs declared --> REFUSED (read-only); ONLY `outputs.default`    |
|    read path is exposed (`fields: 'all'`).                                                 |
+---------------------------------------------+----------------------------------------------+
                                              | (Authorized write / seed / restore / SQL)
                                              v
+--------------------------------------------------------------------------------------------+
| LAYER 2: TRANSACTION WRITE CONTEXT (Session GUCs)                                          |
|  - store.write    = { mode: 'write'|'seed'|'restore', actor, at, rows }                    |
|  - bolt.write     = statement_timestamp()::text (suppresses raw SQL fallback in bolt_audit)|
|  - bolt.audit     = optional operation tag                                                 |
|  - bolt.anonymise = per-row field allowlist exempted from locks during erasure             |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
| LAYER 3: BEFORE ROW TRIGGER -- store_row_rules(rules jsonb)                                |
|  1. Validates store.write mode ('write' | 'seed' | 'restore'); determines `trusted` flag   |
|  2. UPDATE: enforces immutable primary key columns (errcode 23514)                         |
|  3. Non-trusted INSERT/UPDATE: stamps state transition timestamps & checks initial/allowed |
|     state transitions (for stateful models; `notes` has `states: {}`)                      |
|  4. Audit models (`notes` has `audit: true`):                                              |
|     - INSERT: requires revision = 1; stamps created_at/by, updated_at/by                   |
|     - UPDATE: forbids mutating created_at/by; advances revision = old.revision + 1;        |
|       updates updated_at/by                                                                |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
| LAYER 4: COLUMN CHECKS, JSON SHAPE VALIDATION & GENERATED SEARCH COLUMNS                   |
|  - CHECK constraints & store_json_valid(value, spec) validate nested objects/enums/dates   |
|  - GENERATED bolt_record_label: bolt_record_label_notes_06f5fc13(title)                    |
|  - GENERATED bolt_search (tsvector -> GIN index):                                          |
|      bolt_search_fold(text)          -> NFKD/NFKC accent fold, lowercase, CJK run split    |
|        --> bolt_search_romanize(run) -> embedded CJK-to-pinyin lookup table                |
|        --> bolt_search_terms(value)  -> emits kinds: w(word), a(romanized), s(skeleton),   |
|                                         r/c(CJK substrings 1..8), p(syllable), j(joined)   |
|        --> bolt_search_document()    -> deduplicated tsvector (lexemes <= 256 bytes)       |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
| LAYER 5: AFTER TRIGGERS -- store_statement_rules & bolt_audit                              |
|  - store_statement_rules (on locked/child models): locks parent rows FOR SHARE and blocks  |
|    mutations on locked records/relations unless exempted or anonymised                     |
|  - bolt_audit (active on `notes` when bolt.write != statement_timestamp()):                |
|    1. Checks bolt_approvals (state IN Pending, ChangesRequested) FOR UPDATE; if matched -> |
|       RAISE EXCEPTION errcode 'BA001' ('under_approval ...')                               |
|    2. Detects cause: 'direct' vs 'cascade' (checks whether referential parent still exists)|
|    3. Resolves active schema version from bolt_history_current JOIN bolt_history_schema;   |
|       forces full snapshot on first update under a new schema version                      |
|    4. Inserts audit diff row into bolt_history (excluding bolt_search/bolt_record_label)   |
+--------------------------------------------------------------------------------------------+
```

### Schema Lineage Guard (`bolt_history_register`)

Whenever a migration calls `bolt_history_register(model_name, definition)` (seen in `0001_initial.sql`, `0002_schema.sql`, and `0003_schema.sql`):

1. It locks the current active row in `bolt_history_current` (matching either `model_name` or `definition->>'was'` for renames).
2. If the definition changed, it **refuses** the migration if either:
   - `bolt_audit_erase` has a pending erasure for the model, or
   - `bolt_approvals` has an open (`Pending` or `ChangesRequested`) approval touching the model.
3. It preserves field UUID identities across renames (`was`), inserts a new `bolt_history_schema` version under the same `lineage`, and atomically flips `bolt_history_current`.

---

## 5. Schema Migration & Replay Verification Loop

Blank already demonstrates Bolt's deterministic, hash-verified SQL migration mechanism across three sequential migrations in `migrations/`.

```text
+--------------------------------------------------------------------------------------------+
| MIGRATION HISTORY IN templates/blank/migrations/                                           |
|                                                                                            |
|  [Empty DB]                                                                                |
|   physical hash: 4f53cda1...                                                               |
|       |                                                                                    |
|       |  0001_initial.sql  (160 steps | file hash: b7c3109c...)                            |
|       |  - Functions: store_json_valid, store_row_rules, store_statement_rules,            |
|       |    bolt_search_*, bolt_record_label_*, bolt_history_*, bolt_audit                  |
|       |  - Tables (26), FKs (15), Triggers, Indexes, Initial History Schemas               |
|       v                                                                                    |
|  [Prefix 0001]                                                                             |
|   physical hash: 8f379ee6...                                                               |
|       |                                                                                    |
|       |  0002_schema.sql   (3 steps   | file hash: 3d1affd7...)                            |
|       |  - Widens sys_user.preferences.locale: enum['en','zh'] -> text(max: 35)            |
|       |  - Drops ck__3996db29 -> re-registers history -> validates rows -> adds ck__8405.. |
|       v                                                                                    |
|  [Prefix 0002]                                                                             |
|   physical hash: 3591d56e...                                                               |
|       |                                                                                    |
|       |  0003_schema.sql   (3 steps   | file hash: 26f1342e...)                            |
|       |  - Adds optional sys_user.preferences.email_notifications: bool                    |
|       |  - Drops ck__8405d565 -> re-registers history -> validates rows -> adds ck__5ef8.. |
|       v                                                                                    |
|  [Prefix 0003 / HEAD]                                                                      |
|   physical hash: 67435526...  <===>  snapshot.json (hash: 9fcd24a1...) + physical.json     |
+---------------------------------------------+----------------------------------------------+
                                              |
                                              v
+--------------------------------------------------------------------------------------------+
| VERIFICATION LOOP (`bunx bolt check` & `bunx bolt build`)                                  |
|                                                                                            |
|   1. Compile src/ models + platform models ---------> Expected Snapshot                    |
|   2. Spin up scratch native DB (PGlite)                                                    |
|   3. Replay "" -> 0001 -> 0002 -> 0003 step by step                                        |
|   4. At EVERY prefix: inspect catalog -> hash physical state -> compare migrations.lock    |
|   5. At HEAD: compare catalog against physical.json (format 2) & Expected Snapshot         |
|                                                                                            |
|   Mismatch? --> `bolt check` FAILS   |   Schema changed? --> `bolt build` emits 0004_*.sql |
+--------------------------------------------------------------------------------------------+
```

### Hazard Annotations & Commit Atomicity

- Each generated SQL file documents step hazards (`additive`, `validating`, `data`) and lock risks (`access-exclusive-lock`, `table-scan`) directly in comments (see `0002_schema.sql` and `0003_schema.sql`).
- Shape-changing constraints include an editable `data:` section followed by an explicit row-count validation `DO` block that aborts with the offending row count before adding the new `CHECK` constraint.
- Always commit `migrations/*.sql`, `migrations/snapshot.json`, `migrations/migrations.lock.json`, and `migrations/physical.json` together as a single atomic unit.

---

## 6. Access Control, Approval Lifecycle & Norbius Authoring Loop

Blank ships with **0 teams**, **0 policies**, and **0 approval routes**. The diagram below shows both Blank's current unopinionated baseline and the exact Bolt authority/approval substrate activated once teams and policies are authored.

```text
+--------------------------------------------------------------------------------------------+
| A. AUTHORITY & APPROVAL RESOLUTION                                                         |
|                                                                                            |
|  Caller Identity                                                                           |
|   +-- Workspace Admin (sys_user.admin=true, kind='staff') -> Shell/Settings/Studio control |
|   +-- Staff / External / Anonymous (sys_user.team)        -> Holds its sys_team's policies |
|   +-- API Key (sys_api_key.team)                          -> Scoped to assigned team       |
|   +-- Reserved System Identity (automations)              -> Declared `policies` only      |
|                                                              (actor.* matches nothing)     |
|                                                                                            |
|  Blank Baseline (Today):                                                                   |
|   0 seeded teams, 0 authored policies   --> `notes` has 0 write verbs (read-only)          |
|                                                                                            |
|  Once Authored (policy/+*.policy.ts, with sys_team rows holding the policies):             |
|                                                                                            |
|   Write Attempt ---> Policy Check --+--> Direct Grant -------------> Commit immediately    |
|                                     |                                                      |
|                                     +--> Approval-Gated Grant -----> Hold provisional write|
|                                                                      in bolt_approvals     |
|                                                                          |                 |
|         +----------------------------------------------------------------+                 |
|         v                                                                                  |
|   [Pending] <--next Save (reevaluate)-- [ChangesRequested]                                 |
|     |   |   \                                   ^                                          |
|     |   |    +---request_changes----------------+                                          |
|     |   +--------reject / withdraw------------> [Rejected] / [Withdrawn] (restore ckpt)    |
|     +------------approve----------------------> [Approved] (commits + approval_effect)     |
|     (superseder team) ------------------------> [Superseded]                               |
+--------------------------------------------------------------------------------------------+

+--------------------------------------------------------------------------------------------+
| B. NORBIUS WORKSPACE STUDIO AUTHORING LOOP                                                 |
|                                                                                            |
|  Workspace Member                  Norbius (src/agent/+agent.md + AGENTS.md)               |
|  +-----------------------+         +-----------------------------------------------------+ |
|  | Describes domain      |-------->| 1. Reads current declarations, records & AGENTS.md  | |
|  | workflow or asks to   |         | 2. Authors draft model / app / policy / automation  | |
|  | build first app       |         |    (respecting ownership folders & read-only notes) | |
|  +-----------------------+         +--------------------------+--------------------------+ |
|              ^                                                |                            |
|              | Preview & Publish                              v                            |
|  +-----------+-----------+         +-----------------------------------------------------+ |
|  | Human reviews draft   |<--------| 3. Validates draft with `bolt check` & migration    | |
|  | in Studio preview and |         |    replay before exposing draft for publication     | |
|  | publishes release     |         +-----------------------------------------------------+ |
|  +-----------------------+                                                                 |
+--------------------------------------------------------------------------------------------+
```

### Authority Baseline Matrix (Blank Out of the Box)

| Principal                                          | Workspace Shell & Settings                                               | `notes` Model                                                                       | Custom Apps / Automations                 |
| -------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| Workspace Admin (`kind = 'staff'`, `admin = true`) | Full member, integration pairing, settings, and Studio draft publication | Read output `default` (`title`, `body`); **no writes** (no write contract declared) | None authored (`0` apps, `0` automations) |
| Non-Admin Member (`sys_user`)                      | Standard shell access; **People** cannot edit policy definitions         | Governed by authored policies once defined (none yet)                               | None authored                             |
| External / Anonymous (`kind != 'staff'`)           | Cannot hold `admin = true` (DB constraint `admin_staff`)                 | No access without explicit authored policy                                          | None authored                             |
| Automation System Identity                         | N/A                                                                      | N/A                                                                                 | `0` automations declared                  |

---

## 7. Localization (`i18n`) & Seed Resolution Flow

Blank ships configured for English and Simplified Chinese (`Asia/Singapore`, `en-SG`) and boots completely empty unless seeded externally.

```text
  LOCALIZATION RESOLUTION                              SEED & INITIALIZATION FLOW
  =======================                              ==========================

  +-------------------------------+                    +-------------------------------+
  | src/+workspace.ts             |                    | seed/+seeder.ts               |
  |  tz:        'Asia/Singapore'  |                    |  seeder({                     |
  |  locale:    'en-SG'           |                    |    bank: { tree: 'blank' }    |
  |  languages: ['en', 'zh']      |                    |  })                           |
  +---------------+---------------+                    +---------------+---------------+
                  |                                                    |
                  v                                       +------------+------------+
  +-------------------------------+                       |                         |
  | User Preference Override      |                       v                         v
  |  sys_user.preferences.locale  |             +-------------------+     +-------------------+
  |  (text, max 35 chars; 0002)   |             | Public Base Pack  |     | External Seed Bank|
  +---------------+---------------+             | (in release art.) |     | (--bank=<path>)   |
                  |                             |  0 public rows    |     |  In-memory read   |
         +--------+--------+                    +---------+---------+     |  of tree 'blank'  |
         | en              | zh                           |               |  (demo members)   |
         v                 v                              |               +---------+---------+
  +-------------+   +--------------------+                |                         |
  | +messages.ts|   | +zh.messages.ts    |                +------------+------------+
  | label:Notes |   | models.notes:      |                             |
  | sing: Note  |   |  label, singular   |                             v
  | (field keys |   |  fields.title      |                   +-------------------+
  |  default)   |   |  fields.body       |                   | Tenant Database   |
  +-------------+   +--------------------+                   |  Standard boot:   |
                                                             |   0 business rows |
                                                             +-------------------+
```

### Runtime Notes

- **Locale widening (`0002_schema.sql`):** `sys_user.preferences.locale` accepts arbitrary BCP-47 tags up to 35 characters (`max: 35`), falling back to the workspace default (`en-SG` / `en`) when no catalog exists for a tag.
- **Chinese catalog (`src/i18n/+zh.messages.ts`):** Maps `models.notes.label` and `models.notes.singular` to `笔记`, `models.notes.fields.title` to `标题`, and `models.notes.fields.body` to `正文`.
- **Seed isolation:** Blank intentionally contains no `seed/public/` directory and no `seed/test/` fixtures. Release artifacts ship completely empty; private demo members exist only in an external operator bank read in memory during explicit `bolt seed --bank=<path>` runs.
