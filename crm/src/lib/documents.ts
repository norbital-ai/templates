/**
 * Any template of the catalogue (`template_documents`: a document, an outreach email or a research prompt) filled with a
 * company's, and for a job-scoped one its job's, current values. The text is never stored: it is rendered from the
 * template version and the values, live for a preview, frozen as a signed copy's `terms`.
 */
import type { Id } from '@norbital-ai/bolt';
import type { SowContent } from './extracted.js';
import { DateTime } from 'effect';

/** The values a template's `{{placeholder}}`s are filled with: an empty value is missing. */
export type Values = Readonly<Record<string, string>>;
type Rows<T> = { readonly rows: readonly T[] };

const SOW = [
	'overview',
	'definitions',
	'implementation_scope',
	'data_migration',
	'milestones',
	'uat_tests',
	'fees'
] as const;

/** Everything a template is filled from, as one read: a company, its contacts, a job of it and the company's details. */
export const valuesRead = (company: Id<'companies'>, project: Id<'projects'> | null) =>
	({
		companies: {
			where: { id: { eq: company } },
			fields: [
				'name',
				'uen',
				'address',
				'website',
				'industry',
				'research',
				'use_cases',
				'stage',
				'revision'
			],
			limit: 1,
			owner: { fields: ['name'] }
		},
		contacts: {
			output: 'crm',
			where: { company_id: { eq: company } },
			fields: [
				'full_name',
				'job_title',
				'email',
				'company_signatory',
				'is_primary',
				'seniority',
				'angle',
				'revision'
			]
		},
		projects: {
			where: { id: { in: project === null ? [] : [project] } },
			fields: ['name', 'company_id', 'signatory', ...SOW]
		},
		agreement_settings: {
			fields: [
				'provider_company',
				'provider_uen',
				'provider_address',
				'provider_signatory_name',
				'provider_signatory_title',
				'provider_signature'
			],
			limit: 1
		}
	}) as const;
/** A template's versions and its values, as one read: by a page for a preview, by the workspace when a signed copy freezes it, by an automation that sends it. */
export const documentRead = (
	key: string,
	company: Id<'companies'>,
	project: Id<'projects'> | null
) =>
	({
		template_documents: {
			where: { key: { eq: key } },
			fields: [
				'title',
				'key',
				'kind',
				'scope',
				'version',
				'required',
				'subject',
				'body',
				'drafting_instructions'
			]
		},
		...valuesRead(company, project)
	}) as const;

export type Template = {
	readonly id: Id<'template_documents'>;
	readonly title: string;
	readonly key: string;
	readonly kind: 'document' | 'email' | 'research';
	readonly scope: 'company' | 'project';
	readonly version: number;
	readonly required: readonly string[] | null;
	readonly subject: string | null;
	readonly body: string;
	readonly drafting_instructions: string | null;
};
type Contact = {
	readonly id: Id<'contacts'>;
	readonly revision: number;
	readonly full_name: string;
	readonly job_title: string | null;
	readonly email: string | null;
	readonly company_signatory: boolean;
	readonly is_primary: boolean | null;
	readonly seniority: string | null;
	readonly angle: string | null;
};
/** What `valuesRead` answers, as the values use it (a caller's or the workspace's answer alike). */
export type ValuesData = {
	readonly companies: Rows<{
		readonly name: string;
		readonly uen: string | null;
		readonly address: string | null;
		readonly website: string | null;
		readonly industry: string | null;
		readonly research: string | null;
		readonly use_cases: readonly string[] | null;
		readonly stage: string;
		readonly revision: number;
		readonly owner: { readonly id: Id<'sys_user'>; readonly name: string | null } | null;
	}>;
	readonly contacts: Rows<Contact>;
	readonly projects: Rows<
		SowContent & {
			readonly name: string;
			readonly company_id: Id<'companies'> | null;
			readonly signatory: Id<'contacts'> | null;
		}
	>;
	readonly agreement_settings: Rows<{
		readonly provider_company: string | null;
		readonly provider_uen: string | null;
		readonly provider_address: string | null;
		readonly provider_signatory_name: string;
		readonly provider_signatory_title: string | null;
	}>;
};
/** What `documentRead` answers. */
export type DocumentData = ValuesData & { readonly template_documents: Rows<Template> };

/** The latest version of the template read. */
export const latestTemplate = (data: Pick<DocumentData, 'template_documents'>) =>
	latestByKey(data.template_documents.rows)[0];
