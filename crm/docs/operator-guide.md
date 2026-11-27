# CRM Operator Guide

Operational walkthrough for pairing personal and workspace connections, configuring intake rules and product catalogs, capturing meetings and PIC voice profiles, running Apollo outreach cohorts, and issuing signed documents.

## Prerequisites

| Capability                       | Required before use                                                                                                             | Observable readiness                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CRM                              | Signed-in Sales member; company with at least one job and saved PIC email/phone                                                 | Company, job, and contact records open and save                                                           |
| Gmail                            | Host Google OAuth client; Gmail API; Google account permitted by OAuth consent configuration                                    | `/connections` offers **Connect**, Google consent returns to CRM, status becomes Connected                |
| Google Calendar                  | Same host Google OAuth client; Calendar API; authorized Google account                                                          | Connected instance imports the `primary` calendar by default                                              |
| WhatsApp                         | Personal WhatsApp provider available on the host; account owner's phone                                                         | Pairing QR or phone-number code appears; scanning/entering it reaches Connected                           |
| Transcription and job generation | Host ingest (with diarized transcription model) and the workspace's AI models                                                   | Recording reaches Ready; minutes and scope extraction complete                                            |
| Voice profiles                   | Completed transcript, accessible audio, browser WASM/audio support, and PIC consent                                             | Speakers can be tagged; voice profile saved confirmation appears                                          |
| Documents                        | Document templates in the catalogue; organization's legal details in Configuration; host PDF output                             | Export sheet / Documents tab renders the filled template; Download PDF and Send work                      |
| Leads & product fit              | Active products & Seller/research focus (optional); Apollo workspace connection with master API key (optional); host web search | Import creates leads once; new leads get cited research, product-fit use cases, and an outreach follow-up |
| Reminders by direct message      | Paired workspace WhatsApp, Telegram, Slack, Discord, or email account (no owner); member handles                                | Each owner receives reminders in the inbox and as a DM on connected workspace channels                    |

Being signed in to Gmail in another browser tab supplies the Google session, but the workspace still requires its own **Connect** consent flow. A disabled **Connect** or "not available on this host" indicates missing host provider/OAuth setup rather than an unpaired user account.

## Choose the Import Start Before Pairing

For supported providers (Gmail/IMAP/Microsoft mailbox and Baileys WhatsApp), choose the import boundary before clicking **Connect**:

| **Import start** choice   | Meaning                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **From now**              | Default for a new connection. Freezes the containing whole second on Connect/Apply; reopening or retrying keeps that saved boundary. |
| **Since a chosen date**   | Enter **Start date** and an IANA **Time zone** (for example `Asia/Singapore`). Inclusive from midnight at the start of that date.    |
| **All available history** | Removes the timestamp boundary and imports whatever history the provider can supply.                                                 |

After pairing, open **Manage → Import start** to adjust the scope and click **Apply import start** without re-pairing. Widening Gmail rewinds its mailbox cursor and deduplicates by source ID; widening WhatsApp applies to retained raw messages and future/redelivered SDK chunks. Gmail uses authoritative `INTERNALDATE` and WhatsApp uses the SDK message timestamp; already-filed activities are never deleted.

### Gmail

1. Open **Connections** (`/connections`, or **Settings → Integrations → Connections** for shared workspace accounts), add **Email**, and authorize the Google account.
2. Wait for **Connected**. Gmail imports eligible **INBOX** history within the import start, then watches new INBOX messages (Sent and other folders are not imported automatically).
3. Verify incoming messages from a saved customer PIC in **CRM → Leads & clients → Filing logs** and in the matched company/job's **Activities** timeline.

### WhatsApp

1. Open **Connections** (`/connections`) → add **WhatsApp** and scan the QR code from WhatsApp **Settings → Linked devices → Link a device** (or use phone-number pairing code).
2. Wait for **Connected as [account]**. Personal connections synchronize inbound messages only; replies and outbound notifications use workspace-level connections added by an administrator.

### Google Calendar

1. Open **Connections** (`/connections`) → add **Google Calendar** and complete consent (separate instance from Gmail even on the same Google account).
2. Open the calendar view on **CRM → Dashboard**; the `primary` calendar syncs two-way. Editing or cancelling a meeting in CRM updates Google Calendar (guests are emailed only when **Email guests about this change** is ticked). If Google changed the event first, CRM takes Google's version and flags the conflict.
3. Events with a non-self, non-declined attendee/organizer matching a saved customer PIC link to a CRM activity automatically when one active job (neither Complete nor On hold) is unambiguous; otherwise review and assign manually.

