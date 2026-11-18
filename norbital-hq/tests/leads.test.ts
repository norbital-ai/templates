/**
 * Leads from CSV and Apollo are read into one shape and planned against what is stored, and a company is one row however
 * it arrives (the form, the agent, a spreadsheet, Apollo): one per `company_key`, domain and UEN; one PIC per email.
 */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Result, Schema } from 'effect';
import { Convert, Port } from '@norbital-ai/bolt/engine';
import { JobResult } from '@norbital-ai/bolt-cli/test';
import {
	companyKey,
	domainOf,
	leadsFromApollo,
	leadsFromSheet,
	planLeads
} from '../src/lib/leads.js';
import { idOf, pageOf, recordOf, runRows, workspace } from './workspace.js';

const companyId = Schema.decodeUnknownSync(idOf('companies'));

describe('domainOf', () => {
	it.each([
		['https://www.Example.test/about', 'example.test'],
		['example.test', 'example.test'],
		['WWW.example.test:8080', 'example.test'],
		['not a domain', null],
		[null, null]
	] as const)('%s → %s', (value, domain) => {
		expect(domainOf(value)).toBe(domain);
	});
});

it('reads a CSV by its headers, any case, taking the domain from the website or email', () => {
	const leads = leadsFromSheet({
		columns: ['Company Name', 'Website', 'First Name', 'Last Name', 'Job Title', 'Email'],
		rows: [
			['Harbour Co', 'https://harbour.test', 'Ana', 'Lim', 'Director', 'Ana@Harbour.test'],
			['', '', 'Ben', 'Tan', 'Clerk', 'ben@quay.test'],
			['', '', '', '', '', '']
		]
	});
	expect(leads).toEqual([
		{
			company: 'Harbour Co',
			domain: 'harbour.test',
			website: 'https://harbour.test',
			industry: null,
			full_name: 'Ana Lim',
			job_title: 'Director',
			email: 'ana@harbour.test',
			phone: null
		},
		{
			company: 'quay.test',
			domain: 'quay.test',
			website: null,
			industry: null,
			full_name: 'Ben Tan',
			job_title: 'Clerk',
			email: 'ben@quay.test',
			phone: null
		}
	]);
});

it('reads Apollo contacts and leaves out one without a company', () => {
	expect(
		leadsFromApollo([
			{
				name: 'Cara',
				title: 'Owner',
				email: 'cara@dock.test',
				organization: { name: 'Dock', primary_domain: 'dock.test' }
			},
			{ name: 'Nobody' }
		])
	).toEqual([
		{
			company: 'Dock',
			domain: 'dock.test',
			website: null,
			industry: null,
			full_name: 'Cara',
			job_title: 'Owner',
			email: 'cara@dock.test',
			phone: null
		}
	]);
});

it('plans one company per domain and one PIC per email, joining stored companies', () => {
	const stored = companyId('0b000000-0000-4000-8000-000000000001');
	const lead = { website: null, industry: null, job_title: null, phone: null };
	const plan = planLeads(
		[
			{
				...lead,
				company: 'Harbour',
				domain: 'harbour.test',
				full_name: 'Ana',
				email: 'ana@harbour.test'
			},
			{
				...lead,
				company: 'Harbour Pte',
				domain: 'harbour.test',
				full_name: 'Ben',
				email: 'ben@harbour.test'
			},
			{ ...lead, company: 'Dock', domain: 'dock.test', full_name: 'Cara', email: 'cara@dock.test' },
			{
				...lead,
				company: 'Dock',
				domain: 'dock.test',
				full_name: 'Cara again',
				email: 'cara@dock.test'
			},
			{ ...lead, company: 'Quay', domain: 'quay.test', full_name: 'Dee', email: 'dee@quay.test' }
		],
		{
			companies: [{ id: stored, company_key: 'quay', domain: 'quay.test' }],
			emails: new Set(['dee@quay.test'])
		},
		{ source: 'csv', owner: null }
	);
	expect(
		plan.companies.map((c) => [
			c.name,
			c.domain,
			c.contacts.map((p) => [p.full_name, p.is_primary])
		])
	).toEqual([
		[
			'Harbour',
			'harbour.test',
			[
				['Ana', true],
				['Ben', false]
			]
		],
		['Dock', 'dock.test', [['Cara', true]]]
	]);
	expect(plan.contacts).toEqual([]);
	expect(plan.skipped).toBe(2);
});

it.live('a company is one per domain however it is written, and a PIC one per email', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const first = yield* admin.act({
			'companies.create': [
				{
					name: 'Harbour',
					website: 'https://www.Harbour.test/',
					contacts: [{ full_name: 'Ana', email: 'Ana@Harbour.test', is_primary: true }]
				}
			]
		});
		expect(first.kind).toBe('committed');
		expect(
			pageOf(yield* admin.query({ companies: { fields: ['domain', 'stage'] } }), 'companies')
				.rows[0]
		).toMatchObject({ domain: 'harbour.test', stage: 'lead' });
		expect(
			yield* Effect.flip(
				admin.act({ 'companies.create': [{ name: 'Harbour again', domain: 'harbour.test' }] })
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* Effect.flip(
				admin.act({ 'contacts.create': [{ full_name: 'Ana twice', email: 'ana@harbour.test' }] })
			)
		).toMatchObject({ _tag: 'ActRefused' });
	}).pipe(Effect.scoped)
);