/** Each key's latest version, in first-seen key order. */
export const latestByKey = <T extends { readonly key: string; readonly version: number }>(
	rows: readonly T[]
) => [
	...rows
		.reduce((latest, row) => {
			const held = latest.get(row.key);
			return held === undefined || row.version > held.version ? latest.set(row.key, row) : latest;
		}, new Map<string, T>())
		.values()
];

/**
 * The contact a template addresses: the one named, else the job's SOW signer, the customer's signatory, its primary
 * contact (a lead's PIC), in that order.
 */
export const addressee = (
	data: Pick<ValuesData, 'contacts' | 'projects'>,
	named: Id<'contacts'> | null
) => {
	const id = named ?? data.projects.rows[0]?.signatory ?? null;
	return (
		(id === null ? undefined : data.contacts.rows.find((row) => row.id === id)) ??
		data.contacts.rows.find((row) => row.company_signatory) ??
		data.contacts.rows.find((row) => row.is_primary === true)
	);
};

/** One table cell: a pipe or line break would end the cell. */
const cell = (value: string | null | undefined) =>
	(value ?? '')
		.replace(/\|/g, '\\|')
		.replace(/\s*\n\s*/g, ' ')
		.trim();
/** A cell holding several points, each bulleted as in the owner's SOW. */
const points = (values: readonly string[] | null | undefined) =>
	(values ?? []).map((value) => `• ${cell(value)}`).join(' ');
/** A pipe table, empty without rows; the separator's dashes set pandoc's relative column widths. */
const table = (
	head: readonly (readonly [title: string, width: number])[],
	rows: readonly (readonly string[])[]
) =>
	rows.length === 0
		? ''
		: [
				`| ${head.map(([title]) => title).join(' | ')} |`,
				`| ${head.map(([, width]) => '-'.repeat(width * 4)).join(' | ')} |`,
				...rows.map((row) => `| ${row.join(' | ')} |`)
			].join('\n');

/** A job's scope-of-work lists as the owner's SOW tables. */
const sowSections = (sow: SowContent): Record<(typeof SOW)[number], string> => ({
	overview: sow.overview?.trim() ?? '',
	definitions: table(
		[
			['Term', 1],
			['Meaning', 4]
		],
		(sow.definitions ?? []).map((d) => [`**${cell(d.term)}**`, cell(d.meaning)])
	),
	implementation_scope: table(
		[
			['Feature', 3],
			['Included Services', 4],
			['Dependencies and Limitations', 4]
		],
		(sow.implementation_scope ?? []).map((r) => [
			cell(r.feature),
			points(r.included),
			points(r.dependencies)
		])
	),
	data_migration: table(
		[
			['Data', 2],
			['Included Services', 5],
			['Format', 2]
		],
		(sow.data_migration ?? []).map((m) => [cell(m.data), points(m.included), cell(m.format)])
	),
	milestones: table(
		[
			['Timeline', 2],
			['Milestone', 4],
			['Client Review', 2]
		],
		(sow.milestones ?? []).map((m) => [
			cell(
				m.timeline && m.due_on
					? `${m.timeline} (${DateTime.formatUtc(DateTime.makeUnsafe(m.due_on), LONG_DATE)})`
					: m.timeline ||
							(m.due_on ? DateTime.formatUtc(DateTime.makeUnsafe(m.due_on), LONG_DATE) : '')
			),
			cell(m.milestone),
			cell(m.client_review)
		])
	),
	uat_tests: table(
		[
			['Name', 2],
			['Objective', 3],
			['Expected Result', 5]
		],
		(sow.uat_tests ?? []).map((u) => [
			cell([u.ref, u.name].filter(Boolean).join(' — ')),
			cell(u.objective),
			cell(u.expected_result)
		])
	),
	fees: table(
		[
			['Item', 2],
			['Includes', 4],
			['Fee', 2]
		],
		(sow.fees ?? []).map((f) => [cell(f.item), cell(f.includes), cell(f.fee)])
	)
});

/** `9 October 2026`, as the owner's documents date themselves. */
const LONG_DATE = { locale: 'en-GB', day: 'numeric', month: 'long', year: 'numeric' } as const;
/** The placeholders that change every day: a signed copy's terms differ from today's by more than its date. */
const DATED = new Set(['today', 'date', 'date_long']);

/**
 * Every placeholder's value on `today`, addressed to `contact`: dates; the provider (`provider_*`); the counterparty; its
 * addressee (`contact_*`); its owner and research (`owner_name`, `research`, `use_cases`, `pic_*`); for a job-scoped
 * template the job and its scope-of-work sections. A value the records do not hold is empty.
 */
