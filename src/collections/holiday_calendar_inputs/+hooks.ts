import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { prepareHolidayInputs } from '../../lib/holiday-inputs.js';
import type { Hooks } from './$types.js';

type Prepared = {
	readonly latest: ReadonlyMap<string, string>;
	readonly workCompanies: ReadonlyMap<string, ReadonlySet<string>>;
};
const LIMIT = 20_000;

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const groups = new Map<string, string[]>();
				for (const input of inputs) {
					if (!input.jurisdiction_code || !input.date) continue;
					const dates = groups.get(input.jurisdiction_code) ?? [];
					dates.push(dateKey(input.date));
					groups.set(input.jurisdiction_code, dates);
				}
				const latest = new Map<string, string>();
				for (const [jurisdiction, dates] of groups) {
					for (const row of (yield* prepareHolidayInputs(api, jurisdiction, dates)).inputs)
						latest.set(JSON.stringify([jurisdiction, row.date]), row.calendar_id);
				}
				const calendarIds = [
					...new Set(
						inputs.flatMap((row) =>
							row.calendar_id &&
							row.jurisdiction_code &&
							row.date &&
							latest.get(JSON.stringify([row.jurisdiction_code, dateKey(row.date)])) !==
								row.calendar_id
								? [row.calendar_id]
								: []
						)
					)
				];
				const workCompanies = new Map<string, Set<string>>();
				if (!calendarIds.length) return { latest, workCompanies };
				const seals = yield* api.db.holiday_calendar_inputs.findMany({
					where: {
						calendar_id: { in: calendarIds },
						date: { in: [...new Set([...groups.values()].flat())] },
						work_day_id: { isNull: false },
						approval_id: { isNull: true }
					},
					limit: LIMIT
				});
				if (seals.length >= LIMIT)
					refuse('Work holiday evidence exceeded its complete-read limit.');
				if (!seals.length) return { latest, workCompanies };
				const work = yield* api.db.work_days.findMany({
					where: {
						id: {
							in: [...new Set(seals.flatMap((row) => (row.work_day_id ? [row.work_day_id] : [])))]
						},
						approval_id: { isNull: true }
					},
					limit: LIMIT
				});
				if (work.length >= LIMIT) refuse('Work holiday sources exceeded its complete-read limit.');
				if (!work.length) return { latest, workCompanies };
				const contracts = yield* api.db.employments.findMany({
					where: {
						id: { in: [...new Set(work.map((row) => row.employment_id))] },
						approval_id: { isNull: true }
					},
					limit: LIMIT
				});
				if (contracts.length >= LIMIT)
					refuse('Work holiday contracts exceeded its complete-read limit.');
				const workById = new Map(work.map((row) => [row.id, row]));
				const companyByContract = new Map(contracts.map((row) => [row.id, row.company_id]));
				for (const seal of seals) {
					const source = seal.work_day_id ? workById.get(seal.work_day_id) : undefined;
					if (!source || dateKey(source.work_date) !== dateKey(seal.date)) continue;
					const company = companyByContract.get(source.employment_id);
					if (!company) continue;
					const key = JSON.stringify([
						seal.jurisdiction_code,
						dateKey(seal.date),
						seal.calendar_id
					]);
					const companies = workCompanies.get(key) ?? new Set<string>();
					companies.add(company);
					workCompanies.set(key, companies);
				}
				return { latest, workCompanies };
			}),
		perRecord: {
			before: {
				description:
					'Capture the current calendar or payroll’s verified Work evidence; preserve existing captures.',
				handler: ({ input, existing, prepared, parent }) =>
					Effect.sync(() => {
						const row = { ...existing, ...input };
						if (!row.jurisdiction_code || !row.date || !row.calendar_id)
							refuse('A holiday input needs a jurisdiction, date and published calendar.');
						const date = dateKey(row.date);
						if (existing) {
							if (
								row.jurisdiction_code !== existing.jurisdiction_code ||
								date !== dateKey(existing.date) ||
								row.calendar_id !== existing.calendar_id ||
								row.work_day_id !== existing.work_day_id ||
								row.payroll_run_id !== existing.payroll_run_id ||
								row.leave_entry_id !== existing.leave_entry_id
							)
								refuse('Captured holiday inputs are immutable.');
							return input;
						}
						const inheritedWork =
							parent?.collection === 'payroll_runs' &&
							parent.column === 'payroll_run_id' &&
							(row.payroll_run_id == null || row.payroll_run_id === parent.id) &&
							row.work_day_id == null &&
							row.leave_entry_id == null &&
							typeof parent.values.company_id === 'string' &&
							prepared.workCompanies
								.get(JSON.stringify([row.jurisdiction_code, date, row.calendar_id]))
								?.has(parent.values.company_id);
						if (
							!inheritedWork &&
							prepared.latest.get(JSON.stringify([row.jurisdiction_code, date])) !== row.calendar_id
						)
							refuse('The holiday calendar changed before capture. Refresh and retry.');
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retain holiday input seals even after a workday or payroll is removed.',
				handler: () => refuse('Captured holiday inputs cannot be deleted.')
			}
		}
	}
} satisfies Hooks<Prepared>;
