# HRMS documentation

Read [section 0 of the architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed) first. It is the owner's fixed design. The source tree is the final authority.

- [Architecture](0001-hrms-calculation-architecture.md): the fixed design, the owners, the law by date, catalogues, the engine, the ledger, rules and effects, automations, roles and screens.
- [Core mechanisms, run through](0008-mechanisms-walkthrough.md): one invented example from company setup to an exit.
- [Corrections and integrity](0007-corrections-and-integrity.md): correcting a paid period at its source, how a period reads the employment, the ledger's invariants and the integrity check.
- [Dated changes](0011-dated-changes.md): plain fields, self-dated records and dated change rows; the fold, and the decisions behind it.
- [Model specification](0002-model-specification.md): every model, its fields and its write rules, and the expression context.
- [Jurisdiction seed specification](0003-jurisdiction-seed-specification.md): how a law and its dated changes are authored in the public seed.
- [Transfer semantics](transfer-semantics.md): stints, transfers, service, loans and exits.
- [Statutory coverage in the seed](0009-statutory-coverage.md): what law each of the nine jurisdictions carries, and how it is verified.

The template [README](../README.md) covers apps, checks and the release. The workspace agent reads [`src/agent/+agent.md`](../src/agent/+agent.md); coding agents start from [`src/agent/AGENTS.md`](../src/agent/AGENTS.md).
