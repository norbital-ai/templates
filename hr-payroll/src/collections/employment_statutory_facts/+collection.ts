import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { openKeyMentions } from '../../lib/expressions/contexts.js';
import { DEDUCTION_TOTAL_KEYS } from '../../lib/statutory-deductions.js';
import { factValuesFault } from '../../lib/declared-facts.js';
import { factScopeFault } from '../../datatypes/fact_keys/+definition.js';

const columns = {
	employee_id: true,
	employment_id: true,
	statutory_contribution_id: true,
	status: true,
	effective_range: true
} as const;

/**
 * One person has at most one standing with one statutory scheme at any instant.
 *
 * The database is the guarantee — `employment_statutory_facts_no_overlap` in +model.ts rejects an
 * overlap with SQLSTATE 23P01 whatever path the write takes, including a concurrent one or another
 * row in the same batch. Bolt translates that constraint into a caller-facing overlap refusal. A
 * SELECT precheck would be weaker and add a read per bulk row.
 *
 * A registration's elections are the keys its scheme row declares, each of the declared type. The
 * scheme reads them as `scheme.elections.<key>`. Writes validate supplied keys, types and
 * constraints; payroll revalidates against the governing version after alignment. A fact names a
 * person and may bind one of that person's employments; it never moves between either identity.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const schemeIds = [
				...new Set(
					inputs.flatMap((input, index) => {
						const id =
							input.statutory_contribution_id ?? existing[index]?.statutory_contribution_id;
						return id == null || id === '' ? [] : [id];
					})
				)
			];
			const schemes =
				schemeIds.length === 0
					? []
					: yield* db.statutory_contributions.findMany({
							where: { id: { in: schemeIds } },
							columns: {
								id: true,
								code: true,
								elections: true,
								rules: true,
								assessed_on: true,
								ordinary_on: true
							},
							limit: schemeIds.length
						});
			const schemeById = new Map(schemes.map((scheme) => [scheme.id, scheme]));
			const employmentIds = [
				...new Set(
					inputs.flatMap((input, index) => {
						const id = Object.hasOwn(input, 'employment_id')
							? input.employment_id
							: existing[index]?.employment_id;
						return id == null || id === '' ? [] : [id];
					})
				)
			];
			const employments =
				employmentIds.length === 0
					? []
					: yield* db.employments.findMany({
							where: { id: { in: employmentIds } },
							columns: { id: true, employee_id: true },
							limit: employmentIds.length
						});
			const employmentById = new Map(employments.map((row) => [row.id, row]));
			return inputs.map((input, index) => {
				const stored = existing[index];
				const personId = input.employee_id ?? stored?.employee_id;
				if (personId == null || personId === '')
					refuse('A statutory fact must reference an employee profile.');
				const employmentId = Object.hasOwn(input, 'employment_id')
					? input.employment_id
					: stored?.employment_id;
				if (
					employmentId != null &&
					employmentId !== '' &&
					employmentById.get(employmentId)?.employee_id !== personId
				)
					refuse('The selected employment must belong to this employee profile.');
				if (stored?.employment_id != null && employmentId !== stored.employment_id)
					refuse(
						'An employment-specific statutory fact cannot move to another employment. Close it and record a new fact.'
					);
				const schemeId = input.statutory_contribution_id ?? stored?.statutory_contribution_id;
				if (schemeId == null || schemeId === '')
					refuse('A statutory fact must reference a statutory contribution.');
				const status = input.status ?? stored?.status;
				if (
					status?.kind === 'REGISTERED' &&
					((status.child_claims?.length ?? 0) > 0 || (status.deduction_claims?.length ?? 0) > 0)
				) {
					const scheme = schemeById.get(schemeId);
					if (scheme == null)
						refuse('The statutory contribution this fact names no longer exists.');
					const expressions = [
						scheme.assessed_on ?? '',
						scheme.ordinary_on ?? '',
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
					for (const claim of status.child_claims ?? []) {
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
					for (const claim of status.deduction_claims ?? []) {
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
				const elections = status?.kind === 'REGISTERED' ? (status.elections ?? {}) : {};
				if (Object.keys(elections).length > 0) {
					const scheme = schemeById.get(schemeId);
					if (scheme == null)
						refuse('The statutory contribution this fact names no longer exists.');
					const declared = new Map(scheme.elections.map((row) => [row.key, row.type]));
					for (const [key, value] of Object.entries(elections)) {
						const type = declared.get(key);
						if (type == null)
							refuse(
								`${scheme.code} does not declare the election ${key}. Declare it (its key and type) on the scheme first.`
							);
						if (typeof value !== type)
							refuse(
								`${scheme.code} declares the election ${key} as a ${type}; this value is a ${typeof value}.`
							);
					}
					const fault = factValuesFault(scheme.elections, elections);
					if (fault != null) refuse(`${scheme.code}: ${fault}`);
					const scopeFault = factScopeFault(scheme.elections, elections, employmentId);
					if (scopeFault != null) refuse(`${scheme.code}: ${scopeFault}`);
				}
				if (stored != null && personId !== stored.employee_id)
					refuse('A statutory fact cannot move to another person. Close it and record a new fact.');
				return input;
			});
		})
});
