# Customer activity timeline

Mode: Operate. Scope: the company record's Activities tab and the conversation, meeting, and document records it opens. This describes the current timeline components; the shared platform remains the visual authority.

## Behavior

The company representation mounts one company-filtered `ActivityTimeline`, resetting its local state when the company changes. Timeline entries appear newest first, with timestamps, subjects, and activity kinds. The initial live query loads 50 activities; Older loads additional pages of 50. Loading, empty, failed-first-page, and failed-pagination states have explicit text; read failures use an alert role. New activity opens the shared creation dialog with the company prefilled. On completion, the dialog closes and immediately opens the created activity record, whose representation selects its specialized meeting or document view when applicable.

`activitySlices` deduplicates activity IDs and processes records oldest first before ordering the resulting slices newest first. Messages with a thread key share a slice only when source user, source key, and thread key match, the project matches the previous message in that conversation, and the gap is at most 30 minutes. Project changes split the conversation; messages without thread keys remain individual entries. Other activities do not interrupt this per-conversation grouping. The slice timestamp follows its latest message.

Conversation summaries show the first message subject, project name when present, and message count. Native details disclosure mounts the conversation body on expansion. Internal messages remain oldest first, with sender handle or subject, Incoming or Outgoing labels when direction is available, local timestamp, and a details action. Bodies load individually as read-only Markdown. The first 20 messages appear initially; More messages adds 20 from the already loaded slice. Account ownership is part of the grouping identity; source account information is available in the individual message record rather than a dedicated summary label.

Non-message entries open the existing activity record. The timeline header's **Record meeting** (`RecordMeeting`) records in the browser, or **Upload recording** files an existing one, as a new meeting under the customer and job; saving the recording queues transcription automatically and opens the meeting. Meetings use `MeetingActivity`: Audio, Transcript, Speakers, Minutes, and Action items tabs, with a header line naming the meeting's current step (transcribing, speakers to name, write minutes).

Configuration has four flat pages: Message rules, Connections, Templates and Sequences. Company signatory, outreach settings and classified messages open from their related page. Logs lists the signed-in member's message activities newest first, including classification and reason; there is no message review workflow on this surface.

## Visual treatment

The timeline keeps shared platform buttons, dialogs, record shells, and Markdown rendering. A thin semantic border supplies the timeline rail, with 20px inset and 24px entry spacing. Section headings and summaries use compact 14px text; timestamps, kinds, and summary metadata use muted 12px text. Project labels and subjects can wrap. Expanded messages use quiet separators and 14px body text with 1.6 leading.

DocumentPaper separates standard agreement cover blocks from clauses, with app metadata outside the paper. A4 pages use 25.4mm margins, 10pt Calibri/Carlito/Arial and 1.2 line spacing, black body text and table borders. The cover preserves the source date, provider, company and document title positions. At 640px and below the cover scales proportionately and body padding narrows. Custom documents without the standard cover remain intact.

## Verification and limits

This document records inspected source only. See the template source reference for current browser screenshots. They verify local navigation and layout, not live external providers or staging behavior.

The timeline represents loaded pages; loading older messages can extend or regroup a slice. Its initial page is live, while explicitly fetched older pages are retained locally. Conversation disclosure pagination reveals loaded messages rather than fetching the full thread. Individual message bodies use separate reads.

The paper is an A4-style reading surface; printing copies its rendered body into a print-only page. Long content can extend beyond the suggested aspect ratio.

## Source references

- `src/data/model/companies/+representation.svelte`
- `src/lib/ActivityTimeline.svelte` and `src/lib/activity-timeline.ts`
- `src/lib/ConversationSlice.svelte`
- `src/data/model/companies/projects/activities/+representation.svelte` and `+model.ts`
- `src/lib/MeetingActivity.svelte`
- `src/lib/RecordMeeting.svelte`
- `src/lib/AgreementTab.svelte` and `src/lib/DocumentPaper.svelte`
- `src/app/configuration/+rules.page.svelte`
