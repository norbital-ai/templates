# Source reference

Checked against local source and the compiled declaration manifest on 16 November 2026. This does not assert that staging runs these bytes.

19 models, 2 applications, 21 automations.

## Applications and pages

| Source application                                | Title         | Pages                                                                                         | Purpose                                                                                                                              |
| ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [configuration](../src/app/configuration/+app.ts) | Configuration | rules: Message rules; connections: My connections; templates: Templates; sequences: Sequences | Your message rules and connections, the template catalogue and the organization's signatory.                                         |
| [crm](../src/app/crm/+app.ts)                     | CRM           | dashboard: Dashboard; companies: Leads & clients; tasks: Tasks                                | Leads until they convert, then clients, their jobs and signed documents; cohorts managed with companies; sequences in Configuration. |

## Models and exposed operations

Outputs fix field visibility. Policies select outputs and scope rows; write columns and checks constrain mutations. Each row links to its owning declaration.

| Model                                                                                          | Fields | Read outputs | Writes                    | Post-commit effects | Syncs           |
| ---------------------------------------------------------------------------------------------- | ------ | ------------ | ------------------------- | ------------------- | --------------- |
| [activities](../src/data/model/companies/projects/activities/+model.ts)                        | 37     | default      | create, update            | create, update      | google_calendar |
| [agreement_settings](../src/data/model/agreement_settings/+model.ts)                           | 6      | default      | create, update            | none                | none            |
| [calendar_entries](../src/data/model/calendar_entries/+model.ts)                               | 14     | default      | none (calendar sync only) | create, update      | google_calendar |
| [cohort_members](../src/data/model/cohorts/cohort_members/+model.ts)                           | 8      | default      | create, update, delete    | none                | none            |
| [cohorts](../src/data/model/cohorts/+model.ts)                                                 | 10     | default      | create, update, delete    | none                | none            |
| [communication_settings](../src/data/model/communication_settings/+model.ts)                   | 2      | default      | create, update            | create, update      | none            |
| [companies](../src/data/model/companies/+model.ts)                                             | 23     | default      | create, update            | create              | none            |
| [contacts](../src/data/model/companies/contacts/+model.ts)                                     | 17     | default, crm | create, update            | create, update      | none            |
| [potential_projects](../src/data/model/companies/potential_projects/+model.ts)                 | 4      | default      | create, update, delete    | none                | none            |
| [issues](../src/data/model/companies/projects/issues/+model.ts)                                | 6      | default      | create, update            | none                | none            |
| [meeting_speakers](../src/data/model/companies/projects/activities/meeting_speakers/+model.ts) | 3      | default, crm | create, update, delete    | none                | none            |
| [notes](../src/data/model/notes/+model.ts)                                                     | 2      | default      | none                      | none                | none            |
| [outreach_settings](../src/data/model/outreach_settings/+model.ts)                             | 6      | default      | create, update            | none                | none            |
| [sequences](../src/data/model/sequences/+model.ts)                                             | 2      | default      | create, update, delete    | none                | none            |
| [project_documents](../src/data/model/companies/projects/project_documents/+model.ts)          | 5      | default      | create, update            | create, update      | none            |
| [projects](../src/data/model/companies/projects/+model.ts)                                     | 15     | default      | create, update            | update              | none            |
| [signed_documents](../src/data/model/companies/projects/signed_documents/+model.ts)            | 4      | default      | create, delete            | none                | none            |
| [template_documents](../src/data/model/agreement_settings/template_documents/+model.ts)        | 10     | default      | create                    | none                | none            |

Import is available on a model whose unique constraint is marked `import_key: true`; it matches rows on that key and requires an explicit conflict rule. Only `calendar_entries` declares one, and no policy grants its writes: its calendar sync owns them.

| [tasks](../src/data/model/tasks/+model.ts) | 8 | default | create, update | create, update | none |

## Automations

All named runs use the reserved system identity and the listed policies. A manual-start grant controls who may start a run; cron/webhook/schedules use their declared trigger path. Model effects run as their writer and are separate from these named automations.

