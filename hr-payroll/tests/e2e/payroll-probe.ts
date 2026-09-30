/**
 * The production-path payroll probe: a registry of hand-computed, cited payslip cases run against the real host.
 *
 * The host is bolt-server's `start()` — the `bolt start` a deployed tenant runs — over the built artifact
 * (`.norbital/artifact`, from `bolt build`), an embedded PGlite seeded with the template's public `base` pack (the
 * law), and the founder signed in with the emailed code. Every row goes through `POST /__bolt/act` (the transforms,
 * hooks and refusals apply), the run is the Payroll app's own `payroll_runs.create`, and the answer is the SAVED
 * payslips read back through `POST /__bolt/q`. Nothing is written to the database directly.
 *
 * A case (register it in `tests/e2e/probes/<profile>.ts`):
 *
 *   {
 *     id: 'my-foreign-worker-flat',           // unique; also the company's name
 *     profile: 'MY',                          // the settings lineage: the company's `settings_code`
 *     description: 'what it proves',
 *     citation: ['primary source, section, URL', ...],  // where every expected figure comes from
 *     company: { pay_cutoff_day: 1 },         // optional overrides of the company the harness creates
 *     inputs: [                               // rows created in order, each `<collection>.create` through /act
 *       { collection: 'employees', ref: 'amir', values: { name: 'Amir', ... } },
 *       { collection: 'employments', ref: 'amir_job', values: { employee_id: '@amir', company_id: '@company', ... } },
 *     ],
 *     period: '2026-02',                      // the run's period, as the Payroll app names it
 *     expected: [                             // one per payslip the case pins, by the employment's ref
 *       { employment: 'amir_job', lines: { gross: 3000, net: 2040, BASIC: 3000, 'PCB.employee': 900 } },
 *     ],
 *   }
 *
 * Values are the collection's own fields. A string `'@<ref>'` is the id of the row an earlier input created with
 * that `ref` (`'@company'` is the case's company); `'@law:<collection>:<code>'` is the id of that law row (a scheme
 * or catalogue entry by `code`) in the lineage's sealed, unvoided settings version in force on the period's first day
 * (`'@law:<collection>:<code>@<YYYY-MM-DD>'`: on that day instead).
 *
 * Line keys: `gross`, `net`, `total_deductions`, `employer_cost`; a base or adjustment `component_code` (amounts
 * summed per code); `<scheme_code>.employee` and `<scheme_code>.employer` for each statutory charge. Every expected
 * key must match to the cent, and a non-zero statutory amount the case does not list is a failure too: the case
 * names every scheme that charges.
 *
 * Beyond payslips (each optional):
 *   - an input's `files: { certificate_file: 'order.pdf' }` uploads a fixture document through
 *     `PUT /__bolt/files/<collection>.<field>` and sets that field to the stored FileRef;
 *   - an input's `refused: '<pattern>'` expects that create to be refused, the pattern (a RegExp source) matching
 *     `<code> <rule> <message>` of the outcome; the case goes on without the row;
 *   - `refused` on the case expects `payroll_runs.create` itself refused (then `expected` is `[]`);
 *   - `warnings: ['<pattern>', …]` pins the run's warnings: each pattern matches a line of the saved run's
 *     `warnings`, and every line is matched by one;
 *   - `company` expectations are `companyLines`: the run's COMPANY-assessed charges (`company_charges`), keyed and
 *     judged as payslip statutory keys (a non-zero charge the case does not list fails).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type RunningServer } from '@norbital-ai/bolt-server';

type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };
export type Row = { readonly [field: string]: Json };
export type ProbeInput = {
	collection: string;
	ref?: string;
	values: Row;
	/** field → fixture file name, uploaded and set as the field's FileRef */
	files?: { readonly [field: string]: string };
	/** RegExp source the refusal must match; the create must be refused */
	refused?: string;
};
export type ProbeExpectation = { employment: string; lines: { readonly [key: string]: number } };
export type ProbeCase = {
	id: string;
	profile: string;
	description: string;
	citation: readonly string[];
	company?: Row;
	inputs: readonly ProbeInput[];
	period: string;
	expected: readonly ProbeExpectation[];
	/** RegExp source: the run itself must be refused with a matching outcome */
	refused?: string;
	/** RegExp sources, one per warning line the run must save (and no other) */
	warnings?: readonly string[];
	/** The run's COMPANY-assessed charges, `<scheme>.employee` / `<scheme>.employer` */
	companyLines?: { readonly [key: string]: number };
};

export const PROFILES = [
	'MY',
	'ID',
	'TH',
	'PH',
	'SG',
	'CN-shanghai',
	'CN-kunming',
	'TW',
	'VN',
	'JP'
] as const;
export const cases: ProbeCase[] = [];
export const register = (...add: ProbeCase[]) => void cases.push(...add);

