# CRM

![CRM application](docs/screenshots/application.webp)

A company CRM and client-delivery workspace covering the full lifecycle from lead capture to signed
agreements. Leads and clients share one deduplicated company table, multi-channel client messages and
recorded meetings flow into a unified activity timeline, AI extracts structured job scopes from filed
evidence, and versioned agreement templates preview, send and archive as PDFs.

## Industry & Bolt capabilities

- **Industry:** Professional Services
- **Bolt capabilities:** `data_modeling`, `channel_integrations`, `third_party_saas`, `ai_classification`, `browser_automation`, `document_intelligence`, `scheduled_automations`

## How it works

1. **Lead capture & web research:** Leads arrive manually, via CSV/XLSX or through the `apollo`
   integration, deduplicated on company key and contact email. `research_lead` runs cited web research
   (`ctx.web`), matches against `products` and proposes outreach cohorts.
2. **Multi-channel intake & meetings:** Personal WhatsApp/Gmail, workspace channels (Telegram, Slack,
   Discord, Email) and two-way `google_calendar` sync feed `activities`. `classify_messages` and
   `activities_file` route PIC messages onto jobs; `transcribe_meeting` and `meeting_notes` turn meeting
   audio into diarized minutes and follow-ups.
3. **Scope synthesis & commitment gating:** `update_requirements` distills structured job scopes from
   filed evidence without overwriting human edits. Versioned `template_documents` render to A4 PDFs, and
   a company converts from lead to client only when a signed commitment document is filed.

## Key capabilities

- **Unified lead-to-client directory:** Import leads by hand, CSV/XLSX or **Apollo** (deduplicated by
  domain, normalized company key and contact email). New leads run cited web research, match against your
  configurable product catalog, generate tailored project ideas, and enter Apollo outreach cohorts.
- **Multi-channel intake & AI scope extraction:** Pair personal **Gmail**, **WhatsApp** and workspace
  channels (**Telegram**, **Slack**, **Discord**, email). Inbound PIC messages, images and voice notes are
  classified, filed onto jobs, and synthesized into structured Scope of Work fields while preserving
  human edits.
- **Meeting recording, transcription & voice profiles:** Record or upload meetings (up to 20 MiB),
  diarize speakers on the host, match consented PIC voiceprints in the browser (CAM++), and generate
  meeting minutes, decisions and follow-up tasks.
- **Two-way Google Calendar & cadence reminders:** Sync meetings bidirectionally with Google Calendar and
  send daily follow-up reminders in-app and via paired workspace DM channels.
- **Versioned documents & commitment gating:** Author reusable Markdown templates (NDA, MSA, SOW,
  outreach emails, research prompts), render A4 PDFs live, send from the workspace mailbox, and freeze
  signed copies — converting a lead to Client only when a signed commitment document is uploaded.

## Apps and roles

| App               | Pages                                                      | Audience |
| ----------------- | ---------------------------------------------------------- | -------- |
| **CRM**           | Dashboard, Leads & clients, Tasks                          | `Sales`  |
| **Configuration** | Message rules, Connections, Products, Templates, Sequences | `Sales`  |

- **Sales (`hq-sales` → `sales`)** has full workspace access to CRM records, jobs, documents and cohorts.
  Personal connections (`Gmail`, `WhatsApp`, `Google Calendar`) and intake settings are owner-scoped per
  member; workspace outbound channels and Apollo are managed by administrators.
- **`hq_automation`** and **`calendar_activities`** supply system authority for background sync,
  research, extraction, transcription and reminder automations.

## Data model

22 models organized around four ownership trees:

- **Companies & delivery (`companies`):** `companies` (lead → client), `contacts` (PICs and consented
  voice profiles), `potential_projects`, `projects` (jobs with extracted scope and decisions),
  `project_documents`, `issues`, `signed_documents`, `activities` (messages, calls, meetings, milestones),
  `meeting_recordings`, `meeting_speakers`.
- **Cold outreach (`cohorts`, `sequences`):** `sequences` (ordered email/call templates), `cohorts`,
  `cohort_members`.
- **Documents & offering (`agreement_settings`):** `agreement_settings` (legal entity & signatory),
  `template_documents` (versioned agreements, outreach & research prompts), `offering_settings`,
  `products`.
- **Planning & intake:** `tasks`, `calendar_entries`, `communication_settings`, `outreach_settings`,
  `notes`.

## Automations and integrations

| Area                    | Automations / integrations                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead & outreach**     | `import_leads` (daily 07:00 / CSV / Apollo), `research_lead`, `launch_cohort`, `sync_cohort`, `remind_follow_ups` (09:00)                           |
| **Message intake**      | `sync_messages` (every minute), `classify_messages`, `activities_classify`, `activities_file`, `replay_message_routes`, `refresh_job_capture_rules` |
| **Meetings & calendar** | `transcribe_meeting`, `meeting_speakers_save_voice`, `meeting_notes`, `sync_calendar_activities`, `replay_calendar_activities`                      |
| **Scope & messaging**   | `update_requirements`, `send_message`, `template_documents_new_version`                                                                             |
| **Integrations**        | Built-in `whatsapp`, `email`, `telegram`, `slack`, `discord`; authored `google_calendar` (two-way sync) and `apollo`                                |

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

A fresh workspace starts empty; configure your company profile, product catalog, templates and
connections under **Configuration** (`seed/test/` contains synthetic test fixtures only).

- [Documentation index](docs/README.md)
- [Operator guide](docs/operator-guide.md) (pairing, intake rules, voice profiles, outreach, troubleshooting)
- [Activity timeline design](docs/design/activity-timeline.md)
- [Source reference](docs/source-reference.md)
