import { automation } from '@norbital-ai/bolt';
import { dynamicRead } from '@norbital-ai/bolt/protocol';
import { addDays, addMonths, PlainDate } from '@norbital-ai/std/date';
import { weeklyRestDays } from '../lib/payroll_engine/rest_days.js';
import { accountsOf, latestLeft } from '../lib/ledger/core.js';
import { isJsonObject, jsonObject } from '../lib/payroll_engine/foundation.js';

/**
 * Exit encashment: when a sealed contract ends with no same-jurisdiction successor, every leave row whose catalog sets
 * `lookup.encash_on_exit.allowed` gets one encashment request for the days the person has left. It runs under
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
						'input_schema_version_id',
						'employee_extension_data',
						'terms'
					] as const,
					limit: 1000
				}
			})
		);
		for (const stored of ended.employee_contract?.rows ?? []) {
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
			const settingsId = refId(row.input_schema_version_id);
			if (settingsId === '') continue;
			const lineage = yield* ctx.query(
				dynamicRead({
					jurisdiction_settings: {
						where: { id: { eq: settingsId } },
						fields: ['code'] as const,
						limit: 1
					}
				})
			);
			const code = lineage.jurisdiction_settings?.rows?.[0]?.code;
			const contracts = yield* ctx.query(
				dynamicRead({
					employee_contract: {
						where: { employee_id: { eq: employeeId } },
						fields: ['id', 'status', 'effective_range', 'input_schema_version_id'] as const,
						limit: 10000
					}
				})
			);
			const successors = (contracts.employee_contract?.rows ?? []).filter((other) => {
				if (String(other.id) === String(row.id)) return false;
				if (other.status !== 'DRAFT' && other.status !== 'SEALED') return false;
				const successor = other.effective_range;
				return (
					isJsonObject(successor) &&
					typeof successor.from === 'string' &&
					successor.from > effectiveTo
				);
			});
			let sameJurisdiction = false;
			if (successors.length > 0) {
				const ids = [
					...new Set(
						successors
							.map((other) => {
								const value = other.input_schema_version_id;
								return isJsonObject(value) ? value.id : value;
							})
							.filter((value): value is string => typeof value === 'string')
					)
				];
				if (ids.length > 0) {
					const settings = yield* ctx.query(
						dynamicRead({
							jurisdiction_settings: {
								where: { id: { in: ids } },
								fields: ['id', 'code'] as const,
								limit: 10000
							}
						})
					);
					const codes = new Map(
						(settings.jurisdiction_settings?.rows ?? []).map((settingsRow) => [
							String(settingsRow.id),
							settingsRow.code
						])
					);
					sameJurisdiction = successors.some((other) => {
						const value = other.input_schema_version_id;
						const id = isJsonObject(value) ? value.id : value;
						return typeof code === 'string' && typeof id === 'string' && codes.get(id) === code;
					});
				}
			}
			// a same-jurisdiction replacement continues employment; a cross-jurisdiction transfer settles leave first
			if (sameJurisdiction) continue;
			const versions =
				typeof code !== 'string'
					? []
					: ((yield* ctx.query(
							dynamicRead({
								jurisdiction_settings: {
									where: { code: { eq: code }, status: { eq: 'SEALED' } },
									fields: ['id', 'effective_range'] as const,
									limit: 10000
								}
							})
						)).jurisdiction_settings?.rows ?? []);
			const current = versions.find((version) => {
				const range = version.effective_range;
				return (
					isJsonObject(range) &&
					typeof range.from === 'string' &&
					range.from <= effectiveTo &&
					(range.to == null || String(range.to) >= effectiveTo)
				);
			});
			const catalogSettingsId =
				current !== undefined && typeof current.id === 'string' ? current.id : settingsId;
			// every leave row whose catalog says it is encashed on exit; HR approves each before it posts
			const catalogs = yield* ctx.query(
				dynamicRead({
					leave_catalog: {
						where: { settings_id: { eq: catalogSettingsId } },
						fields: ['id', 'code', 'lookup'] as const,
						limit: 1000
					}
				})
			);
			const encashed = (catalogs.leave_catalog?.rows ?? []).filter(
				(catalog) =>
					isJsonObject(catalog.lookup) &&
					isJsonObject(catalog.lookup.encash_on_exit) &&
					catalog.lookup.encash_on_exit.allowed === true
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
			const daysPerWeek = Number(
				jsonObject(row.terms).normal_days_per_week ?? 5
			);
			const nonWorking = weeklyRestDays(daysPerWeek);
			// The final run attends from the previous cutoff to the day before this one: date the cash-out
			// inside that window, or the run captures slots it cannot price.
			const month = effectiveTo.slice(0, 7);
			const cutoff = Number(jsonObject(employer.entity?.rows?.[0]?.payment_schedule).pay_cutoff_day ?? 1);
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
			const closed = new Set(
				(holidays.holiday?.rows ?? []).map((holiday) => String(holiday.date))
			);
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
				const days = latestLeft(accounts, 'leave', code);
				if (!Number.isFinite(days) || days <= 0) return [];
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
