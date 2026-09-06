# RFC 0003: Hook authority simplification (deferred)

- Status: Investigation recorded, implementation deferred
- Scope: `oss` (Bolt) with template follow-up
- Created: 2026-09-07

## Summary

Hook-nested rows (leave accounts/entries under an employment write, payslips under a payroll-run
create) are server-derived work, not caller claims. Today three machineries say that one thing:
the `trusted` flag threaded through graph preparation (`write/engine.ts`), `hookRelationNames`,
and the `afterHookElevation` predicate swap (`policy-surface.ts`), plus the `'after'`/`'none'`
elevation split in `policyWrite` (`invocation.ts`). This RFC records the agreed simplification
and why it is not built yet.

## Findings (traced, with locations)

1. Root + caller-owned nested shape: `policy.write(subject, …, elevation='none')` — allow-policy
   decision, row predicate, and every-submitted-field grant checks (`invocation.ts`).
2. Hook-nested rows (`trusted`): elevation `'after'` skips decision + field checks, swaps the
   predicate to `unrestricted`, and skips their own approval — "a trusted row rides its root's
   route: the graph is one approval, decided once" (`write/engine.ts`). Their own hooks still run.
3. Hook **reads** bind the caller subject with no elevation path (`hooks/boundary.ts`). There is
   no `api.as(...)` or subject-switching on the hook api — a before-hook planner cannot read
   plans, sealed laws or ledgers as a kiosk/employee caller. Verified against access grants:
   kiosk holds zero grants on plans/laws/accounts; employee reads own accounts only.
4. `api.automations.run` from a hook starts a new invocation as `automationSubject` — the
   automation's own declared policies, never the caller (`automations.ts`, `static-identity.ts`).
   The automation hop is therefore the privilege vehicle for low-privilege writers, not just a
   trigger. The leave reconciler depends on this (kiosk enrollments, employee edits).
5. Entailment is not cascade: `leave_account_employment` is deliberately non-`cascade`
   (`collections/+relationship.ts`) — cascade marks delete-ownership, and complete-set
   restatement must not delete omitted siblings. No edge property can carry the rule.
6. A batch commit is one atomic commit but many statements (per-row decode, `prepare` once per
   collection×wave, per-record `before`, graph re-split, snapshots, version asserts, nested
   waves, change events, sync announce) — not "one SQL statement".

## Agreed rule (not yet implemented)

- No `policies` on hooks, no `writes` list, no new edge properties. Hooks stay policy-blind
  pure functions; the engine resolves the requestor union for the caller-owned shape only.
- Hook-returned rows ride the root's authorization as **one documented rule**: delete `trusted`
  threading, `hookRelationNames`, `afterHookElevation`, and the elevation split. One
  authorization function, two subjects (caller-owned vs hook-returned).
- Preserved: nested hooks run (validation), approval rides root, depth limit stays the loop guard.
- The batching design (prepare-once bulk context + before-attached nested payload, no automation
  hop) builds on top — but hook-phase _reads_ need the same ride-root treatment first, which is
  itself an oss change with the same reviewer.

## Why deferred

The change is oss-owned, cross-template, and touches the authorization path every write takes.
It needs the Bolt owner's review, the full oss suite, and every template suite green — plus a
decision on hook-phase reads. Template work (leave settlement union, RFC 0002 follow-ups)
proceeds independently; the per-record automation hop stays until this lands.

## Open questions for the implementation pass

- Fail-closed granularity: root-action level only, or per nested collection?
- Static auditability of what a hook may derive (lint over code vs declaration)?
- Batch-level flush (one automation per commit instead of per record) as an interim step?
