import { collection, type Id } from '@norbital-ai/bolt';
import {
	evidenceFault,
	sealedLineages,
	SUBJECT_SCHEMA,
	type FactSubject
} from '../../../lib/entity-facts.js';
import { caseTypesOf } from '../../../lib/benefit-cases/benefit.js';

const columns = ['subject', 'fact_key', 'reference', 'file', 'received_on'] as const;

/**
 * Evidence of declared facts: an entity's dated fact revision, contract terms, a person-day, a
 * payment or a non-contract settlement. A row written under its payment or settlement, in that
 * subject's own write, is judged there.
 */
const c = collection('fact_evidence', {
	read: { fields: 'all' },
	create: { input: { columns: [...columns] } },
	update: { input: { columns: ['reference', 'file', 'received_on'] } },
	delete: {}
});
export default c;

type Subject = {
	readonly id: string;
	readonly employment_id?: string;
	readonly company_id?: string;
	readonly facts?: Readonly<Record<string, unknown>> | null;
	/** A benefit case's type: its facts are declared by that case type (`payroll.benefit_cases`). */
	readonly case_type?: string;
};
/** Evidence subjects: the fact schemas' own, and a benefit case, whose case type declares its facts. */
type EvidenceSubject = FactSubject | 'benefit_cases';

/**
 * One row per evidenced fact: the subject's lineage declares evidence for the key, the subject records
 * the fact, and the row carries what the declaration demands (a reference, a file, or both).
 */
c.transform(async (inputs, { existing, db, refuse }) => {
	const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const subjects = rows.flatMap((row) => (row.subject == null ? [] : [row.subject]));
	const idsOf = <K extends EvidenceSubject>(name: K) => [
		...new Set(subjects.flatMap((arc) => (arc.collection === name ? [arc.id as Id<K>] : [])))
	];
	const read = async (
		ids: readonly unknown[],
		rowsOf: () => Promise<{ rows: readonly Subject[] }>
	) => (ids.length === 0 ? [] : (await rowsOf()).rows);
	const facts = { id: true, facts: true } as const;
	const byEntity = { ...facts, company_id: true } as const;
	const byPerson = { ...facts, employment_id: true } as const;
	const [revisions, terms, days, payments, settlements, cases] = await Promise.all([
		read(idsOf('company_facts'), () =>
			db.read('company_facts', {
				where: { id: { in: idsOf('company_facts') } },
				select: byEntity,
				all: true
			})
		),
		read(idsOf('employment_terms'), () =>
			db.read('employment_terms', {
				where: { id: { in: idsOf('employment_terms') } },
				select: byPerson,
				all: true
			})
		),
		read(idsOf('work_days'), () =>
			db.read('work_days', {
				where: { id: { in: idsOf('work_days') } },
				select: byPerson,
				all: true
			})
		),
		read(idsOf('payment_events'), () =>
			db.read('payment_events', {
				where: { id: { in: idsOf('payment_events') } },
				select: byEntity,
				all: true
			})
		),
		read(idsOf('noncontract_settlements'), () =>
			db.read('noncontract_settlements', {
				where: { id: { in: idsOf('noncontract_settlements') } },
				select: byEntity,
				all: true
			})
		),
		read(idsOf('benefit_cases'), () =>
			db.read('benefit_cases', {
				where: { id: { in: idsOf('benefit_cases') } },
				select: { ...byPerson, case_type: true },
				all: true
			})
		)
	]);
	const employmentIds = [
		...new Set([...terms, ...days, ...cases].map((row) => String(row.employment_id)))
	];
	const employments =
		employmentIds.length === 0
			? []
			: (
					await db.read('employments', {
						where: { id: { in: employmentIds as never[] } },
						select: { id: true, company_id: true },
						all: true
					})
				).rows;
	const companyOf = new Map(employments.map((row) => [String(row.id), String(row.company_id)]));
	const companyIds = [
		...new Set([
			...employments.map((row) => String(row.company_id)),
			...[...revisions, ...payments, ...settlements].map((row) => String(row.company_id))
		])
	];
	const companies =
		companyIds.length === 0
			? []
			: (
					await db.read('companies', {
						where: { id: { in: companyIds as never[] } },
						select: { id: true, settings_code: true },
						all: true
					})
				).rows;
	const codeOf = new Map(companies.map((row) => [String(row.id), row.settings_code]));
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0
			? []
			: (
					await db.read('jurisdiction_settings', {
						...sealedLineages(codes),
						select: {
							code: true,
							facts: true,
							terms_facts: true,
							work_day_facts: true,
							payment_facts: true,
							settlement_facts: true,
							payroll: true
						}
					})
				).rows;
	const subjectById = new Map(
		[
			...revisions.map((row) => ['company_facts', row] as const),
			...terms.map((row) => ['employment_terms', row] as const),
			...days.map((row) => ['work_days', row] as const),
			...payments.map((row) => ['payment_events', row] as const),
			...settlements.map((row) => ['noncontract_settlements', row] as const),
			...cases.map((row) => ['benefit_cases', row] as const)
		].map(([name, row]) => [`${name}:${row.id}`, row])
	);
	return inputs.map((input, index) => {
		const row = rows[index]!;
		const arc = row.subject;
		// A row nested under its payment has no parent key yet; the payment's transform judges it.
		if (arc == null) return input;
		const name = arc.collection as EvidenceSubject;
		const subject = subjectById.get(`${arc.collection}:${arc.id}`);
		if (!(name in SUBJECT_SCHEMA || name === 'benefit_cases') || subject == null)
			return refuse(
				'Evidence must name the fact revision, contract terms, work day, payment, settlement or benefit case it evidences.',
				{ field: 'subject' }
			);
		const company =
			subject.company_id != null
				? String(subject.company_id)
				: companyOf.get(String(subject.employment_id));
		const code = codeOf.get(company ?? '') ?? '';
		const key = String(row.fact_key ?? '').trim();
		if (!Object.hasOwn(subject.facts ?? {}, key))
			refuse(`The ${name.replaceAll('_', ' ')} record no fact ${key} to evidence.`, {
				field: 'fact_key'
			});
		const lineage = versions.filter((version) => version.code === code);
		const declared =
			name === 'benefit_cases'
				? lineage.flatMap((version) =>
						caseTypesOf(version as never)
							.filter((type) => type.case_type === subject.case_type)
							.flatMap((type) => type.facts)
					)
				: lineage.flatMap((version) => version[SUBJECT_SCHEMA[name]] as readonly object[]);
		const fault = evidenceFault(code, key, row, declared);
		if (fault != null) refuse(fault, { field: 'fact_key' });
		return input;
	});
});
