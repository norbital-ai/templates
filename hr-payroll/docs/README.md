# HR & Payroll documentation

This template's maintained documentation. Read the source tree as the final authority; these
documents describe its contracts and the gates that keep it honest.

| Document                                                                 | Owns                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [0001 — Calculation architecture](0001-hrms-calculation-architecture.md) | Ledger, base pay, subtotal chain, statutory order and posting    |
| [0002 — Model specification](0002-model-specification.md)                | Model fields, ownership, relationships and the final source tree |
| [0003 — Jurisdiction seed](0003-jurisdiction-seed-specification.md)      | Seed pack integrity, replacement procedure and authoring rules   |
| [0004 — Verification and gates](0004-verification-gates.md)              | Current verified state, open gates and evidence policy           |
| [Transfer semantics](transfer-semantics.md)                              | Contract chains, balances, leave/loan settlement and voids       |
| [Manual probe matrix](manual-probe-matrix.md)                            | The live acceptance checklist across nine jurisdictions          |
| [Seed migration guide](seed-migration-guide.md)                          | Replaying the legacy pack into the replacement seed              |

The template [`README.md`](../README.md) covers apps, roles, data model, automations, seed and
checks for operators. The workspace agent's brief is
[`src/agent/+agent.md`](../src/agent/+agent.md); the source map for coding agents is
[`src/agent/AGENTS.md`](../src/agent/AGENTS.md).

The old jurisdiction seed bank that lived beside these documents has been removed. The replacement
seed is maintained per jurisdiction under `seed/public/jurisdiction/<CODE>/version_<v>/`.
