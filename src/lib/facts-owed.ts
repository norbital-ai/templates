/**
 * The declared facts a payroll run will refuse on, listed before it is built: every value a run's `requireFactValues`
 * (company facts, terms facts) or `resolvePersonFacts` (person facts) would find missing, invalid or unevidenced. One
 * judgement, `factValuesFault`, per key; the obligation reminders and the run's precheck both read this list, so the reminders
 * and the gate cannot disagree. Every declaration is stored configuration; nothing here names a jurisdiction.
 */
import { factValuesFault, resolveFactValues } from './declared-facts.js';
import type { CodeResolver, FactKey } from './datatypes/fact_keys.js';
import { evaluateBoolean, expressionEngine } from './expressions/evaluate.js';
import {
	isEligible,
	personContext,
	scalarFacts,
	type PersonInput
} from './payroll/run/eligibility.js';
import { coversDate, overlapsRange, readRange } from './payroll/run/effective.js';
import type { IsoDate } from './payroll/run/dates.js';
import { resolvePersonFacts, type PersonFactRow } from './person-facts.js';
import { dateKey } from './iso-day.js';
import { getErrorMessage } from './refuse.js';
import type { RunIssue } from './payroll/run/validate.js';
import {
	CODED_FIELDS,
	codedFieldFault,
	companyRegionFault,
	wageKeyFault,
	type CodedVersion
} from './coded-fields.js';

/** One subject's recorded values against the declarations that judge them, as the run would judge them. */
export type OwedSubject = {
	/** Where the value is recorded: `companies`, `company_facts`, `employment_terms`, `person_facts`. */
	readonly collection: string;
	/** The recording row; empty where no row records it yet. */
	readonly id: string;
	/** Who or what owes it, for the queue ("E001: terms on 2026-09-01"). */
	readonly label: string;
	readonly fields: readonly FactKey[];
	readonly values: Readonly<Record<string, unknown>>;
	readonly when?: ((expression: string) => boolean) | undefined;
	readonly evidenced?: ((key: string) => boolean) | undefined;
	readonly codes?: CodeResolver | undefined;
	/** The employment that owes it; absent where the company does. */
	readonly employmentId?: string | undefined;
};

/** One fact owed: the subject, the key and the sentence the run refuses with. */
export type OwedFact = {
	readonly collection: string;
	readonly id: string;
	readonly label: string;
	readonly key: string;
	readonly message: string;
	/** The employment that owes it; absent where the company does. */
	readonly employmentId?: string | undefined;
};

/** Every key of every subject whose value the run would refuse, one entry per key (the run stops at the first). */
export function factsOwed(subjects: readonly OwedSubject[]): OwedFact[] {
	return subjects.flatMap((subject) =>
		subject.fields.flatMap((field) => {
			const message = factValuesFault(
				[field],
				subject.values,
				true,
				subject.when,
				subject.evidenced,
				subject.codes
			);
			return message == null
				? []
				: [
						{
							collection: subject.collection,
							id: subject.id,
							label: subject.label,
							key: field.key,
							message,
							...(subject.employmentId == null ? {} : { employmentId: subject.employmentId })
						}
					];
		})
	);
}

/** The owed facts as the run's blocking issues: what `payrollRunPrecheck` refuses a run on. */
export const owedIssues = (owed: readonly OwedFact[]): RunIssue[] =>
	owed.map((fact) => ({
		code: 'FACTS_OWED',
		message: `${fact.label}: ${fact.message}`,
		collection: fact.collection,
		...(fact.id === '' ? {} : { recordId: fact.id })
	}));

/** The declared schemas, tables and wage order of one settings version the run judges. */
type Declared = Pick<CodedVersion, 'tables' | 'work_rules'> & {
	readonly facts?: readonly FactKey[] | null | undefined;
	readonly terms_facts?: readonly FactKey[] | null | undefined;
	readonly person_facts?: readonly FactKey[] | null | undefined;
};

/** What the run reads for one entity and one pay window, as plain rows. */
export type OwedInput = {
	/** The run's governing date (its salary window's last day): company and person facts are judged on it. */
	readonly asOf: IsoDate;
	/** The salary window: every terms row overlapping it is judged on the first day it prices. */
	readonly window: { readonly start: IsoDate; readonly end: IsoDate };
	/** The lineage version in force on a day, or null where none is. */
	readonly versionOn: (day: string) => Declared | null;
	readonly company: {
		readonly id: string;
		readonly name?: string | undefined;
		readonly settings_code: string;
		readonly region: string | null;
		readonly risk_class?: string | null | undefined;
		readonly pay_frequency: string;
		readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
	};
	readonly companyFactRevisions: readonly {
		/** Absent where the caller holds the revision without its row (the run's configuration). */
		readonly id?: string | undefined;
		readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
		readonly effective_range: unknown;
	}[];
	readonly employments: readonly {
		readonly id: string;
		readonly employee_id: string;
		readonly employee_number: string;
		readonly effective_range: unknown;
		readonly exit_ground?: string | null | undefined;
	}[];
	readonly employees: readonly (NonNullable<PersonInput['employee']> & { readonly id: string })[];
	readonly terms: readonly (NonNullable<PersonInput['terms']> & {
		readonly id: string;
		readonly employment_id: string;
		readonly effective_range: unknown;
	})[];
	readonly personFacts: readonly (PersonFactRow & { readonly employee_id: string })[];
	/** `collection:id:key` of every live `fact_evidence` row. */
	readonly evidence: ReadonlySet<string>;
	/** The `code` resolver of the version in force on a day. */
	readonly codesOn?: ((day: string) => CodeResolver) | undefined;
};

