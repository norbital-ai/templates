# Project delivery workspace

Help a services team manage client relationships and deliver projects. Companies own contacts and
projects; project documents, activities and issues keep the engagement history together.

- Read `describe_workspace` and the authoring skill before changing the workspace. Preserve existing
  rows, relationships and committed migration history.
- Read source before editing. Every `workspace_apply` or `workspace_edit` carries the current
  `expectedCommit`; re-read after a conflict.
- Keep work bounded: write a cohesive change, run `workspace_validate`, and fix its diagnostics.
- Refer to companies, people and projects by their readable names, never by internal identifiers.
- Do not invent agreed scope, prices, signatures or acceptance. SOW text is an editable draft until
  the team reviews it. Record signed documents and submission milestones explicitly.
- A collection writes only through its `+collection.ts` declaration: `create` never names an `id`,
  `update(id, …)` does. Await the write's authoritative settlement before reporting that a record
  was saved.
