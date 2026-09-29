import { collection, type Id } from '@norbital-ai/bolt';
import { factValuesFault } from '../../../lib/declared-facts.js';
import { statutoryFactSummary } from '../../../lib/derived-titles.js';
import { factScopeFault, holdsFactType, type FactKey } from '../../../lib/datatypes/fact_keys.js';
import { openKeyMentions } from '../../../lib/expressions/contexts.js';
import { DEDUCTION_TOTAL_KEYS } from '../../../lib/statutory-deductions.js';

const statutoryFacts = collection('employment_statutory_facts', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employee_id',
				'employment_id',
				'statutory_contribution_id',
				'status',
				'effective_range'
			]
		}
	},
	update: {
		input: { columns: ['employment_id', 'statutory_contribution_id', 'status', 'effective_range'] }
	},
	delete: {}
});
export default statutoryFacts;

type Status = {
	readonly kind: string;
	readonly reference_number?: string | null;
	readonly reason?: string | null;
	readonly elections?: Readonly<Record<string, unknown>> | null;
	readonly child_claims?:
		| readonly {
				readonly year: string;
				readonly relief_class: string;
				readonly full_count: number;
				readonly half_count: number;
				readonly reference: string;
		  }[]
		| null;
	readonly unit_assessments?: readonly { readonly reference: string }[] | null;
	readonly deduction_claims?:
		| readonly {
				readonly period: string;
				readonly category: string;
				readonly reference: string;
				readonly source: string;
				readonly event_reference?: string | null;
		  }[]
		| null;
};

/**
 * One person has at most one standing with one statutory scheme on any day (the `noOverlap`, a null employment being
 * the personal row). A registration's elections are the keys its scheme declares, each of the declared type; its child
 * and deduction claims name classes and categories the scheme's formulas read. A fact never moves between people or
 * employments.
 */