/** Every declared fact the entity's run for `window` will refuse on, as `withDeclaredFacts`, `withDatedPeople` and `resolveCompanyFacts` judge it. */
export function entityFactsOwed(input: OwedInput): OwedFact[] {
	const { asOf, window, company } = input;
	const governing = input.versionOn(asOf);
	const companyFields = governing?.facts ?? [];
	const revision = input.companyFactRevisions.find((row) => coversDate(row.effective_range, asOf));
	const raw = scalarFacts(revision?.facts ?? company.facts);
	const companyContext = {
		company: {
			settings_code: company.settings_code,
			region: company.region ?? '',
			pay_frequency: company.pay_frequency,
			facts: resolveFactValues(companyFields, raw, company.name ?? company.settings_code, false),
			fact_keys: Object.keys(raw)
		}
	};
	const owed = factsOwed([
		{
			collection: revision == null ? 'companies' : 'company_facts',
			id: revision == null ? company.id : (revision.id ?? ''),
			label: company.name ?? company.settings_code,
			fields: companyFields,
			values: raw,
			when: (expression) => evaluateBoolean(expressionEngine, expression, companyContext),
			// the run's company facts count their evidence as recorded (`resolveCompanyFacts`)
			evidenced: () => true
		}
	]);
	const scope = company.name ?? company.settings_code;
	// Coded columns against the governing version: a value loaded around the writes shows here before the run.
	const codes = input.codesOn?.(asOf);
	const coded = (
		collection: string,
		id: string,
		label: string,
		key: string,
		message: string | null,
		employmentId?: string
	) => {
		if (message != null)
			owed.push({
				collection,
				id,
				label,
				key,
				message,
				...(employmentId == null ? {} : { employmentId })
			});
	};
	if (governing != null && codes != null) {
		coded(
			'companies',
			company.id,
			scope,
			'risk_class',
			codedFieldFault(
				scope,
				'risk_class',
				CODED_FIELDS.companies.risk_class,
				company.risk_class,
				[governing],
				codes
			)
		);
		coded(
			'companies',
			company.id,
			scope,
			'region',
			companyRegionFault(scope, company.region, [governing.work_rules?.wages])
		);
	}
	const employees = new Map(input.employees.map((row) => [row.id, row]));
	const employments = input.employments.filter((row) =>
		overlapsRange(row.effective_range, window.start, window.end)
	);
	for (const employment of employments) {
		const range = readRange(employment.effective_range);
		const terms = input.terms.filter((row) => row.employment_id === employment.id);
		const person = (day: string) =>
			personContext({
				employee: employees.get(employment.employee_id) ?? null,
				employment: {
					id: employment.id,
					service_start: dateKey(range?.start),
					exit_date: range?.end == null ? null : dateKey(range.end),
					exit_ground: employment.exit_ground ?? null
				},
				terms: terms.find((row) => coversDate(row.effective_range, day as IsoDate)) ?? null,
				company: {
					region: company.region,
					pay_frequency: company.pay_frequency,
					facts: companyContext.company.facts
				},
				asOf: day
			});
		const employee = employees.get(employment.employee_id);
		if (employee != null && governing != null && codes != null)
			for (const [key, table] of Object.entries(CODED_FIELDS.employees))
				coded(
					'employees',
					employee.id,
					`${employment.employee_number}: person`,
					key,
					codedFieldFault(
						scope,
						key,
						table,
						employee[key as keyof typeof CODED_FIELDS.employees],
						[governing],
						codes
					),
					employment.id
				);
		for (const row of terms) {
			if (!overlapsRange(row.effective_range, window.start, window.end)) continue;
			const start = dateKey(readRange(row.effective_range)?.start);
			const day = start < window.start ? window.start : start;
			const wages = input.versionOn(day)?.work_rules?.wages;
			for (const [key, kind] of [
				['worksite', 'places'],
				['worksite_sector', 'sectors']
			] as const)
				coded(
					'employment_terms',
					row.id,
					`${employment.employee_number}: terms on ${day}`,
					key,
					wageKeyFault(scope, key, kind, row[key], [wages]),
					employment.id
				);
			owed.push(
				...factsOwed([
					{
						collection: 'employment_terms',
						id: row.id,
						label: `${employment.employee_number}: terms on ${day}`,
						fields: input.versionOn(day)?.terms_facts ?? [],
						values: scalarFacts(row.facts),
						when: (expression) => isEligible(expression, person(day)),
						evidenced: (key) => input.evidence.has(`employment_terms:${row.id}:${key}`),
						codes: input.codesOn?.(day),
						employmentId: employment.id
					}
				])
			);
		}
		// Person facts go through the run's own resolver, one key at a time: it owns `change_effect` and the
		// employment-over-personal precedence, and it stops at the first refusal.
		const rows = input.personFacts.filter((row) => row.employee_id === employment.employee_id);
		const label = `${employment.employee_number}: person facts on ${asOf}`;
		for (const field of governing?.person_facts ?? []) {
			try {
				resolvePersonFacts([field], rows, { asOf, employmentId: employment.id, scope: label });
			} catch (error) {
				owed.push({
					collection: 'person_facts',
					id: '',
					label,
					key: field.key,
					message: getErrorMessage(error).replace(`${label}: `, ''),
					employmentId: employment.id
				});
			}
		}
	}
	return owed;
}
