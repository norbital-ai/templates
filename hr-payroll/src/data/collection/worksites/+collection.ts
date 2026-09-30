import { collection } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { dateKey } from '../../../lib/iso-day.js';
import { entityFactsFault, sealedLineages } from '../../../lib/entity-facts.js';

const worksites = collection('worksites', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: ['company_id', 'code', 'name', 'address', 'region', 'facts', 'effective_range']
		}
	},
	update: {
		input: {
			columns: ['name', 'address', 'region', 'facts', 'effective_range']
		}
	},
	delete: {}
});
export default worksites;

/**
 * A dated revision of an establishment, judged against its company's lineage `worksite_facts`. Its company and code
 * never move: a new code is a new worksite. `facts` defaults to `{}`; the `noOverlap` keeps one revision per day.
 */
worksites.transform(async (inputs, { existing, db, refuse }) => {
	const ids = [
		...new Set(inputs.map((input, index) => input.company_id ?? existing[index]?.company_id))
	].filter((id) => id != null);
	const companies = (await db.read('companies', { where: { id: { in: ids } }, all: true })).rows;
	const codeById = new Map(companies.map((row) => [row.id, row.settings_code]));
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0
			? []
			: (
					await db.read('jurisdiction_settings', {
						...sealedLineages(codes),
						select: { code: true, worksite_facts: true }
					})
				).rows;
	return inputs.map((input, index) => {
		const stored = existing[index];
		const companyId = input.company_id ?? stored?.company_id;
		const lineage =
			(companyId == null ? undefined : codeById.get(companyId)) ??
			refuse('A worksite must reference a company.', { field: 'company_id' });
		const code = (input.code ?? stored?.code ?? '').trim();
		if (code === '') refuse('A worksite needs a code.', { field: 'code' });
		const name = (input.name ?? stored?.name ?? '').trim();
		if (name === '') refuse('A worksite needs a name.', { field: 'name' });
		const range = readRange(input.effective_range ?? stored?.effective_range);
		if (!range || (range.end != null && dateKey(range.end) < dateKey(range.start)))
			refuse('A worksite needs an ordered inclusive effective range.', {
				field: 'effective_range'
			});
		const facts = input.facts ?? stored?.facts ?? {};
		const fault = entityFactsFault(
			lineage,
			facts,
			versions
				.filter((version) => version.code === lineage)
				.flatMap((version) => version.worksite_facts ?? [])
		);
		if (fault != null) refuse(fault, { field: 'facts' });
		return stored == null ? { ...input, code, name, facts } : { ...input, name };
	});
});