## Intake Rules and Message-to-SOW Pipeline

On each paired email or chat connection in **Connections** (`/connections`) or **Settings → Integrations → Connections**, configure the built-in **Classifier** (`Smart`, `All`, or `Off`), optional per-connection **Instructions**, and automation toggles. In **Smart** mode, CRM requires saved emails, phones, Telegram, Slack, or Discord handles (and recognized group participants) before AI classification; per-job **Capture rules** take precedence over connection instructions to disambiguate similar jobs.

| Step                         | Source and behavior                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Read                      | Provider imports the raw message into `sys_message` with stable source identity.                                                                                                                                                                                                                                                                              |
| 2. Capture                   | `sync_messages` (reactive on `sys_message.create` plus safety-net cron, 25-item fair batches balancing fresh arrivals and backfill) creates an `activities` row awaiting classification; voice notes are transcribed inline without diarization.                                                                                                              |
| 3. Filter and classify       | `classify_messages` checks `import_start`, the connection's `sys_integration.classifier`, 30-message thread window, and job capture rules (≥ 0.85 confidence and clear direct evidence required for AI auto-filing, with deterministic fallback to an explicitly named job or sole open job, plus batched System Agent follow-ups when `needs_update` fires). |
| 4. Build job evidence        | Filing or reassigning an activity (or uploading a project file or transcribing a recording) queues `update_requirements` for the project and `research_lead` profile extraction for the company.                                                                                                                                                              |
| 5. Extract scope of work     | Two parallel AI passes update `overview`, `definitions`, `implementation_scope`, `data_migration`, `milestones`, `uat_tests`, `fees`, and `decisions`, citing source IDs while preserving human-edited items.                                                                                                                                                 |
| 6. Preview and issue the SOW | The job's **Documents** tab renders the latest template live with those values; nothing is frozen until a signed copy is uploaded.                                                                                                                                                                                                                            |

## Meeting Recording, Transcription and PIC Voice Profiles

Supported workflow: **record/upload → separate speakers → assign PIC → record consent → save profile → recognize in future meetings**.

1. In a company, contact, or job's **Activities** tab, click **New activity** and choose **Recording** (or **Scheduled meeting** to sync with Google Calendar first).
2. Click **Record meeting** to capture audio in the browser (supports **Pause**, **Resume**, and crash-safe IndexedDB draft persistence across page reloads; multi-session resumes stitch automatically into a single WAV on save) or **Upload audio** to attach one or more audio/video files (up to 20 MiB each). Saving automatically queues server transcription with speaker diarization.
3. On the opened meeting record, open the **Recordings** tab. Once a recording's badge reaches **Ready**, use the speaker pickers beneath the audio player to map each separated speaker (`Speaker 1`, `Speaker 2`, …) to a customer PIC contact.
4. In **Voice identification**, click **Analyse voices** (or let it start automatically when profiles or tagged contacts exist). The browser downloads the CAM++ ONNX model directly from its public host and computes 512-dim embeddings locally:
   - Unassigned speakers matching a consented company contact at cosine similarity **≥ 0.80** with **≥ 0.10** margin over the runner-up are auto-assigned and enrolled.
   - Matches at **≥ 0.75** with **≥ 0.05** margin appear as one-click **Tag as [Name]?** suggestions.
   - For newly tagged contacts without prior consent, click **Save voice to [Name]'s profile** to record biometric consent and enroll (requires ≥ 1 s of separated speech; up to 60 s sampled per speaker; one enrollment per meeting). Remove profiles anytime from the contact record header without deleting past transcripts.
5. **Minutes** generate automatically after transcription finishes and populate the **Action items** tab with linked tasks; click **Refresh minutes** anytime after naming speakers to regenerate with real names.

## Leads, Products, Research and Apollo Outreach Cohorts

