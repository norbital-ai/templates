import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { PARAMETER_FIELDS, TERM_FIELDS, type Parts } from '../../person.js';
import { jsonObject } from '../../payroll_engine/foundation.js';

/**
 * A person's stints with their dated rows, and their dependants, live: what the profile's tabs show. Call during
 * component initialisation.
 */
export function personRead(
	ctx: Pick<PageContext, 'query'>,
	person: () => Id<'employee_profile'> | null
) {
	const read = $derived.by(() => {
		const id = person();
		return id === null
			? null
			: ctx.query({
					employment: {
						where: { employee_id: { eq: id } },
						fields: [
							'revision',
							'employee_id',
							'entity_id',
							'employee_number',
							'effective_range',
							'service_started_on',
							'exit_ground',
							'encash_leave',
							'final_pay_due_on',
							'reason',
							'events'
						],
						limit: 1000,
						terms: {
							fields: ['revision', 'effective_from', 'signed_on', ...TERM_FIELDS, 'clears'],
							limit: 10000
						},
						parameters: {
							fields: ['revision', 'effective_from', ...PARAMETER_FIELDS, 'clears'],
							limit: 10000
						}
					},
					dependant: { where: { employee_id: { eq: id } }, limit: 1000 },
					entity: { fields: ['name', 'settings_code'], order_by: { name: 'asc' }, limit: 1000 },
					// what a term names by reference, for its name
					pay_group: { fields: ['name'], limit: 1000 },
					shift_pattern: { fields: ['name'], limit: 1000 }
				});
	});
	/** Newest first. */
	const stints = $derived(
		(read?.current?.employment.rows ?? []).toSorted((left, right) =>
			String(right.effective_range.from).localeCompare(String(left.effective_range.from))
		)
	);
	return {
		get loading() {
			return read?.loading ?? false;
		},
		get stints() {
			return stints;
		},
		get dependants() {
			return read?.current?.dependant.rows ?? [];
		},
		/** Every company, by name: a stint's own, and where a person may be hired or moved. */
		get companies() {
			return read?.current?.entity.rows ?? [];
		},
		company: (id: unknown) => (read?.current?.entity.rows ?? []).find((row) => row.id === id),
		/** The names of the records a term refers to, by id. */
		get names(): ReadonlyMap<string, string> {
			return new Map(
				[
					...(read?.current?.pay_group.rows ?? []),
					...(read?.current?.shift_pattern.rows ?? [])
				].flatMap((row) => (row.name == null ? [] : [[String(row.id), row.name] as const]))
			);
		}
	};
}
export type PersonRead = ReturnType<typeof personRead>;
export type StintRow = PersonRead['stints'][number];

/** Whether a stint covers a day. */
export const covers = (stint: StintRow, day: string) =>
	String(stint.effective_range.from) <= day &&
	(stint.effective_range.to == null || day <= String(stint.effective_range.to));
