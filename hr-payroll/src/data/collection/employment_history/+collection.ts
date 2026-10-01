import { collection } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { dateKey } from '../../../lib/iso-day.js';
import { lineagesFault, personLineages } from '../../../lib/person-facts.js';

const history = collection('employment_history', {
	read: { fields: 'all' },
	create: { input: { columns: ['employee_id', 'kind', 'effective_range', 'facts'] } },
	update: { input: { columns: ['effective_range', 'facts'] } },
	delete: {}
});
export default history;

/**
 * One period of prior history. Its `kind` must be a `history_kinds` code some lineage of the person declares, and its
 * facts that kind's declared facts. Prior periods may overlap (concurrent employers). A row never changes person or
 * kind; `facts` defaults to `{}` and the summary is derived.
 */
history.transform(async (inputs, { existing, db, refuse }) => {
	const lineages = await personLineages(db, [
		...new Set(
			inputs.flatMap((input, index) => {
				const id = input.employee_id ?? existing[index]?.employee_id;
				return id == null ? [] : [String(id)];
			})
		)
	]);
	return inputs.map((input, index) => {
		const stored = existing[index];
		const personId = String(
			input.employee_id ??
				stored?.employee_id ??
				refuse('A history period must reference an employee.', { field: 'employee_id' })
		);
		if (stored != null && personId !== String(stored.employee_id))
			refuse('A history period cannot move to another person. Close it and record a new one.');
		const kind = (input.kind ?? stored?.kind ?? '').trim();
		if (stored != null && kind !== stored.kind)
			refuse('A history period cannot change kind. Record a new one.', { field: 'kind' });
		const codes = lineages.codesByEmployee.get(personId) ?? [];
		const kindsOf = (code: string) =>
			lineages.versions
				.filter((version) => version.code === code)
				.flatMap((version) => version.history_kinds ?? [])
				.filter((declared) => declared.code === kind);
		const declaring = codes.filter((code) => kindsOf(code).length > 0);
		if (declaring.length === 0)
			refuse(
				codes.length === 0
					? 'Record an employment first: its settings lineage declares the kinds of prior history.'
					: `${codes.join(', ')} does not declare the history kind ${kind || '(none)'}.`,
				{ field: 'kind' }
			);
		const range = readRange(input.effective_range ?? stored?.effective_range);
		if (range == null || (range.end != null && dateKey(range.end) < dateKey(range.start)))
			refuse('A history period needs an ordered inclusive effective range.', {
				field: 'effective_range'
			});
		const facts = input.facts ?? stored?.facts ?? {};
		const fault = lineagesFault(declaring, facts, (code) =>
			kindsOf(code).flatMap((declared) => declared.facts)
		);
		if (fault != null) refuse(fault, { field: 'facts' });
		return {
			...input,
			...(stored == null ? { facts, kind } : {}),
			summary: `${kind} · ${dateKey(range!.start)} – ${range!.end == null ? 'open' : dateKey(range!.end)}`
		};
	});
});
