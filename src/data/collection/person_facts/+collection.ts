import { collection } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { dateKey } from '../../../lib/iso-day.js';
import { factScopeFault, type FactKey } from '../../../lib/datatypes/fact_keys.js';
import { lineagesFault, personLineages } from '../../../lib/person-facts.js';

const personFacts = collection('person_facts', {
	read: { fields: 'all' },
	create: {
		input: { columns: ['employee_id', 'employment_id', 'facts', 'effective_range', 'source'] }
	},
	update: { input: { columns: ['facts', 'effective_range', 'source'] } },
	delete: {}
});
export default personFacts;

/**
 * A dated revision of a person's declared facts, judged against the `person_facts` declarations of the person's
 * lineages (the named employment's alone when it names one). An employment-scoped key needs a named employment. A
 * revision never moves person or employment; `facts` defaults to `{}` and the summary is derived.
 */
personFacts.transform(async (inputs, { existing, db, refuse }) => {
	const lineages = await personLineages(db, [
		...new Set(
			inputs.flatMap((input, index) => {
				const id = input.employee_id ?? existing[index]?.employee_id;
				return id == null ? [] : [String(id)];
			})
		)
	]);
	const declarationsOf = (code: string) =>
		lineages.versions
			.filter((version) => version.code === code)
			.flatMap((version) => version.person_facts ?? []);
	return inputs.map((input, index) => {
		const stored = existing[index];
		const personId = String(
			input.employee_id ??
				stored?.employee_id ??
				refuse('A person fact must reference an employee.', { field: 'employee_id' })
		);
		if (stored != null && personId !== String(stored.employee_id))
			refuse('A person fact cannot move to another person. Close it and record a new fact.');
		const employmentId =
			input.employment_id !== undefined ? input.employment_id : stored?.employment_id;
		if (stored != null && (employmentId ?? null) !== (stored.employment_id ?? null))
			refuse('A person fact cannot move to another employment. Close it and record a new fact.', {
				field: 'employment_id'
			});
		if (
			employmentId != null &&
			lineages.employeeByEmployment.get(String(employmentId)) !== personId
		)
			refuse('The selected employment must belong to this employee profile.', {
				field: 'employment_id'
			});
		const range = readRange(input.effective_range ?? stored?.effective_range);
		if (range == null || (range.end != null && dateKey(range.end) < dateKey(range.start)))
			refuse('A person fact needs an ordered inclusive effective range.', {
				field: 'effective_range'
			});
		const facts = input.facts ?? stored?.facts ?? {};
		const codes =
			employmentId == null
				? (lineages.codesByEmployee.get(personId) ?? [])
				: [lineages.codeByEmployment.get(String(employmentId)) ?? ''];
		const fault =
			lineagesFault(codes, facts, declarationsOf, lineages.codesOf) ??
			factScopeFault(codes.flatMap(declarationsOf) as FactKey[], facts, employmentId);
		if (fault != null) refuse(fault, { field: 'facts' });
		const keys = Object.keys(facts).toSorted();
		return {
			...input,
			...(stored == null ? { facts } : {}),
			summary: `${keys.length === 0 ? 'No facts' : keys.join(', ')} · from ${dateKey(range!.start)}`
		};
	});
});
