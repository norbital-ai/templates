import type { Id } from '@norbital-ai/bolt';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import { Effect } from 'effect';
import { model } from '../../../../../.norbital/models/dependant.ts';
import { amendmentsFor, refusing } from '../../../../lib/amendments.js';
import { assertFactsHold } from '../../../../lib/ledger/service.js';
import {
	PARAMETER_FIELDS,
	PROFILE_FIELDS,
	STINT_FIELDS,
	TERM_FIELDS,
	employmentOn,
	partsIn,
	segmentsOf
} from '../../../../lib/person.js';
import {
	jsonObject,
	stableJson,
	type JsonObject
} from '../../../../lib/payroll_engine/foundation.js';
import { idOf, queryRows, type Reader } from '../../../../lib/payroll_engine/reads.js';

/** What a formula or a leave row reads of a dependant; the name is for people. */
const READ = [
	'relation',
	'born_on',
	'expected_on',
	'has_income',
	'disabled',
	'studying',
	'allocations'
] as const;
const DATED = ['id', 'employment_id', 'effective_from', 'clears'] as const;

/**
 * The paid periods a write to dependants reaches: each person's, from the dependant's own date (its birth or expected
 * date, the earlier of old and new), or every one where it has none. A change to the name alone reaches nothing.
 */
const touched = (
	changes: readonly { readonly before?: JsonObject; readonly after?: JsonObject }[]
) =>
	changes.flatMap(({ before, after }) => {
		const facts = (row: JsonObject | undefined) =>
			row === undefined ? null : stableJson(READ.map((field) => row[field] ?? null));
		const row = after ?? before;
		if (row === undefined || facts(before) === facts(after)) return [];
		const days = [before, after].map((held) =>
			held === undefined ? undefined : (held.born_on ?? held.expected_on ?? '1900-01-01')
		);
		return [
			{
				employee: String(row.employee_id),
				from: String(days.filter((day) => day !== undefined).toSorted()[0]),
				to: null
			}
		];
	});

/** A dependant taken away or moved must not leave days taken under it with nothing behind them. */
const factsHold = Effect.fnUntraced(function* (
	read: Reader & {
		after(
			model: 'dependant',
			where: { readonly employee_id: { readonly in: readonly Id<'employee_profile'>[] } }
		): Effect.Effect<readonly object[], ReadFailed>;
	},
	people: readonly unknown[]
) {
	const ids = [...new Set(people.map(String))];
	// the dependants as this write leaves them
	const dependant = (yield* read.after('dependant', {
		employee_id: { in: ids.map((id) => idOf('employee_profile', id)) }
	})).map((row) => jsonObject(row));
	const theirs = { employment_id: { is: { employee_id: { in: ids } } } };
	const got = yield* queryRows(read, {
		employment: { where: { employee_id: { in: ids } }, fields: [...STINT_FIELDS], limit: 10000 },
		contract_terms: {
			where: theirs,
			fields: [...DATED, 'signed_on', ...TERM_FIELDS],
			limit: 10000
		},
		statutory_parameters: {
			where: theirs,
			fields: [...DATED, ...PARAMETER_FIELDS],
			limit: 10000
		},
		employee_profile: { where: { id: { in: ids } }, fields: [...PROFILE_FIELDS], limit: 10000 }
	});
	yield* assertFactsHold(
		read,
		partsIn({ ...got, dependant }).flatMap((parts) => {
			const on = segmentsOf(parts).at(-1)?.from;
			return on === undefined || parts.terms.length === 0
				? []
				: [{ employment: employmentOn(parts, on), on }];
		})
	);
});

export default model({
	description:
		'One member of a person’s family, dated by its own birth or expected date. Every count or flag a scheme reads (dependants, a spouse’s income, births) is worked out from these rows, and a child’s birth is a leave event.',
	icon: 'lucide:users',
	record_label: 'has(record.name) ? record.name : string(record.relation)',
	fields: {
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			inverse: 'dependants',
			on_delete: 'cascade'
		},
		relation: { kind: 'enum', values: ['CHILD', 'SPOUSE', 'PARENT'] },
		name: { kind: 'text', optional: true },
		born_on: { kind: 'date', optional: true },
		expected_on: { kind: 'date', optional: true },
		has_income: { kind: 'bool', optional: true },
		disabled: { kind: 'bool', optional: true },
		studying: { kind: 'bool', optional: true },
		/** HR's approved leave days for this child, keyed by leave code. */
		allocations: {
			kind: 'json',
			optional: true,
			shape: { kind: 'record', of: { kind: 'number', min: 0 } }
		}
	},
	outputs: {
		default: {
			fields: 'all',
			// a read reaches a person's dependants through the person and their stints
			employee_id: { fields: 'all', employment: { fields: 'all' } }
		}
	},
	// a dependant is a pay input and a leave fact: its write carries the amendment rows of the paid periods it reaches
	create: {
		columns: { fields: ['employee_id', 'name', ...READ] },
		transform: function* (changes, ctx) {
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* amendmentsFor(
					ctx.query,
					touched(changes.map(({ after }) => ({ after: jsonObject(after) })))
				).pipe(refusing(ctx))
			};
		},
		effect: function* (changes, ctx) {
			yield* ctx.schedule('ledger', {
				employees: [...new Set(changes.map(({ after }) => after.employee_id))]
			});
		}
	},
	update: {
		columns: { fields: ['name', ...READ] },
		transform: function* (changes, ctx) {
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* Effect.gen(function* () {
					yield* factsHold(
						ctx.query,
						changes.map(({ before }) => before.employee_id)
					);
					return yield* amendmentsFor(
						ctx.query,
						touched(
							changes.map(({ before, after }) => ({
								before: jsonObject(before),
								after: jsonObject(after)
							}))
						)
					);
				}).pipe(refusing(ctx))
			};
		},
		effect: function* (changes, ctx) {
			yield* ctx.schedule('ledger', {
				employees: [...new Set(changes.map(({ after }) => after.employee_id))]
			});
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			return {
				on_approved: yield* Effect.gen(function* () {
					yield* factsHold(
						ctx.query,
						changes.map(({ before }) => before.employee_id)
					);
					return yield* amendmentsFor(
						ctx.query,
						touched(changes.map(({ before }) => ({ before: jsonObject(before) })))
					);
				}).pipe(refusing(ctx))
			};
		},
		effect: function* (changes, ctx) {
			yield* ctx.schedule('ledger', {
				employees: [...new Set(changes.map(({ before }) => before.employee_id))]
			});
		}
	}
});
