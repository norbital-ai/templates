# CRM Architecture & Inner Mechanisms

Technical deep-dive into the CRM workspace (`src/+workspace.ts`: `tz: 'Asia/Singapore'`, `locale: 'en-SG'`, `languages: ['en', 'zh']`, `currency: 'SGD'`, `apps: ['crm', 'configuration']`, `ai: {}`, `convert: { to: ['pdf'] }`). Every symbol, constraint, formula, threshold, schedule, and guard below is verified directly against `src/`.

## Table of Contents

1. [System Topology & Runtime Architecture](#1-system-topology--runtime-architecture)
2. [Data Model Ownership & ER Architecture (22 Models)](#2-data-model-ownership--er-architecture-22-models)
3. [State Machines, Commitment Gating & Record Locks](#3-state-machines-commitment-gating--record-locks)
4. [Multi-Channel Message Intake, Fairness & System 1 Routing](#4-multi-channel-message-intake-fairness--system-1-routing)
5. [Two-Way Google Calendar Sync & Conflict Resolution](#5-two-way-google-calendar-sync--conflict-resolution)
6. [Meeting Recording, Diarization, Browser CAM++ Voiceprints & Minutes](#6-meeting-recording-diarization-browser-cam-voiceprints--minutes)
7. [Lead Ingestion, Consolidated Research & SOW Merge Engine](#7-lead-ingestion-consolidated-research--sow-merge-engine)
8. [Document Rendering, PDF Pipeline, Signing & Apollo Outreach](#8-document-rendering-pdf-pipeline-signing--apollo-outreach)
9. [Access Control, Privacy Boundaries & Authority Matrix](#9-access-control-privacy-boundaries--authority-matrix)

---

## 1. System Topology & Runtime Architecture

The workspace splits work cleanly across three runtime planes:

- **Browser Plane (Svelte 5 Pages, Record Hubs & Local Media/ML):** Renders two apps (`crm` and `configuration`), manages crash-safe audio capture via `MediaRecorder` + IndexedDB (`norbital_hq_recordings`), executes biometric speaker embedding locally via `onnxruntime-web/wasm` + pinned Hugging Face CAM++ weights (never shipping large weights in the release or sending raw voiceprints to third-party servers), and renders live A4 document previews (`DocumentPaper` + `ctx.preview_pdf`).
- **Workspace Server Plane (22 Models, 21 Automations, 2 Syncs):** Owns database integrity, transforms, post-commit effects, deduplication keys, state transitions, optimistic revision locks, and background pipelines running on the Bolt engine (PGlite locally/tests, per-tenant PostgreSQL in production).
- **Host Facilities & External Providers:** Supplies sealed integration credentials, AI inference (`ctx.ai.sys_1.decide`, `ctx.ai.sys_2.infer`), web fetch/search (`ctx.web.read`, `web_search`), media & spreadsheet ingest + Pandoc/Typst PDF conversion (`ctx.convert.ingest`, `ctx.convert.document`), and messaging/notification delivery (`ctx.send`, `ctx.notify`).

```text
+============================================================================================+
|                            BROWSER PLANE (Svelte 5 + Page SDK)                             |
+============================================================================================+
|  App: crm (3 pages)                          |  App: configuration (4 pages)               |
|  - dashboard   (CalendarSchedule KPIs+Cal)   |  - connections (Bolt <Connections> +        |
|  - companies   (Table, Import, Cohorts,      |                 Message rules & logs sheets)|
|                 DocumentPreviewSheet)        |  - products    (products + offering_set.)   |
|  - tasks       (Open tasks/follow-ups queue) |  - templates   (template_docs + signatory)  |
|                                              |  - sequences   (sequences + outreach_set.)  |
|  - companies   (Details, Contacts, Research, +---------------------------------------------+
|                 Profile, ActivityTimeline)   |  Browser-Local Engines (no server bloat)    |
|  - projects    (SOW tables, Capture rules,   |  - MediaRecorder 32kbps + IndexedDB drafts  |
|                 Activities, DocumentTab)     |    (`meeting-capture`, `recording-store`)   |
|  - activities  (MeetingActivity: Recordings, |  - onnxruntime-web/wasm (jsDelivr CDN) +    |
|                 Minutes, Action items)       |    CAM++ ONNX (Hugging Face pinned commit)  |
|  - cohorts / contacts / template_docs / seq  |  - DocumentPaper A4 CSS + ctx.preview_pdf   |
+==============================+===============================+=============================+
                               |  PageBolt queries / ctx.act / ctx.run / ctx.upload
                               v
+============================================================================================+
|                       BOLT WORKSPACE RUNTIME (Asia/Singapore, en/zh)                       |
+============================================================================================+
|  22 Models + Transforms + Post-Commit Effects  |  21 Automations (4 cron + 17 event/call)  |
|  - Dedupe keys (company_key, domain, uen_key,  |  - Intake: sync_messages (* * * * *),     |
|    email/phone/telegram/slack/discord keys)    |    classify_messages (*/5 * * * *)        |
|  - Manual-edit provenance (manual_fields,      |  - Leads:  import_leads (0 7 * * *),      |
|    origin: 'manual' | 'generated')             |    research_lead, launch/sync_cohort      |
|  - Commitment gate (signed_documents -> client)|  - Scope:  update_requirements            |
|  - 2 Syncs: calendar_entries (read) +          |  - Audio:  transcribe_meeting,            |
|    activities (write) <-> google_calendar      |    meeting_notes, save_voice              |
|  - 1 Seeded team + 6 Policies                  |  - Cadence: remind_follow_ups (0 9 * * *) |
+====================+===========================+=========================+=================+
                     |                           |                         |
                     v                           v                         v
+-------------------------------+ +-----------------------------+ +--------------------------+
|        HOST FACILITIES        | |  PERSONAL CONNECTIONS       | |  WORKSPACE CHANNELS      |
|  - ctx.ai.sys_1 / sys_2       | |  (owner = member, inbound   | |  (owner = null, admin)   |
|  - ctx.web.read / web_search  | |   except calendar write)    | |  - email (send docs/msg) |
|  - ctx.convert.ingest (ASR,   | |  - email (Gmail/IMAP/MS)    | |  - whatsapp (replies+DM) |
|    diarization, CSV/XLSX)     | |  - whatsapp (Baileys QR)    | |  - telegram / slack /    |
|  - ctx.convert.document (PDF) | |  - google_calendar (2-way)  | |    discord (intake + DM) |
|  - ctx.notify / ctx.send      | |                             | |  - apollo (HTTP 50/min)  |
+-------------------------------+ +-----------------------------+ +--------------------------+
```

---

## 2. Data Model Ownership & ER Architecture (22 Models)

`src/data/model/` mirrors record ownership. Only leaf folders name models; child models sit under their parent directory. Foreign keys enforce referential integrity across four ownership branches plus standalone operational roots.

```text
==============================================================================================
BRANCH 1: COMPANIES & DELIVERY (10 models)
==============================================================================================

  +------------------------------------------------------------------------+
  | companies (root)                                                       |
  | UK: company_key (SQL computed), domain, uen_key (SQL computed)         |
  | state: stage [lead|qualified|client|lost]  count: job_count(projects)  |
  | AI: research, use_cases, industry, description, preferences, manual_*  |
  +---+-------------------+--------------------+---------------------+-----+
      | 1:N (set ref)     | 1:N (cascade)      | 1:N (company_id)    | 1:N (company)
      v                   v                    v                     |
  +-------------------+ +--------------------+ +-------------------+ |
  | contacts          | | potential_projects | | projects          | |
  | UK: email_key     | | summary, rank      | | capture_rules     | |
  | keys: email,phone,| | status: proposed/  | | overview + 6 SOW  | |
  |  telegram,slack,  | |  kept/discarded    | |  JSON tables +    | |
  |  discord (SQL)    | | prompt_version     | |  decisions        | |
  | vector(512):      | +--------------------+ | manual_fields     | |
  |  voice_embedding  |                        | lead_contact_id ->| |
  | company_signatory |                        | signatory(setNull)| |
  +---+---------------+                        +-+-------+-------+-+ |
      |                                          |       |       |   |
      | (contact_id / owner_id / signed_by)      | 1:N   | 1:N   |   |
      |         +--------------------------------+       |       |   |
      |         |                  +---------------------+       |   |
      v         v                  v                             v   v
  +---------------------------+ +--------------------+  +--------------------+
  | activities                | | issues             |  | project_documents  |
  | kind: note|recording|call|| | status, severity   |  | kind: brief |      |
  |  message|meeting|milestone| | raised/resolved_on |  |  supporting        |
  | state: status             | | owner_id->contacts |  | markdown_body,file |
  | UK: (source_key,ext_id)   | +--------------------+  +--------------------+
  | UK: (source_message)      |
  | UK: (source_cal,ext_id)   |  +-------------------------------------------+
  | sync: google_calendar(W)  |  | signed_documents (immutable; create/del)  |
  +------+------------+-------+  | company -> companies, project -> projects |
         | owned      | owned    | signed_by -> contacts (set_null)          |
         v            v          | template_version -> template_documents    |
  +--------------+ +-----------+ | terms (frozen JSON map), signed_copy file |
  | meeting_     | | meeting_  | +-------------------------------------------+
  | recordings   | | speakers  |
  | audio, segs  | | label,name|  UK(speakers): (recording,label) where rec!=null
  | transcription| | contact   |                (meeting,label)   where rec==null
  +------+-------+ +-----^-----+
         | owned (opt)   |
         +---------------+

==============================================================================================
BRANCH 2: TEMPLATES (2 models)          BRANCH 3: OUTREACH (3 models)
==============================================================================================
  +-----------------------------+         +--------------------+     +--------------------+
  | agreement_settings          |         | sequences          | 1:N | cohorts            |
  | UK: scope='workspace' (1)   |         | name, steps (JSON) |---->| state: status      |
  | provider_* + signature img  |         +--------------------+     |  draft|launched|   |
  +-----------------------------+                                    |  done              |
  +-----------------------------+                                    | counts: member,    |
  | template_documents          |                                    |  replied, meeting, |
  | UK: (key, version)          |                                    |  stopped           |
  | kind: document|email|res.   |                                    +---------+----------+
  | scope: company|project      |                                              | 1:N (cascade)
  | commitment (bool), required |                                              v
  +-----------------------------+                                    +--------------------+
                                                                     | cohort_members     |
==================================================================   | contact, company   |
BRANCH 4: PLANNING, OFFERING & INTAKE ROOTS (7 models)               | UK(active=true):   |
==================================================================   |  (contact),        |
  +-----------------------------+  +-----------------------------+   |  (company)         |
  | calendar_entries            |  | tasks                       |   | step, replied,     |
  | UK(import_key):             |  | kind: task | follow_up      |   |  meeting_booked,   |
  |  (account,calendar_id,ext)  |  | state: status [open|done|   |   |  stopped           |
  | sync: google_calendar (R)   |  |  cancelled]                 |   +--------------------+
  | account->sys_integration    |  | reminder: none|before|due|  |
  | source_user->sys_user       |  |  overdue|escalated          |  +---------------------+
  +-----------------------------+  | refs: company, project_id,  |  | offering_settings   |
  +-----------------------------+  |  contact_id, meeting, owner |  | UK: scope='ws' (1)  |
  | communication_settings      |  +-----------------------------+  +---------------------+
  | UK: owner (1 per member)    |  +-----------------------------+  +---------------------+
  | hard_filter, class._sop     |  | outreach_settings           |  | products            |
  +-----------------------------+  | UK: scope='workspace' (1)   |  | name, category,     |
  +-----------------------------+  | projects_prompt, version++  |  |  fit_criteria,active|
  | notes (read-only seeded)    |  +-----------------------------+  +---------------------+
  +-----------------------------+
```

### Key Computed & Constraint Invariants

| Model                | Computed Keys / Unique Constraints                                                                                                           | Transform Guardrails                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companies`          | `company_key` (lowercased, `&` -> `and`, legal suffixes stripped), `uen_key` (alphanumeric upper); unique `company_key`, `domain`, `uen_key` | Blocks create with `stage: 'client'`; names existing company back on duplicate; blocks moving into/out of `client` unless commitment signed state matches (`as_of: 'act'`).                         |
| `contacts`           | `email_key`, `phone_key` (digits only), `telegram_key` (`@user`), `slack_key` (`slack:id`), `discord_key` (`discord:id`); unique `email_key` | Enforces at most one `company_signatory` per company and requires `company_id != null`.                                                                                                             |
| `projects`           | Text index on `name`, `company_id`                                                                                                           | Requires `company_id` on create; forbids reassigning `company_id` on update; requires `signatory` to belong to the same `company_id`.                                                               |
| `tasks`              | Index `by_status_due` on `(status, due_on)`                                                                                                  | Verifies `company`, `project_id.company_id`, and `contact_id.company_id` all agree; resets `reminder = 'none'` and `reminded_at = null` whenever `due_on`, `owner`, or reopening to `open` changes. |
| `signed_documents`   | No `update` verb; immutable snapshot                                                                                                         | Accepts one upload per act; validates `template.kind === 'document'`, matching `scope` (`company` vs `project`), and customer ownership; freezes `terms` and transitions company to/from `client`.  |
| `template_documents` | Unique `(key, version)`                                                                                                                      | Non-empty `body`; every `required` placeholder must appear in `subject` or `body`; auto-increments `version` per `key`. Only `drafting_instructions` is mutable on existing rows.                   |
| `outreach_settings`  | Unique `scope = 'workspace'`                                                                                                                 | Auto-increments `prompt_version` whenever `projects_prompt` changes.                                                                                                                                |

---

## 3. State Machines, Commitment Gating & Record Locks

Four models declare native `state` fields, backed by cross-model transactional transforms (`as_of: 'act'`) and lock constraints:

```text
1) COMPANIES.STAGE & COMMITMENT GATE
==============================================================================================

                                [Sales: crm policy]
                   +-------------------------------------------+
                   |                                           v
              +----+---+  Sales/Admin   +-----------+    +----------+
              |  lead  |--------------->| qualified |--->|   lost   |
              | (init) |<---------------|           |    |          |
              +---+----+  Sales/Admin   +-----+-----+    +----+-----+
                  |                           |  ^            |   |
                  |  ONLY via signed_documents|  |            |   | [Admin ONLY:
                  |  where template.commitment|  |            |   |  crm policy omits
                  |  == true (checked in both |  |            |   |  lost -> lead]
                  |  signed_documents &       |  |            |   v
                  |  companies transforms     |  |            | (lead)
                  |  with as_of: 'act')       |  |            |
                  +------------+--------------+--+------------+
                               |                 |
                               v                 | ONLY when Admin deletes the LAST
                          +----+----+            | commitment signed_documents row
                          | client  |------------+ (auto-reverts stage -> qualified)
                          +---------+

   Invariant: (after.stage === 'client') === exists(signed_documents join commitment template)
   Any direct write violating this returns `errors.client_needs_commitment`.


2) COHORTS.STATUS, LOCK & LEAD RELEASE
==============================================================================================

   +---------+   launch_cohort (hq_automation)    +------------+
   |  draft  |----------------------------------->|  launched  |  stamp: launched_at
   | (init)  |                                    +-----+------+
   +----+----+                                          |
        |                                               | Sales/Admin (crm policy)
        | Sales/Admin (crm policy)                      v
        +---------------------------------------->+------------+
                                                  |    done    |  stamp: done_at
                                                  +------------+
                                                        |
   LOCK CONSTRAINT `sent`:                              v  cohorts.update.transform:
   locked when status != 'draft'                        updates all active cohort_members
   except: ['name', 'status', 'synced_at']              to { active: false }, releasing
   (locks `sequence` & `apollo_sequence_id`)            unique partial constraints on
                                                        (contact) & (company) for reuse.


3) ACTIVITIES.STATUS & TASKS.STATUS
==============================================================================================

   +--------+  complete (tasks / admin)   +--------+
   |  open  |---------------------------->|  done  |   Note:
   | (init) |<----------------------------|        |   - `crm` policy on activities allows
   +---+----+         reopen              +--------+     only open <-> cancelled (which
       |                                                 syncs meeting delete/recreate to
       | cancel   +-----------+                          Google Calendar).
       +--------->| cancelled |                        - `tasks` update resets reminder='none'
       |<---------|           |                          & reminded_at=null on reopen,
         reopen   +-----------+                          due_on change, or owner change.


4) TEMPLATE & SIGNED DOCUMENT IMMUTABILITY
==============================================================================================

   template_documents (key="sow", v1) ---> template_documents_new_version (Admin only)
        |  [only drafting_instructions          |  creates new row (key="sow", v2)
        |   is mutable in place]                v
        v                                  template_documents (key="sow", v2)
   signed_documents (immutable row)
   - stores template_version=v1 + frozen `terms` JSON at upload time
   - Drift detection: termsKey(signed.template_version, signed.terms)
                   != termsKey(latestTemplate.id, currentDocumentValues)
     (excluding DATED placeholders: `today`, `date`, `date_long`)
```

---

## 4. Multi-Channel Message Intake, Fairness & System 1 Routing

Message ingestion separates **mirroring** (`sync_messages`, every minute) from **classification** (`classify_messages`, every 5 minutes) and uses two fairness mechanisms so historical backfills never starve live client messages:

1. **Binary-Search Prefix Skip (`filedThrough`):** When the oldest 50-row page is already filed, `sync_messages` binary-searches the sequence space (`low..high`) using paired `sys_message` vs `activities` count queries to jump directly past the longest contiguous filed prefix.
2. **Dual-Lane Batch Selection (`selectBatch`):** Reserves `floor((batch - 1) / 2)` slots (12 of 25) round-robin across each provider's 4 newest unfiled messages (`dated` by `source_at` + `undated` by `created_at`), then fills the remaining slots in ascending `seq` order to steadily drain backfill.

```text
  Personal (email, whatsapp) & Workspace (email, whatsapp, telegram, slack, discord)
                                         |
                                         v
  +-----------------------------------------------------------------------------------+
  | sys_message + sys_conversation (inputs/attachments, group participants)           |
  +--------------------------------------+--------------------------------------------+
                                         |
         Import Boundary (`message-import.ts`: sys_integration.import_start)
         - 'all'    : unrestricted
         - 'since'  : sys_message.source_at  >= import_start.at
         - 'native' : sys_message.created_at >= import_start.selectedAt
                                         |
                                         v
  +-----------------------------------------------------------------------------------+
  | sync_messages  [cron: * * * * *, rest: 1d, concurrency: 1, policy: hq_automation] |
  | 1. Binary-search filedThrough(mid) to skip already-filed seq prefix               |
  | 2. Dual-lane selectBatch(oldest[50], recent[4/provider], batch=25):               |
  |      - up to 12 fresh slots (round-robin across providers)                        |
  |      - remaining slots oldest-first by seq                                        |
  | 3. For each message:                                                              |
  |      - Prefix telegram:/slack:/discord: handle; extract attachments (<= 20 MiB)   |
  |      - If empty text + audio attachment (voice note):                             |
  |          create activity (transcription='none', no classification yet)            |
  |          -> ctx.convert.ingest(note, { diarize: false })                          |
  |          -> update detail=transcript, segments, classification='pending'          |
  |      - Else: create activity (classification='pending'), skipRacedWrite()         |
  | 4. Schedule classify_messages immediately; self-requeue if batch full             |
  +--------------------------------------+--------------------------------------------+
                                         |
                                         v
  +-----------------------------------------------------------------------------------+
  | classify_messages  [cron: */5 * * * *, rest: 1d, concurrency: 1]                  |
  | A. Import-start reconciliation:                                                   |
  |    - Pending/review outside import_start -> ignored ('beforeImport')              |
  |    - Previously excluded now inside      -> reset to pending                      |
  | B. Batch select (max 50): 25 newest occurred_at + oldest source_seq,              |
  |    where classified_at is null OR older than 5 min (retryAfter)                   |
  | C. Context load: communication_settings, group participants, matching contacts    |
  |    (email/phone/telegram/slack/discord keys, cap 200), companies (cap 60),        |
  |    projects (cap 120), 30-min thread history (max 8 msgs/item)                    |
  +--------------------------------------+--------------------------------------------+
                                         |
             +---------------------------+---------------------------+
             | hard_filter == 'customer_pics'                        | Passes hard filter
             | AND sender + group participants match NO company PIC  | (or hard_filter='all')
             v                                                       v
  +-------------------------+                     +-----------------------------------+
  | IGNORED (hard_filter)   |                     | ctx.ai.sys_1.decide               |
  | (or pending if contact  |                     | - Untrusted message framing       |
  |  overflow > 200)        |                     | - 30-min conversation context     |
  +-------------------------+                     | - Job capture_rules > personal SOP|
                                                  | - Questions: relevance, company,  |
                                                  |   project, certainty              |
                                                  +-----------------+-----------------+
                                                                    |
          +---------------------------------+-----------------------+-----------------+
          | relevance=='useful'             | relevance=='ignored'  | Else / AI down  |
          | & directoryComplete             | & confident           |                 |
          | & rel/cert/comp/proj >= 0.85    | (>=0.85 & 'Clear      | Check evidentJob|
          | & certainty=='Clear direct ev.' |  direct evidence')    | (exact job name |
          v                                 v                       |  or sole open)  |
  +------------------+            +------------------+              +--------+--------+
  | FILED ('useful') |            | IGNORED ('model')|                       |
  | -> deriveFrom()  |            +------------------+          +------------+----------+
  |    queues SOW +  |                                          | Matched               | None
  |    profile sync  |                                          v                       v
  +------------------+                              +------------------+   +------------------+
                                                    | FILED ('useful', |   | RETRY ('pending')|
                                                    |  'hard_filter')  |   | retries in 5 min |
                                                    +------------------+   +------------------+

  REPLAY TRIGGERS (bounded 50-row pages, preserving manual classifications):
  - contacts create/update (handle or company change) -> replay_message_routes (all/owner)
  - communication_settings create/update              -> replay_message_routes (owner)
  - group chat with newly seen PIC                    -> replay_message_routes (thread)
  - projects.capture_rules update                     -> refresh_job_capture_rules (project)
  - Human reassign via `activities_file`              -> classified_by='manual' (locked)
```

---

## 5. Two-Way Google Calendar Sync & Conflict Resolution

Personal Google Calendars run bidirectionally without echo loops or silent data loss. `calendar_entries` is the read-only mirror of every event in each member's configured calendars; `activities` (`kind: 'meeting'`) is the CRM meeting record projected from client-matched events or authored inside CRM.

```text
                              +-------------------------+
                              |  Google Calendar API    |
                              +-----+-------------+-----+
                                    |             ^
         (A) INBOUND SYNC           |             |         (B) OUTBOUND SYNC
   calendar_entries.syncs.          |             |   activities.syncs.google_calendar
   google_calendar                  |             |   [policy: calendar_activities]
   [policy: calendar_import]        |             |   Fires ONLY when:
   [partitions: 'calendars']        |             |   - kind == 'meeting'
   - Per-calendar cursor            |             |   - calendar_revision > 0
   - Decodes source_event JSON      |             |   - op=='create' OR calendar_revision
   - Cancellations mark held rows   |             |     changed (never on inbound/notes)
     cancelled; unseen ignored      |             |
                                    v             |   Event ID: eventIdOf(activity.id)
                        +-----------+-----------+-+   (base32hex -> idempotent POST; 409
                        |   calendar_entries    | |   falls through to GET)
                        | UK: (account,cal,ext) | |
                        +-----------+-----------+ |   Optimistic Concurrency Guard:
                                    |             |   1. GET event from Google
                          create/update effect    |   2. If private.norbital_revision ==
                                    |             |      current -> already applied, ack
                                    v             |   3. Compare event.etag vs seen
                        +-----------+-----------+ |      [$version, row.calendar_etag]
                        | sync_calendar_        | |   4. Mismatch or HTTP 412 -> REFUSE
                        | activities            | |      `errors.calendar_changed`
                        | [concurrency: 1]      | |      (Google wins; local edit rolls
                        +-----------+-----------+ |       back while inbound sync arrives)
                                    |             |   5. Match -> If-Match: etag
             +----------------------+             |      - status=='cancelled' -> DELETE
             | Check existing activity:           |      - else -> PATCH (preserves self
             | 1) Echo? same etag+status OR       |        & guest RSVP statuses; sets
             |    already cancelled               |        sendUpdates='all'|'none' from
             | 2) Pending outbound?               |        opt-in `calendar_notify`)
             |    calendar_revision > 0 AND       |
             |    $sync.status == 'pending'       |
             |    -> link source_calendar only,   |
             |       DO NOT overwrite local edit  |
             | 3) Cancelled in Google?            |
             |    -> set status='cancelled'       |
             |       (unless status=='done')      |
             | 4) Match non-self non-declined     |
             |    attendees/organizer to contacts |
             |    - 1 company + 1 active job      |
             |      (not complete/on_hold)        |
             |      -> classification='useful'    |
             |    - ambiguous -> 'review'         |
             |    - manual/HQ-created meeting     |
             |      preserves existing filing     |
             v                                    |
  +----------+------------------------------------+------------------------------------+
  | activities (kind='meeting')                                                        |
  | Member edit transform (`activities/+model.ts`):                                    |
  | - Rejects editing calendar_id/etag/revision directly (`errors.calendar_fields_...`)|
  | - Verifies calendar_account.owner === actor.id (`errors.calendar_owner_only`)      |
  | - Defaults new member meeting to their active personal google_calendar ('primary') |
  | - If syncedChange(subject|detail|location|attendees|times|status):                 |
  |     calendar_revision += 1; calendar_notify = (input.calendar_notify === true)     |
  +------------------------------------------------------------------------------------+

  Contact Replay: contacts create / update(email, company_id) -> replay_calendar_activities
                  (pages all calendar_entries in 50-row batches -> sync_calendar_activities)
```

---

## 6. Meeting Recording, Diarization, Browser CAM++ Voiceprints & Minutes

Audio capture, server transcription, local biometric voice matching, and minutes generation span browser and host cleanly while keeping raw biometric inference entirely client-side:

```text
  STAGE 1: BROWSER CAPTURE / UPLOAD (`ActivityCreate.svelte` & `MeetingActivity.svelte`)
  ======================================================================================
  Option A: Live Microphone (`meeting-capture.ts` + `recording-store.ts`)
    getUserMedia(audio) -> MediaRecorder (32 kbps; mp4/ogg/webm, 2s chunks, max 19.5 MiB)
      |-> every chunk persisted to IndexedDB (`norbital_hq_recordings` / `drafts`)
      |-> survives pause, reload, crash -> resume appends a new segment array
      +-> Stop & Save: `buildRecordingFile()`
            - 1 segment  -> native compressed File (.m4a / .ogg / .webm)
            - N segments -> OfflineAudioContext resamples & joins to 16 kHz mono WAV
  Option B: Multi-File Upload (`audio/*`, `video/*`, max 20 MiB each, concurrency 2)
      |
      v
  ctx.upload -> `meeting_recordings.create` (transcription = 'pending')
      |  [post-commit effect schedules `transcribe_meeting` with { recording_ids }]
      v

  STAGE 2: SERVER DIARIZATION (`+transcribe_meeting.automation.ts`)
  ======================================================================================
  [retry: 3 attempts, 1min backoff; idempotency key: `transcribe-rec:<id>:<revision>`]
  ctx.convert.ingest(rec.audio, { diarize: true })
      |-- Unavailable / FacilityFailure -> sets transcription='unavailable'|'failed'
      +-> Success -> atomic act:
            1. Delete prior `meeting_speakers` for this recording
            2. Create `meeting_speakers` rows per distinct diarizer label
            3. Update `meeting_recordings`: transcription='done',
               segments=[{ speaker, start, end, text }]
            4. Schedule `meeting_notes` (key: `meeting-notes:<meeting>`)
      |  [update effect on segments change also calls deriveFrom() -> SOW + profile sync]
      v

  STAGE 3: IN-BROWSER BIOMETRIC VOICEPRINT ENGINE (`MeetingVoices.svelte` + `voice.ts`)
  ======================================================================================
  Runs ONLY in browser (never on host; large weights never enter release):
    1. Lazy-load `onnxruntime-web/wasm` from jsDelivr CDN (numThreads=1)
    2. Lazy-load 3D-Speaker CAM++ ONNX (~29.6 MB, pinned Hugging Face commit)
    3. Decode recording audio via OfflineAudioContext -> 16 kHz mono Float32Array
    4. Per speaker label:
         - `speakerRanges`: keep segments >= 1s, total capped at 60s
         - `fbank`: 80-bin Kaldi log-mel (25ms/400-sample frame, 10ms/160 shift,
           512-pt FFT, DC removal, 0.97 pre-emphasis, Povey window, per-bin CMVN)
         - CAM++ ONNX inference -> L2 unit-normalized 512-dim embedding vector
    5. Compare cosine similarity vs consented company contacts (`voice_consent_at != null`):
         +-------------------------------------------------------------------------+
         | score >= 0.80 AND margin >= 0.10 (vs runner-up) AND contact unassigned  |
         |   -> AUTO-ASSIGN + ENROL via `meeting_speakers_save_voice(automatic=T)` |
         +-------------------------------------------------------------------------+
         | score >= 0.75 AND margin >= 0.05                                        |
         |   -> UI SUGGESTION ("Tag as <Name>? <score>% match")                    |
         +-------------------------------------------------------------------------+
         | Manual tag + consent click -> `meeting_speakers_save_voice(consent=T)`  |
         +-------------------------------------------------------------------------+
    6. Server validation (`+meeting_speakers_save_voice.automation.ts`, policy `crm`):
         - `salesStarter(ctx.trigger, ctx)` required; consent required; norm > 0
         - If `automatic`: server re-runs `recognise()` to verify match & non-duplicate
         - Once-per-meeting dedupe (even if diarizer splits one person across labels)
         - Running weighted mean: enrol(prev, n, next) = unit((prev*n + unit(next))/(n+1))
         - Atomic update: contacts.voice_embedding/voice_samples++ & voice_enrolled_at

  STAGE 4: MEETING MINUTES & ACTION ITEMS (`+meeting_notes.automation.ts`)
  ======================================================================================
  Combines legacy `activities.segments` + all `meeting_recordings` segments (ordered by
  created_at), substituting resolved speaker names (`contact.full_name ?? name ?? label`),
  merges consecutive same-speaker turns (`transcriptPrompt`, capped to 48,000 chars):
    -> ctx.ai.sys_2.infer -> { summary, decisions[], actions[{title, owner?, due_in_days?}] }
    -> Atomic act:
         - Update `activities.notes` (Markdown) + `notes_at`
         - Create `tasks` for action items whose title is not already in `action_items`
           (due_on = today + (due_in_days ?? 7), linked to meeting/company/project/owner)
```

---

## 7. Lead Ingestion, Consolidated Research & SOW Merge Engine

Two extraction engines keep company intelligence and project Scopes of Work continuously up to date from live evidence without ever destroying human edits:

```text
  ======================================================================================
  PART A: LEAD IMPORT & CONSOLIDATED RESEARCH (`import_leads` -> `research_lead`)
  ======================================================================================
  CSV/XLSX Upload (ctx.convert.ingest)       Apollo Saved Contacts (cron 07:00, rest 7d)
  headers mapped by `leadsFromSheet()`       POST /api/v1/contacts/search (5 pages x 100)
                \                                     /
                 +-----------------+-----------------+
                                   v
  planLeads() Deduplication:
  - Company matched by `domainOf(domain|website|emailHost)` else `companyKey(name)`
  - Contact matched by lowercased `email`; first PIC on new company -> `is_primary=true`
  - Atomic act: `companies.create` (with inline contacts) + `contacts.create` (for known)
                                   |
                   companies.create.effect (if researched_at == null)
                   OR companies.update.effect (if companies.documents changed)
                   OR manual "Research company" / "Research unresearched" sweep
                                   v
  +------------------------------------------------------------------------------------+
  | research_lead [concurrency: 10; batch concurrency: 5; key: `hq:research:<id>`]     |
  |                                                                                    |
  | PHASE 1 -- Web Research & Enrichment (runs if researched_at==null OR person force) |
  |   1. Apollo enrich (only if connected & fields missing):                           |
  |        GET /api/v1/organizations/enrich + POST /api/v1/people/match                |
  |   2. Homepage read: ctx.web.read(website) (capped 12,000 chars)                    |
  |   3. Load offering_settings, active products (<=100), latest research/email        |
  |      templates, outreach_settings, kept potential_projects                         |
  |   4. Single consolidated `ctx.ai.sys_2.infer`:                                     |
  |        - tools: ['web_search'], steps: 4, rule: `size(sources) > 0`                |
  |        - returns: findings, use_cases[], angle, sources[], pic_seniority,          |
  |          projects[] (3-5 ideas), outreach{subject,body} (if lead & 0 activities)   |
  |   5. Renumber citations [1..N], deduplicate URLs, append `## References`           |
  |   6. Atomic act: update companies (fills+research+use_cases+researched_at),        |
  |      update PIC contact (fills+seniority+angle), replace 'proposed'                |
  |      potential_projects (keeping 'kept'/'discarded'), create initial follow_up task|
  |                                                                                    |
  | PHASE 2 -- Customer Profile Extraction (runs whenever evidence exists)             |
  |   - Reads up to 200 useful activities (+ meeting_recordings transcripts),          |
  |     project_documents, companies.documents (PDF/image/text files attached)         |
  |   - `ctx.ai.sys_2.infer(PROFILE_ANSWER)` -> industry, description, preferences[]   |
  |   - Applies `mergeGenerated()` + respects `companies.manual_fields`                |
  |   - Retries up to 3 attempts (exponential backoff: 1m, 2m) on facility failure     |
  +------------------------------------------------------------------------------------+

  ======================================================================================
  PART B: JOB SOW EVIDENCE EXTRACTION & MANUAL-EDIT MERGE (`update_requirements`)
  ======================================================================================
  Triggers (`deriveFrom` in `src/lib/derive.ts`, coalesced by key):
  - `activities` create/update (assigned & non-message or classification=='useful')
  - `meeting_recordings` update (segments changed)
  - `project_documents` create/update (title/body/attachment/assignment changed)
  - Reassignment refreshes BOTH former and new project/company!
                                   |
                                   v
  +------------------------------------------------------------------------------------+
  | update_requirements [concurrency: 4; key: `hq:update-requirements:<project>`]      |
  | 1. Gather all useful project activities, child meeting_recordings segments,        |
  |    project_documents, and readable attachments (application/pdf, image/*, text/*). |
  | 2. If 0 evidence rows -> clear generated items only, keep all manual items.        |
  | 3. Guard: if JSON payload > PROMPT_MAX (48,000 chars) -> store generation_error.   |
  | 4. TWO parallel `ctx.ai.sys_2.infer` calls (staying within step budget):           |
  |      Call 1 (SCOPE_ANSWER): overview, definitions, implementation_scope,           |
  |                             data_migration                                         |
  |      Call 2 (PLAN_ANSWER) : milestones, uat_tests, fees, decisions                 |
  |    (Retry up to 3 attempts with 1m -> 2m exponential backoff on failure)           |
  +----------------------------------------+-------------------------------------------+
                                           |
                                           v
  PROVENANCE & MERGE ENGINE (`src/lib/extracted.ts`)
  --------------------------------------------------------------------------------------
  When a MEMBER edits a record (`actor.kind === 'member'` in companies/projects transform):
  - Scalar fields (`overview`, `industry`, `description`):
      non-empty edit -> added to `manual_fields`; clearing to empty -> removed (re-enabled)
  - JSON list fields (definitions, implementation_scope, data_migration, milestones,
    uat_tests, fees, decisions, preferences):
      `markManual(next, before)` hashes content ignoring `origin`/`sources`; new or
      edited items get `origin: 'manual'`; unchanged generated items keep `'generated'`.

  When EXTRACTION writes back (`mergeGenerated(stored, generated, keyFn, validSourceIds)`):
  - Index all stored `origin === 'manual'` items by `norm(keyFn(item))`
  - For each generated item:
      - If a manual item shares the same normalized key -> emit MANUAL item (discard generated)
      - Else -> emit generated item with `origin: 'generated'` and `sources` filtered to
                IDs actually present in the evidence set (blocks hallucinated citations)
  - Append any remaining unmatched manual items -> NEVER overwritten or dropped
```

---

## 8. Document Rendering, PDF Pipeline, Signing & Apollo Outreach

### Part A: Dynamic Agreement Templates, PDF Export & Signing Freeze

Unsigned agreements are **never stored as rendered text**. Both the browser preview (`DocumentTab` / `DocumentPreviewSheet`) and the server email dispatcher (`send_message`) render dynamically from the latest `template_documents` version and live CRM records via shared helpers in `src/lib/documents.ts` and `src/lib/document-layout.ts`.

```text
  documentRead(key, company, project) -> 1 batch query:
  [template_documents(key), companies, contacts(crm), projects(SOW), agreement_settings]
                                         |
                                         v
  addressee() fallback order:
    explicit contact -> project.signatory -> contact.company_signatory -> contact.is_primary
                                         |
                                         v
  documentValues() builds placeholder map:
    - Dates:     today, date (DD/MM/YY), date_long (D Month YYYY)
    - Provider:  provider_company, provider_uen, provider_address, provider_name, provider_title
    - Company:   company, uen, address, website, industry, owner_name, research, use_cases
    - Contact:   contact_name, contact_title, contact_email, pic_seniority, pic_angle
    - Project:   project, overview + 6 Markdown pipe tables (`sowSections`)
                                         |
                                         v
  render(tidyTemplate(body), values) -> missing values shown as `[placeholder_name]`
  missing(template.required, values) -> blocks sending if non-empty
                                         |
                 +-----------------------+-----------------------+
                 | BROWSER PATH                                  | SERVER PATH (`send_message`)
                 v                                               v
  +-------------------------------------+         +---------------------------------------+
  | DocumentPaper.svelte                |         | 1. Check missing.length == 0 &        |
  | - `documentLayout()` detects C&A:   |         |    active workspace email (owner=null)|
  |   cover block & 2-col signature tbl |         | 2. Fetch provider_signature bytes     |
  | - A4 CSS (210x297mm, 25.4mm margin) |         | 3. `documentForPdf()` injects Typst   |
  | - Download / Render PDF Preview via |         |    page/cover/2-col signature grid    |
  |   `ctx.preview_pdf(documentForPdf)` |         | 4. `ctx.convert.document({to:'pdf'})` |
  +-------------------------------------+         | 5. `ctx.send(mailbox, [pdf])`         |
                                                  | 6. `ctx.notify` sender copy of PDF    |
                                                  +---------------------------------------+
                                         |
                             Signed copy returned by client
                                         v
  +---------------------------------------------------------------------------------------+
  | signed_documents.create (single upload, <= 20 MiB PDF/image)                          |
  | - Re-queries live `documentRead()` and freezes `terms: documentValues(...)`           |
  | - Locks `template_version` to the exact version ID signed                             |
  | - If `template.commitment === true` and `company.stage !== 'client'`:                 |
  |     atomically updates `companies.stage = 'client'` in the same transaction           |
  | - Later previews compare `termsKey(signed)` vs `termsKey(current)` (ignoring dates)   |
  |   to show "Details changed since signing" drift banner when facts or templates change |
  +---------------------------------------------------------------------------------------+
```

### Part B: Apollo Cold Outreach Cohorts & Daily Follow-Up Cadence

```text
  COLD OUTREACH LIFECYCLE (`outreach.ts`, `launch_cohort`, `sync_cohort`)
  ======================================================================================
  sequences (ordered day_offset steps: email/call)   outreach_settings (sender_name,
    variables: {{first_name}}, {{company}},            apollo_projects_variable,
               {{potential_projects}}, {{sender_name}} apollo_field_id)
                         \                            /
                          v                          v
  cohorts (status: draft) <-- cohort_members (unique active per contact & per company)
            |
            | User confirms -> `launch_cohort` [agent: 'confirm', concurrency: 1]
            v
    1. Require 1 active `apollo` account with `email_account_id` (master API key)
    2. Create Apollo contact custom field `potential_projects` once (`POST /api/v1/fields`)
       and persist `outreach_settings.apollo_field_id`
    3. If cohort is `draft`: convert steps via `apolloSteps()` (delta `wait_time` days;
       step 1 = `new_thread`, subsequent = `reply_to_thread`) ->
       `POST /api/v1/sequences` (or `PUT /api/v1/sequences/:id` if ID provided)
    4. In 100-contact chunks:
       - `POST /api/v1/contacts/bulk_create` (`run_dedupe: true`)
       - `POST /api/v1/contacts/bulk_update` (set `potential_projects` bullets from kept rows)
       - `POST /api/v1/emailer_campaigns/:id/add_contact_ids` (from `email_account_id`)
    5. Atomic act: store `apollo_contact_id`, `projects_sent`, `enrolled_on`, `launched`
            |
            | On demand -> `sync_cohort` [agent: 'confirm', concurrency: 1]
            v
    GET /api/v1/emailer_messages/search (up to 10 pages x 100, all + unsubscribed filter)
    -> monotonic progress update: `step = max`, `replied = OR`, `stopped = bounced|unsubscribed`


  DAILY FOLLOW-UP CADENCE & ESCALATION LADDER (`remind_follow_ups`, cron 09:00 Asia/SG)
  ======================================================================================
  Step 1 -- Cadence Planning for `stage == 'qualified'` companies:
    For each qualified lead with NO open `follow_up` task:
      due = (last activity occurred_at in Asia/Singapore) + follow_up_days (clamped >= today)
      -> create `tasks` { kind: 'follow_up', subject: 'Follow up <name>', due_on, owner }

  Step 2 -- Paginated Reminder Sweep (500/page, open tasks due <= tomorrow, != escalated):
    late = days(due_on -> today)

    late == -1         late == 0         late >= 1          late >= 3 (ESCALATE_AFTER_DAYS)
    +--------+         +-------+         +---------+        +-----------+
    | before | ------> |  due  | ------> | overdue | -----> | escalated |
    +--------+         +-------+         +---------+        +-----------+
    [owner]            [owner]           [owner]            [owner + created_by]

    - Late-created tasks jump straight to the current step (never replaying past steps)
    - Delivered via `ctx.notify` to inbox + all active workspace channels (`owner == null`:
      whatsapp, telegram, slack, discord, email) with idempotency key `taskId:step:due_on`
    - Editing `due_on`, `owner`, or reopening a task resets `reminder = 'none'`
```

---

## 9. Access Control, Privacy Boundaries & Authority Matrix

One seeded team (`sys_team` row `sales`, name `Sales`, in `seed/public/sys_team.json`) holds two policies (`sales` + `crm`); administrators edit teams as rows. Four background policies carry zero human team membership and are assumed exclusively by automations and syncs.

```text
+============================================================================================+
|                              ACTORS & POLICY BINDINGS                                      |
+============================================================================================+
|  Sales Member (team: sales)  --->  [ sales ]  +  [ crm ]                                   |
|  Workspace Administrator     --->  Full authority (bypasses sales-only restrictions)       |
|  Background Automations      --->  [ hq_automation ] | [ calendar_activities ] |           |
|                                    [ crm ] (with salesStarter check) |                     |
|                                    [ template_publishing ]                                 |
|  Google Calendar Read Sync   --->  [ calendar_import ]                                     |
+============================================================================================+

  DATA & ACTION BOUNDARY MATRIX
  --------------------------------------------------------------------------------------------
  Surface / Model             | Sales (`sales`+`crm`)       | Admin         | Background Policy
  ----------------------------+-----------------------------+---------------+-----------------
  companies                   | R/C/U; stage moves EXCEPT   | Full incl.    | hq_automation:
                              |  lost->lead & client gate   |  lost->lead   |  R/C/U (no stage)
  contacts                    | R(default+crm incl. voice), | Full          | hq_auto/cal_act:
                              |  C/U                        |               |  R(crm ONLY! no
                              |                             |               |  voice_embedding)
  projects / issues /         | R/C/U (no delete)           | Full          | hq_automation:
   project_documents          |                             |               |  R/U projects
  signed_documents            | R/C only (NO update/delete) | R/C/Delete    | none
  activities                  | R/C/U (open<->cancelled)    | Full          | hq_auto / cal_act
  meeting_recordings          | R/C/U/D                     | Full          | hq_auto: R/C/U
  meeting_speakers            | R(default)/C/U              | Full          | hq_auto: R(crm)C/D
  tasks                       | R/C/U (all fields except    | Full          | hq_auto: R/C/U
                              |  reminder/reminded_at)      |               |  (writes reminder)
  calendar_entries            | R ONLY where                | Full          | calendar_import:
                              |  source_user == actor.id    |               |  R/C/U (sync only)
  sys_integration             | R/C/U/D ONLY where          | Full (creates | hq_auto/cal_*: R
                              |  owner == actor.id AND      |  shared ch. & |
                              |  integration in [whatsapp,  |  Apollo)      |
                              |  email, google_calendar]    |               |
  communication_settings      | R/C/U ONLY where            | Full          | hq_auto: R
                              |  owner == actor.id          |               |
  agreement_settings          | R ONLY (no C/U)             | R/C/U         | hq_auto: R
  template_documents          | R + U(`drafting_instr.`     | R/C/U + run   | template_pub:
                              |  ONLY; no new version)      |  new_version  |  R/C (new version)
  products / offering_settings| R/C/U (+ D on products)     | Full          | hq_auto: R
  sequences / potential_proj. | R/C/U/D                     | Full          | hq_auto: R/C/D
  cohorts / cohort_members    | R/C/U/D (cohorts: ->done;   | Full          | hq_auto: draft->
                              |  members: meeting_booked)   |               |  launched, track
  notes                       | R ONLY                      | Full          | none
  ----------------------------+-----------------------------+---------------+-----------------

  AUTOMATION TRIGGER & GUARD SUMMARY
  - `sales` policy grants manual start for 10 automations:
      import_leads, research_lead, send_message, update_requirements, transcribe_meeting,
      meeting_notes, activities_file, meeting_speakers_save_voice, launch_cohort, sync_cohort
  - `template_documents_new_version`: NOT in `sales` -> Workspace Admin only.
  - `activities_classify`, `activities_reconsider_job_rules`, `activities_retry_routing`:
      `agent: 'never'` -> internal automation helpers only.
  - `import_leads`, `research_lead`, `launch_cohort`, `sync_cohort`:
      `agent: 'confirm'` -> Norbius must ask explicit confirmation before running.
  - `activities_file`, `meeting_notes` (non-system), `meeting_speakers_save_voice`:
      enforce `salesStarter(ctx.trigger, ctx)` in code (admin, or a member / linked envoy of a
      team holding `sales`).
  - `contacts` biometric privacy: `hq_automation` & `calendar_activities` only hold the `crm`
      read output, which strips all 5 `voice_*` columns at the engine query layer.
```
