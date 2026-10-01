import { collection, type CollectionName } from '@norbital-ai/bolt';
import { evidenceFault, sealedLineages } from '../../../lib/entity-facts.js';
import { caseTypesOf } from '../../../lib/benefit-cases/benefit.js';
import type { FactKey } from '../../../lib/datatypes/fact_keys.js';
import { readAll } from '../../../lib/reads.js';
import { plain } from '../../../lib/wire.js';
import { addDays, requiredDateKey } from '../../../lib/payroll/run/dates.js';

const columns = [
	'subject',
	'fact_key',
	'reference',
	'file',
	'received_on',
	'document_type',
	'expires_on'
] as const;

/**
 * Evidence of declared facts on any subject that records them. A row written under its payment or
 * settlement, in that subject's own write, is judged there.
 */
const c = collection('fact_evidence', {
	read: { fields: 'all' },
	create: { input: { columns: [...columns] } },
	update: {
		input: { columns: ['reference', 'file', 'received_on', 'document_type', 'expires_on'] }
	},
	delete: {}
});
export default c;

type Row = Readonly<Record<string, unknown>>;
type Facts = Readonly<Record<string, unknown>> | null | undefined;
type Declarations = readonly object[];

/**
 * Who declares a subject's facts. `lineage`: a field of every sealed live version of the company's
 * lineage, reached through the subject's own company, its employment's, or its person's contracts.
 * `by`: the row the subject names (a catalogue row, a scheme, a settings version).
 */
type Spec = {
	/** The stored field holding the values; `facts` reads them out of it where they are nested. */
	readonly field: string;
	readonly facts?: (row: Row) => Facts;
	/** Extra subject fields a declaration is picked by. */
	readonly keys?: readonly string[];
} & (
	| {
			readonly owner: 'company_id' | 'employment_id' | 'employee_id';
			readonly lineage: (version: Row, subject: Row) => Declarations;
	  }
	| {
			readonly by: {
				readonly collection: CollectionName;
				readonly key: string;
				readonly fields: readonly string[];
				readonly declared: (declaring: Row, subject: Row) => Declarations;
			};
	  }
);

const list = (value: unknown): Declarations => (Array.isArray(value) ? value : []);
const field =
	(name: string) =>
	(row: Row): Declarations =>
		list(row[name]);

/** Every subject evidence can be recorded against, and where its declarations live. */
const SUBJECTS: Readonly<Record<string, Spec>> = {
	company_facts: { field: 'facts', owner: 'company_id', lineage: field('facts') },
	employment_terms: { field: 'facts', owner: 'employment_id', lineage: field('terms_facts') },
	work_days: { field: 'facts', owner: 'employment_id', lineage: field('work_day_facts') },
	payment_events: { field: 'facts', owner: 'company_id', lineage: field('payment_facts') },
	noncontract_settlements: {
		field: 'facts',
		owner: 'company_id',
		lineage: field('settlement_facts')
	},
	worksites: { field: 'facts', owner: 'company_id', lineage: field('worksite_facts') },
	/** A departure's declarations: evidence of a ground or notice, judged on the contract. */
	employments: { field: 'exit_facts', owner: 'company_id', lineage: field('exit_facts') },
	person_facts: { field: 'facts', owner: 'employee_id', lineage: field('person_facts') },
	employment_history: {
		field: 'facts',
		keys: ['kind'],
		owner: 'employee_id',
		lineage: (version, subject) =>
			list(version.history_kinds).flatMap((kind) =>
				(kind as Row).code === subject.kind ? list((kind as Row).facts) : []
			)
	},
	/** A benefit case's facts are declared by its case type (`payroll.benefit_cases`). */
	benefit_cases: {
		field: 'facts',
		keys: ['case_type'],
		owner: 'employment_id',
		lineage: (version, subject) =>
			caseTypesOf(version as never)
				.filter((type) => type.case_type === subject.case_type)
				.flatMap((type) => type.facts)
	},
	leave_entries: {
		field: 'facts',
		by: {
			collection: 'leave_catalogue',
			key: 'catalogue_id',
			fields: ['code', 'event_facts'],
			declared: field('event_facts')
		}
	},
	adhoc_requests: {
		field: 'facts',
		by: {
			collection: 'adhoc_catalogue',
			key: 'catalogue_id',
			fields: ['code', 'request_facts'],
			declared: field('request_facts')
		}
	},
	claim_requests: {
		field: 'facts',
		by: {
			collection: 'claim_catalogue',
			key: 'catalogue_id',
			fields: ['code', 'request_facts'],
			declared: field('request_facts')
		}
	},
	/** A registration's elections, declared by its scheme. */
	employment_statutory_facts: {
		field: 'status',
		facts: (row) => (row.status as { readonly elections?: Facts } | null)?.elections,
		by: {
			collection: 'statutory_contributions',
			key: 'statutory_contribution_id',
			fields: ['code', 'elections'],
			declared: field('elections')
		}
	},
	/** A duty instance's evidence is what its duty type demands, on the version that raised it. */
	obligation_instances: {
		field: 'facts',
		keys: ['duty_code'],
		by: {
			collection: 'jurisdiction_settings',
			key: 'settings_id',
			fields: ['code', 'duty_types'],
			declared: (version, subject) =>
				list(version.duty_types).flatMap((duty) =>
					(duty as Row).code === subject.duty_code ? list((duty as Row).evidence) : []
				)
		}
	}
};