describe('companyKey', () => {
	it.each([
		['Harbour Pte. Ltd.', 'harbour'],
		['HARBOUR PRIVATE LIMITED', 'harbour'],
		['Harbour', 'harbour'],
		['A&B Co', 'a and b'],
		['Acme Sdn. Bhd.', 'acme'],
		['Ltd', 'ltd'],
		['Café Nordic AG', 'café nordic'],
		['港湾物流', '港湾物流']
	] as const)('%s → %s', (name, key) => {
		expect(companyKey(name)).toBe(key);
	});
});

it('plans one company for a name with and without its domain', () => {
	const lead = { website: null, industry: null, job_title: null, phone: null, email: null };
	const plan = planLeads(
		[
			{ ...lead, company: 'Harbour', domain: 'harbour.test', full_name: 'Ana' },
			{ ...lead, company: 'Harbour Pte. Ltd.', domain: null, full_name: 'Ben' }
		],
		{ companies: [], emails: new Set() },
		{ source: 'csv', owner: null }
	);
	expect(plan.companies.map((c) => [c.name, c.contacts.length])).toEqual([['Harbour', 2]]);
});

const sheet = {
	columns: ['Company', 'Website', 'Name', 'Email'],
	rows: [['HARBOUR PTE. LTD.', 'https://harbour.test', 'Ben Tan', 'ben@harbour.test']]
};
const convert = Layer.succeed(Convert, {
	targets: [],
	convert: () => Port.unavailable('convert'),
	ingest: () =>
		Effect.succeed({
			kind: 'data' as const,
			json: { sheets: [sheet] },
			images: [],
			meta: { stats: { pages: null, bytes: 1, cpuMs: 0, wallMs: 0 } }
		})
});

it.live('one company however it arrives: the form, a spreadsheet, Apollo and a second create', () =>
	Effect.gen(function* () {
		const t = yield* workspace({ ports: convert });
		const admin = yield* t.as(t.admin);
		const count = Effect.map(
			admin.query({ companies: { fields: ['name', 'company_key'] } }),
			(answer) => pageOf(answer, 'companies').rows
		);
		// the form (and the agent, through the same create)
		const created = yield* admin.act({ 'companies.create': [{ name: 'Harbour' }] });
		if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
		const harbour = recordOf(created.records, 'companies').id;
		// the database computes the key exactly as the importer plans with it
		expect(yield* count).toMatchObject([{ name: 'Harbour', company_key: companyKey('Harbour') }]);

		// a spreadsheet naming it differently joins it, adding its PIC
		const upload = yield* admin.upload('import_leads.$input.file', {
			name: 'leads.csv',
			mime: 'text/csv',
			bytes: new TextEncoder().encode('x')
		});
		if (upload.kind !== 'committed') throw new Error(JSON.stringify(upload));
		yield* admin.run('import_leads', { file: upload.output }, JobResult);
		yield* t.run_due();

		// Apollo naming it a third way joins it too
		const apollo = yield* admin.act({
			'sys_integration.create': [{ integration: 'apollo', name: 'Apollo' }]
		});
		if (apollo.kind !== 'committed') throw new Error(JSON.stringify(apollo));
		t.fakes.links.answer = () =>
			Effect.succeed({
				status: 200,
				body: {
					contacts: [
						{
							name: 'Cara Lim',
							email: 'cara@harbour.test',
							organization: { name: 'Harbour Private Limited', primary_domain: 'harbour.test' }
						}
					],
					pagination: { total_pages: 1 }
				}
			});
		yield* admin.run('import_leads', {}, JobResult);
		yield* t.run_due();
		expect((yield* runRows(t, 'import_leads')).map((run) => run.state)).toEqual([
			'succeeded',
			'succeeded'
		]);
		expect((yield* count).map((row) => row.name)).toEqual(['Harbour']);
		expect(
			pageOf(
				yield* admin.query({
					contacts: { output: 'crm', where: { company_id: { eq: harbour } }, fields: ['email'] }
				}),
				'contacts'
			)
				.rows.map((row) => row.email)
				.sort()
		).toEqual(['ben@harbour.test', 'cara@harbour.test']);

		// a person creating it again is told which record it is
		const refused = yield* Effect.flip(
			admin.act({ 'companies.create': [{ name: 'Harbour Pte Ltd' }] })
		);
		expect(refused).toMatchObject({ _tag: 'ActRefused' });
		expect(refused.message).toContain('Harbour');

		// researched once, on create, and never by a later edit
		const researched = (yield* runRows(t, 'research_lead')).length;
		expect(researched).toBe(1);
		const [row] = pageOf(
			yield* admin.query({
				companies: { where: { id: { eq: harbour } }, fields: ['revision'], limit: 1 }
			}),
			'companies'
		).rows;
		yield* admin.act({
			'companies.update': [
				{ target: { id: harbour, revision: Number(row?.['revision']) }, set: { notes: 'Edited' } }
			]
		});
		yield* t.run_due();
		expect((yield* runRows(t, 'research_lead')).length).toBe(researched);
	}).pipe(Effect.scoped)
);

it.live('two racing creates of one company leave one row', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const outcomes = yield* Effect.all(
			[
				admin.act({ 'companies.create': [{ name: 'Quay Pte Ltd', source: 'csv' }] }),
				admin.act({ 'companies.create': [{ name: 'QUAY', source: 'apollo' }] })
			].map(Effect.result),
			{ concurrency: 'unbounded' }
		);
		expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
		expect(
			pageOf(yield* admin.query({ companies: { fields: ['name'] } }), 'companies').rows
		).toHaveLength(1);
	}).pipe(Effect.scoped)
);
