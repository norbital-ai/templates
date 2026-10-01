import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { boot, officeWeek, runCase, type Host, type ProbeCase } from './payroll-probe.ts';
import { collectPayslipPages } from '../../src/lib/ui/payslip-export-pages.js';
import { fileRefs } from './probe-oracle.ts';

const employer = 'Synthetic Công ty Nguyễn 株式会社東京 臺灣 北京 บริษัทไทย';
const employee = 'Synthetic Nguyễn Thị Đặng 山田太郎 陳美玲 张晓明 สมชาย ใจดี';
const number = 'UNICODE-EXPORT';
const probe: ProbeCase = {
	id: number,
	profile: 'SG',
	period: '2026-01',
	description:
		'Synthetic Singapore monthly employment with multilingual legal names; export the saved payslip through the production guest automation and persisted file transport.',
	citation: [
		'Unicode export fidelity: the employer and employee identity and settled monetary values must survive PDF serialization, persistence and independent parsing.'
	],
	company: { name: employer, facts: { sdl_individual_employer: false } },
	inputs: [
		...officeWeek('2025-06-02'),
		{
			collection: 'employees',
			ref: 'person',
			values: {
				name: employee,
				date_of_birth: '1990-01-01',
				gender: 'MALE',
				nationality: 'Singaporean',
				race: 'OTHER',
				religion: 'OTHER'
			}
		},
		{
			collection: 'employments',
			ref: 'job',
			values: {
				employee_id: '@person',
				company_id: '@company',
				employee_number: number,
				effective_range: { from: '2025-06-02', to: null }
			}
		},
		{
			collection: 'employment_terms',
			values: {
				employment_id: '@job',
				residency_status: 'CITIZEN',
				tax_residency: 'RESIDENT',
				currency: 'SGD',
				base_salary: 3000,
				pay_frequency: 'MONTHLY',
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				shift_pattern_id: '@week',
				effective_range: { from: '2025-06-02', to: null }
			}
		},
		{
			collection: 'employment_statutory_facts',
			values: {
				employee_id: '@person',
				employment_id: '@job',
				statutory_contribution_id: '@law:statutory_contributions:SDL',
				effective_range: { from: '2025-06-02', to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: 'Synthetic SDL registration',
					elections: {
						sdl_service_scope: 'SINGAPORE_SERVICE',
						sdl_household_role: 'NONE',
						sdl_wholly_exclusive: false,
						sdl_nonbusiness: false,
						sdl_student_class: 'NONE'
					}
				}
			}
		}
	],
	expected: [
		{
			employment: 'job',
			lines: {
				gross: 3000,
				net: 2400,
				'CPF.employee': 600,
				'CPF.employer': 510,
				'SDL.employer': 7.5
			}
		}
	]
};

let host: Host;
beforeAll(async () => {
	host = await boot();
}, 300_000);
afterAll(() => host?.close());