1. **Configure products (optional):** Under **Configuration → Products**, add active products/categories with fit criteria and open **Seller & research focus** to describe your offering and qualification signals.
2. **Import (`import_leads`):** Open **CRM → Leads & clients → Import leads** to upload a CSV/XLSX or leave the file blank to pull saved contacts from active Apollo accounts (also runs daily at 07:00). Companies deduplicate by normalized domain and `company_key`; PICs deduplicate by email.
3. **Research (`research_lead`):** Newly created unresearched companies run once automatically (or trigger **Research unresearched** in bulk from **Leads & clients**, or **Re-research** on one company). Research enriches missing fields from Apollo (if connected), reads the company homepage and cited web sources, evaluates fit against active **Products**, assesses PIC seniority and outreach angle, proposes 3–5 `potential_projects`, drafts a first outreach follow-up task, and extracts the customer profile from any filed evidence.
4. **Cold outreach cohorts:**
   - Author multi-step email/call templates in **Configuration → Sequences** using `{{first_name}}`, `{{company}}`, `{{potential_projects}}`, and `{{sender_name}}`, and configure the potential-project prompt and sender under **Outreach**.
   - Open **CRM → Leads & clients → Cohorts**, create a cohort bound to a sequence, and add leads (each contact and company may belong to at most one active cohort at a time; marking a cohort **Done** releases its leads).
   - Click **Launch** (`launch_cohort`, requires explicit confirmation) to push sequence steps to Apollo, sync the `potential_projects` custom field on each contact, and enroll members from the configured Apollo mailbox (`email_account_id`, requiring an Apollo master API key).
   - Click **Sync from Apollo** (`sync_cohort`, requires confirmation) to pull furthest email step reached, replies, bounces, and unsubscribes.
5. **Cadence reminders (`remind_follow_ups`):** Runs daily at 09:00 (`Asia/Singapore`), generating follow-ups for `qualified` leads on their `follow_up_days` cadence and notifying owners in-app and via paired workspace channels (day before, due day, overdue, and 3-day escalation copying whoever created the task).

## Document Templates and Signing

Every agreement (`document`), outreach email (`email`), and research prompt (`research`) lives in **Configuration → Templates** (`template_documents`), alongside your legal entity and signature image in **Company signatory** (`agreement_settings`).

- **Company-scoped agreements** (such as NDA or MSA): select one company in **CRM → Leads & clients** and click **Export [Template]** in the toolbar to open the live WYSIWYG A4 / PDF preview sheet.
- **Job-scoped agreements** (such as SOW): open the project record's **Documents** tab to preview live values assembled from extracted Scope of Work tables.
- **Download PDF** or **Send** (via the connected workspace mailbox; refused while required placeholders are empty or no signatory email exists).
- **Upload signed copy** freezes the exact template version and placeholder values at signing time; **View signed terms** reproduces that snapshot and flags drift if live values or the template change later.
- Uploading a signed **Commitment** document (`commitment: true`, such as an SOW) automatically converts a company to **Client**; manual conversion without signed commitment evidence is refused.

## Troubleshooting

| Symptom                                   | Check / action                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Connect disabled or unavailable    | Verify host OAuth client ID/secret, enabled Gmail/Calendar APIs, callback URL, and OAuth consent test-user list                                       |
| WhatsApp QR expires or stays pairing      | Reopen pairing, scan from **Linked devices** on the target phone, or switch to phone-number pairing code                                              |
| Connected to Gmail but no messages arrive | Confirm the message is in **INBOX** within the saved Import start window and inspect **CRM → Leads & clients → Filing logs**                          |
| Message ignored or needs review           | Verify the PIC's exact email/phone/handle, active intake filter, and job **Capture rules**; reassign manually via **Reassign job** in the timeline    |
| Calendar event not linked to a job        | Save the attendee/organizer email on a customer PIC contact; disambiguate when multiple active jobs exist                                             |
| Transcription failed or microphone denied | Grant microphone permission (or use **Upload audio**, ≤ 20 MiB per file) and confirm host ingest transcription availability                           |
| Voice matching skips a speaker            | Confirm PIC consent/profile exists, browser can reach Hugging Face/jsDelivr, audio is decodable, and speaker has ≥ 1 s clean separated speech         |
| Send document refused                     | Fill all missing required placeholders shown in preview, verify signatory PIC email, and confirm an active workspace email connection (`owner` unset) |
| "Details changed since signing" banner    | Company, signatory, scope, or template changed after upload; re-upload a signed copy if the agreement was re-executed                                 |
| Paired sessions lost after local restart  | Keep the local persistent workspace database, file store, and master encryption key together                                                          |
