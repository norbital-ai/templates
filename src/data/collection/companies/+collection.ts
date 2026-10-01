import { collection } from '@norbital-ai/bolt';
import { entityFactsFault, sealedLineages } from '../../../lib/entity-facts.js';
import {
	CODED_FIELDS,
	codedFieldFault,
	companyRegionFault,
	factTables,
	lineageCodes
} from '../../../lib/coded-fields.js';

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

/**
 * The legal entity. Its form writes every column; `facts` defaults to `{}` and is judged against its lineage, and so
 * are its coded columns (`CODED_FIELDS`) and its wage region.
 */
companies.transform(async (inputs, { existing, db, refuse }) => {
	// A coded column is judged as written: a stored value loaded around the transform does not block other edits.
	const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const codes = [
		...new Set(
			inputs.flatMap((input, index) => {
				const row = rows[index]!;
				const judged =
					Object.keys(row.facts ?? {}).length > 0 ||
					(input.risk_class ?? '') !== '' ||
					(input.region ?? '') !== '';
				return judged && row.settings_code != null ? [row.settings_code] : [];
			})
		)
	];
	const versions =
		codes.length === 0 ? [] : (await db.read('jurisdiction_settings', sealedLineages(codes))).rows;
	const codesOf = await lineageCodes(db, versions, [
		...factTables(versions.flatMap((version) => version.facts ?? [])),
		...Object.values(CODED_FIELDS.companies)
	]);
	return inputs.map((input, index) => {
		const row = rows[index]!;
		const code = row.settings_code ?? '';
		const facts = row.facts ?? {};
		const lineage = versions.filter((version) => version.code === code);
		const declared = lineage.flatMap((version) => version.facts);
		const fault = entityFactsFault(code, facts, declared, codesOf(code));
		if (fault != null) refuse(fault, { field: 'facts' });
		const risk = codedFieldFault(
			code,
			'risk_class',
			CODED_FIELDS.companies.risk_class,
			input.risk_class,
			lineage,
			codesOf(code)
		);
		if (risk != null) refuse(risk, { field: 'risk_class' });
		const region = companyRegionFault(
			code,
			input.region,
			lineage.map((version) => version.work_rules?.wages)
		);
		if (region != null) refuse(region, { field: 'region' });
		return existing[index] == null ? { ...input, facts } : input;
	});
});
