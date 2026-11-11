# HR & Payroll documentation

Four documents explain the workspace. Each can be read alone. The source tree is the final authority.

| Document                                                       | What it answers                                                                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](0001-hrms-calculation-architecture.md)          | Who owns what, how the records connect, how a law version is chosen, what the engine computes, the automations and the roles. Section 0 is the fixed design |
| [Core mechanisms, run through](0008-mechanisms-walkthrough.md) | One invented example from company setup to an exit: what HR does, what the system writes, where it shows                                                    |
| [Reversals and corrections](0007-corrections-and-integrity.md) | How every act is undone, what follows a cancelled exit, the ledger's invariants and the integrity check                                                     |
| [Statutory coverage in the seed](0009-statutory-coverage.md)   | What law each of the nine jurisdictions carries, what is not enforced, and how it is verified                                                               |

**Before changing anything, read [section 0 of the architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed).** It is the owner's fixed design. Every agent wires around it.

Reference:

| Document                                                                   | Holds                                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Model specification](0002-model-specification.md)                         | Every model, its fields and its write rules                                                              |
| [Jurisdiction seed specification](0003-jurisdiction-seed-specification.md) | How a law version is authored in the public seed                                                         |
| [Transfer semantics](transfer-semantics.md)                                | Contract chains, transfers within and across jurisdictions, voids                                        |
| [Manual probe matrix](manual-probe-matrix.md)                              | The probes an operator runs against a running workspace                                                  |
| [Compliance research](compliance/)                                         | Dated legal research per jurisdiction, with sources. Where a note differs from the seed, the seed stands |

The template [`README.md`](../README.md) covers apps, checks and the release for operators. The workspace agent's brief is [`src/agent/+agent.md`](../src/agent/+agent.md); the source map for coding agents is [`src/agent/AGENTS.md`](../src/agent/AGENTS.md).
