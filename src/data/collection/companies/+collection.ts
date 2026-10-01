import { collection } from '@norbital-ai/bolt';
import { entityFactsFault, sealedLineages } from '../../../lib/entity-facts.js';

const companies = collection('companies', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'settings_code',
				'name',
				'registration_number',
				'pay_cutoff_day',
				'late_arrival_grace_minutes',
				'pay_frequency',
				'risk_class',
				'region',
				'facts',
				'holiday_source',
				'workbook_layout',
				'disbursement_account',
				'effective_range'
			]
		}
	},
	update: {
		input: {
			columns: [
				'settings_code',
				'name',
				'registration_number',
				'pay_cutoff_day',
				'late_arrival_grace_minutes',
				'pay_frequency',
				'risk_class',
				'region',
				'facts',
				'holiday_source',
				'workbook_layout',
				'disbursement_account',
				'effective_range'
			]
		}
	},
	delete: {}
});
export default companies;

/** The legal entity. Its form writes every column; `facts` defaults to `{}` and is judged against its lineage. */
companies.transform(async (inputs, { existing, db, refuse }) => {
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
		codes.length === 0 ? [] : (await db.read('jurisdiction_settings', sealedLineages(codes))).rows;
	return inputs.map((input, index) => {
		const code = input.settings_code ?? existing[index]?.settings_code ?? '';
		const facts = input.facts ?? existing[index]?.facts ?? {};
		const declared = versions
			.filter((version) => version.code === code)
			.flatMap((version) => version.facts);
		const fault = entityFactsFault(code, facts, declared);
		if (fault != null) refuse(fault, { field: 'facts' });
		return existing[index] == null ? { ...input, facts } : input;
	});
});