export const documentValues = (
	data: ValuesData,
	today: string,
	contact: Contact | undefined
): Values => {
	const company = data.companies.rows[0];
	const project = data.projects.rows[0];
	const provider = data.agreement_settings.rows[0];
	return {
		today,
		// `30/09/26`, as the owner's NDA dates itself
		date: DateTime.formatUtc(DateTime.makeUnsafe(today), {
			locale: 'en-GB',
			day: '2-digit',
			month: '2-digit',
			year: '2-digit'
		}),
		date_long: DateTime.formatUtc(DateTime.makeUnsafe(today), LONG_DATE),
		provider_company: provider?.provider_company ?? '',
		provider_uen: provider?.provider_uen ?? '',
		provider_address: provider?.provider_address ?? '',
		provider_name: provider?.provider_signatory_name ?? '',
		provider_title: provider?.provider_signatory_title ?? '',
		company: company?.name ?? '',
		uen: company?.uen ?? '',
		address: company?.address ?? '',
		website: company?.website ?? '',
		industry: company?.industry ?? '',
		owner_name: company?.owner?.name ?? '',
		research: company?.research ?? '',
		use_cases: (company?.use_cases ?? []).map((use) => `- ${use}`).join('\n'),
		contact_name: contact?.full_name ?? '',
		contact_title: contact?.job_title ?? '',
		contact_email: contact?.email ?? '',
		pic_seniority: contact?.seniority ?? '',
		pic_angle: contact?.angle ?? '',
		project: project?.name ?? '',
		...(project === undefined ? {} : sowSections(project))
	};
};

/** A template's `required` placeholders the values leave empty. */
export const missing = (required: readonly string[] | null, values: Values) =>
	(required ?? []).filter((name) => !values[name]?.trim());

/** A line holding only a clause number: `1.`, `1.2`, `(a)`, `1.2 (a)`, `(B)`. */
const MARK = String.raw`[ \t]*(?:\d+\.(?:\d+\.?)*|\([A-Za-z0-9]{1,4}\))(?:[ \t]+\([A-Za-z0-9]{1,4}\))?`;
/**
 * A template pasted from Word or PDF text, its layout repaired without changing a word: a tab after a list marker, a
 * clause number on a line of its own, a page break's blank line inside a wrapped sentence.
 */
export const tidyTemplate = (template: string): string =>
	template
		.replace(/^([ \t]*\(?(?:\d{1,3}|[A-Za-z])[.)])[ \t]*\t[ \t]*/gm, '$1 ')
		.replace(
			new RegExp(String.raw`(\S[ \t]*)\n(?=${MARK}[ \t]*$|[ \t]*\d+\.\d+[ \t]+\S)`, 'gm'),
			'$1\n\n'
		)
		.replace(new RegExp(String.raw`^(${MARK})[ \t]*\n(?:[ \t]*\n)*[ \t]*(?=[^\s#|])`, 'gm'), '$1 ')
		.replace(
			new RegExp(
				String.raw`^(?![ \t]*(?:[#|>-]|${MARK}[ \t]))([^\n]{59,}[A-Za-z])\n[ \t]*\n(?=[ \t]*[A-Za-z])`,
				'gm'
			),
			'$1\n'
		);

/** A template's text filled with `values`; a placeholder without a value shows as `[name]`. */
export const render = (template: string, values: Values): string =>
	tidyTemplate(template).replace(
		/\{\{([a-z_]+)\}\}/g,
		(_, name: string) => values[name]?.trim() || `[${name}]`
	);

/** What a copy agreed to, apart from its date: a signed copy whose key differs from today's has drifted. */
export const termsKey = (template: Id<'template_documents'> | null, values: Values) =>
	JSON.stringify([
		template,
		Object.entries(values)
			.filter(([name]) => !DATED.has(name))
			.sort(([a], [b]) => (a < b ? -1 : 1))
	]);

/** A template as rendered now: its version, text, subject, what is missing, its drift key and its addressee. */
export const preview = (data: DocumentData, today: string, named: Id<'contacts'> | null = null) => {
	const template = latestTemplate(data);
	const contact = addressee(data, named);
	const values = documentValues(data, today, contact);
	return {
		template,
		values,
		body: template === undefined ? '' : render(template.body, values),
		subject: template?.subject == null ? '' : render(template.subject, values),
		missing: missing(template?.required ?? null, values),
		key: termsKey(template?.id ?? null, values),
		contact
	};
};
