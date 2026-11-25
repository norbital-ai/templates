# Blank

![Blank application](docs/screenshots/application.webp)

A minimal Norbital Bolt starter with one read-only example model (`notes`), no apps and no automations —
designed as a clean foundation for building a custom workspace from scratch or with the workspace agent.

## Apps and roles

None. `src/+workspace.ts` declares only the time zone and locale, with no authored teams or policies. The
workspace shell provides default theming and navigation once you add your first app.

## Data model

| Model   | Purpose                                                                  |
| ------- | ------------------------------------------------------------------------ |
| `notes` | Free-form starter note (`title`, optional `body`); read-only placeholder |

Replace or delete `notes` once you author your first domain model.

## Automations and integrations

None. Extend this starter using standard Bolt filesystem conventions:

- **Models:** `src/data/model/<name>/+model.ts` (`model('<name>', { … })` from `@norbital-ai/bolt` —
  schema, refs, `outputs`, write verbs and callbacks together).
- **Apps:** `src/app/<app>/+app.ts` with one `+<page>.page.svelte` per page.
- **Automations:** `src/automation/+<name>.automation.ts`.
- **Integrations:** `src/integration/<name>/+integration.ts` (built-in channels such as `whatsapp` and
  `email` require no custom definition), paired under **Settings → Integrations**.

The workspace agent (`src/agent/+agent.md`) can author models, pages and automations directly through its
Studio tools, writing drafts you preview and publish. See the
[Norbital OSS repository](https://github.com/norbital-ai/oss/tree/main/packages/bolt) for the authoring
contract.

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

Starts completely empty with no seed rows. `bolt build` refreshes `counts` in `norbital.template.json`
from `src/`.

- [Documentation index](docs/README.md)
- [Source reference](docs/source-reference.md)
