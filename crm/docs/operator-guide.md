# CRM operator guide

Operational walkthrough for pairing personal and workspace connections, configuring intake rules,
capturing meetings and PIC voice profiles, running Apollo outreach cohorts, and issuing signed documents.

## Prerequisites

| Capability                       | Required before use                                                                                 | Observable readiness                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CRM                              | Signed-in Sales member; company with at least one job and saved PIC email/phone                     | Company, job and contact records open and save                                          |
| Gmail                            | Host Google OAuth client; Gmail API; Google account permitted by OAuth consent configuration        | Connections offers **Connect**, Google consent returns to CRM, status becomes Connected |
| Google Calendar                  | Same host Google OAuth client; Calendar API; authorized Google account                              | Connected instance imports the `primary` calendar by default                            |
| WhatsApp                         | Personal WhatsApp provider available on the host; account owner's phone                             | Pairing QR or phone-number code appears; scanning/entering it reaches Connected         |
| Transcription and job generation | Host ingest (Norbital Convert with a transcription model) and the workspace's `default` model       | Recording reaches Ready; scope extraction completes                                     |
| Voice profiles                   | Completed transcript, accessible audio, browser model/audio support and PIC consent                 | Speakers can be tagged; profile-saved confirmation appears                              |
| Documents                        | Document templates in the catalogue; organization's legal details in Configuration; host PDF output | Documents tabs render the filled template; Download PDF and Send work                   |
| Leads                            | Apollo workspace connection with API key (optional); host web search for research                   | Import creates leads once; new leads get research, use cases and an outreach follow-up  |
| Reminders by direct message      | Paired workspace WhatsApp, Telegram, Slack, Discord or email account (no owner); member handles     | Each owner receives reminders in the inbox and as a DM on connected channels            |

Being signed in to Gmail in another browser tab supplies the Google session, but the workspace still
requires its own **Connect** consent flow. A disabled **Connect** or "not available on this host"
indicates missing host provider/OAuth setup rather than an unpaired user account.

## Choose the import start before pairing

For supported providers (Gmail/IMAP/Microsoft mailbox and Baileys WhatsApp), choose the import
boundary before clicking **Connect**:

| **Import start** choice   | Meaning                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **From now**              | Default for a new connection. Freezes the containing whole second on Connect/Apply; reopening/retrying keeps that saved boundary. |
| **Since a chosen date**   | Enter **Start date** and an IANA **Time zone** (for example `Asia/Singapore`). Inclusive from midnight at the start of that date. |
| **All available history** | Removes the timestamp boundary and imports whatever history the provider can supply.                                              |

After pairing, open **Manage → Import start** to adjust the scope and click **Apply import start**
without re-pairing. Widening Gmail rewinds its mailbox cursor and deduplicates by source ID; widening
WhatsApp applies to retained raw messages and future/redelivered SDK chunks. Gmail uses authoritative
`INTERNALDATE` and WhatsApp uses the SDK message timestamp; already-filed activities are never deleted.

### Gmail

1. Select **Configuration → Connections → Gmail → Connect** and authorize the Google account.
2. Wait for **Connected**. Gmail imports eligible **INBOX** history within the import start, then watches
   new INBOX messages (Sent and other folders are not imported automatically).
3. Verify incoming messages from a saved customer PIC in **Configuration → Message rules** logs and in
   the matched job's **Activities** timeline.

### WhatsApp

1. Select **Configuration → Connections → WhatsApp → Connect** and scan the QR code from WhatsApp
   **Settings → Linked devices → Link a device** (or use phone-number pairing code).
2. Wait for **Connected as [account]**. Personal connections synchronize inbound messages only; replies
   and outbound notifications use workspace-level connections.

### Google Calendar

1. Select **Configuration → Connections → Google Calendar → Connect** and complete consent (separate
   instance from Gmail even on the same Google account).
2. Open the calendar view on **Dashboard**; the `primary` calendar syncs two-way. Editing or cancelling a
   meeting in CRM updates Google Calendar (guests are emailed only when **Email guests about this change**
   is ticked). If Google changed the event first, CRM takes Google's version and flags the conflict.
3. Events with a non-self attendee/organizer matching a saved customer PIC link to a CRM activity
   automatically when one active job is unambiguous; otherwise review and assign manually.

## Intake rules and message-to-SOW pipeline

In **Configuration → Message rules**, keep **Customer PICs only (default)** to match saved emails, phones
and recognized WhatsApp group participants before AI classification. Add optional **Supplementary
classification SOP** (up to 8,000 characters) or per-job **Capture rules** to disambiguate similar jobs.

| Step                         | Source and behavior                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Read                      | Provider imports the raw message into `sys_message` with stable source identity.                                                                                                      |
| 2. Capture                   | `sync_messages` (every minute, 25-item batches) creates an `activities` row awaiting classification.                                                                                  |
| 3. Filter and classify       | `classify_messages` checks PIC filters, SOP and job capture rules (≥ 0.85 confidence required for auto-filing; uncertain items remain Needs review).                                  |
| 4. Build job evidence        | Filing or reassigning an activity queues `update_requirements`, reading discovery, non-message activities, filed messages, attachments and meeting transcripts.                       |
| 5. Extract scope of work     | AI updates `overview`, `definitions`, `implementation_scope`, `data_migration`, `milestones`, `uat_tests` and `fees`, citing source activities while preserving human-edited entries. |
| 6. Preview and issue the SOW | The job's **Documents** tab renders the latest template live with those values; nothing is frozen until a signed copy is uploaded.                                                    |

