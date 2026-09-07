import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import {
	componentEntryEventIssues,
	componentEntryEventMismatchMessage,
	componentEntryKindIssues
} from '../../lib/component_entry_refusals.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { entryEventDate, entrySign } from '../payroll_runs/lib/entries.js';
import { entryCapRefusal, reimbursable, resolveEntryCap } from '../payroll_runs/lib/entry-cap.js';
import { capSubject } from '../../lib/component_entry_cap_subject.js';
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

							/**
							 * The entitlement ceiling, refused here rather than mid-run.
							 *
							 * The cap used to be enforced only by MEASURE, so a twelfth claim against an
							 * annual limit of ten was accepted, sat in the workspace, and took down the
							 * whole company's payroll weeks later — refusing the run, not the entry, at a
							 * moment when the person who made the mistake was no longer looking at it.
							 *
							 * `resolveEntryCap` is the run's own rule (`payroll_runs/lib/entry-cap.ts`).
							 * A `FORMULA` layer is priced over the payslip context, which does not exist
							 * at write time, so this caller answers `null` for one and the resolver then
							 * states no ceiling at all — the merge takes the highest layer, and omitting
							 * one would understate it and refuse a legal entry. Such a cap stays the
							 * run's to enforce, because its number is not knowable before the payslip.
							 */
							if (definition.cap != null) {
								const eventDate = entryEventDate(candidate as never);
								const employmentId = String(candidate.employment_id ?? '');
								if (eventDate != null && employmentId !== '') {
									const person = yield* capSubject(api, employmentId, eventDate);
									if (person != null) {
										const siblings = yield* api.db.component_entries.findMany({
											where: {
												employment_id: { eq: employmentId },
												component_catalogue_id: {
													eq: String(candidate.component_catalogue_id)
												},
												approval_id: { isNull: true }
											},
											columns: {
												id: true,
												component_catalogue_id: true,
												amount: true,
												event: true
											},
											limit: 10_000
										});
										const resolved = resolveEntryCap({
											cap: definition.cap,
											componentId: String(candidate.component_catalogue_id),
											employmentId,
											entry: candidate as never,
											eventDate,
											siblings: siblings as never,
											eventDateOf: (row) => entryEventDate(row as never),
											signOf: (row) => entrySign(row as never),
											subject: person.subject,
											// FIXED is knowable now; a formula is not. See above.
											evaluateAward: (layer) =>
												layer.award.kind === 'FIXED' ? layer.award.amount : null
										});
										if (resolved != null) {
											const refusal = entryCapRefusal({
												cap: definition.cap,
												resolved,
												componentCode: String(catalogueComponent.code),
												subject: person.label,
												proposed: reimbursable(decodeNumber(candidate.amount), resolved)
											});
											if (refusal !== null) refuse(refusal);
										}
									}
								}
							}
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
