import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import { sealOnly } from '../service/entries.js';
import { isJsonObject, jsonObject, type JsonObject } from '../../../../lib/foundation.js';
import { amendmentsFor, refusing } from '../../payroll_run/service/amendments.js';
import { sharesPay } from '../../payroll_run/service/rates.js';
import {
	assertLeft,
	assertCashable,
	entriesUndone,
	entryPostings,
	entryRead,
	assertWorked,
	lawOf,
	syncLatePosted,
	type Known
} from '../../employee_profile/employee_balance/service/service.js';
import { tap } from '../../jurisdiction/service/taps.js';

const unpaid = (known: Known, entry: JsonObject): boolean => {
	const catalog = lawOf(known, entry)?.rows.leave_catalog.find(
		(row) => String(row.code) === String(entry.catalog_code)
	);
	return catalog !== undefined && sharesPay(catalog);
};

/** The days a leave prices, and the run that priced each: a paid period holding one is worked out again. */
const touched = (
	employment: unknown,
	days: readonly unknown[],
	cashOut: unknown = false,
	paySharing = false
) =>
	days.flatMap((day) => {
		if (!isJsonObject(day)) return [];
		const date = day.date ?? day.incurred_on;
		return typeof date === 'string'
			? [
					{
						employment: String(employment),
						from: date,
						run: day.payroll_run_id ?? null,
						// unpaid/partial-pay leave inside a period's salary coverage can turn that period full-unpaid or back out
						...(paySharing && cashOut !== true ? {} : { attendance: true }),
						// a cash-out's days are placeholders: only the run that paid it is touched
						...(cashOut === true ? { undated: true } : {})
					}
				]
			: [];
	});
