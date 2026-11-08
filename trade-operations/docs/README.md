# Trade Operations documentation

This folder is the maintained documentation for the template. The source tree is the final authority; these
documents describe its objective, contracts and gates, and never create a second implementation plan.

Read in order. Each document ends with the next one, so the sequence is the intended path from product intent to
operating evidence.

| #    | Document                                                   | Owns                                                                                        |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0000 | [Objective](0000-objective.md)                             | What the workspace is for, who it serves, scope, principles and success                     |
| 0001 | [Architecture](0001-architecture.md)                       | Applications, order/agreement lifecycle, pricing, commission, documents, access, invariants |
| 0002 | [Integration](0002-integration.md)                         | Kingdee boundary, read pages, network-blip safety, efficiency, hidden/local tables          |
| 0003 | [Source reference](0003-source-reference.md)               | Current applications, model outputs/writes, syncs, automations and integrations             |
| 0004 | [Kingdee implementation](0004-kingdee-implementation.md)   | SQL projections, account set, bindings, write path and connection operations                |
| 0005 | [Kingdee order lifecycle](0005-kingdee-order-lifecycle.md) | Source order versions, approval, void, amendment and the production writer incident         |
| 0006 | [SalesBridge parity](0006-salesbridge-parity.md)           | Source-by-source coverage, decisions and known gaps                                         |
| 0007 | [Print layouts](0007-print-layouts.md)                     | Layout HTML, fields, PDF rendering and retained document evidence                           |
| 0008 | [Manual probe matrix](0008-manual-probe-matrix.md)         | Live acceptance checklist, evidence and open probes                                         |

The template [`README.md`](../README.md) is the operator walkthrough. The workspace agent brief is
[`src/agent/+agent.md`](../src/agent/+agent.md); the coding-agent source map is
[`src/agent/AGENTS.md`](../src/agent/AGENTS.md).

## How to keep these docs honest

- A behaviour claim names the source that owns it. If the code changes, change the document in the same change.
- A gap is a gap. Do not describe a planned path as implemented, and do not turn a missing source binding into a
  guessed value.
- `0003` is a dated inventory. Re-check it when a model, output, write, sync or automation changes.
- `0008` records runtime evidence. A green automated suite does not certify an external provider or a deployed
  release; name the build and the actual probe.
