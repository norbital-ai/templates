# CRM source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
agreement_settings/
  template_documents/
calendar_entries/
cohorts/
  cohort_members/
communication_settings/
companies/
  contacts/
  potential_projects/
  projects/
    activities/
      meeting_speakers/
    issues/
    project_documents/
    signed_documents/
notes/
outreach_settings/
sequences/
tasks/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `configuration`, `crm`
- Automations: `activities_classify`, `activities_file`, `activities_reconsider_job_rules`, `activities_retry_routing`, `classify_messages`, `import_leads`, `launch_cohort`, `meeting_notes`, `meeting_speakers_save_voice`, `refresh_job_capture_rules`, `remind_follow_ups`, `replay_calendar_activities`, `replay_message_routes`, `research_lead`, `send_message`, `sync_calendar_activities`, `sync_cohort`, `sync_messages`, `template_documents_new_version`, `transcribe_meeting`, `update_requirements`
- Policies: `calendar_activities`, `calendar_import`, `hq_automation`, `sales`, `template_publishing`
- Custom fields: none
- Integrations: `apollo`, `google_calendar` (and Bolt's own whatsapp, email, telegram, slack, discord)

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- Every document, outreach email and research prompt is a `template_documents` row (`key`, `kind`, `scope`, `required`); text is rendered from it and the record's values (`lib/documents.ts`), never stored; only a signed copy is stored, frozen with its values.
- A company is a lead (`stage`) until converted; only clients show as clients. One company per domain, one PIC per email.
- Personal connections and calendar sources are private to their owner.
- An activity is routed from a source message or calendar entry by its source identity; manual notes survive a re-route.
- Never invent a signature, a signing date or a commercial term.
- Cold outreach is authored only here: a `sequences` row is the template `launch_cohort` pushes to Apollo; the potential-project prompt is the runtime `outreach_settings` row, never source. A lead (contact and company) holds at most one active `cohort_members` row (partial unique constraints); a cohort's `done` releases it.
- Apollo is reached only through the `apollo` integration and its one active account; tests answer through a fake link, never a real key.
- Keep every visible string in both `src/i18n/+messages.ts` and `src/i18n/+zh.messages.ts`.
- Keep downstream client work within the customer representation; load the `crm_acceptance` skill (`src/agent/skill/crm_acceptance/`) before changing apps or models or reporting whether a change works.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
