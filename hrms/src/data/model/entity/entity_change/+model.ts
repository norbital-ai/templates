import type { CarriedWrites, EffectCtx } from '@norbital-ai/bolt';
import { DateTime, Effect } from 'effect';
import { model } from '../../../../../.norbital/models/entity_change.ts';
import { amendmentsOf, refusing } from '../../../../lib/amendments.js';
import { COMPANY_FIELDS, companyChange, employerOn } from '../../../../lib/company.js';
import { reachOf } from '../../../../lib/dated.js';
import { syncLedgerOn } from '../../../../lib/payroll_engine/configuration.js';
import {
	jsonObject,
	stableJson,
	type JsonObject
} from '../../../../lib/payroll_engine/foundation.js';
import { queryRows, type Reader } from '../../../../lib/payroll_engine/reads.js';
import { validateRegistered } from '../../../../lib/payroll_engine/registrations.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';

type Verb = 'create' | 'update' | 'delete';

/** These companies and every change of theirs: what a write is checked on, in one read. */
const companies = (read: Reader, entities: readonly unknown[]) => {
	const ids = [...new Set(entities.map(String))];
	return queryRows(read, {
		entity: {
			where: { id: { in: ids } },
			fields: [
				'id',
				'settings_code',
				'name',
				'representative_name',
				'registered_address',
				'time_zone',
				'bank'
			],
			limit: 10000
		},
		entity_change: { where: { entity_id: { in: ids } }, limit: 10000 }
	});
};

const of = (entity: JsonObject, rows: readonly JsonObject[]) =>
	rows.filter((row) => String(row.entity_id) === String(entity.id));

/**
 * The company as a registered rule or effect reads it at a change: its plain fields with its dated values on that day,
 * from that day to the day before its next change.
 */
const entryOn = (entity: JsonObject, changes: readonly JsonObject[], day: string): JsonObject => {
	const next = changes
		.map((row) => String(row.effective_from))
		.filter((date) => date > day)
		.toSorted()[0];
	return {
		...employerOn(entity, changes, day),
		id: changes.find((row) => row.effective_from === day)?.id ?? null,
		effective_range: {
			from: day,
			to:
				next === undefined
					? null
					: DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(next), { days: -1 }))
		}
	};
};

/**
 * A write to these companies' changes, checked where a seal checked. `rewrite` turns the stored changes into the changes
 * the write leaves. Each company is folded on the earliest day the write touches and at every later change date, and
 * its law's registered rules must hold on each. Answers the amendment rows of the paid periods the write reaches, for
 * the write to carry.
 */
const companyWrite = Effect.fnUntraced(function* (
	read: Reader,
	verb: Verb,
	entities: readonly unknown[],
	rewrite: (stored: readonly JsonObject[]) => readonly JsonObject[]
) {
	const got = yield* companies(read, entities);
	const stored = got.entity_change ?? [];
	const next = rewrite(stored);
	const entries: JsonObject[] = [];
	type Carried = NonNullable<NonNullable<CarriedWrites['pay_amendment']>['create']>;
	const carried: Carried[number][] = [];
	for (const entity of got.entity ?? []) {
		const after = of(entity, next);
		const prior = new Map(
			of(entity, stored)
				.map(companyChange)
				.map((row) => [row.id, row])
		);
		const post = new Map(after.map(companyChange).map((row) => [row.id, row]));
		const written = [...new Set([...prior.keys(), ...post.keys()])].filter((id) => {
			const a = prior.get(id);
			const b = post.get(id);
			return (
				a === undefined ||
				b === undefined ||
				a.effective_from !== b.effective_from ||
				stableJson(a.patch) !== stableJson(b.patch)
			);
		});
		const from = written
			.flatMap((id) => [prior.get(id), post.get(id)])
			.flatMap((row) => (row === undefined ? [] : [row.effective_from]))
			.toSorted()[0];
		if (from === undefined) continue;
		const days = new Set([
			from,
			...[...post.values()].map((row) => row.effective_from).filter((day) => day > from)
		]);
		for (const day of [...days].toSorted()) entries.push(entryOn(entity, after, day));
		const amended: CarriedWrites = yield* amendmentsOf(
			read,
			written.flatMap((id) => {
				const span = reachOf(
					[...post.values()].filter((row) => row.id !== id),
					prior.get(id),
					post.get(id)
				);
				return span === undefined ? [] : [{ entity: String(entity.id), ...span }];
			})
		);
		carried.push(...(amended.pay_amendment?.create ?? []));
	}
	yield* validateRegistered(read, 'entity_change', verb, entries);
	const writes: CarriedWrites = carried.length === 0 ? {} : { pay_amendment: { create: carried } };
	return writes;
});

/**
 * After the write: the law's registered effects read the company as it stood and as it stands at each written change,
 * and the ledger syncs now for a change in force today, else on the change's day.
 */
