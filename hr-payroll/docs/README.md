# HR & Payroll documentation

This template's maintained documentation. Read the source tree as the final authority; these
documents describe its contracts and the gates that keep it honest.

**Start with [section 0 of the calculation architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed).** It is the owner's fixed design. Every agent wires around it.

| Document                                                                                | Owns                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [0000 — How this HRMS works](0000-hrms-principles.md)                                   | The principles in plain language, for HR professionals                             |
| [0001 — Calculation architecture](0001-hrms-calculation-architecture.md)                | The fixed design; ledger, base pay, subtotal chain and posting                     |
| [0002 — Model specification](0002-model-specification.md)                               | Model fields, ownership, relationships and the final source tree                   |
| [0003 — Jurisdiction seed](0003-jurisdiction-seed-specification.md)                     | Seed layout, versions and authoring rules                                          |
| [0004 — Verification and gates](0004-verification-gates.md)                             | Current verified state, open gates and evidence policy                             |
| [0005 — Target architecture](0005-target-architecture.md)                               | The system as built: primitives, responsibilities, ledger service, worked examples |
| [0006 — Configuration ownership and smells](0006-configuration-ownership-and-smells.md) | The second-owner smell, ownership ladder and owner rules                           |
| [Transfer semantics](transfer-semantics.md)                                             | Contract chains, balances, leave/loan settlement and voids                         |
| [Manual probe matrix](manual-probe-matrix.md)                                           | The live acceptance checklist across nine jurisdictions                            |

The template [`README.md`](../README.md) covers apps, roles, data model, automations, seed and
checks for operators. The workspace agent's brief is
[`src/agent/+agent.md`](../src/agent/+agent.md); the source map for coding agents is
[`src/agent/AGENTS.md`](../src/agent/AGENTS.md).

The seed is maintained per jurisdiction under `seed/public/jurisdiction/<CODE>/version_<v>/`.