/** A Monday-anchored 5 × office, off, rest week for the case's company (the cycle anchors at the pattern's start). */
export const officeWeek = (from: string): ProbeInput[] => [
	{
		collection: 'shift_definitions',
		ref: 'office',
		values: {
			company_id: '@company',
			code: 'OFFICE',
			name: 'Office day (0900 to 1800)',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'off',
		values: {
			company_id: '@company',
			code: 'OFF',
			name: 'Off day',
			variant: { kind: 'OFF' },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'rest',
		values: {
			company_id: '@company',
			code: 'REST',
			name: 'Rest day',
			variant: { kind: 'REST' },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_patterns',
		ref: 'week',
		values: {
			company_id: '@company',
			code: 'OFFICEx5-OFF-REST',
			name: '5 x OFFICE, OFF, REST',
			pattern: {
				days: ['@office', '@office', '@office', '@office', '@office', '@off', '@rest'].map(
					(roster_code_id) => ({
						roster_code_id
					})
				)
			},
			effective_range: { from, to: null }
		}
	}
];

const FOUNDER = 'probe@example.test';

/** The built artifact on a fresh PGlite with the public `base` pack, and the founder's session cookie. */
export async function boot(root = process.cwd()) {
	const scratch = mkdtempSync(join(tmpdir(), 'norbital-payroll-probe-'));
	cpSync(join(root, '.norbital', 'artifact'), join(scratch, 'artifact'), { recursive: true });
	mkdirSync(join(scratch, 'files'));
	const mail: { to: readonly string[]; text?: string; html?: string }[] = [];
	const server: RunningServer = await start(
		{
			artifact: join(scratch, 'artifact'),
			host: '127.0.0.1',
			port: 0,
			database: { pglite: join(scratch, 'db') },
			publicUrl: 'http://localhost:3100',
			files: { provider: 'local', root: join(scratch, 'files') },
			masterKey: randomBytes(32),
			opsKey: null,
			mail: null,
			sms: null,
			providers: {},
			ai: { sys1: null, sys2: {}, embed: {}, modalities: { sys2: null, embed: null } },
			vapid: null,
			turnstile: null,
			telemetryRetainHours: 72,
			environment: 'probe',
			trustProxy: [],
			accept: true,
			founder: FOUNDER,
			seed: join(root, '.norbital', 'seed', 'base'),
			dev: false
		},
		{
			mail: async (m) => {
				mail.push(m as (typeof mail)[number]);
				return `probe-${mail.length}`;
			},
			log: () => {}
		}
	);
	let cookie = '';
	const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
		const response = await fetch(`${server.url}${path}`, {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body)
		});
		return { response, body: (await response.json()) as Json };
	};
	await post('/__bolt/session/code', { address: FOUNDER });
	const code = /\b(\d{6})\b/.exec(mail.at(-1)?.text ?? mail.at(-1)?.html ?? '')?.[1];
	if (code === undefined) throw new Error('no sign-in code was mailed to the founder');
	const verified = await post('/__bolt/session/verify', { address: FOUNDER, code });
	cookie = verified.response.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	if (!cookie.includes('nb_s='))
		throw new Error(`sign-in refused: ${JSON.stringify(verified.body)}`);

	/** One `/act`: its outcome, whatever it is. */
	const attempt = async (callable: string, input: Row) => {
		const { body } = await post(
			'/__bolt/act',
			{ callable, input, issuedAt: new Date().toISOString() },
			{ 'Idempotency-Key': randomUUID() }
		);
		return { body, outcome: (body as { outcome?: Outcome }).outcome };
	};
	/** One `/act`: the committed records, or the outcome as the error. */
	const act = async (callable: string, input: Row) => {
		const { body, outcome } = await attempt(callable, input);
		if (outcome?.kind !== 'committed')
			throw new Error(`${callable} was not committed: ${JSON.stringify(body)}`);
		return outcome.records ?? [];
	};
	/** A fixture document uploaded to `<collection>.<field>`: the FileRef the field stores. */
	const upload = async (collection: string, field: string, name: string) => {
		const response = await fetch(`${server.url}/__bolt/files/${collection}.${field}`, {
			method: 'PUT',
			headers: {
				cookie,
				'content-type': 'application/pdf',
				'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
				'Idempotency-Key': randomUUID()
			},
			body: `%PDF-1.4\n% payroll probe fixture: ${name}\n%%EOF\n`
		});
		const body = (await response.json()) as Json;
		if (!response.ok || typeof body !== 'object' || body === null || 'error' in body)
			throw new Error(`upload to ${collection}.${field} refused: ${JSON.stringify(body)}`);
		return body;
	};
	/** One `/q` read of a collection, every page. */
	const read = async (collection: string, query: Row) => {
		const { body } = await post('/__bolt/q', {
			reads: [{ m: 'read', a: [collection, { ...query, all: true }] }]
		});
		const answer = (body as { answers?: { rows?: Row[] }[] }).answers?.[0];
		if (answer?.rows === undefined)
			throw new Error(`read ${collection} failed: ${JSON.stringify(body)}`);
		return answer.rows.map(plain) as Row[];
	};
	const close = async () => {
		await server.close();
		rmSync(scratch, { recursive: true, force: true });
	};
	return { act, attempt, upload, read, close };
}
type Outcome = { kind: string; code?: string; rule?: string; message?: string; records?: Row[] };
/** A refusal as the text a case's pattern reads: `<code> <rule> <message>`. */
const refusalText = (o: Outcome | undefined) =>
	o?.kind === 'committed'
		? null
		: `${o?.code ?? o?.kind ?? ''} ${o?.rule ?? ''} ${o?.message ?? ''}`;
export type Host = Awaited<ReturnType<typeof boot>>;

/** The wire's tagged scalars untagged: `{ $dec }` a number, `{ $d }` a date and `{ $t }` an instant as their strings. */
function plain(v: Json): Json {
	if (typeof v !== 'object' || v === null) return v;
	if (Array.isArray(v)) return (v as readonly Json[]).map(plain);
	const entries = Object.entries(v as { readonly [k: string]: Json });
	const [tag, value] = entries[0] ?? [];
	if (entries.length === 1 && tag!.startsWith('$') && typeof value === 'string')
		return tag === '$dec' ? Number(value) : value;
	return Object.fromEntries(entries.map(([k, x]) => [k, plain(x)]));
}
const amount = (v: Json | undefined): number => Number(v ?? 0);

/** A saved payslip as the case's line keys. */
export function lines(slip: Row): Record<string, number> {
	const out: Record<string, number> = {};
	for (const key of ['gross', 'net', 'total_deductions', 'employer_cost'])
		out[key] = amount(slip[key]);
	for (const part of ['base', 'adjustments'])
		for (const line of (slip[part] ?? []) as Row[]) {
			const code = String(line.component_code);
			out[code] = Math.round(((out[code] ?? 0) + amount(line.amount)) * 100) / 100;
		}
	for (const charge of (slip.statutory ?? []) as Row[]) {
		out[`${charge.scheme_code}.employee`] = amount(charge.employee_amount);
		out[`${charge.scheme_code}.employer`] = amount(charge.employer_amount);
	}
	return out;
}

/** Every difference between what the case expects and the saved slip; `[]` is a pass. */
export function differences(expected: ProbeExpectation['lines'], actual: Record<string, number>) {
	const out: string[] = [];
	for (const [key, want] of Object.entries(expected))
		if (actual[key] === undefined || Math.abs(actual[key] - want) >= 0.005)
			out.push(`${key}: expected ${want}, saved ${actual[key] ?? 'nothing'}`);
	for (const [key, got] of Object.entries(actual))
		if (/\.(employee|employer)$/.test(key) && Math.abs(got) >= 0.005 && !(key in expected))
			out.push(`${key}: saved ${got}, which the case does not expect`);
	return out;
}

/** Create the case's company and rows, run its period through `payroll_runs.create`, read the saved payslips. */
export async function runCase(host: Host, probe: ProbeCase) {
	const first = `${probe.period.slice(0, 7)}-01`;
	const versions = await host.read('jurisdiction_settings', {
		where: { code: { eq: probe.profile } }
	});
	const versionOn = (day: string) => {
		const version = versions.find((row) => {
			const range = row.effective_range as { from: string; to: string | null };
			return (
				row.sealed_at != null &&
				row.voided_at == null &&
				range.from <= day &&
				(range.to == null || day <= range.to)
			);
		});
		if (version === undefined)
			throw new Error(
				`${probe.id}: no sealed ${probe.profile} settings in force on ${day}: ${JSON.stringify(versions.slice(0, 2))}`
			);
		return version;
	};
	versionOn(first);
	const ids = new Map<string, string>();
	const law = async (collection: string, code: string, day = first) => {
		const [row] = await host.read(collection, {
			where: { settings_id: { eq: versionOn(day).id as string }, code: { eq: code } }
		});
		if (row === undefined)
			throw new Error(`${probe.id}: ${probe.profile} has no ${collection} ${code} on ${day}`);
		return row.id as string;
	};
	const resolve = async (v: Json): Promise<Json> => {
		if (typeof v === 'string' && v.startsWith('@law:')) {
			const [, collection, named] = v.split(':');
			const [code, day] = named!.split('@');
			return law(collection!, code!, day);
		}
		if (typeof v === 'string' && v.startsWith('@')) {
			const id = ids.get(v.slice(1));
			if (id === undefined) throw new Error(`${probe.id}: ${v} names no earlier input`);
			return id;
		}
		if (Array.isArray(v)) return Promise.all(v.map(resolve));
		if (typeof v === 'object' && v !== null)
			return Object.fromEntries(
				await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await resolve(x)]))
			);
		return v;
	};
	const create = async (collection: string, values: Row, ref?: string) => {
		const records = await host.act(`${collection}.create`, (await resolve(values)) as Row);
		const row = records.find((r) => r.collection === collection);
		if (ref !== undefined) ids.set(ref, row!.id as string);
	};
	const results: { employment: string; actual: unknown; differences: string[] }[] = [];
	await create(
		'companies',
		{
			settings_code: probe.profile,
			name: `${probe.id} ${randomUUID().slice(0, 8)}`,
			pay_cutoff_day: 1,
			pay_frequency: 'MONTHLY',
			effective_range: { from: '2020-01-01', to: null },
			...probe.company
		},
		'company'
	);
	for (const [n, input] of probe.inputs.entries()) {
		const values: Record<string, Json> = { ...input.values };
		for (const [field, name] of Object.entries(input.files ?? {}))
			values[field] = await host.upload(input.collection, field, name);
		if (input.refused === undefined) {
			await create(input.collection, values, input.ref);
			continue;
		}
		const { outcome } = await host.attempt(
			`${input.collection}.create`,
			(await resolve(values)) as Row
		);
		const text = refusalText(outcome);
		results.push({
			employment: `input ${n} (${input.collection})`,
			actual: outcome,
			differences:
				text !== null && new RegExp(input.refused).test(text)
					? []
					: [`expected a refusal matching /${input.refused}/, got ${text ?? 'a commit'}`]
		});
	}
	const runInput = { company_id: ids.get('company')!, period: probe.period };
	if (probe.refused !== undefined) {
		const { outcome } = await host.attempt('payroll_runs.create', runInput);
		const text = refusalText(outcome);
		results.push({
			employment: 'run',
			actual: outcome,
			differences:
				text !== null && new RegExp(probe.refused).test(text)
					? []
					: [`expected the run refused matching /${probe.refused}/, got ${text ?? 'a commit'}`]
		});
		return results;
	}
	const run = await host.act('payroll_runs.create', runInput);
	const runId = run.find((r) => r.collection === 'payroll_runs')!.id as string;
	if (probe.warnings !== undefined || probe.companyLines !== undefined) {
		const [saved] = await host.read('payroll_runs', {
			where: { id: { eq: runId } },
			select: { warnings: true, company_charges: true }
		});
		if (probe.warnings !== undefined) {
			const saw = String(saved?.warnings ?? '')
				.split('\n')
				.filter((line) => line.trim() !== '');
			const patterns = probe.warnings.map((p) => new RegExp(p));
			results.push({
				employment: 'warnings',
				actual: saw,
				differences: [
					...patterns
						.filter((p) => !saw.some((line) => p.test(line)))
						.map((p) => `no warning matches /${p.source}/`),
					...saw
						.filter((line) => !patterns.some((p) => p.test(line)))
						.map((line) => `unexpected warning: ${line}`)
				]
			});
		}
		if (probe.companyLines !== undefined) {
			const actual = lines({ statutory: saved?.company_charges ?? [] });
			const charges = Object.fromEntries(
				Object.entries(actual).filter(([key]) => /\.(employee|employer)$/.test(key))
			);
			results.push({
				employment: 'company',
				actual: charges,
				differences: differences(probe.companyLines, charges)
			});
		}
	}
	const slips = await host.read('payslips', {
		where: { payroll_run_id: { eq: runId } },
		select: Object.fromEntries(
			[
				'employment_id',
				'gross',
				'net',
				'total_deductions',
				'employer_cost',
				'base',
				'adjustments',
				'statutory'
			].map((f) => [f, true])
		)
	});
	return [
		...results,
		...probe.expected.map((expectation) => {
			const employment = ids.get(expectation.employment);
			const slip = slips.find((s) => s.employment_id === employment);
			if (slip === undefined)
				throw new Error(`${probe.id}: no saved payslip for ${expectation.employment}`);
			const actual = lines(slip);
			return {
				employment: expectation.employment,
				actual,
				differences: differences(expectation.lines, actual)
			};
		})
	];
}
