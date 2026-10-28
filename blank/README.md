# Blank

An empty Norbital workspace: one read-only starter model (`notes`), no apps and no automations.
It is the starting point for building a workspace from scratch with the workspace agent.

## Apps and roles

None. `src/+workspace.ts` declares only the time zone and locale, and no teams or policies are
authored. The starter includes Runed, std and Iconify for authoring ordinary modules and custom UI;
the workspace shell owns theme behavior. Add other dependencies when your source uses them.

## Data model

| Model   | Purpose                                                                   |
| ------- | ------------------------------------------------------------------------- |
| `notes` | A free-form note (`title`, optional `body`); read-only, no write contract |

Replace or delete `notes` once the first real model exists.

## Automations and integrations

None. To build on the starter:

- Models under `src/data/model/<name>/+model.ts`: storage, `ref` fields, exposure (`read`,
  `create`, `update`, `delete`) and logic in one `model('<name>', …)` call (a model without `read`
  is invisible).
- Apps under `src/app/<app>/+app.ts` with one `+<page>.page.svelte` per page.
- Automations under `src/automation/+<name>.automation.ts`.
- External accounts are integrations: a definition under `src/integration/<name>/+integration.ts`
  (Bolt's conversation integrations such as `whatsapp` and `email` are built in), a named instance in
  `src/+workspace.ts` `connections`, and optionally an envoy role under
  `src/agent/envoy/+<id>.envoy.ts` deployed on that instance. An administrator pairs each instance
  under **Settings → Integrations**, where its credentials are entered and stay sealed.

The workspace agent (`src/agent/+agent.md`) can author all of this through its Studio tools
(the `workspace_search`, `workspace_write` and `workspace_validate` tools), which write private drafts a person
previews and publishes. The authoring contract lives in the
[Norbital OSS repository](https://github.com/norbital-ai/oss/tree/main/packages/bolt); the
`authoring-tenant-workspace` skill is its published summary.

## Seed

None.

## Checks

```bash
bun install
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run test    # bolt test
```

`tests/blank.test.ts` recomputes the model, app and automation counts from `src/` and fails when
they disagree with `counts` in `norbital.template.json`: update both in the same change.
