import { automation } from '@norbital-ai/bolt';
import { dynamicRead } from '@norbital-ai/bolt/protocol';
import { addDays, addMonths, PlainDate } from '@norbital-ai/std/date';
import { weeklyRestDays } from '../lib/payroll_engine/rest_days.js';
import { accountsOf, latestLeft } from '../lib/ledger/core.js';
import { isExit, versionOn } from '../lib/payroll_engine/contract_change.js';
import { isJsonObject, jsonObject } from '../lib/payroll_engine/foundation.js';
import { queryRows } from '../lib/payroll_engine/reads.js';

/**
 * Exit encashment: when a sealed contract ends with no same-jurisdiction successor, every leave row with a `payout`
 * gets one encashment request for the days the person has left. It runs under
 * `payroll_execution`, whose leave grant holds an encashment for HR controller approval, so nothing posts to the ledger
 * until it is approved; whoever ended the contract, an administrator included. Running it again raises nothing twice.
 */
export default automation('encashment', {
	description: 'Raise exit leave encashments for HR approval; safe to run at any time.',
	input: { employments: { kind: 'list', of: { kind: 'id', of: 'employee_contract' } } },
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* ({ employments }, ctx) {
		const ended = yield* ctx.query(
			dynamicRead({
				employee_contract: {
					where: { id: { in: [...employments] } },
					fields: [
						'id',
						'status',
						'effective_range',
						'employee_id',
						'entity_id',
						'employee_extension_data',
						'terms'
					] as const,
					limit: 1000
				}
			})
		);
		const rows = ended.employee_contract?.rows ?? [];
		// the people's whole chains, every entity's lineage code and the sealed law, in one read
		const {
			employee_contract: chain = [],
			entity: entities = [],
			jurisdiction_settings: versions = []
		} = yield* queryRows(ctx.query, {
			employee_contract: {
				where: { employee_id: { in: [...new Set(rows.map((row) => String(row.employee_id)))] } },
				fields: ['employee_id', 'status', 'effective_range', 'entity_id'],
				limit: 10000
			},
			entity: { fields: ['id', 'settings_code'], limit: 10000 },
			jurisdiction_settings: {
				where: { status: { eq: 'SEALED' } },
				fields: ['id', 'code', 'effective_range'],
				limit: 10000
			}
		});
		const lineage = new Map(entities.map((row) => [String(row.id), String(row.settings_code)]));
		for (const stored of rows) {
			const row = stored as Record<string, unknown>;
			const range: unknown = row.effective_range;
			const effectiveTo =
				typeof range === 'string'
					? (() => {
							// a stored range excludes its upper bound: the last day is the one before
							const end = range.slice(range.indexOf(',') + 1, -1);
							return end === '' ? null : String(addDays(PlainDate(end), -1));
						})()
					: isJsonObject(range) && typeof range.to === 'string'
						? range.to
						: null;
			if (row.status !== 'SEALED' || effectiveTo == null) continue;
			const extension = isJsonObject(row.employee_extension_data)
				? row.employee_extension_data
				: {};
			if (extension.misconduct_dismissal === true || extension.dismissed_for_misconduct === true)
				continue;
			const refId = (value: unknown): string => {
				if (typeof value === 'string') return value;
				if (isJsonObject(value) && typeof value.id === 'string') return value.id;
				return '';
			};
			const employeeId = refId(row.employee_id);
			if (employeeId === '') continue;
			// a same-jurisdiction replacement continues employment; a cross-jurisdiction transfer settles leave first
			if (!isExit(row, chain, lineage)) continue;
			// the law in force on the last day
			const current = versionOn(versions, lineage.get(refId(row.entity_id)), effectiveTo);
			if (current === undefined) continue;
			const catalogSettingsId = String(current.id);
			// every leave row with a payout can be cashed out; HR approves each before it posts
			const catalogs = yield* ctx.query(
				dynamicRead({
					leave_catalog: {
						where: { settings_id: { eq: catalogSettingsId } },
						fields: ['id', 'code', 'payout', 'lookup'] as const,
						limit: 1000
					}
				})
			);
			const encashed = (catalogs.leave_catalog?.rows ?? []).filter(
				(catalog) => typeof catalog.payout === 'string' && catalog.payout.trim() !== ''
			);
			if (encashed.length === 0) continue;
			const held = yield* ctx.query(
				dynamicRead({
					leave_catalog_entry: {
						where: { employment_id: { eq: String(row.id) }, encashment: { eq: true } },
						fields: ['id', 'catalog_id'] as const,
						limit: 1000
					},
					'leave_catalog_entry.catalog_id': { fields: ['code'] as const }
				})
			);
			const done = new Set(
				(held.leave_catalog_entry?.rows ?? []).map((entry) =>
					isJsonObject(entry.catalog_id) ? String(entry.catalog_id.code) : ''
				)
			);
			const balances = yield* ctx.query(
				dynamicRead({
					employee_balance: {
						where: { employee_id: { eq: employeeId } },
						fields: ['account'] as const,
						limit: 1
					}
				})
			);
			const accounts = accountsOf(balances.employee_balance?.rows?.[0]?.account);
			const employer = yield* ctx.query(
				dynamicRead({
					entity: {
						where: { id: { eq: String(row.entity_id) } },
						fields: ['payment_schedule'] as const,
						limit: 1
					}
				})
			);
			// A leave balance is in working days. A cash-out carries the same days as slot pairs on working
			// days of the final settlement month: calendar days would pay fewer days than the balance takes.
			// The contract's normal week decides the weekly rest days; the pay schedule's business-day list is not it.
			const daysPerWeek = Number(jsonObject(row.terms).normal_days_per_week ?? 5);
			const nonWorking = weeklyRestDays(daysPerWeek);
			// The final run attends from the previous cutoff to the day before this one: date the cash-out
			// inside that window, or the run captures slots it cannot price.
			const month = effectiveTo.slice(0, 7);
			const cutoff = Number(
				jsonObject(employer.entity?.rows?.[0]?.payment_schedule).pay_cutoff_day ?? 1
			);
			const windowFrom =
				cutoff <= 1
					? `${month}-01`
					: `${String(addMonths(`${month}-01`, -1)).slice(0, 7)}-${String(cutoff).padStart(2, '0')}`;
			const windowTo = String(addDays(PlainDate(windowFrom), 62));
			const holidays = yield* ctx.query(
				dynamicRead({
					holiday: {
						where: {
							entity_id: { eq: String(row.entity_id) },
							date: { gte: windowFrom, lte: windowTo }
						},
						fields: ['date'] as const,
						limit: 1000
					}
				})
			);
			const closed = new Set((holidays.holiday?.rows ?? []).map((holiday) => String(holiday.date)));
			const working: string[] = [];
			for (let index = 0; working.length < 62 && index < 366; index += 1) {
				const date = String(addDays(PlainDate(windowFrom), index));
				const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
				if (nonWorking.has(weekday) || closed.has(date)) continue;
				working.push(date);
			}
			const input = encashed.flatMap((catalog) => {
				const code = String(catalog.code);
				if (done.has(code)) return [];
				const left = latestLeft(accounts, 'leave', code);
				if (!Number.isFinite(left) || left <= 0) return [];
				// a row that counts in hours cashes them out as half days of the contract's normal day
				const dayHours = Number(jsonObject(row.terms).normal_hours_per_day ?? 0);
				const days =
					jsonObject(catalog.lookup).unit === 'HOUR' && dayHours > 0 ? left / dayHours : left;
				const halfDays = Math.max(1, Math.round(days * 2));
				return [
					{
						entity_id: String(row.entity_id),
						employment_id: String(row.id),
						catalog_id: String(catalog.id),
						encashment: true,
						// one slot pair a working day: a single date cannot hold more than its AM and PM
						leave_catalog_entry_day: working
							.flatMap((date) => [
								{ incurred_on: date, part: 'AM' as const },
								{ incurred_on: date, part: 'PM' as const }
							])
							.slice(0, halfDays)
					}
				];
			});
			if (input.length > 0)
				yield* ctx.act.checked([{ callable: 'leave_catalog_entry.create', input }]);
		}
	}
});