const afterWrite = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	verb: Verb,
	changes: readonly { readonly before?: JsonObject; readonly after?: JsonObject }[]
) {
	const rows = changes.flatMap(({ before, after }) =>
		[before, after].filter((row): row is JsonObject => row !== undefined)
	);
	const got = yield* companies(
		ctx.query,
		rows.map((row) => row.entity_id)
	);
	const ids = new Set(rows.map((row) => String(row.id)));
	const now = got.entity_change ?? [];
	const was = [
		...now.filter((row) => !ids.has(String(row.id))),
		...changes.flatMap(({ before }) => (before === undefined ? [] : [before]))
	];
	const entry = (held: readonly JsonObject[], row: JsonObject | undefined) => {
		const entity = (got.entity ?? []).find((company) => company.id === row?.entity_id);
		return row === undefined || entity === undefined
			? undefined
			: entryOn(entity, of(entity, held), String(row.effective_from));
	};
	yield* tap(
		ctx,
		verb,
		'entity_change',
		changes.map(({ before, after }) => {
			const stood = entry(was, before);
			const stands = entry(now, after);
			return {
				...(stood === undefined ? {} : { before: stood }),
				...(stands === undefined ? {} : { after: stands })
			};
		})
	);
	yield* syncLedgerOn(
		ctx,
		rows.map((row) => String(row.effective_from))
	);
});

const named = (clears: readonly string[] | null | undefined) =>
	(clears ?? []).every((name) => COMPANY_FIELDS.some((field) => field === name));

export default model({
	description:
		'One dated change to a company: from its date, the fields it holds are now these. A field left empty is unchanged; one named in clears is taken away. A change may be edited, moved or deleted.',
	icon: 'lucide:calendar-plus',
	record_label: 'record.effective_from',
	fields: {
		entity_id: { kind: 'ref', to: 'entity', inverse: 'changes', on_delete: 'cascade' },
		effective_from: { kind: 'date' },
		pay_methods: {
			kind: 'object',
			optional: true,
			fields: {
				overtime_hour_basis: {
					kind: 'enum',
					values: ['STATUTORY', 'CONTRACT_WEEKLY'],
					default: 'STATUTORY'
				},
				rest_day_hourly_multiplier: {
					kind: 'number',
					min: 1,
					optional: true
				},
				night_differential_basis: {
					kind: 'enum',
					values: ['WORKED', 'CLOCK_SPAN', 'WHOLE_NIGHT'],
					default: 'WORKED'
				},
				contribution_split: {
					kind: 'enum',
					values: ['EVEN', 'FIRST_RUN'],
					default: 'EVEN'
				},
				health_billing: {
					kind: 'enum',
					values: ['CURRENT', 'ARREARS'],
					default: 'CURRENT'
				},
				benefit_exclusion: {
					kind: 'enum',
					values: ['POOLED', 'EXCESS_TAXED'],
					default: 'POOLED'
				},
				/** Leave codes the employer pays in full where the law's row leaves them unpaid: its own policy, no statute. */
				paid_leave: { kind: 'text', many: true, optional: true }
			}
		},
		final_pay_loan_floor_percent: { kind: 'int', min: 0, max: 100, optional: true },
		overtime_full_award_percent: { kind: 'int', min: 1, max: 100, optional: true },
		/** What the law's formulas read of the company: the fields its jurisdiction's entity extension schema declares. */
		statutory_parameters: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true
		},
		/** The fields above taken away from this date. */
		clears: { kind: 'text', many: true, optional: true }
	},
	constraints: { one_change: { unique: ['entity_id', 'effective_from'] } },
	outputs: { default: { fields: 'all' } },
	// every write is checked on the company it leaves, on its date and at every later change, and carries the amendment
	// rows of the paid periods it reaches
	create: {
		columns: { fields: ['entity_id', 'effective_from', ...COMPANY_FIELDS, 'clears'] },
		transform: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			const unknown = rows.findIndex((row) => !named(row.clears));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.entity_change_clears', { row: unknown, field: 'clears' });
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* companyWrite(
					ctx.query,
					'create',
					rows.map((row) => row.entity_id),
					(stored) => [
						...stored,
						...rows.map((row, index) => jsonObject({ ...row, id: `new/${index}` }))
					]
				).pipe(refusing(ctx))
			};
		},
		effect: function* (changes, ctx) {
			yield* afterWrite(
				ctx,
				'create',
				changes.map(({ after }) => ({ after: jsonObject(after) }))
			);
		}
	},
	update: {
		columns: { fields: ['effective_from', ...COMPANY_FIELDS, 'clears'] },
		transform: function* (changes, ctx) {
			const unknown = changes.findIndex(({ after }) => !named(after.clears));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.entity_change_clears', { row: unknown, field: 'clears' });
			const written = new Map(changes.map(({ before, after }) => [String(before.id), after]));
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* companyWrite(
					ctx.query,
					'update',
					changes.map(({ before }) => before.entity_id),
					(stored) =>
						stored.map((row) => {
							const after = written.get(String(row.id));
							return after === undefined ? row : jsonObject({ ...after, id: row.id ?? null });
						})
				).pipe(refusing(ctx))
			};
		},
		effect: function* (changes, ctx) {
			yield* afterWrite(
				ctx,
				'update',
				changes.map(({ before, after }) => ({
					before: jsonObject(before),
					after: jsonObject(after)
				}))
			);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const gone = new Set(changes.map(({ before }) => String(before.id)));
			return {
				on_approved: yield* companyWrite(
					ctx.query,
					'delete',
					changes.map(({ before }) => before.entity_id),
					(stored) => stored.filter((row) => !gone.has(String(row.id)))
				).pipe(refusing(ctx))
			};
		},
		effect: function* (changes, ctx) {
			yield* afterWrite(
				ctx,
				'delete',
				changes.map(({ before }) => ({ before: jsonObject(before) }))
			);
		}
	}
});
