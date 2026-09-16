import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { payPeriodWindow } from '../payroll_runs/lib/period.js';

const QUERY_LIMIT = 20_000;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])(-[12])?$/;

/** The pay-calendar facts of every entity a batch names, read once for the batch. */
type Prepared = ReadonlyMap<
	string,
	{ readonly pay_frequency: string; readonly pay_cutoff_day: unknown }
>;

/**
 * A roster of record is one employment over one payroll cycle. The row states which cycle; the
 * days it owns (`work_days.roster_id`) are the schedule, and a run refuses to price a roster with
 * a day missing. The cycle's dates are resolved here from the entity's cutoff, never typed: the
 * 21st-to-20th window at a monthly entity, the half at a semi-monthly one.
 */
export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const companyIds = [
					...new Set(
						inputs.flatMap((input) => (input.company_id == null ? [] : [input.company_id]))
					)
				];
				if (companyIds.length === 0) return new Map() as Prepared;
				const companies = yield* api.db.companies.findMany({
					where: { id: { in: companyIds } },
					columns: { id: true, pay_frequency: true, pay_cutoff_day: true },
					limit: QUERY_LIMIT
				});
				return new Map(
					companies.map((company) => [
						company.id,
						{ pay_frequency: company.pay_frequency, pay_cutoff_day: company.pay_cutoff_day }
					])
				) as Prepared;
			}),
		perRecord: {
			before: {
				description:
					'Resolves the roster’s cycle window from its period and the entity’s cutoff, requires the period in the entity’s grammar, and keeps a roster on the employment and cycle it was created for.',
				handler: ({ input, existing, prepared }) =>
					Effect.gen(function* () {
						if (existing !== undefined) {
							for (const column of ['employment_id', 'company_id', 'period', 'range'] as const)
								if (column in input && input[column] !== existing[column])
									refuse(
										`A roster’s ${column} is what it is the roster of; make a new roster for another cycle or person.`
									);
							return input;
						}
						const { employment_id: employmentId, company_id: companyId, period } = input;
						if (employmentId == null || companyId == null || period == null)
							refuse(
								'A roster names an employment, its legal entity and the payroll cycle it covers.'
							);
						const company = prepared.get(companyId);
						if (company == null) refuse('The roster’s legal entity is not on file.');
						if (!PERIOD.test(period))
							refuse(
								'A roster period is YYYY-MM, or YYYY-MM-1 / YYYY-MM-2 at a semi-monthly entity.'
							);
						const half = period.length > 7;
						if (company.pay_frequency === 'SEMI_MONTHLY' && !half)
							refuse(
								`${period} names a month; this entity pays by the half, so the roster covers one.`
							);
						if (company.pay_frequency !== 'SEMI_MONTHLY' && half)
							refuse(
								`${period} names a half; this entity pays monthly, so the roster covers the cycle.`
							);
						const window = payPeriodWindow(period, {
							pay_frequency: company.pay_frequency,
							pay_cutoff_day: company.pay_cutoff_day
						} as never);
						return {
							...input,
							range: { start: `${window.start}T00:00:00.000Z`, end: `${window.end}T00:00:00.000Z` }
						};
					})
			}
		}
	}
} satisfies Hooks<Prepared>;