/** What a declaration's evidence may add to its kind: the document it must be, and how long it counts. */
type EvidenceDemand = NonNullable<FactKey['evidence']> & {
	readonly document?: string | null;
	readonly valid_days?: number | null;
};

/** `valid_days` counts the day received: 30 days from 2026-01-01 last count on 2026-01-30. */
const expiresOn = (received: string, validDays: number) =>
	addDays(
		requiredDateKey(received, 'The evidence receipt day'),
		validDays - 1
	) as `${number}-${number}-${number}`;

const SUBJECT_FAULT =
	'Evidence must name the fact revision, contract terms, work day, payment, settlement, benefit case, worksite, departure, person fact, history period, leave entry, request, registration or duty it evidences.';

/**
 * One row per evidenced fact: the subject's declarations demand evidence for the key, the subject
 * records the fact, and the row carries what the declaration demands (a reference, a file, or both;
 * the named document type; an expiry `valid_days` after receipt).
 */
c.transform(async (inputs, { existing, db, refuse }) => {
	const rows = inputs.map((input, index) => plain({ ...existing[index], ...input }) as Row);
	const arcs = rows.flatMap((row) => {
		const arc = row.subject as { readonly collection: string; readonly id: string } | null;
		return arc == null ? [] : [arc];
	});
	const idsIn = (name: string) => [
		...new Set(arcs.flatMap((arc) => (arc.collection === name ? [String(arc.id)] : [])))
	];
	const byId = (found: readonly Row[]) => new Map(found.map((row) => [String(row.id), row]));
	const inIds = (ids: readonly string[]) => ({ id: { in: ids } });

	// Wave 1: the subjects.
	const named = Object.entries(SUBJECTS).filter(([name]) => idsIn(name).length > 0);
	const subjects = new Map(
		await Promise.all(
			named.map(async ([name, spec]) => {
				const select = Object.fromEntries(
					[
						'id',
						spec.field,
						...(spec.keys ?? []),
						'owner' in spec ? spec.owner : spec.by.key,
						...(name === 'person_facts' ? ['employment_id'] : [])
					].map((key) => [key, true])
				);
				const found = await readAll<Row>(
					db,
					name as CollectionName,
					inIds(idsIn(name)),
					undefined,
					select
				);
				return [name, byId(found)] as const;
			})
		)
	);
	const subjectOf = (name: string, id: string) => subjects.get(name)?.get(id);
	const every = (name: string) => [...(subjects.get(name)?.values() ?? [])];
	const ownedBy = (owner: string) =>
		named.flatMap(([name, spec]) => ('owner' in spec && spec.owner === owner ? every(name) : []));

	// Wave 2: declaring rows, and the contracts that reach a company.
	const declaring = new Map<string, Map<string, Row>>();
	const employmentIds = [
		...new Set(
			ownedBy('employment_id')
				.concat(every('person_facts'))
				.flatMap((row) => (row.employment_id == null ? [] : [String(row.employment_id)]))
		)
	];
	const personIds = [...new Set(ownedBy('employee_id').map((row) => String(row.employee_id)))];
	const reach = [
		...(employmentIds.length === 0 ? [] : [{ id: { in: employmentIds } }]),
		...(personIds.length === 0 ? [] : [{ employee_id: { in: personIds } }])
	];
	const contracts =
		reach.length === 0
			? Promise.resolve([])
			: readAll<Row>(db, 'employments', { or: reach }, undefined, {
					id: true,
					employee_id: true,
					company_id: true
				});
	await Promise.all(
		named.flatMap(([name, spec]) => {
			if (!('by' in spec)) return [];
			const ids = [...new Set(every(name).map((row) => String(row[spec.by.key])))];
			return [
				readAll<Row>(
					db,
					spec.by.collection,
					inIds(ids),
					undefined,
					Object.fromEntries(['id', ...spec.by.fields].map((key) => [key, true]))
				).then((found) => declaring.set(name, byId(found)))
			];
		})
	);
	const employments: readonly Row[] = await contracts;
	const companyOfContract = new Map(
		employments.map((row) => [String(row.id), String(row.company_id)])
	);
	const companiesOf = (spec: Spec, subject: Row): string[] => {
		if (!('owner' in spec)) return [];
		if (spec.owner === 'company_id') return [String(subject.company_id)];
		const contract =
			subject.employment_id == null
				? undefined
				: companyOfContract.get(String(subject.employment_id));
		if (contract != null) return [contract];
		// A personal row is judged by every lineage the person is contracted under.
		return spec.owner === 'employee_id'
			? employments.flatMap((row) =>
					row.employee_id === subject.employee_id ? [String(row.company_id)] : []
				)
			: [];
	};
	const companyIds = [
		...new Set(
			named.flatMap(([name, spec]) => every(name).flatMap((row) => companiesOf(spec, row)))
		)
	];

	// Wave 3: the entities and their lineages.
	const companies =
		companyIds.length === 0
			? []
			: await readAll<Row>(db, 'companies', inIds(companyIds), undefined, {
					id: true,
					settings_code: true
				});
	const codeOf = new Map(companies.map((row) => [String(row.id), String(row.settings_code)]));
	const codes = [...new Set(codeOf.values())];
	const versions =
		codes.length === 0
			? []
			: (plain(
					(
						await db.read('jurisdiction_settings', {
							...sealedLineages(codes),
							select: {
								code: true,
								facts: true,
								terms_facts: true,
								work_day_facts: true,
								payment_facts: true,
								settlement_facts: true,
								exit_facts: true,
								worksite_facts: true,
								person_facts: true,
								history_kinds: true,
								payroll: true
							}
						})
					).rows
				) as readonly Row[]);

	return inputs.map((input, index) => {
		const row = rows[index]!;
		const arc = row.subject as { readonly collection: string; readonly id: string } | null;
		// A row nested under its payment has no parent key yet; the payment's transform judges it.
		if (arc == null) return input;
		const spec = SUBJECTS[arc.collection];
		const subject = spec == null ? undefined : subjectOf(arc.collection, String(arc.id));
		if (spec == null || subject == null) return refuse(SUBJECT_FAULT, { field: 'subject' });
		const label = arc.collection.replaceAll('_', ' ');
		const key = String(row.fact_key ?? '').trim();
		const facts = spec.facts?.(subject) ?? (subject[spec.field] as Facts);
		if (!Object.hasOwn(facts ?? {}, key))
			refuse(`The ${label} record no fact ${key} to evidence.`, { field: 'fact_key' });
		let code: string;
		let declared: Declarations;
		if ('owner' in spec) {
			const lineages = companiesOf(spec, subject).map((company) => codeOf.get(company) ?? '');
			code = lineages[0] ?? '';
			declared = versions
				.filter((version) => lineages.includes(String(version.code)))
				.flatMap((version) => spec.lineage(version, subject));
		} else {
			const by = declaring.get(arc.collection)?.get(String(subject[spec.by.key]));
			code = String(by?.code ?? '');
			declared = by == null ? [] : spec.by.declared(by, subject);
		}
		const fault = evidenceFault(code, key, row, declared);
		if (fault != null) refuse(fault, { field: 'fact_key' });
		const demands = (declared as readonly FactKey[]).flatMap((declaration) =>
			declaration.key === key && declaration.evidence != null
				? [declaration.evidence as EvidenceDemand]
				: []
		);
		const documentCode = demands.find((demand) => demand.document != null)?.document ?? null;
		const documentType = row.document_type == null ? null : String(row.document_type);
		if (documentType != null && documentType !== documentCode)
			refuse(
				documentCode == null
					? `${code} names no document type for the evidence of ${key}.`
					: `The evidence for ${key} must be a ${documentCode} document.`,
				{ field: 'document_type' }
			);
		const validDays = demands.find((demand) => demand.valid_days != null)?.valid_days ?? null;
		const received = row.received_on == null ? null : String(row.received_on);
		const derived = validDays != null && received != null ? expiresOn(received, validDays) : null;
		const expires = row.expires_on != null ? String(row.expires_on) : derived;
		if (validDays != null && received == null)
			refuse(`The evidence for ${key} needs the day it was received.`, { field: 'received_on' });
		if (expires != null && received != null && expires < received)
			refuse('Evidence cannot expire before it was received.', { field: 'expires_on' });
		return {
			...input,
			...(documentCode != null && documentType == null ? { document_type: documentCode } : {}),
			...(derived != null && row.expires_on == null ? { expires_on: derived } : {})
		};
	});
});
