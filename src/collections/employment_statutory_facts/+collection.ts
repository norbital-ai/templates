import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	employee_id: true,
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
 * scheme reads them as `scheme.elections.<key>`, so an undeclared key or a value of another type
 * would be silently read as the type's empty value. Facts name a person, never a contract, and
 * never move between people.
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
							columns: { id: true, code: true, elections: true },
							limit: schemeIds.length
						});
			const schemeById = new Map(schemes.map((scheme) => [scheme.id, scheme]));
			return inputs.map((input, index) => {
				const stored = existing[index];
				const personId = input.employee_id ?? stored?.employee_id;
				if (personId == null || personId === '')
					refuse('A statutory fact must reference an employee profile.');
				const schemeId = input.statutory_contribution_id ?? stored?.statutory_contribution_id;
				if (schemeId == null || schemeId === '')
					refuse('A statutory fact must reference a statutory contribution.');
				const status = input.status ?? stored?.status;
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
				}
				if (stored != null && personId !== stored.employee_id)
					refuse('A statutory fact cannot move to another person. Close it and record a new fact.');
				return input;
			});
		})
});
