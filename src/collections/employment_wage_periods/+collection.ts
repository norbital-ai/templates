import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import model from './+model.js';
import { cents } from '../payroll_runs/lib/rounding.js';
import { inclusiveDays, requiredDateKey } from '../payroll_runs/lib/dates.js';
import { readRange } from '../payroll_runs/lib/effective.js';
import { settingsInForce } from '../../lib/jurisdiction_settings.js';

const columns = {
	employment_id: true,
	period: true,
	normal_wages: true,
	ordinary_wages: true,
	ordinary_days: true,
	due_on: true,
	paid_on: true,
	reference: true
} as const;
const LIMIT = 20_000;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
			const employmentIds = [
				...new Set(rows.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])))
			];
			const existingIds = existing.flatMap((row) => (row == null ? [] : [row.id]));
			const [employments, history, captures] = yield* Effect.all(
				[
					employmentIds.length === 0
						? Effect.succeed([])
						: db.employments.findMany({
								where: { id: { in: employmentIds } },
								columns: { id: true },
								with: {
									employment_company: { columns: { settings_code: true } }
								},
								limit: employmentIds.length
							}),
					employmentIds.length === 0
						? Effect.succeed([])
						: db.employment_wage_periods.findMany({
								where: { employment_id: { in: employmentIds } },
								columns: { id: true, employment_id: true, period: true },
								limit: LIMIT
							}),
					existingIds.length === 0
						? Effect.succeed([])
						: db.payslip_wage_periods.findMany({
								where: { wage_period_id: { in: existingIds } },
								columns: { wage_period_id: true },
								limit: existingIds.length
							})
				],
				{ concurrency: 'unbounded' }
			);
			if (history.length >= LIMIT)
				refuse('Wage-period history is too large to verify for overlaps safely.');
			if (captures.length > 0)
				refuse('A wage period used by a payslip is immutable. Delete the draft payslip first.');
			const employmentById = new Map(employments.map((row) => [row.id, row]));
			const settingsCodes = [
				...new Set(
					employments.flatMap((row) => {
						const code = row.employment_company?.settings_code;
						if (code == null || code === '') return [];
						return [code];
					})
				)
			];
			const versions =
				settingsCodes.length === 0
					? []
					: yield* db.jurisdiction_settings.findMany({
							where: {
								code: { in: settingsCodes },
								sealed_at: { isNotNull: true },
								voided_at: { isNull: true },
								approval_id: { isNull: true }
							},
							columns: {
								id: true,
								code: true,
								effective_range: true,
								payroll: true,
								sealed_at: true,
								voided_at: true,
								approval_id: true
							},
							limit: LIMIT
						});
			if (versions.length >= LIMIT)
				refuse('Jurisdiction history is too large to validate wage-period currency safely.');

			const candidates = rows.map((row, index) => {
				const employmentId = row.employment_id;
				if (employmentId == null || !employmentById.has(employmentId))
					refuse('A wage period must reference an employment.');
				if (existing[index] != null && employmentId !== existing[index]!.employment_id)
					refuse('A wage period cannot move to another employment.');
				const period = readRange(row.period);
				if (period == null || period.start == null || period.end == null)
					refuse('A wage period needs an ordered finite inclusive period.');
				const start = requiredDateKey(period.start, 'employment_wage_periods.period.start');
				const end = requiredDateKey(period.end, 'employment_wage_periods.period.end');
				if (end < start) refuse('A wage period needs an ordered finite inclusive period.');
				const normal = row.normal_wages;
				const ordinary = row.ordinary_wages;
				const days = row.ordinary_days;
				if (normal == null && ordinary == null)
					refuse('A wage period requires normal wages or ordinary earnings.');
				if ((ordinary == null) !== (days == null))
					refuse('Ordinary earnings and days worked must be supplied together.');
				if (!String(row.reference ?? '').trim())
					refuse('A wage period requires a source reference.');
				const employment = employmentById.get(employmentId)!;
				const settingsCode = employment.employment_company?.settings_code;
				const version = settingsCode == null ? null : settingsInForce(versions, settingsCode, end);
				const currency = version?.payroll.currency;
				if (currency == null)
					refuse('A wage period requires sealed jurisdiction settings on its final day.');
				for (const [label, money] of [
					['Normal wages', normal],
					['Ordinary earnings', ordinary]
				] as const) {
					if (money == null) continue;
					const amount = decodeNumber(money.value);
					if (!Number.isFinite(amount) || amount < 0)
						refuse(`${label} must be finite and nonnegative.`);
					if (money.currency !== currency)
						refuse(`${label} currency must match the employment jurisdiction.`);
					if (cents(amount, currency) !== amount)
						refuse(`${label} must use the jurisdiction currency precision.`);
				}
				if (days != null) {
					const count = decodeNumber(days);
					if (!Number.isFinite(count) || count <= 0)
						refuse('Ordinary days worked must be finite and positive.');
					if (count > inclusiveDays(start, end))
						refuse('Ordinary days worked cannot exceed the wage period’s calendar days.');
				}
				return { id: existing[index]?.id ?? null, employmentId, start, end };
			});

			for (const [index, candidate] of candidates.entries()) {
				const siblings = [
					...history.flatMap((row) => {
						if (row.id === candidate.id || row.employment_id !== candidate.employmentId) return [];
						const period = readRange(row.period);
						return period?.start == null || period.end == null
							? []
							: [
									{
										start: requiredDateKey(period.start, 'employment_wage_periods.period.start'),
										end: requiredDateKey(period.end, 'employment_wage_periods.period.end')
									}
								];
					}),
					...candidates
						.slice(index + 1)
						.flatMap((row) =>
							row.employmentId === candidate.employmentId
								? [{ start: row.start, end: row.end }]
								: []
						)
				];
				if (siblings.some((row) => row.start <= candidate.end && row.end >= candidate.start))
					refuse('Wage periods for one employment cannot overlap.');
			}
			return inputs;
		})
});