statutoryFacts.transform(async (inputs, { existing, db, refuse }) => {
	const schemeIds = [
		...new Set(
			inputs.map(
				(input, index) =>
					input.statutory_contribution_id ?? existing[index]?.statutory_contribution_id
			)
		)
	].filter((id) => id != null);
	const employmentIds = [
		...new Set(
			inputs.flatMap((input, index) => {
				const id =
					input.employment_id !== undefined ? input.employment_id : existing[index]?.employment_id;
				return id == null ? [] : [id];
			})
		)
	];
	const [schemes, employments] = await Promise.all([
		schemeIds.length === 0
			? []
			: db
					.read('statutory_contributions', { where: { id: { in: schemeIds } }, all: true })
					.then((page) => page.rows),
		employmentIds.length === 0
			? []
			: db
					.read('employments', { where: { id: { in: employmentIds } }, all: true })
					.then((page) => page.rows)
	]);
	const schemeById = new Map(schemes.map((scheme) => [scheme.id, scheme]));
	const employmentById = new Map(employments.map((row) => [row.id, row]));
	return inputs.map((input, index) => {
		const stored = existing[index];
		const personId = input.employee_id ?? stored?.employee_id;
		const employmentId: Id<'employments'> | null | undefined =
			input.employment_id !== undefined ? input.employment_id : stored?.employment_id;
		if (employmentId != null && employmentById.get(employmentId)?.employee_id !== personId)
			refuse('The selected employment must belong to this employee profile.', {
				field: 'employment_id'
			});
		if (stored?.employment_id != null && employmentId !== stored.employment_id)
			refuse(
				'An employment-specific statutory fact cannot move to another employment. Close it and record a new fact.',
				{ field: 'employment_id' }
			);
		const schemeId = (input.statutory_contribution_id ?? stored?.statutory_contribution_id)!;
		const status = (input.status ?? stored?.status) as Status | undefined;
		const scheme = schemeById.get(schemeId);
		const claims = status?.kind === 'REGISTERED' ? status : undefined;
		if ((claims?.child_claims?.length ?? 0) > 0 || (claims?.deduction_claims?.length ?? 0) > 0) {
			if (scheme == null)
				return refuse('The statutory contribution this fact names no longer exists.');
			const expressions = [
				scheme.assessed_on,
				scheme.ordinary_on,
				...scheme.rules.flatMap((rule) => [
					rule.when,
					rule.employee,
					rule.employer,
					rule.rebate ?? '',
					rule.deduction ?? ''
				])
			];
			const classes = new Set(
				expressions.flatMap((expression) => openKeyMentions(expression, 'scheme.child_claims'))
			);
			const seen = new Set<string>();
			for (const claim of claims?.child_claims ?? []) {
				if (!/^\d{4}$/.test(claim.year)) refuse('Child claims require a four-digit tax year.');
				if (!classes.has(claim.relief_class))
					refuse(`${scheme.code} does not use child relief class ${claim.relief_class}.`);
				const key = `${claim.year}:${claim.relief_class}`;
				if (seen.has(key)) refuse('Use one child-claim row per tax year and relief class.');
				seen.add(key);
				if (claim.full_count + claim.half_count > 0 && claim.reference.trim() === '')
					refuse('A child claim requires the employee declaration reference.');
			}
			const categories = new Set(
				expressions.flatMap((expression) =>
					DEDUCTION_TOTAL_KEYS.flatMap((key) => openKeyMentions(expression, `scheme.${key}`))
				)
			);
			const deductionKeys = new Set<string>();
			for (const claim of claims?.deduction_claims ?? []) {
				if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(claim.period))
					refuse('Deduction claims require a valid month in YYYY-MM format.');
				if (!categories.has(claim.category))
					refuse(`${scheme.code} does not use deduction category ${claim.category}.`);
				if (claim.reference.trim() === '')
					refuse('A deduction claim requires the employee declaration reference.');
				if (claim.category === 'DEPARTURE_LEVY' && !claim.event_reference?.trim())
					refuse('A departure levy claim requires a journey reference.');
				const key = JSON.stringify([claim.source, claim.reference.trim(), claim.category]);
				if (deductionKeys.has(key))
					refuse(
						'Duplicate deduction claim: use a separate reference for a correction or another declaration.'
					);
				deductionKeys.add(key);
			}
		}
		if ((claims?.unit_assessments?.length ?? 0) > 0) {
			if (employmentId == null || employmentId === '')
				refuse('Payment assessments require a named employment.');
			if (!scheme?.rules.some((rule) => rule.per_unit))
				refuse('This scheme does not assess payments per unit.');
			const references = new Set<string>();
			for (const entry of claims?.unit_assessments ?? []) {
				const reference = entry.reference.trim();
				if (references.has(reference))
					refuse('Use a distinct reference for every payment assessment.');
				references.add(reference);
			}
		}
		const elections = status?.elections ?? {};
		if (Object.keys(elections).length > 0) {
			if (scheme == null)
				return refuse('The statutory contribution this fact names no longer exists.');
			const declared = scheme.elections;
			const types = new Map(declared.map((row) => [row.key, row.type]));
			for (const [key, value] of Object.entries(elections)) {
				const type = types.get(key);
				if (type == null)
					refuse(
						`${scheme.code} does not declare the election ${key}. Declare it (its key and type) on the scheme first.`
					);
				if (type === undefined || !holdsFactType(type, value))
					refuse(
						`${scheme.code} declares the election ${key} as a ${type}; this value is a ${typeof value}.`
					);
			}
			const fault =
				factValuesFault(declared, elections) ?? factScopeFault(declared, elections, employmentId);
			if (fault != null) refuse(`${scheme.code}: ${fault}`);
		}
		if (stored != null && personId !== stored.employee_id)
			refuse('A statutory fact cannot move to another person. Close it and record a new fact.');
		return {
			...input,
			summary: statutoryFactSummary(status, input.effective_range ?? stored?.effective_range)
		};
	});
});
