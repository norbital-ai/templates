import { documentLayout, documentForPdf } from '../src/lib/document-layout.js';
/** Template filling edge cases use supplied templates and invented values, not shipped legal wording. */
import { expect, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import {
	documentValues,
	missing,
	render,
	termsKey,
	tidyTemplate,
	type ValuesData
} from '../src/lib/documents.js';
import { idOf } from './workspace.js';
import { Schema } from 'effect';

const contact = {
	id: Schema.decodeUnknownSync(idOf('contacts'))('0c000000-0000-4000-8000-000000000001'),
	revision: 1,
	full_name: 'Avery',
	job_title: 'Lead',
	email: 'avery@example.test',
	company_signatory: true,
	is_primary: true,
	seniority: 'owner',
	angle: 'Handover risk'
};
const data = (over: Partial<ValuesData['companies']['rows'][number]> = {}): ValuesData => ({
	companies: {
		rows: [
			{
				name: 'Example Client',
				uen: 'EX-1',
				address: null,
				website: 'example.test',
				industry: null,
				research: null,
				use_cases: ['Rosters', 'Payroll'],
				stage: 'lead',
				revision: 1,
				owner: {
					id: Schema.decodeUnknownSync(idOf('sys_user'))('0a000000-0000-4000-8000-000000000001'),
					name: 'Riley'
				},
				...over
			}
		]
	},
	contacts: { rows: [contact] },
	projects: { rows: [] },
	agreement_settings: {
		rows: [
			{
				provider_company: 'Provider Ltd',
				provider_uen: 'PR-1',
				provider_address: null,
				provider_signatory_name: 'Sam',
				provider_signatory_title: 'Director'
			}
		]
	}
});

it('fills every placeholder from the company, its PIC, its owner and the provider, with formatted dates', () => {
	const values = documentValues(data(), '2026-09-30', contact);
	expect(
		render(
			'{{company}} | {{uen}} | {{contact_name}} | {{pic_angle}} | {{owner_name}} | {{provider_company}} | {{provider_name}} | {{date}} | {{date_long}}',
			values
		)
	).toBe(
		'Example Client | EX-1 | Avery | Handover risk | Riley | Provider Ltd | Sam | 30/09/26 | 30 September 2026'
	);
	expect(values['use_cases']).toBe('- Rosters\n- Payroll');
});

it('keeps a missing value explicit and lists the required ones still missing', () => {
	const values = documentValues(data({ uen: null }), '2026-09-30', undefined);
	expect(render('{{company}} | {{uen}} | {{contact_name}} | {{unknown}}', values)).toBe(
		'Example Client | [uen] | [contact_name] | [unknown]'
	);
	expect(missing(['company', 'uen', 'contact_name'], values)).toEqual(['uen', 'contact_name']);
});

it('escapes pipe characters and flattens line breaks in a job’s scope tables', () => {
	const values = documentValues(
		{
			...data(),
			projects: {
				rows: [
					{
						name: 'Example job',
						company_id: null,
						signatory: null,
						definitions: [{ term: 'Key|Name', meaning: 'Line one\nline two', origin: 'manual' }]
					}
				]
			}
		},
		'2026-09-30',
		contact
	);
	const document = render('{{definitions}}', values);
	expect(document).toContain('**Key\\|Name**');
	expect(document).toContain('Line one line two');
});

it('a copy drifts when its values change, not when its date does', () => {
	const template: Id<'template_documents'> = Schema.decodeUnknownSync(idOf('template_documents'))(
		'0d000000-0000-4000-8000-000000000001'
	);
	const today = termsKey(template, documentValues(data(), '2026-10-01', contact));
	expect(termsKey(template, documentValues(data(), '2026-09-28', contact))).toBe(today);
	expect(termsKey(template, documentValues(data({ uen: 'EX-2' }), '2026-10-01', contact))).not.toBe(
		today
	);
});

it('normalizes pasted text while preserving its content', () => {
	expect(tidyTemplate('(1) \tFirst item\n\n(B) \tSecond item')).toBe(
		'(1) First item\n\n(B) Second item'
	);
	expect(tidyTemplate('1.\n\nFirst sentence.\n1.2 Next sentence.')).toBe(
		'1. First sentence.\n\n1.2 Next sentence.'
	);
	const wrapped =
		'This invented sentence has enough words to represent a wrapped line of ordinary text';
	expect(tidyTemplate(`${wrapped}\n\ncontinued here.`)).toBe(`${wrapped}\ncontinued here.`);
});

it('separates the standard agreement cover without dropping clauses or changing other documents', () => {
	const source =
		'C&A: {{date}}\n\n**{{provider_company}}**\n\n**{{company}}**\n\n# Non Disclosure Agreement\n\nThis agreement is entered between:\n\n1. The parties';
	expect(documentLayout(source)).toEqual({
		cover: {
			date: 'C&A: {{date}}',
			provider: '**{{provider_company}}**',
			company: '**{{company}}**',
			title: 'Non Disclosure Agreement'
		},
		body: 'This agreement is entered between:\n\n1. The parties',
		signatures: null
	});
	expect(documentLayout('# Custom agreement\n\nText')).toEqual({
		cover: null,
		body: '# Custom agreement\n\nText',
		signatures: null
	});
});

it('formats native PDF input without copying or dropping agreement clauses', () => {
	const body = 'Clause one\n\nClause two';
	const result = documentForPdf(
		'C&A: 1 October 2026\n\n**Provider**\n\n**Client**\n\n# NDA\n\n' + body
	);
	expect(result).toContain('#set page(paper: "a4", margin: 25.4mm)');
	expect(result).toContain('#pagebreak()');
	expect(result).toContain('text("Provider")');
	expect(result).toContain('size: 10pt');
	expect(result.endsWith(body)).toBe(true);
	expect(documentForPdf('# Custom\n\nText')).not.toContain('#pagebreak()');
});

const signatureTable = String.raw`| \_\_\_\_ | \_\_\_\_ |
| :---- | :---- |
| Name: Sam | Name: Avery |
| Title: Director | Title: Lead |
| For and on behalf of Provider Ltd | For and on behalf of Example \| Client |`;
const signatureSource =
	'Final clause.\n\nAgreed by the parties through their authorised signatories.\n\n' +
	signatureTable;

it('separates the two signature columns and keeps the attestation with them', () => {
	expect(documentLayout(signatureSource)).toMatchObject({
		body: 'Final clause.',
		signatures: {
			introduction: 'Agreed by the parties through their authorised signatories.',
			parties: [
				['Name: Sam', 'Title: Director', 'For and on behalf of Provider Ltd'],
				['Name: Avery', 'Title: Lead', 'For and on behalf of Example | Client']
			]
		}
	});
	// Ordinary data tables and incomplete signature sections retain their original content.
	const ordinary = '| Product | Price |\n| --- | --- |\n| Item | 20 |';
	expect(documentLayout(ordinary).body).toBe(ordinary);
	expect(documentLayout(signatureSource.replace('Title: Lead', 'Role: Lead')).body).toBe(
		signatureSource.replace('Title: Lead', 'Role: Lead')
	);
});

it('prints one unbroken, borderless signature section with an optional provider image', () => {
	const result = documentForPdf(signatureSource);
	expect(result).toContain('Final clause.');
	expect(result).toContain('#block(breakable: false)');
	expect(result).toContain('columns: (1fr, 1fr)');
	expect(result).toContain('For and on behalf of Example | Client');
	expect(result).not.toContain(signatureTable);
	expect(result).not.toContain('data:image/');
	expect(
		documentForPdf(signatureSource, { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
	).toContain('![](data:image/png;base64,AQID){height=22mm}');
	const hostile = signatureSource.replace('Sam', 'Sam "] #panic("injected")');
	expect(documentForPdf(hostile)).toContain('Sam \\"] #panic(\\"injected\\")');
});