it('production Unicode payslip export persists a reader-valid PDF with original names and settled money', async () => {
	for (const result of await runCase(host, probe))
		expect(result.differences, result.employment).toEqual([]);
	const [company] = await host.read('companies', {
		where: { name: { eq: employer } },
		select: { id: true }
	});
	const [run] = await host.read('payroll_runs', {
		where: { company_id: { eq: String(company!.id) }, period: { eq: probe.period } },
		select: { id: true }
	});
	const output = await host.run('payroll_export', { ids: [String(run!.id)], kind: 'payslip-pdfs' });
	const refs = fileRefs(output.result ?? null);
	expect(refs).toHaveLength(1);
	expect(JSON.stringify(output.result)).toContain('"mime":"application/pdf"');
	expect(refs[0]!.name).toBe(`payslip_${probe.period}_${number}.pdf`);
	const bytes = await host.download(refs[0]!.id);
	expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
	const document = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
	const rows: string[] = [];
	for (let page = 1; page <= document.numPages; page++) {
		const content = await (
			await document.getPage(page)
		).getTextContent({ disableNormalization: true });
		let row = '';
		for (const item of content.items) {
			if (!('str' in item)) continue;
			row += item.str;
			if (item.hasEOL) {
				rows.push(row.replace(/\s+/g, ' ').trim());
				row = '';
			}
		}
		if (row) rows.push(row.replace(/\s+/g, ' ').trim());
	}
	await document.destroy();
	for (const wanted of [
		`Employer: ${employer}`,
		`Employee: ${employee} (${number})`,
		'Salary period: 2026-01-01 to 2026-01-31',
		'Gross 3,000.00',
		'Net pay 2,400.00 SGD'
	])
		expect(rows).toContain(wanted);
	const directory =
		process.env.UNICODE_EXPORT_OUT ??
		join(process.cwd(), '..', '..', '.tmp', 'hr-takeover', 'unicode-export');
	mkdirSync(directory, { recursive: true });
	const path = join(directory, refs[0]!.name);
	writeFileSync(path, bytes);
	writeFileSync(join(directory, 'extracted.txt'), `${rows.join('\n')}\n`);
	const render = spawnSync(
		'pdftoppm',
		['-scale-to', '1400', '-png', path, join(directory, 'payslip')],
		{ encoding: 'utf8' }
	);
	if (render.error == null) {
		expect(render.status, render.stderr).toBe(0);
		expect(render.stderr).not.toMatch(/Syntax (Error|Warning)|Couldn't create a font/);
	}
	writeFileSync(
		join(directory, 'evidence.json'),
		JSON.stringify(
			{
				runId: run!.id,
				file: refs[0],
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				rendered: render.error == null && render.status === 0,
				rendererError: render.error?.message ?? null
			},
			null,
			2
		)
	);
}, 120_000);

it('production export persists 89 Unicode payslips using independent render invocations', async () => {
	const people = probe.inputs.filter((row) =>
		['employees', 'employments', 'employment_terms', 'employment_statutory_facts'].includes(
			row.collection
		)
	);
	const suffixes = Array.from({ length: 89 }, (_, i) => String(i + 1).padStart(2, '0'));
	const batch: ProbeCase = {
		...probe,
		id: 'UNICODE-EXPORT-89',
		company: { ...probe.company, name: `${employer} batch89` },
		inputs: [
			...probe.inputs.filter((row) => !people.includes(row)),
			...suffixes.flatMap((suffix) =>
				people.map((row) => {
					const values = { ...row.values };
					for (const key of ['employee_id', 'employment_id']) {
						if (values[key] === '@person') values[key] = `@person${suffix}`;
						if (values[key] === '@job') values[key] = `@job${suffix}`;
					}
					if (row.collection === 'employees') values.name = `${employee} ${suffix}`;
					if (row.collection === 'employments') values.employee_number = `${number}-${suffix}`;
					return { ...row, ...(row.ref == null ? {} : { ref: `${row.ref}${suffix}` }), values };
				})
			)
		],
		expected: suffixes.map((suffix) => ({ ...probe.expected[0]!, employment: `job${suffix}` }))
	};
	for (const result of await runCase(host, batch))
		expect(result.differences, result.employment).toEqual([]);
	const [company] = await host.read('companies', {
		where: { name: { eq: batch.company!.name } },
		select: { id: true }
	});
	const [run] = await host.read('payroll_runs', {
		where: { company_id: { eq: String(company!.id) }, period: { eq: batch.period } },
		select: { id: true }
	});
	let pages = 0;
	const refs = await collectPayslipPages(async (payslip_offset) => {
		const output = await host.run('payroll_export', {
			ids: [String(run!.id)],
			kind: 'payslip-pdfs',
			payslip_offset
		});
		pages++;
		return output.result;
	});
	expect(pages).toBe(18);
	expect(refs).toHaveLength(89);
	expect(new Set(refs.map((ref) => ref.name)).size).toBe(89);
	const evidence = [];
	for (const ref of refs) {
		const bytes = await host.download(ref.id);
		expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
		const document = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
		const content = await (
			await document.getPage(1)
		).getTextContent({ disableNormalization: true });
		// PDF text items split by font/glyph; their own spaces carry the original text.
		const text = content.items
			.flatMap((item) => ('str' in item ? [item.str] : []))
			.join('')
			.replace(/\s+/g, ' ');
		const suffix = ref.name.match(/-(\d{2})\.pdf$/)![1];
		expect(text).toContain(`${employee} ${suffix}`);
		expect(text).toContain(employer);
		expect(text).toMatch(/Gross\s+3,000\.00/);
		expect(text).toMatch(/Net\s+pay\s+2,400\.00\s+SGD/);
		await document.destroy();
		evidence.push({
			name: ref.name,
			id: ref.id,
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
	}
	const directory =
		process.env.UNICODE_EXPORT_OUT ??
		join(process.cwd(), '..', '..', '.tmp', 'hr-takeover', 'unicode-export');
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, 'batch-89-evidence.json'),
		JSON.stringify({ runId: run!.id, count: evidence.length, pages, files: evidence }, null, 2)
	);
}, 300_000);
