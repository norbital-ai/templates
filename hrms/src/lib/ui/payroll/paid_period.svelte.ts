import type { PageContext } from '@norbital-ai/bolt/page';
import type { FormProps } from '@norbital-ai/ui';

type FormConfirm = NonNullable<FormProps['confirm']>;

/** What a correction of a paid period does, in the words the save asks with. */
export const PAID_NOTE =
	'The paid payslip does not change. The next payroll run works that period out again and carries the difference.';

/** The question a save reaching a paid period asks first. */
export const PAID_QUESTION = {
	title: 'This period is already paid',
	body: PAID_NOTE,
	confirm_label: 'Save correction'
};

/** A reference as its id: a record holds the row it points at, a form its id. */
const keyOf = (value: unknown): string =>
	value !== null && typeof value === 'object' && 'id' in value ? String(value.id) : String(value);

/**
 * The periods on-cycle runs have paid, for a form that may date a record in one. `confirm` asks before such a save:
 * the record is corrected where it stands, and the answer says what happens to the pay.
 */
export const paidPeriods = (ctx: Pick<PageContext, 'query'>) => {
	const runs = ctx.query({
		payroll_run: {
			where: { state: { eq: 'PAID' }, kind: { eq: 'ON_CYCLE' } },
			fields: ['salary_coverage', 'entity_id'],
			limit: 1000
		}
	});
	// a save asks from a click, outside any reactive read: this keeps the periods loaded for it
	$effect(() => void runs.current);
	// a form holds a date as its own value, a record as text: both read as the day
	const covers = (date: unknown, entity?: unknown): boolean => {
		const day = date == null ? '' : String(date).slice(0, 10);
		return (
			day !== '' &&
			(runs.current?.payroll_run.rows ?? []).some(
				(run) =>
					(entity == null || keyOf(run.entity_id) === keyOf(entity)) &&
					String(run.salary_coverage.from) <= day &&
					(run.salary_coverage.to === null || String(run.salary_coverage.to) >= day)
			)
		);
	};
	/**
	 * Asks when the record a run priced (`priced`) or any of these dates is in a paid period; `company` names the
	 * record's own company field, for a record that reaches one company's runs only.
	 */
	const confirm =
		(priced: () => boolean, dates: readonly string[], company?: string): FormConfirm =>
		({ values, before }) => {
			const entity = company === undefined ? undefined : (values[company] ?? before[company]);
			return priced() ||
				dates.some((name) => covers(values[name], entity) || covers(before[name], entity))
				? PAID_QUESTION
				: null;
		};
	return { covers, confirm };
};
