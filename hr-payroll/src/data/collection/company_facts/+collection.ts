import { collection } from '@norbital-ai/bolt';
import { entityFactsFault, sealedLineages } from '../../../lib/entity-facts.js';

const companyFacts = collection('company_facts', {
	read: { fields: 'all' },
	create: { input: { columns: ['company_id', 'facts', 'effective_range'] } },
	update: { input: { columns: ['facts', 'effective_range'] } },
	delete: {}
});
export default companyFacts;

/** A dated revision of a company's facts, judged against its lineage; `facts` defaults to `{}`. It never moves company. */
companyFacts.transform(async (inputs, { existing, db, refuse }) => {
	const ids = [
		...new Set(inputs.map((input, index) => input.company_id ?? existing[index]?.company_id))
	];
	const companies = (
		await db.read('companies', { where: { id: { in: ids.filter((id) => id != null) } }, all: true })
	).rows;
	const codeById = new Map(companies.map((row) => [row.id, row.settings_code]));
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0 ? [] : (await db.read('jurisdiction_settings', sealedLineages(codes))).rows;
	return inputs.map((input, index) => {
		const companyId = input.company_id ?? existing[index]?.company_id;
		const code =
			(companyId == null ? undefined : codeById.get(companyId)) ??
			refuse('A company fact revision must reference a company.', { field: 'company_id' });
		const facts = input.facts ?? existing[index]?.facts ?? {};
		const declared = versions
			.filter((version) => version.code === code)
			.flatMap((version) => version.facts);
		const fault = entityFactsFault(code, facts, declared);
		if (fault != null) refuse(fault, { field: 'facts' });
		return existing[index] == null ? { ...input, facts } : input;
	});
});