export default model('leave_catalog_entry', {
	description: 'One leave request: dated half-day slots for an employment.',
	record_label: "record.employment_id.employee_number + ' · ' + record.catalog_code",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employment', inverse: 'leave_catalog_entry' },
		catalog_code: { kind: 'text' },
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'leave',
			optional: true,
			on_delete: 'set_null'
		},
		evidence_file: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			optional: true
		},
		// HR pays days out for someone still employed; an exit's own leave is settled by its last payslip, with no entry
		encashment: { kind: 'bool', default: false, hidden: true }
	},
	outputs: {
		default: {
			fields: 'all',
			employment_id: { fields: 'all' },
			payroll_run_id: { fields: 'all' },
			leave_catalog_entry_day: { fields: 'all' }
		}
	},
	create: {
		fields: ['entity_id', 'employment_id', 'catalog_code', 'evidence_file', 'encashment'],
		leave_catalog_entry_day: { fields: ['incurred_on', 'part'] },
		transform: function* (changes, ctx) {
			const slotsOf = (row: JsonObject) =>
				(Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : []).flatMap(
					(child) =>
						isJsonObject(child) && typeof child.incurred_on === 'string'
							? [
									{
										date: child.incurred_on,
										part: child.part,
										payroll_run_id: child.payroll_run_id ?? null
									}
								]
							: []
				);
			const entries = changes.map((c) => {
				const row = jsonObject(c.after);
				return jsonObject({ ...row, days: slotsOf(row) });
			});
			// A leave entry is its slots: an entry with none has no day to draw or price.
			const empty = entries.findIndex((row) => !Array.isArray(row.days) || row.days.length === 0);
			if (empty >= 0) return yield* ctx.refuse('errors.leave_entry_needs_day', { row: empty });
			const known = yield* entryRead(
				ctx.query,
				'leave_catalog_entry',
				entries,
				ctx.approving ? undefined : 'create'
			).pipe(refusing(ctx));
			if (!ctx.approving) {
				// the balance checks say why in their own words: the refusal carries that text
				yield* Effect.all([
					assertCashable(known, entries),
					assertWorked(known, entries),
					assertLeft(known, entries, ctx.today)
				]).pipe(refusing(ctx));
			}
			const amended = yield* amendmentsFor(
				ctx.query,
				entries.flatMap((entry) =>
					touched(
						entry.employment_id,
						Array.isArray(entry.days) ? entry.days : [],
						entry.encashment,
						unpaid(known, entry)
					)
				)
			);
			return {
				sets: changes.map((c) => c.set),
				on_approved: {
					...(yield* entryPostings(known, 'leave_catalog_entry', entries)),
					...amended
				}
			};
		},
		// a day before this year can change what carried since
		effect: function* (changes, ctx) {
			yield* syncLatePosted(
				ctx,
				changes.map((change) => `leave_catalog_entry:${change.after.id}`)
			);
		}
	},
	update: {
		fields: ['catalog_code', 'evidence_file', 'payroll_run_id'],
		leave_catalog_entry_day: { fields: ['incurred_on', 'part'] },
		transform: function* (changes, ctx) {
			if (sealOnly(changes)) return changes.map((change) => change.set);
			const held = yield* ctx.query({
				leave_catalog_entry_day: {
					where: { leave_entry_id: { in: changes.map((change) => change.before.id) } },
					fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
					limit: 10000
				}
			});
			const slotsByEntry = Map.groupBy(
				held.leave_catalog_entry_day.rows,
				(row) => row.leave_entry_id
			);
			const actionsOf = (change: { readonly set: Record<string, unknown> }) =>
				jsonObject(change.set.leave_catalog_entry_day ?? {});
			const proposed = changes.map((change) => {
				const actions = actionsOf(change);
				const created = Array.isArray(actions.create) ? actions.create.filter(isJsonObject) : [];
				// a child delete names its day at a revision ({ id, revision }), or by id alone
				const deleted = new Set(
					Array.isArray(actions.delete)
						? actions.delete.map((target) =>
								isJsonObject(target) ? String(target.id) : String(target)
							)
						: []
				);
				const existing = slotsByEntry.get(change.before.id) ?? [];
				const days = [
					...existing
						.filter((row) => !deleted.has(row.id))
						.map((row) => ({
							date: row.incurred_on,
							part: row.part,
							payroll_run_id: row.payroll_run_id
						})),
					...created.map((row) => ({ date: row.incurred_on, part: row.part }))
				];
				return jsonObject({
					...change.after,
					days,
					// rules read the resulting slots, not the change's child actions
					leave_catalog_entry_day: [...existing.filter((row) => !deleted.has(row.id)), ...created]
				});
			});
			const empty = proposed.findIndex((row) => !Array.isArray(row.days) || row.days.length === 0);
			if (empty >= 0) return yield* ctx.refuse('errors.leave_entry_needs_day', { row: empty });
			const known = yield* entryRead(
				ctx.query,
				'leave_catalog_entry',
				proposed,
				ctx.approving ? undefined : 'update'
			).pipe(refusing(ctx));
			if (!ctx.approving) {
				// only the days this change adds: a day already filed stands
				yield* assertWorked(
					known,
					changes.map((change) => {
						const actions = actionsOf(change);
						return jsonObject({
							...change.after,
							days: (Array.isArray(actions.create) ? actions.create : [])
								.filter(isJsonObject)
								.map((row) => ({ date: row.incurred_on, part: row.part }))
						});
					})
				).pipe(refusing(ctx));
				yield* assertLeft(
					known,
					proposed,
					ctx.today,
					changes.map((change) => jsonObject(change.before))
				).pipe(refusing(ctx));
			}
			// the days it held and the days it holds now: a day removed and a day added both touch their period
			const amended = yield* amendmentsFor(ctx.query, [
				...changes.flatMap((change, index) => {
					const beforeRow = jsonObject({
						...change.before,
						days: slotsByEntry.get(change.before.id) ?? []
					});
					const afterRow = proposed[index];
					const paySharing =
						unpaid(known, beforeRow) || (afterRow !== undefined && unpaid(known, afterRow));
					return touched(
						change.before.employment_id,
						slotsByEntry.get(change.before.id) ?? [],
						change.before.encashment,
						paySharing
					);
				}),
				...proposed.flatMap((entry) =>
					touched(
						entry.employment_id,
						Array.isArray(entry.days) ? entry.days : [],
						entry.encashment,
						unpaid(known, entry)
					)
				)
			]);
			return {
				sets: changes.map((c) => c.set),
				on_approved: {
					...(yield* entryPostings(known, 'leave_catalog_entry', proposed)),
					...amended
				}
			};
		},
		// a day before this year can change what carried since
		effect: function* (changes, ctx) {
			yield* syncLatePosted(
				ctx,
				changes.map((change) => `leave_catalog_entry:${change.after.id}`)
			);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const entries = changes.map((change) => jsonObject(change.before));
			const employmentOf = new Map(changes.map(({ before }) => [before.id, before.employment_id]));
			const cashOut = new Set(
				changes.filter(({ before }) => before.encashment).map(({ before }) => before.id)
			);
			const entryById = new Map(entries.map((entry) => [String(entry.id), entry]));
			// the slots and check reads cross together; amendment rows follow once the law for each entry is known
			const [known, held] = yield* Effect.all(
				[
					entryRead(
						ctx.query,
						'leave_catalog_entry',
						entries,
						ctx.approving ? undefined : 'delete'
					).pipe(refusing(ctx)),
					ctx.query({
						leave_catalog_entry_day: {
							where: { leave_entry_id: { in: changes.map((change) => change.before.id) } },
							fields: ['leave_entry_id', 'incurred_on', 'payroll_run_id'],
							limit: 10000
						}
					})
				],
				{ concurrency: 'unbounded' }
			);
			const amended = yield* amendmentsFor(
				ctx.query,
				held.leave_catalog_entry_day.rows.flatMap((day) => {
					const entry = entryById.get(day.leave_entry_id);
					return touched(
						employmentOf.get(day.leave_entry_id),
						[day],
						cashOut.has(day.leave_entry_id),
						entry !== undefined && unpaid(known, entry)
					);
				})
			);
			return {
				on_approved: {
					...entriesUndone(known, 'leave_catalog_entry', entries),
					...amended
				}
			};
		},
		// a day before this year can change what carried since
		effect: function* (changes, ctx) {
			yield* syncLatePosted(
				ctx,
				changes.map((change) => `leave_catalog_entry:${change.before.id}`)
			);
		}
	}
});
