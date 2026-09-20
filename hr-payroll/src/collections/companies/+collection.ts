import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { factValueFault } from '../../datatypes/fact_keys/+definition.js';
import model from './+model.js';

const columns = {
	settings_code: true,
	name: true,
	registration_number: true,
	pay_cutoff_day: true,
	pay_frequency: true,
	risk_class: true,
	region: true,
	facts: true,
	holiday_source: true,
	workbook_layout: true,
	disbursement_account: true,
	effective_range: true
} as const;

/** The legal entity. Its form writes every column; nothing is derived. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const codes = [
				...new Set(
					inputs.flatMap((input, index) => {
						const facts = input.facts ?? existing[index]?.facts ?? {};
						const code = input.settings_code ?? existing[index]?.settings_code;
						return Object.keys(facts).length > 0 && code != null ? [code] : [];
					})
				)
			];
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
				refuse('Jurisdiction input declarations are truncated; entity facts cannot be validated.');
			return inputs.map((input, index) => {
				const code = input.settings_code ?? existing[index]?.settings_code;
				const values = input.facts ?? existing[index]?.facts ?? {};
				const declarations = versions
					.filter((version) => version.code === code)
					.flatMap((version) => version.facts);
				// A company spans versions. Writes admit a value declared in its lineage; calculations
				// apply the exact constraints and required fields of the version governing their date.
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
