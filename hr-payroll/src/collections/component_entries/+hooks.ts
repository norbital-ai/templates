import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import {
	componentEntryEventIssues,
	componentEntryEventMismatchMessage,
	componentEntryKindIssues
} from '../../lib/component_entry_refusals.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import type { Hooks } from './$types.js';

/**
 * What an entry must satisfy before it is a payroll input at all.
 *
 * The arm rule is shared with the form (`componentEntryEventIssues` in
 * `src/lib/component_entry_refusals.ts`, a pure function) so a form, an import and this hook
 * cannot disagree. On top of it, two checks need the catalogue:
 *
 * - **The component must be an `ENTRY` definition.** A schedule is the contract and a formula is
 *   arithmetic; neither consumes a person's number, so an entry that names one is a misstatement
 *   the catalogue's own definition refuses.
 * - **A component that demands evidence gets it.** `definition.evidence` is the catalogue's own
 *   policy, so the requirement is read from there and not restated here.
 *
 * ## The settlement lock
 *
 * The entry-capture junction is what freezes a consumed entry: any row over this entry names a run
 * that still stands, and the same `refuseIfCaptured` sentence the other source families use
 * explains how to release it. Corrections do not bypass it: a settled payslip is corrected with a
 * NEW entry naming the settled adjustment through `corrects_adjustment_id`, never by editing the
 * one that was consumed.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses an entry whose payload disagrees with its event arm, a component that does not take entries, an unevidenced claim on a component that demands one, a non-positive amount, and any change to an entry a payroll run has already captured.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						// The patch merged over the stored row, so a partial update is judged as the row it
						// would produce — the same candidate a form validates before it submits.
						const candidate = existing === undefined ? { ...input } : { ...existing, ...input };
						const issues = componentEntryEventIssues(candidate);
						if (issues.length > 0) refuse(componentEntryEventMismatchMessage(candidate, issues));
						// The component must actually take entries, and a component that demands evidence
						// gets it from the claim that cites it.
						const catalogueComponent = yield* api.db.component_catalogue.findFirst({
							where: { id: { eq: String(candidate.component_catalogue_id) } },
							columns: { code: true, definition: true, entry_kind: true }
						});
						if (catalogueComponent != null) {
							const definition = catalogueComponent.definition;
							if (definition?.source !== 'ENTRY')
								refuse(
									`Component ${catalogueComponent.code} does not take entries, so nothing can be raised against it.`
								);
							const event = candidate.event;
							const eventKind =
								event != null && typeof event === 'object' ? Reflect.get(event, 'kind') : undefined;
							// The arm is the component's. The entry restates it because the union carries the
							// payload, and this is what stops the two drifting apart.
							const kindIssues = componentEntryKindIssues(
								eventKind,
								catalogueComponent.entry_kind,
								catalogueComponent.code
							);
							if (kindIssues.length > 0) refuse(kindIssues.join(' '));
							if (
								definition.evidence === 'REQUIRED' &&
								eventKind === 'CLAIM' &&
								candidate.evidence_file == null
							)
								refuse(
									`Component ${catalogueComponent.code} requires evidence for its claims. Attach a receipt.`
								);
						}
						// Only an edit can disturb a capture: a create has no prior run that consumed it.
						if (existing !== undefined)
							yield* refuseIfCaptured({
								capture: api.db.payslip_component_entry_inputs.findFirst({
									where: { component_entry_id: { eq: existing.id } },
									columns: { period: true }
								}),
								approvalId: null,
								action: 'Changing this component entry'
							});
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a component entry a payroll run has already captured. Corrections are new entries.',
				handler: ({ existing, api }) =>
					refuseIfCaptured({
						capture: api.db.payslip_component_entry_inputs.findFirst({
							where: { component_entry_id: { eq: existing.id } },
							columns: { period: true }
						}),
						approvalId: null,
						action: 'Deleting this component entry'
					})
			}
		}
	}
} satisfies Hooks;
