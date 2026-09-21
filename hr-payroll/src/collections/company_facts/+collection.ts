import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { factValueFault } from '../../datatypes/fact_keys/+definition.js';
import model from './+model.js';

const columns = {
	company_id: true,
	facts: true,
	effective_range: true
} as const;
const LIMIT = 20_000;

/** A company fact revision, validated against the declarations of the company's lineage. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const companyIds = [
				...new Set(
					inputs.flatMap((input, index) => {
						const id = input.company_id ?? existing[index]?.company_id;
						return id == null ? [] : [id];
					})
				)
			];
			if (companyIds.length === 0) refuse('A company fact revision requires a company.');
			const companies = yield* db.companies.findMany({
				where: { id: { in: companyIds } },
				columns: { id: true, settings_code: true },
				limit: LIMIT
			});
			const codeById = new Map(companies.map((row) => [row.id, row.settings_code]));
			const codes = [...new Set(companies.map((row) => row.settings_code))];
			const versions =
				codes.length === 0
					? []
					: yield* db.jurisdiction_settings.findMany({
							where: {
								code: { in: codes },
								sealed_at: { isNotNull: true },
								voided_at: { isNull: true },
								approval_id: { isNull: true }
							},
							columns: { code: true, facts: true },
							limit: 500
						});
			if (versions.length >= 500)
				refuse('Jurisdiction input declarations are truncated; company facts cannot be validated.');
			return inputs.map((input, index) => {
				const current = existing[index];
				const companyId = input.company_id ?? current?.company_id;
				if (companyId == null || !codeById.has(companyId))
					refuse('A company fact revision must reference a company.');
				if (current != null && companyId !== current.company_id)
					refuse('A company fact revision cannot move to another company.');
				const values = input.facts ?? current?.facts ?? {};
				const code = codeById.get(companyId)!;
				const declarations = versions
					.filter((version) => version.code === code)
					.flatMap((version) => version.facts);
				for (const [key, value] of Object.entries(values)) {
					const matches = declarations.filter((field) => field.key === key);
					if (matches.length === 0) refuse(`${code} does not declare the entity fact ${key}.`);
					const faults = matches.map((field) => factValueFault(field, value));
					if (faults.every((fault) => fault != null)) refuse(`${code}: ${faults[0]}`);
				}
				return input;
			});
		})
});
