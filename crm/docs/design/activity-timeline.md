# Customer Activity Timeline & Document Surface Design

Mode: Operate. Scope: the company/contact/project record's **Activities** tab, typed activity creation, conversation slicing, meeting recordings, and A4 document rendering. This describes the current components in `src/`; the shared platform remains the visual authority.

## Behavior

### Activity Timeline & Conversation Slicing

Each company, contact, or project hub mounts a scoped `ActivityTimeline`, resetting its local expanded/archive state when scope changes. Timeline entries appear newest first, with timestamps, subjects, and activity kinds. The initial live query loads 50 activities (retaining evicted rows until a full page confirms removal); **Load older activities** fetches cursor-paginated pages of 50. Loading, empty, failed-first-page, and failed-pagination states display explicit text; read failures use an `alert` role.

`activitySlices` (`src/lib/activity-timeline.ts`) deduplicates activity IDs and processes records oldest first before ordering the resulting slices newest first. Messages with a `thread_key` share a slice only when `source_user`, `source_key`, and `thread_key` match, `project_id` matches the previous message in that conversation, and the gap between consecutive timestamps is at most 30 minutes. Project changes split the conversation; messages without `thread_key` remain individual entries. Non-message activities do not interrupt per-conversation grouping. The slice timestamp follows its latest message.

Conversation summaries show the first message subject, project name when present, and message count. Expanding a slice mounts `ConversationSlice`, showing messages oldest first with sender handle or subject, **Incoming** / **Outgoing** labels, local timestamp, **Details**, and **Reassign job** (which opens a sheet backed by `activities_file` to file manually). Message bodies load individually as read-only Markdown. The first 20 messages render initially; **Show more messages** reveals 20 more from the loaded slice.

### Typed Activity Creation & Meeting Hub

Clicking **New activity** opens `ActivityCreate`, which prompts for one of three tailored creation flows:

1. **Recording:** Record locally via `MediaRecorder` (`meeting-capture.ts`, 32 kbps, 2 s chunks, 19.5 MiB cap) with **Pause**, **Resume**, and crash-safe IndexedDB draft persistence (`recording-store.ts`), or queue multiple audio/video files (≤ 20 MiB each). Unfinished drafts also surface an alert banner directly on the timeline. Saving creates the activity plus child `meeting_recordings` rows and automatically queues diarized transcription.
2. **Manual notes:** Lightweight form for call notes, observations, or summaries.
3. **Scheduled meeting:** Schedules a meeting with start/end timestamps or all-day dates, location, attendees, and opt-in **Email guests about this change**, syncing bidirectionally with the member's Google Calendar.

Non-message entries open their activity record; `meeting` and `recording` rows mount `MeetingActivity` with three tabs:

- **Recordings:** Unifies multi-recording capture/upload, audio playback, transcription status/retry/delete, inline speaker contact pickers, `MeetingVoices` in-browser CAM++ voice identification, and resolved speaker-labeled Markdown transcripts.
- **Minutes:** Auto-generates minutes once transcription finishes (`meeting_notes`) with **Refresh minutes** in the header after naming speakers.
- **Action items:** Lists linked `tasks` rows ordered by due date.

### Configuration Surfaces

Configuration has five flat pages: **Message rules**, **My connections**, **Products**, **Templates**, and **Sequences**. Related singletons and logs open in sheets from their owning page: **Classified messages** from Message rules, **Seller & research focus** from Products, **Company signatory** from Templates, and **Outreach** settings from Sequences.

## Visual Treatment

The timeline uses shared platform buttons, dialogs, record shells, and Markdown rendering. Section headings and summaries use compact 14px text; timestamps, kinds, and summary metadata use muted 12px text. Expanded messages use quiet top borders (`1px solid var(--color-border)`) and 14px body text with 1.6 leading.

`DocumentPaper` (mounted inside `DocumentTab` for job-scoped documents, `DocumentPreviewSheet` for company-scoped exports from **Leads & clients**, and `template_documents/+representation.svelte`) separates standard `C&A:` cover blocks and two-column signature blocks from clauses, keeping controls outside the paper. A4 pages use 210mm × 297mm geometry with 25.4mm margins, 10pt Calibri/Carlito/Arial, 1.2 line spacing, and solid black table borders. At 640px and below the cover scales proportionately and body padding narrows. Custom documents without standard cover/signature markers render intact.

## Verification and Limits

- This document records inspected source only; see [Source Reference](../source-reference.md) for browser screenshots.
- The timeline slices currently loaded pages; fetching older pages can extend or regroup a slice. Conversation disclosure pagination reveals loaded messages rather than fetching full server threads; individual message bodies use separate reads.
- `DocumentPaper` is an A4 reading surface with `@media print` styling; faithful PDF export uses `documentForPdf()` + Pandoc/Typst via `ctx.preview_pdf` (browser download/preview) or `ctx.convert.document` (`send_message`).

## Source References

- `src/data/model/companies/+representation.svelte`
- `src/lib/ActivityTimeline.svelte` and `src/lib/activity-timeline.ts`
- `src/lib/ActivityCreate.svelte` and `src/lib/activity-create.ts`
- `src/lib/ConversationSlice.svelte`
- `src/data/model/companies/projects/activities/+representation.svelte` and `+model.ts`
- `src/lib/MeetingActivity.svelte`, `src/lib/MeetingVoices.svelte`, `src/lib/meeting-capture.ts`, and `src/lib/recording-store.ts`
- `src/lib/DocumentTab.svelte`, `src/lib/DocumentPreviewSheet.svelte`, `src/lib/DocumentPaper.svelte`, and `src/lib/document-layout.ts`
- `src/app/configuration/+app.ts` and `+rules.page.svelte`