| Automation                                                                                          | Trigger                           | Policies            | Purpose                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [activities_classify](../src/automation/+activities_classify.automation.ts)                         | started or scheduled from code    | hq_automation       | Applies background classification only while a message still awaits triage.                                                                                                                             |
| [activities_file](../src/automation/+activities_file.automation.ts)                                 | started or scheduled from code    | sales               | Assigns or reassigns captured messages to their customer and job.                                                                                                                                       |
| [activities_reconsider_job_rules](../src/automation/+activities_reconsider_job_rules.automation.ts) | started or scheduled from code    | hq_automation       | Reconsiders captured messages after job capture rules change.                                                                                                                                           |
| [activities_retry_routing](../src/automation/+activities_retry_routing.automation.ts)               | started or scheduled from code    | hq_automation       | Reconsiders a deterministically filtered message after routing rules change.                                                                                                                            |
| [import_leads](../src/automation/+import_leads.automation.ts)                                       | [{"cron":"0 7 * * *"}]            | hq_automation       | Imports leads from a CSV upload or Apollo, deduplicated by company domain and PIC email.                                                                                                                |
| [launch_cohort](../src/automation/+launch_cohort.automation.ts)                                     | manual (person; Norbius confirms) | hq_automation       | Pushes a draft cohort's sequence steps to its Apollo sequence, sets each lead's `potential_projects` custom field and enrols them.                                                                      |
| [classify_messages](../src/automation/+classify_messages.automation.ts)                             | [{"cron":"*/5 * * * *"}]          | hq_automation       | Automatically routes personal account messages to customers and retries incomplete classification.                                                                                                      |
| [meeting_notes](../src/automation/+meeting_notes.automation.ts)                                     | started or scheduled from code    | sales               | Writes a meeting’s notes, decisions and action items from its transcript.                                                                                                                               |
| [meeting_speakers_save_voice](../src/automation/+meeting_speakers_save_voice.automation.ts)         | started or scheduled from code    | sales               | Saves a tagged speaker to a consenting contact’s voice profile once per meeting.                                                                                                                        |
| [refresh_job_capture_rules](../src/automation/+refresh_job_capture_rules.automation.ts)             | started or scheduled from code    | hq_automation       | Reconsiders captured messages when a job’s capture rules change.                                                                                                                                        |
| [remind_follow_ups](../src/automation/+remind_follow_ups.automation.ts)                             | [{"cron":"0 9 * * *"}]            | hq_automation       | Reminds follow-up owners the day before, on the due day and when overdue, and escalates after three days.                                                                                               |
| [replay_calendar_activities](../src/automation/+replay_calendar_activities.automation.ts)           | started or scheduled from code    | calendar_activities | Matches already imported calendar appointments after client contacts change.                                                                                                                            |
| [replay_message_routes](../src/automation/+replay_message_routes.automation.ts)                     | started or scheduled from code    | hq_automation       | Reconsiders captured history when customer PICs or connection filters change.                                                                                                                           |
| [research_lead](../src/automation/+research_lead.automation.ts)                                     | started or scheduled from code    | hq_automation       | Researches a company once when it is created without research, or on request (Apollo fills missing details), proposes potential projects and drafts the first outreach.                                 |
| [send_message](../src/automation/+send_message.automation.ts)                                       | started or scheduled from code    | hq_automation       | Sends a reply in a client thread, or a new email to a contact.                                                                                                                                          |
| [sync_calendar_activities](../src/automation/+sync_calendar_activities.automation.ts)               | started or scheduled from code    | calendar_activities | Registers client calendar appointments once and updates their schedule without replacing CRM notes or manual filing; an HQ meeting’s edit still on its way to Google is never undone by an older event. |
| [sync_cohort](../src/automation/+sync_cohort.automation.ts)                                         | manual (person; Norbius confirms) | hq_automation       | Reads a cohort's Apollo outreach emails and updates each lead's step, reply, bounce and unsubscribe.                                                                                                    |
| [sync_messages](../src/automation/+sync_messages.automation.ts)                                     | [{"cron":"* * * * *"}]            | hq_automation       | Mirrors personal WhatsApp and mailbox account items and the workspace Telegram bot into the shared CRM intake table; a voice note is filed as its transcript.                                           |
| [template_documents_new_version](../src/automation/+template_documents_new_version.automation.ts)   | started or scheduled from code    | template_publishing | Publish a new template version. Existing versions and customer copies remain unchanged.                                                                                                                 |
| [transcribe_meeting](../src/automation/+transcribe_meeting.automation.ts)                           | started or scheduled from code    | hq_automation       | Transcribes a meeting recording with speakers separated.                                                                                                                                                |
| [update_requirements](../src/automation/+update_requirements.automation.ts)                         | started or scheduled from code    | hq_automation       | Checks a job’s or customer’s new evidence and updates its requirements, scope of work, dates and decisions, and the customer’s profile.                                                                 |

## Integrations and source roles

- Integration definitions: `apollo`, `google_calendar`.
- Named connections: none. Workspace WhatsApp, email, Telegram, Slack, Discord and Apollo accounts and members'
  personal accounts are runtime `sys_integration` rows created in Configuration → Connections or Settings.
- Source policies: `calendar_activities`, `hq_automation`, `sales`, `template_publishing`.
- Custom datatypes: none.

Pairing and credentials belong to the host's Connections surface; defining a connection does not mean it is paired.

## Browser evidence

![Current local workspace](screenshots/workspace-overview.webp)

![Representative application](screenshots/application.webp)

Captured through the browser from a separate local documentation workspace on 30 October 2026. This shows layout and navigation; it does not certify external providers, automation results or deployment.

Tasks are root work records (subject, owner, due date, completion, company/job/contact/meeting context, files and reminder progression). Calendar and upcoming work read them directly. Follow-up activity rows migrate to tasks with the same identities, original timestamps, notes, files and reminders. `template_documents` permits native editing of drafting instructions; content revisions retain immutable versions. Its commitment flag governs client conversion from signed evidence.
