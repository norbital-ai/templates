import { collection, type Id } from '@norbital-ai/bolt';
import { inclusiveDays } from '../../../lib/payroll/run/dates.js';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { cents } from '../../../lib/payroll/run/rounding.js';
import { sealedLineages } from '../../../lib/entity-facts.js';
import { dateKey } from '../../../lib/iso-day.js';
import { governed, settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { decodeNumber } from '../../../lib/wire.js';

const wagePeriods = collection('employment_wage_periods', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'period',
				'currency',
				'normal_wages',
				'ordinary_wages',
				'ordinary_days',
				'due_on',
				'paid_on',
				'reference'
			]
		}
	},
	update: {
		input: {
			columns: [
				'period',
				'currency',
				'normal_wages',
				'ordinary_wages',
				'ordinary_days',
				'due_on',
				'paid_on',
				'reference'
			]
		}
	},
	delete: {}
});
export default wagePeriods;

/**
 * Dated wage evidence: a finite ordered period, normal wages or ordinary earnings (earnings with the days worked),
 * a source reference, amounts in the currency and precision of the jurisdiction in force on the period's last day.
 * Evidence a payslip used is immutable. One employment's periods never overlap (the `noOverlap`).
 */
wagePeriods.transform(async (inputs, { existing, db, refuse }) => {
	const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const employmentIds = [
		...new Set(rows.map((row) => row.employment_id).filter((id) => id != null))
	];
	const storedIds = existing.flatMap((row) => (row == null ? [] : [row.id]));
	const [employments, companies, captures] = await Promise.all([
		employmentIds.length === 0
			? []
			: db
					.read('employments', { where: { id: { in: employmentIds } }, all: true })
					.then((page) => page.rows),
		employmentIds.length === 0
			? []
			: db
					.read('companies', {
						where: { employments: { some: { id: { in: employmentIds } } } },
						all: true
					})
					.then((page) => page.rows),
		storedIds.length === 0
			? []
			: db
					.read('payslip_wage_periods', { where: { wage_period_id: { in: storedIds } }, all: true })
					.then((page) => page.rows)
	]);
	if (captures.length > 0)
		refuse('A wage period used by a payslip is immutable. Delete the draft payslip first.');
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0 ? [] : (await db.read('jurisdiction_settings', sealedLineages(codes))).rows;
	const codeOf = (employmentId: Id<'employments'>) => {
		const companyId = employments.find((row) => row.id === employmentId)?.company_id;
		return companies.find((row) => row.id === companyId)?.settings_code;
	};
	for (const row of rows) {
		const period = readRange(row.period);
		if (period?.end == null || dateKey(period.end) < dateKey(period.start))
			return refuse('A wage period needs an ordered finite inclusive period.', { field: 'period' });
		const [start, end] = [dateKey(period.start), dateKey(period.end)];
		const normal = row.normal_wages == null ? null : decodeNumber(row.normal_wages);
		const ordinary = row.ordinary_wages == null ? null : decodeNumber(row.ordinary_wages);
		const days = row.ordinary_days == null ? null : decodeNumber(row.ordinary_days);
		if (normal == null && ordinary == null)
			refuse('A wage period requires normal wages or ordinary earnings.', {
				field: 'normal_wages'
			});
		if ((ordinary == null) !== (days == null))
			refuse('Ordinary earnings and days worked must be supplied together.', {
				field: 'ordinary_days'
			});
		if (!(row.reference ?? '').trim())
			refuse('A wage period requires a source reference.', { field: 'reference' });
		const code = row.employment_id == null ? undefined : codeOf(row.employment_id);
		const first = versions
			.filter((version) => version.code === code && governed(version.effective_range) != null)
			.toSorted((left, right) =>
				governed(left.effective_range)!.from.localeCompare(governed(right.effective_range)!.from)
			)[0];
		// Opening evidence predates the configured payroll timeline. Its recorded amount is never
		// recalculated; validate it against the first supported currency, without extending law.
		const opening = first != null && end < governed(first.effective_range)!.from ? first : null;
		const currency =
			code == null
				? undefined
				: (settingsInForce(versions, code, end) ?? opening)?.payroll.currency;
		if (currency == null)
			return refuse('A wage period requires sealed jurisdiction settings on its final day.', {
				field: 'period'
			});
		if (row.currency !== currency)
			refuse('The wage period currency must match the employment jurisdiction.', {
				field: 'currency'
			});
		for (const [label, amount] of [
			['Normal wages', normal],
			['Ordinary earnings', ordinary]
		] as const) {
			if (amount == null) continue;
			if (!Number.isFinite(amount) || amount < 0)
				refuse(`${label} must be finite and nonnegative.`);
			if (cents(amount, currency) !== amount)
				refuse(`${label} must use the jurisdiction currency precision.`);
		}
		if (days != null) {
			if (!Number.isFinite(days) || days <= 0)
				refuse('Ordinary days worked must be finite and positive.', { field: 'ordinary_days' });
			if (days > inclusiveDays(start, end))
				refuse('Ordinary days worked cannot exceed the wage period’s calendar days.', {
					field: 'ordinary_days'
				});
		}
	}
	return inputs;
});
