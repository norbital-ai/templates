---
description: Acceptance guidance for this workspace's CRM - its lead pipeline, documents, follow-ups, conversations and meetings, and its email, WhatsApp, Telegram, Slack, Discord, Apollo and calendar integrations - preserve existing records and attachments, tell the running app apart from your working tree, and report only the diagnosis and test evidence actually observed.
---

# CRM acceptance

Applies to the `crm` app, its customer representation and downstream models.

## Preserve existing records and attachments

- Extend what exists; never delete, truncate or overwrite records, transcripts, documents or
  uploaded files to make a change fit.
- Reuse the existing models and relations instead of a parallel model, and refer to a record
  by a human-readable field, never by its system `id`.
- Do not re-upload a meeting's audio or surface attachment storage keys.

## The running app is not your working tree

- The outline describes the current runtime artifact, which may be Live or Preview; never equate
  the running app with Live. `workspace_grep` reads your working tree, which is separate
  authored source.
- Confirm deployment status from the selected environment and its release/commit, not by assuming
  your edits are running, and say which one an edit is in.

## Report actual evidence

- Run the diagnosis and the tests, and report their real results. A green compile is not proof
  of a user workflow.
- Name the interactions still untested, such as creating and reopening a record, uploading or
  downloading an attachment, importing leads, previewing or sending a document and uploading its signed copy, and recording and transcribing a
  meeting.
- Never claim a diagnosis or test you did not run. Label user- or tester-supplied acceptance as prior
  evidence, with its commit when known.
