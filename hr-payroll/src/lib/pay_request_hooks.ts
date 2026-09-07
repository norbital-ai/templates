import { Effect } from 'effect';
import { refuse, type Api as AuthoringApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types';
import { decodeNumber } from '@norbital-ai/std/json';
import { capSubject } from './component_entry_cap_subject.js';
import {
	entryCapRefusal,
	reimbursable,
	resolveEntryCap
} from '../collections/payroll_runs/lib/entry-cap.js';
import { refuseIfCaptured } from './scheduling/lock.js';
import type { PayRequestFamily } from '../collections/payroll_runs/lib/entries.js';

/**
 * What every pay request must satisfy before it is a payroll input at all.
 *
 * The five request collections each state their own shape in columns — a claim's incurred date, an
 * allowance's recurrence, the periods arrears cover, the settled line a correction names — and the
 * database keeps those. This is the remainder: the rules that need the *catalogue*, which no column
 * can reach, plus the settlement lock.
 *
 * It is one function with five callers rather than five copies for the reason the old arm rule was
 * one function with three: a form, an import and a hook that disagree about whether a claim is
 * admissible are three different workspaces.
 *
 * ## What the catalogue decides
 *
 * - **The component must take entries at all.** A schedule is the contract and a formula is
 *   arithmetic; neither consumes a person's number, so a request naming one is a misstatement the
 *   catalogue's own definition refuses.
 * - **The component must take *this* family.** `entry_kind` is the catalogue's declaration of which
 *   request collection may name the row. It used to be checked against a discriminator the entry
 *   restated — and could therefore contradict — and is now checked against the collection the write
 *   arrived at, which cannot be misstated because it is not stated at all.
 * - **A component that demands evidence gets it.** Only claims carry evidence, and only the claim
 *   collection has a column for one, so this reads `definition.evidence` and looks no further.
 * - **The entitlement ceiling.** See `entryCapRefusal` below.
 *
 * ## The settlement lock
 *
 * The family's capture junction is what freezes a consumed request: any row over it names a run
 * that still stands, and the same `refuseIfCaptured` sentence the other source families use
 * explains how to release it. Corrections do not bypass it — a settled payslip is corrected with a
 * new `correction_requests` row naming the settled adjustment, never by editing the row that was
 * consumed.
 */
export type PayRequestGuard = {
	/** The collection this hook guards, named the way a refusal should read. */
	readonly family: PayRequestFamily;
	/** How to read the day this request's economics belong to, off its own columns. */
	readonly eventDate: (candidate: Readonly<Record<string, unknown>>) => string | null;
	/** Whether this family's rows count against a cap in the same direction. */
	readonly sign?: number;
	/** The capture read that says a run has already consumed this row. */
	readonly capture: (
		api: AuthoringApi<WorkspaceSchema, unknown>,
		id: string
	) => Effect.Effect<{ readonly period: string } | undefined, never, never>;
	/** Every live sibling under the same component, for the cap's running total. */
	readonly siblings: (
		api: AuthoringApi<WorkspaceSchema, unknown>,
		employmentId: string,
		componentId: string
	) => Effect.Effect<readonly Readonly<Record<string, unknown>>[], never, never>;
	/** A readable noun for the refusal sentences, e.g. "claim". */
	readonly noun: string;
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
	value == null || typeof value !== 'object' ? {} : (value as Readonly<Record<string, unknown>>);

export function assertPayRequestAdmissible(
	guard: PayRequestGuard,
	options: {
		readonly api: AuthoringApi<WorkspaceSchema, unknown>;
		readonly input: Readonly<Record<string, unknown>>;
		readonly existing: Readonly<Record<string, unknown>> | undefined;
	}
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const { api } = options;
		// The patch merged over the stored row, so a partial update is judged as the row it would
		// produce — the same candidate a form validates before it submits.
		const candidate =
			options.existing === undefined
				? { ...options.input }
				: { ...options.existing, ...options.input };

		const amount = decodeNumber(candidate.amount);
		if (!Number.isFinite(amount) || amount <= 0)
			refuse(`A ${guard.noun} amount is a positive magnitude; direction comes from the component.`);

		const componentId = String(candidate.component_catalogue_id ?? '');
		const component = yield* api.db.component_catalogue.findFirst({
			where: { id: { eq: componentId } },
			columns: { code: true, definition: true, entry_kind: true }
		});
		if (component != null) {
			const definition = component.definition;
			if (definition?.source !== 'ENTRY')
				refuse(
					`Component ${component.code} is calculated by the engine and takes no requests, so nothing can be raised against it.`
				);
			if (component.entry_kind !== guard.family)
				refuse(
					`Component ${component.code} takes ${component.entry_kind ?? 'no'} requests, and this is a ${guard.family} one. The request shape is the component's, not the request's.`
				);
			if (
				guard.family === 'CLAIM' &&
				definition.evidence === 'REQUIRED' &&
				candidate.evidence_file == null
			)
				refuse(`Component ${component.code} requires evidence for its claims. Attach a receipt.`);

			/**
			 * The entitlement ceiling, refused here rather than mid-run.
			 *
			 * The cap used to be enforced only by MEASURE, so a twelfth claim against an annual limit
			 * of ten was accepted, sat in the workspace, and took down the whole company's payroll
			 * weeks later — refusing the run, not the request, at a moment when the person who made
			 * the mistake was no longer looking at it.
			 *
			 * `resolveEntryCap` is the run's own rule. A `FORMULA` layer is priced over the payslip
			 * context, which does not exist at write time, so this caller answers `null` for one and
			 * the resolver then states no ceiling at all — the merge takes the highest layer, and
			 * omitting one would understate it and refuse a legal request. Such a cap stays the run's
			 * to enforce, because its number is not knowable before the payslip.
			 */
			if (definition.cap != null) {
				const eventDate = guard.eventDate(candidate);
				const employmentId = String(candidate.employment_id ?? '');
				if (eventDate != null && employmentId !== '') {
					const person = yield* capSubject(api, employmentId, eventDate);
					if (person != null) {
						const siblings = yield* guard.siblings(api, employmentId, componentId);
						const sign = guard.sign ?? 1;
						const resolved = resolveEntryCap({
							cap: definition.cap,
							componentId,
							employmentId,
							entry: candidate as never,
							eventDate,
							siblings: siblings as never,
							eventDateOf: (row) => guard.eventDate(asRecord(row)),
							signOf: () => sign,
							subject: person.subject,
							// FIXED is knowable now; a formula is not. See above.
							evaluateAward: (layer) => (layer.award.kind === 'FIXED' ? layer.award.amount : null)
						});
						if (resolved != null) {
							const refusal = entryCapRefusal({
								cap: definition.cap,
								resolved,
								componentCode: String(component.code),
								subject: person.label,
								proposed: reimbursable(amount, resolved)
							});
							if (refusal !== null) refuse(refusal);
						}
					}
				}
			}
		}

		// Only an edit can disturb a capture: a create has no prior run that consumed it.
		if (options.existing !== undefined)
			yield* refuseIfCaptured({
				capture: guard.capture(api, String(options.existing.id)),
				approvalId: null,
				action: `Changing this ${guard.noun}`
			});
	});
}

/** The delete half: a request a run has captured is money history, and corrections are new rows. */
export const assertPayRequestDeletable = (
	guard: PayRequestGuard,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	id: string
): Effect.Effect<void, never, never> =>
	refuseIfCaptured({
		capture: guard.capture(api, id),
		approvalId: null,
		action: `Deleting this ${guard.noun}`
	});
