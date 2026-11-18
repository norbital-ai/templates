import type { PageContext } from '@norbital-ai/bolt/page';
import { label } from '@norbital-ai/ui';
import { DateTime } from 'effect';
import { factWrites, factsOf, type Fact } from '../../dated_facts.js';
import { TERM_FIELDS } from '../../person.js';
import { jsonObject } from '../../payroll_engine/foundation.js';
import { declaredParameters } from '../components/parameter_facts.js';
import { pageLaws } from '../law.svelte.js';
import { PAID_QUESTION, paidPeriods } from '../payroll/paid_period.svelte.js';
import { categoryValues } from './contract_categories.js';
import type { PersonRead, StintRow } from './person_read.svelte.js';

/**
 * One dated family of a person (the contract terms, or the statutory parameters): each stint's facts as edited, and
 * what the enclosing form's one Save writes for them. A statutory parameter is one the law of the stint's company
 * declares. Call during component initialisation.
 */
export function datedFamily(
	ctx: PageContext,
	of: 'contract_terms' | 'statutory_parameters',
	read: PersonRead
) {
	const clock = ctx.clock('day');
	const paid = paidPeriods(ctx);
	const attributes = of === 'contract_terms' ? ['signed_on'] : [];
	const shape =
		of === 'contract_terms'
			? { fields: TERM_FIELDS, attributes }
			: { fields: [], record: 'parameters' };
	const rowsOf = (stint: StintRow) =>
		(of === 'contract_terms' ? stint.terms : stint.parameters).map(jsonObject);
	const codeOf = (stint: StintRow) => read.company(stint.entity_id)?.settings_code;
	const laws = pageLaws(ctx, () => [
		...new Set(read.stints.flatMap((stint) => codeOf(stint) ?? []))
	]);
	const lawOn = (stint: StintRow, day: string) =>
		laws.on(codeOf(stint), day === '' ? clock.today : day);
	const exposure = $derived(ctx.ui.kinds.catalog?.[of]);
	/** A change to a person starts on the first of a month: the next one, until HR says otherwise. */
	const nextMonth = $derived(
		DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.startOf(DateTime.makeUnsafe(clock.today), 'month'), { months: 1 })
		)
	);
	/** The lists being edited, by stint. */
	let drafts = $state<Record<string, readonly Fact[]>>({});
	const written = () =>
		read.stints.flatMap((stint) => {
			const draft = drafts[stint.id];
			return draft === undefined
				? []
				: [{ stint, writes: factWrites(rowsOf(stint), draft, { employment_id: stint.id }, shape) }];
		});
	return {
		of,
		attributes,
		get nextMonth() {
			return nextMonth;
		},
		lawOn,
		/** A stint's facts as stored. */
		base: (stint: StintRow) => factsOf(rowsOf(stint), shape),
		/** A stint's facts as edited. */
		facts: (stint: StintRow) => drafts[stint.id] ?? factsOf(rowsOf(stint), shape),
		change: (stint: StintRow, next: readonly Fact[]) => (drafts = { ...drafts, [stint.id]: next }),
		/** The facts a stint's change may name, in the order they are shown. */
		names: (stint: StintRow) =>
			of === 'contract_terms'
				? [...attributes, ...TERM_FIELDS].map((value) => ({ value, label: label(ctx, of, value) }))
				: Object.entries(
						declaredParameters(lawOn(stint, clock.today)?.settings.employee_statutory_parameters)
					).map(([value, { label }]) => ({ value, label })),
		kindOf: (stint: StintRow) => (fact: Fact) => {
			const law = lawOn(stint, fact.from);
			if (of === 'statutory_parameters')
				return declaredParameters(law?.settings.employee_statutory_parameters)[fact.name];
			if (fact.name === 'allowances') return undefined;
			const values = categoryValues(law)[fact.name];
			const field = exposure?.fields[fact.name];
			const relation = exposure?.relations?.[fact.name];
			if (values !== undefined)
				return { kind: { kind: 'enum' as const, values, optional: true as const } };
			// a reference is its relation: the catalogue lists it apart from the plain fields
			if (relation !== undefined)
				return {
					kind: { kind: 'ref' as const, to: relation.targets[0] ?? '', optional: true as const },
					relation
				};
			return field === undefined ? undefined : { kind: field };
		},
		/** What the form's Save writes for the family. */
		acts: () =>
			Object.fromEntries(
				(['create', 'update', 'delete'] as const).flatMap((verb) => {
					const rows = written().flatMap(({ writes }) => writes[verb]);
					return rows.length === 0 ? [] : [[`${of}.${verb}`, rows]];
				})
			),
		/** A change dated in a paid period amends it: HR is asked first. */
		confirm: () =>
			written().some(({ stint, writes }) =>
				writes.dates.some((day) => paid.covers(day, stint.entity_id))
			)
				? PAID_QUESTION
				: null,
		reset: () => (drafts = {})
	};
}
export type DatedFamily = ReturnType<typeof datedFamily>;