## Meeting recording, transcription and PIC voice profiles

Supported workflow: **record/upload → separate speakers → assign PIC → record consent → save profile →
recognize in future meetings**.

1. In a company or job's **Activities** tab, choose **Record meeting** (or **Upload recording**, up to
   20 MiB). Saving automatically queues server transcription with speaker diarization.
2. Once the **Transcript** reaches **Ready**, open **Speakers** and map each separated speaker (`S1`,
   `S2`, …) to a customer PIC contact (or display name).
3. In **Voice identification**, tick the PIC biometric consent checkbox to enroll a voiceprint using the
   in-browser CAM++ model (≥ 1 s of separated speech; up to 60 s sampled). Future meetings auto-assign
   consented matches at cosine similarity ≥ 0.80 with ≥ 0.10 margin (0.60+ suggested). Remove profiles
   anytime on the contact record without deleting past transcripts.
4. Choose **Write minutes** (`meeting_notes`) to generate summary, decisions and linked follow-up tasks.

## Leads, research and Apollo outreach cohorts

1. **Import (`import_leads`):** Upload a CSV/XLSX in **Leads & clients → Import leads** or pull saved
   contacts from a paired Apollo connection (also runs daily at 07:00). Companies deduplicate by domain
   and normalized `company_key` (unique in the database); PICs deduplicate by email.
2. **Research (`research_lead`):** Newly created unresearched companies run once automatically — enriching
   missing fields from Apollo (if connected), running cited web search across configured research prompts,
   matching active **Configuration → Products**, assessing PIC seniority/angle, proposing 3–5 potential
   projects (`potential_projects`), and drafting a first outreach follow-up.
3. **Cold outreach cohorts:**
   - Author multi-step email/call templates in **Configuration → Sequences** using `{{first_name}}`,
     `{{company}}`, `{{potential_projects}}` and `{{sender_name}}`.
   - Group leads into a **Cohort** (a lead may belong to one active cohort at a time; marking a cohort
     **Done** releases its leads).
   - **Launch (`launch_cohort`)** pushes sequence steps to Apollo, syncs the `potential_projects` custom
     field on each contact, and enrolls members from the configured Apollo mailbox (`email_account_id`,
     requiring an Apollo master API key).
   - **Sync from Apollo (`sync_cohort`)** records step reached, replies, bounces and unsubscribes.
4. **Cadence reminders (`remind_follow_ups`):** Runs daily at 09:00 (`Asia/Singapore`), generating
   follow-ups for qualified leads and notifying owners in-app and via paired workspace channels (day
   before, due day, overdue, and 3-day escalation).

## Document templates and signing

Every agreement (`nda`, `msa`, `sow`, …), outreach sample and research prompt lives in **Configuration →
Templates** (`template_documents`). Agreements render live in company/job **Documents** tabs with
placeholders (`{{company}}`, `{{uen}}`, `{{contact_name}}`, `{{provider_*}}`, `{{overview}}`,
`{{implementation_scope}}`, `{{milestones}}`, `{{fees}}`, etc.) in A4 layout with optional signatory
artwork from `agreement_settings`.

- **Download PDF** or **Send** (via the connected workspace mailbox; refused if required placeholders are
  missing).
- **Upload signed copy** freezes the exact template version and placeholder values at signing time;
  **View signed terms** reproduces that snapshot and warns if live values or the template change later.
- Uploading a signed **Commitment** document (such as an SOW) automatically converts a Lead to Client;
  manual conversion without signed commitment evidence is refused.

## Troubleshooting

| Symptom                                   | Check / action                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Google Connect disabled or unavailable    | Verify host OAuth client ID/secret, enabled Gmail/Calendar APIs, callback URL and OAuth consent test-user list                |
| WhatsApp QR expires or stays pairing      | Reopen pairing, scan from **Linked devices** on the target phone, or switch to phone-number pairing code                      |
| Connected to Gmail but no messages arrive | Confirm the message is in **INBOX** within the saved Import start window and inspect **Configuration → Message rules** logs   |
| Message ignored or needs review           | Verify the PIC's exact email/phone, active intake filter and job Capture rules; reassign manually from the timeline if needed |
| Calendar event not linked to a job        | Save the attendee/organizer email on a customer PIC contact; disambiguate when multiple active jobs exist                     |
| Transcription failed or microphone denied | Grant microphone permission (or use **Upload recording**, ≤ 20 MiB) and confirm host ingest transcription model availability  |
| Voice matching skips a speaker            | Confirm PIC consent/profile exists, audio is decodable and speaker has ≥ 1 s clean separated speech                           |
| Send document refused                     | Fill all missing required placeholders shown in preview, verify signatory PIC email and an active workspace mailbox           |
| "Details changed since signing" banner    | Company, signatory, scope or template changed after upload; re-upload a signed copy if the agreement was re-executed          |
| Paired sessions lost after local restart  | Keep the local persistent workspace database, file store and master encryption key together                                   |
