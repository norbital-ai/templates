/**
 * The differential probe: every synthetic scenario of `tests/e2e/profiles/<profile>.ts` run through the production
 * path (the built artifact under bolt-server's `start()`, `/__bolt/act` writes, the Payroll app's
 * `payroll_runs.create`, the saved payslips — `boot()` / `runCase()` of `payroll-probe.ts`), every saved line judged
 * against that profile's independent oracle (`tests/e2e/oracle/<profile>.ts` `computePayslip`).
 *
 * Shape. A profile's adapter maps one scenario onto probe inputs: `shared` rows (roster, holidays, worksites) and the
 * company override belong to the company, `inputs` to the person (local refs, prefixed per scenario in a batch).
 * Scenarios with the same company, shared rows and run list share one company; a batch of up to `DIFF_BATCH` of them
 * is one `runCase` (one company, every employee, each period of `runs` in order, the last judged). A batch whose
 * writes or run are refused is split in halves until the refusing scenario stands alone. A scenario the oracle
 * refuses runs alone; one whose law reads the company's headcount runs in a company padded to that headcount.
 *
 * A scenario field with no production-path precedent in `tests/e2e/probes/<profile>.ts` (or a collection shape no
 * probe writes) is not guessed: the adapter throws `Unmapped` and the scenario is reported as unmapped, not judged.
 *
 * Judgement, to 0.01 (a missing key is 0): the totals and every statutory key either side carries, and each
 * component code both sides name (oracles name some components differently, e.g. SALARY for BASIC; the totals carry
 * that money). The oracle's own unpriced keys are skipped. Company-assessed charges and run warnings are not judged.
 *
 * Where a separation request needs the payment's presence (a catalogue refuses a payment that is not owed), the
 * adapter raises it at 0 (priced by the catalogue formula) exactly when the oracle prices it, and an exit leave
 * encashment carries the oracle's day count: the engine values those days, it does not choose them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	officeWeek,
	runCase,
	type Host,
	type ProbeCase,
	type ProbeInput,
	type Row
} from './payroll-probe.ts';
import * as sgOracle from './oracle/SG.ts';
import { generateProfiles as sgScenarios } from './profiles/SG.ts';
import * as thOracle from './oracle/TH.ts';
import { generateProfiles as thScenarios } from './profiles/TH.ts';
import * as twOracle from './oracle/TW.ts';
import { generateProfiles as twScenarios } from './profiles/TW.ts';
import * as vnOracle from './oracle/VN.ts';
import { generateProfiles as vnScenarios } from './profiles/VN.ts';
import * as myOracle from './oracle/MY.ts';
import { generateProfiles as myScenarios, type Scenario as MyScenario } from './profiles/MY.ts';
import * as phOracle from './oracle/PH.ts';
import { generateProfiles as phScenarios, type PHScenario } from './profiles/PH.ts';
import * as jpOracle from './oracle/JP.ts';
import { generateProfiles as jpScenarios } from './profiles/JP.ts';
import * as idOracle from './oracle/ID.ts';
import { generateProfiles as idScenarios } from './profiles/ID.ts';
import * as shOracle from './oracle/CN-shanghai.ts';
import {
	generateProfiles as shScenarios,
	type Scenario as ShScenario
} from './profiles/CN-shanghai.ts';
import * as kmOracle from './oracle/CN-kunming.ts';
import {
	generateProfiles as kmScenarios,
	type Scenario as KmScenario
} from './profiles/CN-kunming.ts';

type Json = Row[string];

export class Unmapped extends Error {}
/** The scenario carries a branch this adapter cannot express on the production path. */
export function unmapped(what: string): never {
	throw new Unmapped(what);
}

/** One scenario as probe inputs. */
export type Mapped = {
	/** company overrides (facts, region …) */
	company?: Row;
	/** company-level rows: the roster, published holidays, worksites; refs here are not prefixed */
	shared?: readonly ProbeInput[];
	/** the person's rows, local refs */
	inputs: readonly ProbeInput[];
	/** local ref of the employment whose slip is judged */
	employment: string;
	/** every period run, in order; the last is judged */
	runs: readonly string[];
	/** the company's headcount the law reads: batches are capped at it and padded with `filler` people to it */
	headcount?: number;
	/** one filler person's rows (local refs), active through the judged period */
	filler?: readonly ProbeInput[];
};
/** What the oracle says the judged slip is. */
export type Verdict = {
	lines: Record<string, number>;
	/** the law refuses the slip as described (a refused write or run) */
	refused: string | null;
	/** keys the oracle declines to price */
	unjudged: readonly string[];
};
type Tagged = { id: string; rows: readonly string[]; branches: readonly string[] };
type Entry = { tags: Tagged; map: () => Mapped; verdict: () => Verdict };
export type Profile = { code: string; entries: () => Entry[] };

export const profile = <S extends Tagged>(
	code: string,
	generate: () => S[],
	map: (s: S) => Mapped,
	verdict: (s: S) => Verdict
): Profile => ({
	code,
	entries: () => generate().map((s) => ({ tags: s, map: () => map(s), verdict: () => verdict(s) }))
});

// ---------------------------------------------------------------------------------------------------------------
// Oracle lines
// ---------------------------------------------------------------------------------------------------------------

type OracleLine = { amount?: number; employee?: number; employer?: number };
/** An oracle's `lines` (flat numbers, or `{ amount | employee | employer }` per code) as probe keys. */
export function flatLines(lines: Record<string, number | OracleLine>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [key, v] of Object.entries(lines)) {
		if (typeof v === 'number') out[key] = v;
		else {
			if (v.amount !== undefined) out[key] = v.amount;
			if (v.employee !== undefined) out[`${key}.employee`] = v.employee;
			if (v.employer !== undefined) out[`${key}.employer`] = v.employer;
		}
	}
	return out;
}
const reason = (r: unknown): string | null =>
	r == null || r === false
		? null
		: typeof r === 'string'
			? r
			: typeof r === 'object' && 'reason' in r
				? String(r.reason)
				: JSON.stringify(r);

/** The generic verdict of an oracle result: `refused` (a string or `{ reason }`), `lines` via `probe` or flattened. */
export const verdictOf = (
	result: { refused?: unknown; lines?: unknown },
	probe?: Record<string, number>,
	unjudged: readonly string[] = []
): Verdict => ({
	lines: probe ?? flatLines((result.lines ?? {}) as Record<string, number | OracleLine>),
	refused: reason(result.refused),
	// a code the oracle leaves unpriced leaves its statutory shares unpriced too
	unjudged: unjudged.flatMap((k) => [k, `${k}.employee`, `${k}.employer`])
});

// ---------------------------------------------------------------------------------------------------------------
// Input helpers shared by the adapters
// ---------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;
export const addDays = (d: string, n: number) =>
	new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const monthDays = (period: string) => {
	const out: string[] = [];
	for (let d = `${period}-01`; d.startsWith(period); d = addDays(d, 1)) out.push(d);
	return out;
};
export const lastDay = (period: string) => monthDays(period).at(-1)!;
export const periodsFrom = (from: string, to: string) => {
	const out: string[] = [];
	for (let p = from; p <= to; p = addDays(`${lastDay(p)}`, 1).slice(0, 7)) out.push(p);
	return out;
};
/** The office week (Mon–Fri 09:00–18:00, one hour's break, Sat off, Sun rest) is anchored on this Monday. */
export const ANCHOR = '2000-01-03';
export const COMPANY_FROM = '2000-01-01';

/** `hours` of work from `start` (HH:MM) with the 13:00–14:00 break once it is crossed, as `[from, to]` clock pairs. */
export function clock(hours: number, start = '09:00'): [string, string][] {
	const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
	const hhmm = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
	const s = toMin(start);
	const end = s + Math.round(hours * 60);
	if (s >= 13 * 60 || end <= 13 * 60) return [[hhmm(s), hhmm(end)]];
	return [
		[hhmm(s), '13:00'],
		['14:00', hhmm(end + 60)]
	];
}
/** A work day of `job` at offset `tz`: the clock pairs, plus any extra fields. */
export const workDay = (
	job: string,
	date: string,
	pairs: readonly (readonly [string, string])[],
	tz: string,
	extra: Row = {}
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${job}`,
		work_date: date,
		worked_intervals: pairs.map(([start, end]) => ({
			start: `${date}T${start}:00${tz}`,
			end: `${date}T${end}:00${tz}`
		})),
		...extra
	}
});
export const holidayRow = (
	date: string,
	name = 'Public holiday',
	kind = 'PUBLIC_HOLIDAY'
): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind,
		source: 'differential probe',
		published_at: '2024-01-01T00:00:00.000Z'
	}
});
export const adhocRow = (
	job: string,
	code: string,
	amount: number,
	date: string,
	reason: string,
	extra: Partial<ProbeInput> = {}
): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${job}`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		pay_period: date.slice(0, 7),
		reason,
		as_adjustment_entry: false
	},
	...extra
});
export const leaveRow = (
	job: string,
	code: string,
	from: string,
	to: string,
	extra: Row = {},
	files?: Record<string, string>
): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${job}`,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `DIFF-${code}-${from}`,
		from_date: from,
		to_date: to,
		reason: code.toLowerCase().replaceAll('_', ' '),
		...extra
	},
	...(files === undefined ? {} : { files })
});
export const registration = (
	person: string,
	job: string,
	scheme: string,
	from: string,
	status: Row
): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${person}`,
		employment_id: `@${job}`,
		statutory_contribution_id: `@law:statutory_contributions:${scheme}`,
		effective_range: { from, to: null },
		status
	}
});
/**
 * Sorted dates as inclusive ranges, joined across days `skip` accepts (weekends, holidays), never across a month end:
 * a time-off entry settles in the period holding all its days (tests/e2e/probes/MY.ts maternity entries).
 */
export function ranges(dates: readonly string[], skip: (d: string) => boolean = () => false) {
	const out: [string, string][] = [];
	for (const d of [...dates].sort()) {
		const last = out.at(-1);
		let gap = last === undefined ? null : addDays(last[1], 1);
		while (gap !== null && gap < d && skip(gap)) gap = addDays(gap, 1);
		if (last !== undefined && gap === d && d.slice(0, 7) === last[0].slice(0, 7)) last[1] = d;
		else out.push([d, d]);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Batching and judgement
// ---------------------------------------------------------------------------------------------------------------

/** Every local ref of `inputs` renamed `<p><ref>`, and every employment given a unique employee number. */
export function prefixInputs(inputs: readonly ProbeInput[], p: string): ProbeInput[] {
	const local = new Set(inputs.flatMap((i) => (i.ref === undefined ? [] : [i.ref])));
	const rename = (v: Json): Json => {
		if (typeof v === 'string' && v.startsWith('@') && local.has(v.slice(1)))
			return `@${p}${v.slice(1)}`;
		if (Array.isArray(v)) return (v as readonly Json[]).map(rename);
		if (typeof v === 'object' && v !== null)
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rename(x)]));
		return v;
	};
	return inputs.map((input) => {
		const values = rename(input.values) as Row;
		return {
			...input,
			...(input.ref === undefined ? {} : { ref: `${p}${input.ref}` }),
			...(input.target === undefined ? {} : { target: rename(input.target) as string }),
			values:
				input.collection === 'employments' && input.target === undefined
					? { ...values, employee_number: `${p}${String(values.employee_number ?? 'E')}` }
					: values
		};
	});
}

export type Disagreement = {
	scenario: string;
	rows: readonly string[];
	branches: readonly string[];
	line: string;
	engine: number | string;
	oracle: number | string;
};
const TOTALS = ['gross', 'net', 'total_deductions', 'employer_cost'];

/** Every line where the saved slip and the oracle differ by more than 0.01; `[]` agrees. */
export function judge(
	tags: Tagged,
	verdict: Verdict,
	saved: { lines: Record<string, number> } | { refused: string }
): Disagreement[] {
	const at = (line: string, engine: number | string, oracle: number | string): Disagreement => ({
		scenario: tags.id,
		rows: tags.rows,
		branches: tags.branches,
		line,
		engine,
		oracle
	});
	if (verdict.refused !== null)
		return 'refused' in saved ? [] : [at('run', 'paid', `refused: ${verdict.refused}`)];
	if ('refused' in saved) return [at('run', `refused: ${saved.refused}`, 'paid')];
	const skip = new Set(verdict.unjudged);
	const statutory = (k: string) => /\.(employee|employer)$/.test(k);
	const keys = new Set([
		...Object.keys(verdict.lines),
		...Object.keys(saved.lines).filter(statutory)
	]);
	const out: Disagreement[] = [];
	for (const key of [...keys].sort()) {
		// totals and statutory charges always; a component only where both sides name its code (an oracle's
		// SALARY is the engine's BASIC net of deductions or not: the totals carry the money either way)
		const judged = TOTALS.includes(key) || statutory(key) || key in saved.lines;
		if (skip.has(key) || !judged) continue;
		// a slip's employer_cost is what the employer pays on top of gross; the oracles state the whole cost
		const engine =
			key === 'employer_cost'
				? (saved.lines.employer_cost ?? 0) + (saved.lines.gross ?? 0)
				: (saved.lines[key] ?? 0);
		const oracle = verdict.lines[key] ?? 0;
		if (Math.abs(engine - oracle) > 0.01 + 1e-9) out.push(at(key, engine, oracle));
	}
	return out;
}

type Job = { tags: Tagged; mapped: Mapped; verdict: Verdict };
type Outcome = { job: Job; disagreements: Disagreement[] };

/** One batch as one company: its rows, every run, the judged slips; a refused batch is split in halves. */
async function runBatch(
	host: Host,
	code: string,
	jobs: readonly Job[],
	n: string
): Promise<Outcome[]> {
	const head = jobs[0]!.mapped;
	const probe: ProbeCase = {
		id: `diff-${code}-${n}`,
		profile: code,
		description: `differential batch ${n}`,
		citation: [],
		company: { effective_range: { from: COMPANY_FROM, to: null }, ...head.company },
		inputs: [
			...(head.shared ?? []),
			...jobs.flatMap((job, k) => prefixInputs(job.mapped.inputs, `s${k}_`)),
			...Array.from({ length: Math.max(0, (head.headcount ?? 0) - jobs.length) }, (_, k) =>
				prefixInputs(head.filler ?? [], `f${k}_`)
			).flat()
		],
		history: head.runs.slice(0, -1).map((period) => ({ period })),
		period: head.runs.at(-1)!,
		expected: jobs.map((job, k) => ({ employment: `s${k}_${job.mapped.employment}`, lines: {} })),
		// a refusal the oracle expects is attempted, not thrown (runs alone, see `groups`)
		...(jobs.length === 1 && jobs[0]!.verdict.refused !== null ? { refused: '' } : {})
	};
	let results: Awaited<ReturnType<typeof runCase>>;
	try {
		results = await runCase(host, probe);
	} catch (error) {
		if (jobs.length > 1) {
			const half = Math.ceil(jobs.length / 2);
			return [
				...(await runBatch(host, code, jobs.slice(0, half), `${n}a`)),
				...(await runBatch(host, code, jobs.slice(half), `${n}b`))
			];
		}
		const text = error instanceof Error ? error.message : String(error);
		return [
			{ job: jobs[0]!, disagreements: judge(jobs[0]!.tags, jobs[0]!.verdict, { refused: text }) }
		];
	}
	return jobs.map((job, k) => {
		if (probe.refused !== undefined) {
			const run = results.find((r) => r.employment === 'run')!;
			const saved =
				run.differences.length === 0
					? { refused: JSON.stringify(run.actual) }
					: { lines: {} as Record<string, number> };
			return { job, disagreements: judge(job.tags, job.verdict, saved) };
		}
		const slip = results.find((r) => r.employment === `s${k}_${job.mapped.employment}`);
		return {
			job,
			disagreements: judge(job.tags, job.verdict, {
				lines: (slip?.actual ?? {}) as Record<string, number>
			})
		};
	});
}

/** Scenarios grouped by company shape, run list and headcount, in batches; the ones the oracle refuses alone. */
function groups(jobs: readonly Job[], size: number): Job[][] {
	const by = new Map<string, Job[]>();
	for (const job of jobs) {
		const m = job.mapped;
		const alone = job.verdict.refused !== null;
		const key = JSON.stringify([
			m.company ?? {},
			m.shared ?? [],
			m.runs,
			m.headcount ?? null,
			alone ? job.tags.id : ''
		]);
		by.set(key, [...(by.get(key) ?? []), job]);
	}
	const out: Job[][] = [];
	for (const list of by.values()) {
		const n = Math.max(1, Math.min(size, list[0]!.mapped.headcount ?? size));
		for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
	}
	return out;
}

/** `tasks` run with at most `limit` in flight. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
	const out: T[] = [];
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) {
			const i = next++;
			out[i] = await tasks[i]!();
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
	return out;
}

export type ProfileReport = {
	profile: string;
	scenarios: number;
	agreed: number;
	disagreed: number;
	unmapped: { scenario: string; reason: string }[];
	disagreements: Disagreement[];
	/** tracker row / branch → agreed and disagreed scenarios */
	agreement: {
		rows: Record<string, { agreed: number; disagreed: number }>;
		branches: Record<string, { agreed: number; disagreed: number }>;
	};
};

/** One profile, every scenario: mapped, batched, run on `host`, judged. */
export async function differential(
	host: Host,
	p: Profile,
	opts: { batch: number; concurrency: number; log?: (line: string) => void }
): Promise<ProfileReport> {
	const unmappedList: ProfileReport['unmapped'] = [];
	const jobs: Job[] = [];
	for (const entry of p.entries()) {
		try {
			jobs.push({ tags: entry.tags, mapped: entry.map(), verdict: entry.verdict() });
		} catch (error) {
			if (!(error instanceof Unmapped)) throw error;
			unmappedList.push({ scenario: entry.tags.id, reason: error.message });
		}
	}
	const batches = groups(jobs, opts.batch);
	let done = 0;
	const outcomes = (
		await pool(
			batches.map((batch, i) => async () => {
				const out = await runBatch(host, p.code, batch, String(i));
				opts.log?.(`${p.code}: batch ${++done}/${batches.length} (${batch.length} scenarios)`);
				return out;
			}),
			opts.concurrency
		)
	).flat();
	const agreement: ProfileReport['agreement'] = { rows: {}, branches: {} };
	const tally = (
		into: Record<string, { agreed: number; disagreed: number }>,
		key: string,
		ok: boolean
	) => {
		const t = (into[key] ??= { agreed: 0, disagreed: 0 });
		if (ok) t.agreed++;
		else t.disagreed++;
	};
	for (const { job, disagreements } of outcomes) {
		const ok = disagreements.length === 0;
		for (const row of job.tags.rows) tally(agreement.rows, row, ok);
		for (const branch of job.tags.branches) tally(agreement.branches, branch, ok);
	}
	const disagreed = outcomes.filter((o) => o.disagreements.length > 0).length;
	return {
		profile: p.code,
		scenarios: jobs.length + unmappedList.length,
		agreed: outcomes.length - disagreed,
		disagreed,
		unmapped: unmappedList,
		disagreements: outcomes.flatMap((o) => o.disagreements),
		agreement
	};
}

/** `<dir>/<profile>.json` per report (summary, disagreements, unmapped) and `<dir>/agree.json`. */
export function writeReports(dir: string, reports: readonly ProfileReport[]) {
	mkdirSync(dir, { recursive: true });
	for (const r of reports) {
		const { agreement: _, ...rest } = r;
		writeFileSync(join(dir, `${r.profile}.json`), `${JSON.stringify(rest, null, '\t')}\n`);
	}
	writeFileSync(
		join(dir, 'agree.json'),
		`${JSON.stringify(Object.fromEntries(reports.map((r) => [r.profile, r.agreement])), null, '\t')}\n`
	);
}

// ---------------------------------------------------------------------------------------------------------------
// The office roster every adapter shares: a Monday-anchored week, 5 × OFFICE, OFF, REST (see `officeWeek`)
// ---------------------------------------------------------------------------------------------------------------
const OFFICE = officeWeek(ANCHOR);

// ---------------------------------------------------------------------------------------------------------------
// SG (precedents: tests/e2e/probes/SG.ts `hire`, `registration`, `workDay`, `holiday`, `bonus`, `encash`, `deduct`)
// ---------------------------------------------------------------------------------------------------------------

const SG_PASS = { EP: 'EMPLOYMENT_PASS', S_PASS: 'S_PASS', WORK_PERMIT: 'WORK_PERMIT' } as const;
const SG_EXIT: Record<string, Row> = {
	RESIGNATION: { exit_ground: 'RESIGNATION', exit_facts: { notice_served: true } },
	DISMISSAL: {
		exit_ground: 'DISMISSAL',
		exit_facts: { misconduct_dismissal: false, final_pay_not_possible: false }
	},
	RETRENCHMENT: { exit_ground: 'RETRENCHMENT', exit_facts: { final_pay_not_possible: false } },
	CONTRACT_END: { exit_ground: 'END_OF_CONTRACT', exit_facts: {} },
	DEATH: { exit_ground: 'DEATH', exit_facts: {} }
};

function sgMap(s: sgOracle.Scenario): Mapped {
	const e = s.employee;
	const job = s.employment;
	const m = s.month;
	const tz = '+08:00';
	if (job.part_time !== undefined) unmapped('part_time (no SG part-time probe)');
	if (job.monthly_allowance !== undefined || job.rate_changes?.some((c) => c.monthly_allowance))
		unmapped('monthly_allowance (SG has no allowance catalogue)');
	if (m.medical_reimbursement !== undefined) unmapped('medical_reimbursement (no claim probe)');
	if (e.sdl_exempt_student) unmapped('sdl_exempt_student (no SG student probe)');
	const end = job.end ?? null;
	// terms: a new row at every status change and rate change
	const status = (day: string) => sgOracle.statusOn(e, day);
	const cuts = [
		job.start,
		...[e.spr_granted_on, e.citizen_on].filter(
			(d): d is string => d !== undefined && d > job.start && (end === null || d <= end)
		),
		...(job.rate_changes ?? []).map((c) => c.from)
	];
	const starts = [...new Set(cuts)].sort();
	const salaryOn = (day: string) =>
		[...(job.rate_changes ?? [])].reverse().find((c) => c.from <= day)?.monthly_basic ??
		job.monthly_basic;
	const terms = starts.map((from, i): ProbeInput => {
		const st = status(from);
		const next = starts[i + 1];
		return {
			collection: 'employment_terms',
			values: {
				employment_id: '@job',
				residency_status: st === 'SPR' ? 'PERMANENT_RESIDENT' : st,
				...(st === 'SPR' ? { residency_since: e.spr_granted_on! } : {}),
				...(st === 'CITIZEN' && e.citizen_on !== undefined
					? { residency_since: e.citizen_on }
					: {}),
				...(st === 'FOREIGNER' ? { pass_type: SG_PASS[e.pass ?? 'EP'] } : {}),
				tax_residency: 'RESIDENT',
				currency: 'SGD',
				base_salary: salaryOn(from),
				pay_frequency: 'MONTHLY',
				work_classification: job.managerial ? 'MANAGERIAL' : 'EA_COVERED',
				statutory_work_category: job.workman ? 'MANUAL_LABOUR' : 'NON_MANUAL',
				employment_type: 'PERMANENT',
				shift_pattern_id: '@week',
				...(m.leave_days_paid_on_exit !== undefined ||
				m.paid_leave?.some((l) => l.kind === 'ANNUAL')
					? {
							// an exit settles the current service year: attendance is declared to the period's eve and
							// recorded day by day after it; leave taken in service draws on the year before the current one
							opening_attendance_through:
								m.leave_days_paid_on_exit !== undefined
									? addDays(`${s.period}-01`, -1)
									: (() => {
											let from = `${s.period.slice(0, 4)}${job.start.slice(4)}`;
											if (from > `${s.period}-01`)
												from = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`;
											return addDays(from, -1);
										})(),
							opening_unexcused_absence_days: 0,
							opening_attendance_reference: 'DIFF-OPENING-ATTENDANCE'
						}
					: {}),
				effective_range: { from, to: next === undefined ? end : addDays(next, -1) }
			}
		};
	});
	const funds = sgOracle.funds(e);
	const first = sgOracle.funds({ ...e, shg_dual_election: false, shg_opt_out: [] });
	const regs: ProbeInput[] = [];
	const reg = (scheme: string, from: string, status: Row) =>
		regs.push(registration('person', 'job', scheme, from, status));
	const sprFrom =
		e.spr_granted_on !== undefined && e.spr_granted_on > job.start ? e.spr_granted_on : job.start;
	if (s.employer_unregistered)
		for (const scheme of ['CPF', ...funds])
			reg(scheme, job.start, { kind: 'NOT_REGISTERED', reason: 'Registration pending' });
	else {
		const cpf: Row = {
			...(e.spr_rates === 'FULL_EMPLOYER' || e.spr_rates === 'FULL'
				? {
						elections: {
							spr_full_rate: e.spr_rates === 'FULL',
							spr_full_employer_rate: e.spr_rates === 'FULL_EMPLOYER',
							spr_approval_reference: 'DIFF-CPF-APPROVAL'
						}
					}
				: {}),
			...(s.cpf_opening === undefined
				? {}
				: {
						opening: [
							{
								year: s.period.slice(0, 4),
								base: s.cpf_opening.ordinary_wages_ytd + s.cpf_opening.additional_wages_ytd,
								ordinary: s.cpf_opening.ordinary_wages_ytd,
								employee: 0,
								employer: 0,
								origin: 'CURRENT_EMPLOYER',
								reference: 'This employer’s CPF submissions this year'
							},
							...(s.cpf_opening.other_employer_ow_ytd === undefined
								? []
								: [
										{
											year: s.period.slice(0, 4),
											base: s.cpf_opening.other_employer_ow_ytd,
											ordinary: s.cpf_opening.other_employer_ow_ytd,
											employee: 0,
											employer: 0,
											...(s.cpf_opening.related_company_approved
												? {
														origin: 'APPROVED_RELATED_EMPLOYER',
														board_approval_reference: 'DIFF-CPF-BOARD',
														employers_related: true,
														employee_informed: true,
														terms_unchanged: true,
														transferred_employee: true
													}
												: { origin: 'OTHER_EMPLOYER' }),
											reference: 'Earlier employer’s CPF this year'
										}
									])
						]
					})
		};
		if (Object.keys(cpf).length > 0)
			reg('CPF', e.spr_rates === undefined ? job.start : sprFrom, {
				kind: 'REGISTERED',
				reference_number: 'DIFF-CPF',
				...cpf
			});
		for (const fund of e.shg_opt_out ?? [])
			reg(fund, job.start, {
				kind: 'REGISTERED',
				reference_number: `DIFF-${fund}`,
				elections: { shg_opt_out: true, shg_instruction_reference: `DIFF-${fund}-OPT-OUT` }
			});
		const second = funds.filter((f) => !first.includes(f));
		for (const fund of second) {
			if (fund !== 'CDAC' && fund !== 'SINDA') unmapped(`dual ${fund} election`);
			reg(fund, job.start, {
				kind: 'REGISTERED',
				reference_number: `DIFF-${fund}`,
				elections: {
					[`shg_dual_${fund.toLowerCase()}`]: true,
					shg_secondary_race: e.second_race!,
					shg_instruction_reference: `DIFF-${fund}-DUAL`
				}
			});
		}
		if (e.shg_instruction !== undefined)
			reg(e.shg_instruction.fund, job.start, {
				kind: 'REGISTERED',
				reference_number: `DIFF-${e.shg_instruction.fund}`,
				elections: {
					shg_monthly_amount: e.shg_instruction.amount,
					shg_instruction_reference: `DIFF-${e.shg_instruction.fund}-INSTRUCTION`
				}
			});
	}
	reg('SDL', job.start, {
		kind: 'REGISTERED',
		reference_number: 'DIFF-SDL',
		elections: {
			sdl_service_scope: job.wholly_outside_singapore ? 'OUTSIDE_SINGAPORE' : 'SINGAPORE_SERVICE',
			sdl_household_role: job.household_role ? 'CHAUFFEUR' : 'NONE',
			sdl_wholly_exclusive: job.household_role === true,
			sdl_nonbusiness: job.household_role === true,
			sdl_student_class: 'NONE'
		}
	});

	const holidays = s.holidays;
	const skip = (d: string) => weekday(d) === 0 || weekday(d) === 6 || holidays.includes(d);
	const on = (d: string) => (end !== null && end < d ? end : d);
	const mid = on(`${s.period}-15`);
	const last = on(lastDay(s.period));
	const gross = job.monthly_basic;
	const time: ProbeInput[] = [
		...holidays
			.filter((d) => weekday(d) === 6 && d >= job.start && (end === null || d <= end))
			.map((d) => workDay('job', d, [], tz)),
		...(m.absent ?? []).map((d) => workDay('job', d, [], tz)),
		...(m.overtime ?? []).map((o) =>
			workDay('job', o.date, clock(8 + o.hours), tz, { approved_overtime_hours: o.hours })
		),
		// EA s.88A(5): the exit month's attendance, day by day after the opening declaration
		...(m.leave_days_paid_on_exit === undefined
			? []
			: monthDays(s.period)
					.filter(
						(d) =>
							!skip(d) &&
							d >= job.start &&
							d <= last &&
							!(m.absent ?? []).includes(d) &&
							!(m.no_pay_leave ?? []).includes(d) &&
							!(m.overtime ?? []).some((o) => o.date === d) &&
							!(m.paid_leave ?? []).some((l) => l.date === d)
					)
					.map((d) => workDay('job', d, clock(8), tz))),
		...(m.rest_day_work ?? []).map((w) =>
			workDay('job', w.date, clock(w.hours), tz, {
				approved_overtime_hours: w.hours,
				requested_by: w.requested_by
			})
		),
		...(m.holiday_work ?? []).map((w) =>
			workDay('job', w.date, clock(w.hours), tz, { approved_overtime_hours: w.hours })
		),
		...ranges(m.no_pay_leave ?? [], skip).map(([from, to]) =>
			leaveRow('job', 'UNPAID_LEAVE', from, to, {
				half_day_start: false,
				half_day_end: false,
				no_pay_origin: 'EMPLOYEE_REQUESTED'
			})
		),
		...(m.paid_leave ?? []).map((l) =>
			l.kind === 'ANNUAL'
				? leaveRow('job', 'ANNUAL_LEAVE', l.date, l.date, {
						half_day_start: false,
						half_day_end: false
					})
				: leaveRow(
						'job',
						l.kind === 'OUTPATIENT' ? 'SICK_LEAVE' : 'HOSPITALIZATION_LEAVE',
						l.date,
						l.date,
						{ half_day_start: false, half_day_end: false },
						{ certificate_file: `sick-${l.date}.pdf` }
					)
		),
		...(m.bonus === undefined ? [] : [adhocRow('job', 'bonus', m.bonus, mid, 'Bonus')]),
		...(m.retrenchment_benefit === undefined
			? []
			: [
					adhocRow(
						'job',
						'RETRENCHMENT_BENEFIT',
						m.retrenchment_benefit,
						last,
						'Retrenchment benefit'
					)
				]),
		...(m.damage_recovery === undefined
			? []
			: [
					adhocRow(
						'job',
						m.damage_recovery.commissioner_permitted
							? 'APPROVED_DAMAGE_RECOVERY'
							: 'DAMAGE_RECOVERY',
						// EA ss.29(1), 32(1): the lawful deduction, not the whole loss
						sgOracle.computePayslip(s).components.damage_recovery!,
						mid,
						'Damage recovery, inquiry held',
						{ files: { evidence_file: 'damage-record.pdf' } }
					)
				]),
		...(m.notice_in_lieu_weeks === undefined && m.notice_in_lieu_days === undefined
			? []
			: [
					adhocRow(
						'job',
						'SALARY_IN_LIEU_OF_NOTICE',
						sgOracle.noticePayInLieu(
							gross,
							m.notice_in_lieu_weeks ?? 0,
							m.notice_in_lieu_days ?? 0
						),
						last,
						'Salary in lieu of notice'
					)
				]),
		...(m.leave_days_paid_on_exit === undefined
			? []
			: (() => {
					// the service year holding the last day
					let from = `${last.slice(0, 4)}${job.start.slice(4)}`;
					if (from > last) from = `${Number(last.slice(0, 4)) - 1}${job.start.slice(4)}`;
					const to = addDays(`${Number(from.slice(0, 4)) + 1}${from.slice(4)}`, -1);
					return [
						leaveRow('job', 'ANNUAL_LEAVE', from, to, {
							reference: 'DIFF-EXIT-ANNUAL',
							encash_days: m.leave_days_paid_on_exit,
							effective_on: last,
							due_on: last
						})
					];
				})())
	];
	return {
		company: {
			facts: {
				sdl_individual_employer: false,
				...(m.off_day_holiday === 'SUBSTITUTE' || m.holiday_work?.some((w) => w.time_off_in_lieu)
					? { public_holiday_compensation: 'TIME_OFF' }
					: {})
			}
		},
		shared: [...OFFICE, ...holidays.map((d) => holidayRow(d))],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: e.birth_date,
					gender: 'MALE',
					nationality: e.residency === 'FOREIGNER' ? 'Foreign' : 'Singaporean',
					race: e.race,
					religion: e.religion ?? 'OTHER'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'SG',
					effective_range: { from: job.start, to: end },
					...(job.exit_cause === undefined ? {} : SG_EXIT[job.exit_cause])
				}
			},
			...terms,
			...regs,
			...time
		],
		employment: 'job',
		runs: [s.period]
	};
}
const sg = profile('SG', sgScenarios, sgMap, (s) =>
	verdictOf({ lines: sgOracle.computePayslip(s).lines })
);

// ---------------------------------------------------------------------------------------------------------------
// A roster of `days` ('W' work, 'OFF', 'REST', 'STAT' a statutory rest day), Monday first, anchored on ANCHOR
// ---------------------------------------------------------------------------------------------------------------
type Day = 'W' | 'SHORT' | 'OFF' | 'REST' | 'STAT';
const DAY_REF: Record<Day, [ref: string, name: string, variant: Row]> = {
	W: ['rw', 'Work day', { kind: 'WORK' }],
	SHORT: ['rshort', 'Short work day', { kind: 'WORK' }],
	OFF: ['roff', 'Off day', { kind: 'OFF' }],
	REST: ['rrest', 'Rest day', { kind: 'REST' }],
	STAT: ['rstat', 'Statutory rest day', { kind: 'REST', statutory: true }]
};
/** Shift definitions and the week pattern `rweek` of `days` (Monday first), the work day `work`. */
export function week(
	days: readonly Day[],
	work: Row,
	code = 'DIFF',
	short: Row = work
): ProbeInput[] {
	const range = { from: ANCHOR, to: null };
	return [
		...[...new Set(days)].map((d): ProbeInput => {
			const [ref, name, variant] = DAY_REF[d];
			return {
				collection: 'shift_definitions',
				ref,
				values: {
					company_id: '@company',
					code: `${code}-${d}`,
					name,
					variant:
						d === 'W'
							? { ...variant, ...work }
							: d === 'SHORT'
								? { ...variant, ...short }
								: variant,
					effective_range: range
				}
			};
		}),
		{
			collection: 'shift_patterns',
			ref: 'rweek',
			values: {
				company_id: '@company',
				code: `${code}-WEEK`,
				name: days.join(' '),
				pattern: { days: days.map((d) => ({ roster_code_id: `@${DAY_REF[d][0]}` })) },
				effective_range: range
			}
		}
	];
}
const hhmm = (minutes: number) =>
	`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** A day `hours` long from 09:00, an hour's break at 13:00 once past four hours. */
const dayVariant = (hours: number): Row => ({
	start_time: '09:00',
	end_time: hhmm(9 * 60 + Math.round(hours * 60) + (hours > 4 ? 60 : 0)),
	break_minutes: hours > 4 ? 60 : 0,
	...(hours > 4 ? { break_start_time: '13:00' } : {})
});
/** Free working days of a month handed out in order, so leave and overtime never share a day. */
function days(pool: readonly string[]) {
	let i = 0;
	return (n: number) => {
		if (i + n > pool.length) unmapped(`${n} more working days than the month holds`);
		const out = pool.slice(i, i + n);
		i += n;
		return out;
	};
}

// ---------------------------------------------------------------------------------------------------------------
// TH (precedents: tests/e2e/probes/TH.ts `person`, `week`, `workDay`, `timeOff`, `encashOnExit`, `adhoc`, `statutory`)
// ---------------------------------------------------------------------------------------------------------------

const TH_SITE: Record<thOracle.Worksite, string> = {
	BANGKOK: 'Bangkok',
	CHONBURI: 'Chon Buri',
	PHUKET: 'Phuket',
	SURAT_THANI_KO_SAMUI: 'Surat Thani/Ko Samui',
	CHIANG_MAI_MUEANG: 'Chiang Mai/Mueang Chiang Mai',
	SONGKHLA_HAT_YAI: 'Songkhla/Hat Yai',
	NONTHABURI: 'Nonthaburi',
	NAKHON_RATCHASIMA: 'Nakhon Ratchasima',
	SAMUT_SONGKHRAM: 'Samut Songkhram',
	CHIANG_MAI: 'Chiang Mai/Doi Saket',
	LOPBURI: 'Lop Buri',
	NONG_KHAI: 'Nong Khai',
	KRABI: 'Krabi',
	SONGKHLA: 'Songkhla/Mueang Songkhla',
	SURAT_THANI: 'Surat Thani/Mueang Surat Thani',
	CHUMPHON: 'Chumphon',
	LAMPHUN: 'Lamphun',
	ROI_ET: 'Roi Et',
	ANG_THONG: 'Ang Thong',
	UDON_THANI: 'Udon Thani',
	NAN: 'Nan',
	YALA: 'Yala'
};
const TH_CLASS: Record<thOracle.WorkClass, Row> = {
	ORDINARY: { work_classification: 'EA_COVERED' },
	S65_1_AUTHORITY: { work_classification: 'MANAGERIAL' },
	S65_2_COMMISSION_SALES: { work_classification: 'COMMISSION_SALES' },
	S65_3_9_HOURLY: { work_classification: 'OVERTIME_AT_HOURLY_RATE' },
	GUARD: { work_classification: 'EA_COVERED', statutory_work_category: 'GUARD_DUTY' }
};
const TH_EXIT: Record<thOracle.ExitCause, (x: NonNullable<thOracle.Scenario['exit']>) => Row> = {
	RESIGNATION: () => ({ exit_ground: 'RESIGNATION' }),
	EMPLOYER_TERMINATION: (x) => ({
		exit_ground: 'RETRENCHMENT',
		...(x.noticeGivenOn === null ? {} : { exit_facts: { notice_given_on: x.noticeGivenOn } })
	}),
	DISMISSAL_S119: () => ({ exit_ground: 'DISMISSAL', exit_facts: { dismissed_for_cause: true } }),
	RETIREMENT: () => ({ exit_ground: 'RETIREMENT' }),
	CONTRACT_EXPIRY: () => ({
		exit_ground: 'END_OF_CONTRACT',
		exit_facts: { fixed_term_project_exempt: false }
	}),
	FIXED_TERM_PROJECT_EXEMPT: () => ({
		exit_ground: 'END_OF_CONTRACT',
		exit_facts: { fixed_term_project_exempt: true }
	}),
	RELOCATION_OBJECTION: (x) => ({
		exit_ground: 'RESIGNATION',
		exit_facts: { relocation_objection: true, relocation_notice_posted: x.relocationNoticePosted }
	}),
	TECHNOLOGY_RESTRUCTURING: (x) => ({
		exit_ground: 'RETRENCHMENT',
		exit_facts: {
			technology_restructuring: true,
			technology_notice_60_days: x.technologyNotice60Days
		}
	})
};
const TH_TZ = '+07:00';

function thMap(s: thOracle.Scenario): Mapped {
	const e = s.employee;
	const x = s.exit;
	const lv = s.leave;
	if (e.normalDailyHours > 8)
		unmapped('a normal day over 8 hours (needs the split-break agreement)');
	const oracle = thOracle.computePayslip(s).lines;
	const pay = e.pay;
	const first = `${s.period}-01`;
	const lastWorked =
		x !== null && x.date < thOracle.monthEnd(s.period) ? x.date : thOracle.monthEnd(s.period);
	// holidays: the last weekdays of the month, one per paid traditional holiday (or one to work on)
	const weekdays = monthDays(s.period).filter((d) => weekday(d) >= 1 && weekday(d) <= 5);
	const nHolidays = Math.max(
		pay.basis === 'DAILY' ? pay.paidTraditionalHolidays : 0,
		s.time.holidayWork?.kind === 'TRADITIONAL' ? 1 : 0
	);
	const holidays = weekdays.slice(weekdays.length - nHolidays);
	const free = weekdays.filter((d) => !holidays.includes(d) && d >= e.hireDate && d <= lastWorked);
	const take = days(free);
	const job = 'job';
	const inputs: ProbeInput[] = [];
	const leave = (code: string, dates: readonly string[], extra: Row = {}, cert = false) =>
		inputs.push(
			...ranges(dates).map(([from, to]) =>
				leaveRow(
					job,
					code,
					from,
					to,
					extra,
					cert ? { certificate_file: 'medical-certificate.pdf' } : undefined
				)
			)
		);
	if (pay.basis === 'DAILY') {
		// worked: the first `workedDays` free weekdays; the rest absent (unpaid)
		const worked = take(pay.workedDays);
		for (const d of free.filter((d) => !worked.includes(d)))
			inputs.push(workDay(job, d, [], TH_TZ));
	}
	// prior leave this year: working days before the period, latest first
	const before = (n: number) => {
		const pool: string[] = [];
		for (
			let d = addDays(first, -1);
			pool.length < n && d >= `${s.period.slice(0, 4)}-01-01`;
			d = addDays(d, -1)
		)
			if (weekday(d) >= 1 && weekday(d) <= 5 && d >= e.hireDate) pool.push(d);
		if (pool.length < n) unmapped(`${n} prior leave days before ${s.period} this year`);
		return pool.sort();
	};
	leave('UNPAID_LEAVE', take(lv.unpaidDays));
	leave('SICK_LEAVE', [...before(lv.sick.prior), ...take(lv.sick.days)], {}, true);
	// s.57/1 pays three days; a day granted beyond is keyed as unpaid leave (owner rule 2026-09-30, TH-LEAVE-07)
	const personalPaid = Math.max(0, Math.min(lv.personal.days, 3 - lv.personal.prior));
	leave('PERSONAL_BUSINESS_LEAVE', [...before(lv.personal.prior), ...take(personalPaid)]);
	leave('UNPAID_LEAVE', take(lv.personal.days - personalPaid));
	leave('MILITARY_LEAVE', [...before(lv.military.prior), ...take(lv.military.days)]);
	leave('ANNUAL_LEAVE', take(lv.annualLeaveDays));
	leave(
		'CHILD_CARE_LEAVE',
		take(lv.childCareDays),
		{ facts: { event_kind: 'BIRTH', event_date: addDays(first, -40) } },
		true
	);
	leave('CHILD_BIRTH_LEAVE', take(lv.spouseBirthDays), {
		facts: { event_kind: 'BIRTH', event_relationship: 'SPOUSE', event_date: addDays(first, -1) }
	});
	if (lv.maternityStart !== null) {
		// 120 calendar days from the start, one entry per month (as the probe records it)
		const end = addDays(lv.maternityStart, 119);
		for (let from = lv.maternityStart; from <= end; from = addDays(lastDay(from.slice(0, 7)), 1)) {
			const to = lastDay(from.slice(0, 7)) < end ? lastDay(from.slice(0, 7)) : end;
			inputs.push(
				leaveRow(job, 'MATERNITY_LEAVE', from, to, {
					facts: { event_kind: 'BIRTH', event_date: lv.maternityStart }
				})
			);
		}
	}
	// overtime: at most three hours a day on successive free weekdays, after s.27's 20 minutes' rest from two hours
	const normalEnd = 9 * 60 + e.normalDailyHours * 60 + 60;
	const otDay = (d: string, ot: number) =>
		workDay(
			job,
			d,
			[
				['09:00', '13:00'],
				['14:00', hhmm(normalEnd)],
				...(ot > 0
					? [
							[
								hhmm(normalEnd + (ot >= 2 ? 20 : 0)),
								hhmm(normalEnd + (ot >= 2 ? 20 : 0) + Math.round(ot * 60))
							] as [string, string]
						]
					: [])
			],
			TH_TZ,
			{ approved_overtime_hours: ot, overtime_consented_at: `${d}T00:00:00${TH_TZ}` }
		);
	for (let left = s.time.overtimeHours; left > 0; left -= 3)
		inputs.push(otDay(take(1)[0]!, Math.min(3, left)));
	const hw = s.time.holidayWork;
	if (hw !== null) {
		const d =
			hw.kind === 'TRADITIONAL'
				? holidays[0]!
				: monthDays(s.period).find((d) => weekday(d) === 6 && d >= e.hireDate && d <= lastWorked)!;
		const pairs = clock(hw.hours);
		const endMin = Number(pairs.at(-1)![1].slice(0, 2)) * 60 + Number(pairs.at(-1)![1].slice(3));
		if (hw.overtimeHours > 0) {
			const from = endMin + (hw.overtimeHours >= 2 ? 20 : 0);
			if (hw.overtimeHours >= 2)
				pairs.push([hhmm(from), hhmm(from + Math.round(hw.overtimeHours * 60))]);
			else
				pairs[pairs.length - 1] = [
					pairs.at(-1)![0],
					hhmm(endMin + Math.round(hw.overtimeHours * 60))
				];
		}
		inputs.push(
			workDay(job, d, pairs, TH_TZ, {
				approved_overtime_hours: hw.hours + hw.overtimeHours,
				overtime_consented_at: `${d}T00:00:00${TH_TZ}`
			})
		);
	}
	if (s.bonus > 0)
		inputs.push(
			adhocRow(
				job,
				'BONUS',
				s.bonus,
				lastWorked < `${s.period}-15` ? lastWorked : `${s.period}-15`,
				'Bonus'
			)
		);
	// LPA ss.46–48 are judged on the timed day: every working day of an under-18 employee carries its clock (TH-HR-07)
	if (thOracle.ageOn(e.birthDate, lastWorked) < 18) {
		const timed = new Set(
			inputs.filter((i) => i.collection === 'work_days').map((i) => String(i.values.work_date))
		);
		for (const d of free)
			if (!timed.has(d)) inputs.push(workDay(job, d, clock(e.normalDailyHours), TH_TZ));
	}
	if (x !== null) {
		for (const code of ['SEVERANCE_PAY', 'NOTICE_IN_LIEU'])
			if (oracle[code] !== undefined)
				inputs.push(adhocRow(job, code, 0, x.date, code.toLowerCase()));
		const year = x.date.slice(0, 4);
		const opens = `${year}-01-01` > e.hireDate ? `${year}-01-01` : e.hireDate;
		const adjust = (reference: string, days: number, reason: string) =>
			inputs.push(
				leaveRow(job, 'ANNUAL_LEAVE', `${year}-01-01`, `${year}-12-31`, {
					reference,
					days,
					effective_on: opens,
					reason
				})
			);
		if (x.carriedLeaveDays > 0)
			adjust('DIFF-CARRIED', x.carriedLeaveDays, 'carried forward from last year');
		if (x.annualLeaveTakenThisYear > 0)
			adjust('DIFF-TAKEN', -x.annualLeaveTakenThisYear, 'taken earlier this year');
		const encash = oracle.LEAVE_ENCASHMENT?.base;
		if (encash !== undefined)
			inputs.push(
				leaveRow(
					job,
					'ANNUAL_LEAVE',
					`${x.date.slice(0, 4)}-01-01`,
					`${x.date.slice(0, 4)}-12-31`,
					{
						reference: 'DIFF-EXIT-ANNUAL',
						days: encash,
						encash_days: encash,
						effective_on: x.date,
						due_on: x.date
					}
				)
			);
	}
	const regs: ProbeInput[] = [];
	if (e.providentFundMember)
		regs.push(
			registration('person', job, 'EWF', e.hireDate, {
				kind: 'REGISTERED',
				reference_number: 'DIFF-EWF',
				elections: {
					provident_fund_member: true,
					provident_fund_registration_reference: 'DIFF-PF-REG',
					provident_fund_membership_reference: 'DIFF-PF-MEMBER'
				}
			})
		);
	if (e.ly01 > 0)
		regs.push(
			registration(
				'person',
				job,
				'PIT',
				`${s.period.slice(0, 4)}-01-01` > e.hireDate ? `${s.period.slice(0, 4)}-01-01` : e.hireDate,
				{
					kind: 'REGISTERED',
					reference_number: 'DIFF-PIT',
					elections: { ly01_deductions: e.ly01 }
				}
			)
		);
	const person: ProbeInput[] = [
		{
			collection: 'employees',
			ref: 'person',
			values: {
				name: `Differential ${s.id}`,
				date_of_birth: e.birthDate,
				gender:
					e.pregnant || lv.maternityStart !== null || lv.childCareDays > 0 ? 'FEMALE' : 'MALE',
				nationality: e.citizenship === 'TH' ? 'Thai' : 'Foreign'
			}
		},
		{
			collection: 'employments',
			ref: job,
			values: {
				employee_id: '@person',
				company_id: '@company',
				employee_number: 'TH',
				effective_range: { from: e.hireDate, to: x?.date ?? null },
				...(x === null ? {} : TH_EXIT[x.cause](x))
			}
		},
		{
			collection: 'employment_terms',
			values: {
				employment_id: `@${job}`,
				residency_status: e.citizenship === 'TH' ? 'CITIZEN' : 'FOREIGNER',
				tax_residency: e.taxResident ? 'RESIDENT' : 'NON_RESIDENT',
				currency: 'THB',
				base_salary: pay.basis === 'MONTHLY' ? pay.monthly : pay.daily,
				pay_frequency: pay.basis,
				statutory_work_category: 'NON_MANUAL',
				...TH_CLASS[e.workClass],
				employment_type: 'PERMANENT',
				worksite: TH_SITE[s.company.worksite],
				...(s.company.sector === 'GENERAL' || s.company.sector === 'HOTEL_TYPE_1'
					? {}
					: { worksite_sector: s.company.sector }),
				facts: {
					hazardous_work: e.hazardous,
					pregnancy_status: e.pregnant ? 'PREGNANT' : 'NOT_PREGNANT'
				},
				shift_pattern_id: '@rweek',
				effective_range: { from: e.hireDate, to: x?.date ?? null }
			}
		}
	];
	// the Employee Welfare Fund (from October 2026) reads the company's headcount: ten or more, or the count itself
	const ewf = s.period >= '2026-10';
	return {
		company: { facts: { sso_flood_relief_area: s.company.floodReliefArea } },
		shared: [
			...week(['W', 'W', 'W', 'W', 'W', 'REST', 'REST'], dayVariant(e.normalDailyHours), 'TH'),
			...holidays.map((d) => holidayRow(d, 'Traditional holiday'))
		],
		inputs: [...person, ...regs, ...inputs],
		employment: job,
		runs: s.steadyYear
			? periodsFrom(
					e.hireDate.slice(0, 4) === s.period.slice(0, 4)
						? e.hireDate.slice(0, 7)
						: `${s.period.slice(0, 4)}-01`,
					s.period
				)
			: [s.period],
		...(ewf
			? {
					headcount: Math.min(10, s.company.headcount),
					filler: thFiller
				}
			: {})
	};
}
const thFiller: ProbeInput[] = [
	{
		collection: 'employees',
		ref: 'person',
		values: { name: 'Filler', date_of_birth: '1990-01-01', gender: 'MALE' }
	},
	{
		collection: 'employments',
		ref: 'job',
		values: {
			employee_id: '@person',
			company_id: '@company',
			employee_number: 'TH-F',
			effective_range: { from: '2020-01-01', to: null }
		}
	},
	{
		collection: 'employment_terms',
		values: {
			employment_id: '@job',
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'THB',
			base_salary: 30000,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			worksite: 'Bangkok',
			facts: { hazardous_work: false, pregnancy_status: 'NOT_PREGNANT' },
			shift_pattern_id: '@rweek',
			effective_range: { from: '2020-01-01', to: null }
		}
	}
];
const th = profile('TH', thScenarios, thMap, (s) => verdictOf(thOracle.computePayslip(s)));

/** Working days before `first` in its year (and from `from`), `n` of them, earliest first. */
function priorWeekdays(
	first: string,
	n: number,
	from: string,
	what: string,
	skip: readonly string[] = []
) {
	const pool: string[] = [];
	for (
		let d = addDays(first, -1);
		pool.length < n && d >= `${first.slice(0, 4)}-01-01`;
		d = addDays(d, -1)
	)
		if (weekday(d) >= 1 && weekday(d) <= 5 && d >= from && !skip.includes(d)) pool.push(d);
	if (pool.length < n) unmapped(`${n} prior ${what} days before ${first} this year`);
	return pool.sort();
}
const weekendSkip = (d: string) => weekday(d) === 0 || weekday(d) === 6;
/** The first weekday of each of the `n` months before `first` this year: 性別平等工作法 §14, one 生理假 day a month. */
function priorMonthWeekdays(first: string, n: number, from: string) {
	const out: string[] = [];
	for (let m = Number(first.slice(5, 7)) - 1; out.length < n && m >= 1; m--) {
		const d = monthDays(`${first.slice(0, 4)}-${String(m).padStart(2, '0')}`).find(
			(day) => !weekendSkip(day) && day >= from
		);
		if (d !== undefined) out.push(d);
	}
	if (out.length < n) unmapped(`${n} prior months of 生理假 before ${first}`);
	return out.sort();
}

// ---------------------------------------------------------------------------------------------------------------
// TW (precedents: tests/e2e/probes/TW.ts `twWeek`, `personInputs`, `worked`/`asked`, `leave`, `wageMonth`, `adhoc`)
// ---------------------------------------------------------------------------------------------------------------

const TW_RISK: Record<number, string> = { 0.0012: '42', 0.0057: '25', 0.0022: '4', 0.0096: '3' };
const TW_TZ = '+08:00';
const TW_SUBSIDY = { MILD: 25, MODERATE: 50, SEVERE: 100 } as const;

function twMap(s: twOracle.Scenario): Mapped {
	const e = s.employee;
	const x = s.exit;
	const lv = s.leave;
	if (!s.company.liUnit) unmapped('liUnit false (an establishment under five without an LI unit)');
	const risk = TW_RISK[s.company.occRate] ?? unmapped(`occRate ${s.company.occRate}`);
	if (
		e.citizenship !== 'ROC' &&
		e.citizenship !== 'MIGRANT_WORKER' &&
		e.citizenship !== 'FOREIGN_PROFESSIONAL'
	)
		unmapped(`citizenship ${e.citizenship}`);
	if (e.prGrantedOn !== null) unmapped('prGrantedOn');
	if (e.pay.basis !== 'MONTHLY') unmapped('hourly pay');
	if (e.pay.raise !== null) unmapped('mid-month raise');
	const monthly = e.pay.monthly;
	if (e.partTimeWeeklyHours !== null) unmapped('part-time');
	if (e.shortTermHire) unmapped('shortTermHire');
	if (e.oldSystemServiceMonths > 0 || e.pension.system !== 'NEW') unmapped('old pension system');
	if (e.pension.rateChange !== undefined) unmapped('voluntary rate change');
	if (s.time.restDayEmergencyDays > 0) unmapped('restDayEmergencyDays');
	if (lv.maternityDays + lv.paternityDays + lv.occInjuryDays > 0 || lv.parentalWholeMonth)
		unmapped('maternity / paternity / occupational-injury / parental leave');
	if (s.occInjuryMedical > 0) unmapped('occInjuryMedical');
	if (s.bonus.priorThisYear > 0) unmapped('an earlier bonus this year');
	const oracle = twOracle.computePayslip(s).lines;
	const first = `${s.period}-01`;
	const last = lastDay(s.period);
	const lastWorked = x !== null && x.date < last ? x.date : last;
	// the declared insured grades are the insurer's facts: the oracle's grade of each scheme
	const base = (code: string) =>
		oracle[code]?.base ??
		oracle.LI?.base ??
		oracle.OCC_INJURY?.base ??
		oracle.NHI?.base ??
		oracle.LABOR_PENSION?.base ??
		monthly;
	const disability = e.disability === null ? {} : { disability_subsidy: TW_SUBSIDY[e.disability] };
	const dep = (level: 'MILD' | 'MODERATE' | 'SEVERE') =>
		e.dependantDisability.filter((d) => d === level).length;
	const elections: Record<string, Row> = {
		LI: { insured_amount: base('LI'), ...disability },
		EI: { insured_amount: base('EI'), ...disability },
		NHI: {
			insured_amount: base('NHI'),
			enrolled_dependants: e.nhiDependants,
			...disability,
			...(e.dependantDisability.some((d) => d !== null)
				? {
						dependants_subsidised_full: dep('SEVERE'),
						dependants_subsidised_half: dep('MODERATE'),
						dependants_subsidised_quarter: dep('MILD')
					}
				: {})
		},
		OCC_INJURY: { insured_amount: base('OCC_INJURY') },
		LABOR_PENSION: {
			insured_amount: base('LABOR_PENSION'),
			voluntary_rate: e.pension.voluntaryRate * 100,
			...(e.citizenship === 'FOREIGN_PROFESSIONAL'
				? { professional_work_class: 'FOREIGN_PROFESSIONAL' }
				: {})
		},
		WAGE_ARREARS_BASE: { insured_amount: base('LI') },
		INCOME_TAX:
			e.taxMethod === 'FLAT5'
				? { five_percent_withholding: true }
				: { table_declaration_reference: 'DIFF-TW-TABLE', table_dependants: e.taxDependants }
	};
	const range = { from: e.hireDate, to: x?.date ?? null };
	// 就業保險法 §5(1): a foreigner without PR or an ROC spouse is outside 就保 (TW-PEN-02-1); 勞工保險條例 §6(1):
	// compulsory LI ends at 65, so an over-65 worker the unit did not keep insured is not registered
	const excluded: Record<string, { reason: string; elections: Row }> = {
		...(e.citizenship === 'MIGRANT_WORKER' || e.citizenship === 'FOREIGN_PROFESSIONAL'
			? {
					EI: {
						reason: 'Foreigner without permanent residence: outside 就業保險法 §5',
						elections: { foreign_worker_excluded: true }
					}
				}
			: {}),
		...(!e.liAfter65 && twOracle.ageOn(e.birthDate, first) >= 65
			? { LI: { reason: '勞工保險條例 §6(1): over 65, cover not continued', elections: {} } }
			: {})
	};
	const regs = Object.entries(elections).map(([code, el]) => {
		const ex = excluded[code];
		return {
			collection: 'employment_statutory_facts',
			values: {
				employee_id: '@person',
				employment_id: '@job',
				statutory_contribution_id: `@law:statutory_contributions:${code}`,
				effective_range: range,
				status:
					ex !== undefined
						? {
								kind: 'NOT_REGISTERED',
								reason: ex.reason,
								declaration_reference: `DIFF-${code}-EXCLUDED`,
								elections: ex.elections
							}
						: {
								kind: 'REGISTERED',
								elections: el,
								reference_number: `DIFF-${code}`,
								since: e.hireDate,
								first_contribution_due_on: e.hireDate
							}
			}
		};
	});
	const free = monthDays(s.period).filter(
		(d) => !weekendSkip(d) && d >= e.hireDate && d <= lastWorked
	);
	// §37 holidays worked: weekdays from the end of the month, published for this company
	const holidays = free.slice(free.length - s.time.holidayWork.length);
	const take = days(free.filter((d) => !holidays.includes(d)));
	const saturdays = monthDays(s.period).filter(
		(d) => weekday(d) === 6 && d >= e.hireDate && d <= lastWorked
	);
	if (saturdays.length < s.time.restDayWork.length) unmapped('more 休息日 work than Saturdays');
	const time: ProbeInput[] = [
		...s.time.weekdayOvertime.map((h) =>
			workDay('job', take(1)[0]!, clock(8 + h), TW_TZ, { approved_overtime_hours: h })
		),
		...s.time.restDayWork.map((h, i) =>
			workDay('job', saturdays[i]!, clock(h), TW_TZ, { approved_overtime_hours: h })
		),
		...s.time.holidayWork.map((h, i) =>
			workDay('job', holidays[i]!, clock(h), TW_TZ, { approved_overtime_hours: h })
		)
	];
	const leave = (code: string, dates: readonly string[]) =>
		ranges(dates).map(([from, to]) =>
			leaveRow('job', code, from, to, { half_day_start: false, half_day_end: false })
		);
	const menstrualPrior = priorMonthWeekdays(first, lv.menstrualPriorDays, e.hireDate);
	const leaves = [
		...leave('PERSONAL_LEAVE', take(lv.personalDays)),
		...leave('SICK_LEAVE', [
			...priorWeekdays(first, lv.sickPriorDays, e.hireDate, 'sick', menstrualPrior),
			...take(lv.sickDays)
		]),
		...leave('HOSPITALISED_SICK_LEAVE', take(lv.hospitalisedDays)),
		...leave('MENSTRUAL_LEAVE', [...menstrualPrior, ...take(lv.menstrualDays)])
	];
	const pay: ProbeInput[] = [
		...(s.bonus.amount > 0
			? [
					adhocRow(
						'job',
						'bonus',
						s.bonus.amount,
						`${s.period}-10` < lastWorked ? `${s.period}-10` : lastWorked,
						'Bonus'
					)
				]
			: []),
		...(s.garnishment > 0
			? [
					adhocRow(
						'job',
						'COURT_GARNISHMENT',
						s.garnishment,
						`${s.period}-10` < lastWorked ? `${s.period}-10` : lastWorked,
						'強制執行法 §115-1',
						{
							files: { evidence_file: 'garnishment-order.pdf' }
						}
					)
				]
			: [])
	];
	let exitFacts: Row = {};
	if (x !== null) {
		const avg = { average_daily_wage: x.averageMonthlyWage / 30, old_system_service_months: 0 };
		const byCause: Record<twOracle.ExitCause, Row> = {
			RESIGNATION: { exit_ground: 'RESIGNATION', exit_facts: { lsa_termination_ground: 'OTHER' } },
			DISMISSAL_S12: { exit_ground: 'DISMISSAL', exit_facts: { lsa_termination_ground: 'OTHER' } },
			LAYOFF_S11: {
				exit_ground: 'REDUNDANCY',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_11',
					notice_days_given: x.noticeDaysGiven,
					...avg
				}
			},
			WORKER_S14: {
				exit_ground: 'RESIGNATION',
				exit_facts: {
					lsa_termination_ground: 'ARTICLE_14',
					notice_days_given: x.noticeDaysGiven,
					...avg
				}
			},
			RETIREMENT: {
				exit_ground: 'RETIREMENT',
				exit_facts: { ...avg, retirement_disability_duty_caused: x.dutyDisability }
			}
		};
		exitFacts = byCause[x.cause];
		for (const code of ['SEVERANCE_PAY', 'RETIREMENT_PAY'])
			if (oracle[code] !== undefined)
				pay.push(adhocRow('job', code, 0, x.date, `${code} on departure`));
		// the last whole month's normal wage (施行細則 §24-1) and the unused annual leave the oracle pays
		const prev = addDays(first, -1).slice(0, 7);
		// the TW lineage opens 2025-12-01: an earlier month has no sealed settings to record a wage period under
		if (prev >= '2025-12')
			pay.push({
				collection: 'employment_wage_periods',
				values: {
					employment_id: '@job',
					period: { from: `${prev}-01`, to: lastDay(prev) },
					currency: 'TWD',
					normal_wages: e.pay.monthly,
					due_on: lastDay(prev),
					paid_on: lastDay(prev),
					reference: `${prev} payslip`
				}
			});
		const payout = oracle.ANNUAL_LEAVE_PAYOUT?.amount;
		if (payout !== undefined) {
			const d =
				Math.round(
					(payout / (Math.max(e.pay.monthly, twOracle.lawFor(s.period).mwMonthly) / 30)) * 1000
				) / 1000;
			pay.push(
				leaveRow(
					'job',
					'ANNUAL_LEAVE',
					`${x.date.slice(0, 4)}-01-01`,
					`${x.date.slice(0, 4)}-12-31`,
					{
						reference: 'DIFF-EXIT-ANNUAL',
						days: d,
						encash_days: d,
						effective_on: x.date,
						due_on: x.date
					}
				)
			);
		}
	}
	const foreign = e.citizenship !== 'ROC';
	return {
		company: { risk_class: risk, facts: {} },
		shared: [
			...week(['W', 'W', 'W', 'W', 'W', 'REST', 'STAT'], dayVariant(8), 'TW'),
			...holidays.map((d) => holidayRow(d))
		],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: e.birthDate,
					gender: lv.menstrualDays + lv.menstrualPriorDays > 0 ? 'FEMALE' : 'MALE',
					nationality: foreign ? 'Foreign' : 'Taiwanese'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'TW',
					effective_range: range,
					...exitFacts
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: foreign ? 'FOREIGNER' : 'CITIZEN',
					...(foreign
						? { pass_type: e.citizenship === 'MIGRANT_WORKER' ? 'WORK_PERMIT' : 'EMPLOYMENT_PASS' }
						: {}),
					tax_residency: e.taxResident ? 'RESIDENT' : 'NON_RESIDENT',
					currency: 'TWD',
					base_salary: e.pay.monthly,
					...(e.mealAllowance > 0
						? {
								allowances: [
									{
										catalogue_id: '@law:allowance_catalogue:MEAL_ALLOWANCE',
										amount: e.mealAllowance
									}
								]
							}
						: {}),
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					shift_pattern_id: '@rweek',
					facts: {
						// 勞動基準法 §46 / §45(1)
						...(twOracle.ageOn(e.birthDate, e.hireDate) < 18
							? { guardian_consent_reference: 'DIFF-LSA46-CONSENT' }
							: {}),
						...(twOracle.ageOn(e.birthDate, e.hireDate) < 15
							? { under_15_exception_reference: 'DIFF-LSA45-PERMIT' }
							: {})
					},
					effective_range: range
				}
			},
			...regs,
			...time,
			...leaves,
			...pay
		],
		employment: 'job',
		runs: [s.period]
	};
}
const tw = profile('TW', twScenarios, twMap, (s) => verdictOf(twOracle.computePayslip(s)));

// ---------------------------------------------------------------------------------------------------------------
// VN (precedents: tests/e2e/probes/VN.ts `company`, `hire`, `worked`, `leave`, `registered`, `adhoc`)
// ---------------------------------------------------------------------------------------------------------------

const VN_TZ = '+07:00';
function vnMap(s: vnOracle.Scenario): Mapped {
	const e = s.employee;
	const k = s.contract;
	const t = s.time;
	const x = s.exit;
	if (k.partTime !== null) unmapped('part-time hourly contract');
	if (e.voluntaryPension > 0) unmapped('voluntary pension premium (a PIT deduction claim)');
	if (Object.values(t.night).some((h) => h > 0)) unmapped('night work');
	if (x?.cause === 'ABANDONMENT') unmapped('ABANDONMENT exit');
	if (k.allowance > 0)
		unmapped('stable job allowance (no insured VN allowance class; VN-SI-01 GAP)');
	const oracle = vnOracle.computePayslip(s).lines;
	const first = `${s.period}-01`;
	const last = lastDay(s.period);
	const end = x !== null && x.date < last ? x.date : last;
	const free = monthDays(s.period).filter((d) => !weekendSkip(d) && d >= k.start && d <= end);
	const holidays = t.ot.holiday > 0 ? [free.at(-1)!] : [];
	const take = days(free.filter((d) => !holidays.includes(d)));
	const sundays = monthDays(s.period).filter((d) => weekday(d) === 0 && d >= k.start && d <= end);
	const inputs: ProbeInput[] = [];
	const fact = (code: string, from: string, status: Row, to: string | null = null): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			employment_id: '@job',
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from, to },
			status: { kind: 'REGISTERED', reference_number: `DIFF-${code}`, ...status }
		}
	});
	// overtime: weekday hours at most four a day, rest-day (Sunday) and holiday hours at most eight a day
	// LC art.107(2)(b): at most 40 approved hours a month; hours past it are worked and paid as incentive hours
	let approved = 0;
	for (let left = t.ot.weekday; left > 0; left -= 4) {
		const h = Math.min(4, left);
		const ok = Math.min(h, Math.max(0, 40 - approved));
		approved += ok;
		inputs.push(
			workDay('job', take(1)[0]!, clock(8 + h), VN_TZ, {
				approved_overtime_hours: ok,
				...(h > ok ? { incentive_hours: h - ok } : {})
			})
		);
	}
	let sunday = 0;
	for (let left = t.ot.rest; left > 0; left -= 8) {
		const d = sundays[sunday++] ?? unmapped('more rest-day overtime than Sundays');
		inputs.push(
			workDay('job', d, clock(Math.min(8, left)), VN_TZ, {
				approved_overtime_hours: Math.min(8, left)
			})
		);
	}
	if (t.ot.holiday > 0) {
		if (t.ot.holiday > 8) unmapped('holiday overtime over one day');
		inputs.push(
			workDay('job', holidays[0]!, clock(t.ot.holiday), VN_TZ, {
				approved_overtime_hours: t.ot.holiday
			})
		);
	}
	for (const [from, to] of ranges(take(t.unpaidDays)))
		inputs.push(
			leaveRow('job', 'UNPAID_LEAVE', from, to, {
				reason: 'Agreed unpaid leave (Labour Code art.115(3))'
			})
		);
	// SI arts.33(5)/34(3): days before hire, after exit, unpaid and fund-paid sick days are working days without wage
	const siFrom = k.start > first ? k.start : first;
	const noWage =
		vnOracle.workingDays(first, last) -
		(vnOracle.workingDays(siFrom, end) - t.unpaidDays - t.sickDays);
	const si = {
		...(noWage >= 14 ? { continue_si_unpaid: false } : {}),
		...(t.sickDays > 0
			? { sickness_benefit_eligible: true, long_term_sickness: false, first_return_month: false }
			: {})
	};
	if (Object.keys(si).length > 0) inputs.push(fact('SI', siFrom, { elections: si }, end));
	if (t.sickDays > 0) {
		for (const [from, to] of ranges(take(t.sickDays)))
			inputs.push(
				leaveRow(
					'job',
					'SICK_LEAVE',
					from,
					to,
					{},
					{ certificate_file: 'sick-leave-certificate.pdf' }
				)
			);
	}
	if (s.bonus > 0)
		inputs.push(
			adhocRow('job', 'BONUS', s.bonus, `${s.period}-10` < end ? `${s.period}-10` : end, 'Bonus')
		);
	if (x !== null) {
		for (const code of ['SEVERANCE_ALLOWANCE', 'JOB_LOSS_ALLOWANCE'])
			if (oracle[code] !== undefined)
				inputs.push(adhocRow('job', code, 0, x.date, 'Separation payment on departure'));
		const untaken = oracle.ENCASHMENT?.base;
		if (untaken !== undefined)
			inputs.push(
				leaveRow(
					'job',
					'ANNUAL_LEAVE',
					`${x.date.slice(0, 4)}-01-01`,
					`${x.date.slice(0, 4)}-12-31`,
					{
						reference: 'DIFF-EXIT-ANNUAL',
						days: untaken,
						encash_days: untaken,
						effective_on: x.date,
						due_on: x.date
					}
				)
			);
	}
	const foreign = e.citizenship === 'FOREIGN';
	// a fixed term ends on its last day: the contract's length is its range (tests/e2e/probes/VN.ts P-VN-161)
	const range = { from: k.start, to: x?.date ?? k.fixedEnd };
	return {
		company: {
			region: s.company.region,
			facts: s.company.oaReduced ? { occupational_accident_reduced: true } : {}
		},
		shared: [...OFFICE, ...holidays.map((d) => holidayRow(d))],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: e.birthDate,
					gender: e.sex === 'F' ? 'FEMALE' : 'MALE',
					nationality: foreign ? 'Japanese' : 'Vietnamese',
					receiving_pension: e.receivingPension
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'VN',
					effective_range: range,
					...(x === null
						? {}
						: { exit_ground: x.cause, exit_facts: { pension_eligible: x.pensionEligible } })
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: foreign ? 'FOREIGNER' : 'CITIZEN',
					...(foreign ? { pass_type: 'WORK_PERMIT' } : {}),
					tax_residency: e.taxResident ? 'RESIDENT' : 'NON_RESIDENT',
					currency: 'VND',
					base_salary: k.monthly,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: k.probation
						? 'PROBATION'
						: k.fixedEnd !== null
							? 'CONTRACT'
							: 'PERMANENT',
					facts:
						k.start <= '2025-12-31'
							? { prior_floor_region: s.company.region, prior_floor_reclassified: false }
							: {},
					shift_pattern_id: '@week',
					effective_range: range
				}
			},
			...(k.uiFrom === null
				? []
				: [
						fact('UI', k.uiFrom < k.start ? k.start : k.uiFrom, {
							since: k.uiFrom,
							// the pension-qualified exclusion is Law 74/2025 art.31(2), from 1 January 2026; Law 38/2013 has none
							elections: s.period >= '2026-01' ? { pension_qualified: e.receivingPension } : {}
						})
					]),
			fact('UNION_DUES', k.start, { elections: { union_member: e.unionMember } }),
			fact('PIT', k.start, {
				elections: {
					eligible_dependents: e.dependants,
					...(e.dependants > 0 ? { dependents_registration_reference: 'DIFF-DEP' } : {})
				},
				// a resident's payment under a contract of less than three months, or after the contract: one declared payment
				...(e.taxResident &&
				((k.fixedEnd !== null &&
					vnOracle.monthsBetween(k.start, vnOracle.addDays(k.fixedEnd, 1)) < 3) ||
					(x !== null && x.date < last))
					? {
							unit_assessments: [
								{
									period: s.period,
									gross: oracle.PIT!.base!,
									units: 1,
									reference: 'DIFF-PAY',
									paid_on: last
								}
							]
						}
					: {})
			}),
			...inputs
		],
		employment: 'job',
		runs: [s.period]
	};
}
const vn = profile('VN', vnScenarios, vnMap, (s) => verdictOf(vnOracle.computePayslip(s)));

// ---------------------------------------------------------------------------------------------------------------
// MY (precedents: tests/e2e/probes/MY.ts `hrd`, `hire`, `worked`, `holiday`, `adhoc`, `leave`, `retrenched`,
// `exitLeave`, the TP3 openings and child claims)
// ---------------------------------------------------------------------------------------------------------------

const MY_TZ = '+08:00';
function myMap(s: MyScenario): Mapped {
	const e = s.employee;
	const j = s.employment;
	const m = s.month;
	const x = j.exit;
	if (j.payBasis !== 'MONTHLY' || j.employmentType !== 'FULL_TIME')
		unmapped('daily, hourly or part-time pay');
	if (e.presence !== undefined) unmapped('recorded presence periods');
	if (e.sch6Para21EmploymentDays !== undefined) unmapped('Sch.6 para 21 claim');
	if (x !== null && x.cause === 'RESIGNATION' && !x.noticeServed)
		unmapped('a resignation without notice (the employee owes)');
	const oracle = myOracle.computePayslip(s).lines;
	const last = lastDay(s.period);
	const end = x !== null && x.date < last ? x.date : last;
	const foreign = e.citizenship === 'FOREIGNER';
	const range = { from: j.hireDate, to: x?.date ?? j.contractEnd };
	const fact = (code: string, extra: Row = {}, from = j.hireDate): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			employment_id: '@job',
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from, to: range.to },
			status: { kind: 'REGISTERED', reference_number: `DIFF-${code}`, ...extra }
		}
	});
	const year = s.period.slice(0, 4);
	const tp3Months = Math.max(0, Number(j.hireDate.slice(5, 7)) - 1);
	const half = e.childrenHalf ?? 0;
	const pcb: Row = {
		elections: { zakat: e.zakat },
		...(e.children > 0
			? {
					child_claims: [
						{
							year,
							relief_class: 'UNDER_18',
							full_count: e.children - half,
							half_count: half,
							reference: 'TP1 child relief'
						}
					]
				}
			: {}),
		...(e.tp3 === undefined
			? {}
			: {
					opening: [
						{
							year,
							base: e.tp3.remuneration,
							employee: e.tp3.mtd,
							employer: 0,
							...(e.tp3.zakat > 0 ? { rebate: e.tp3.zakat } : {}),
							months: tp3Months,
							reference: 'TP3'
						}
					]
				})
	};
	// Act 800 from 1 January 2018; para 8: none due before 18 (an under-18 has no date yet)
	const eisFirst = [
		e.firstContributionDate,
		'2018-01-01',
		`${+e.birthDate.slice(0, 4) + 18}${e.birthDate.slice(4)}`
	]
		.sort()
		.at(-1)!;
	const facts: ProbeInput[] = [
		fact('EPF', {
			elections: foreign ? { member_before_1998: false } : {},
			...(e.tp3 === undefined
				? {}
				: {
						opening: [
							{ year, base: e.tp3.remuneration, employee: e.tp3.epf, employer: 0, reference: 'TP3' }
						]
					})
		}),
		fact('SOCSO', { elections: {}, first_contribution_due_on: e.firstContributionDate }),
		fact('EIS', {
			elections: foreign ? { mykas_resident: false } : {},
			...(eisFirst <= last ? { first_contribution_due_on: eisFirst } : {})
		}),
		fact('PCB', pcb),
		...(e.skbbkReleased
			? [
					fact(
						'SKBBK',
						{ elections: { skbbk_liability_released: true } },
						// a release exists only from the 8 July 2026 version (LINDUNG FAQ; MY-SKBBK-04)
						[`${s.period}-01`, j.hireDate, '2026-07-08'].sort().at(-1)!
					)
				]
			: [])
	];
	const holidays = new Set(m.holidays);
	const time: ProbeInput[] = [
		...m.work.map((w) => {
			const off = holidays.has(w.date) || weekendSkip(w.date);
			// a short shifted day punches its break as a gap (a start before 13:00 that crosses the lunch hour)
			return workDay(
				'job',
				w.date,
				clock(w.hours, w.hours <= 4 && !weekendSkip(w.date) ? '12:30' : '09:00'),
				MY_TZ,
				{
					approved_overtime_hours: off ? w.hours : Math.max(0, w.hours - 8)
				}
			);
		}),
		...ranges(m.unpaidLeave).map(([from, to]) =>
			leaveRow('job', 'UNPAID_LEAVE', from, to, { half_day_start: false, half_day_end: false })
		),
		...ranges(m.sickLeave ?? []).map(([from, to]) =>
			leaveRow(
				'job',
				'MEDICAL_LEAVE',
				from,
				to,
				{ half_day_start: false, half_day_end: false },
				{
					certificate_file: 'medical_leave-certificate.pdf'
				}
			)
		),
		...(m.paternityLeave === undefined || m.paternityLeave.length === 0
			? []
			: [
					leaveRow(
						'job',
						'PATERNITY_LEAVE',
						m.paternityLeave[0]!,
						m.paternityLeave.at(-1)!,
						{
							half_day_start: false,
							half_day_end: false,
							facts: { event_kind: 'BIRTH', event_date: m.paternityLeave[0]! }
						},
						{ certificate_file: 'paternity_leave-certificate.pdf' }
					)
				])
	];
	if (m.maternityFrom !== undefined) {
		// 98 consecutive days from confinement, one entry per month continuing the first as its episode
		const stop = addDays(m.maternityFrom, 97);
		for (
			let from = m.maternityFrom, n = 0;
			from <= stop;
			from = addDays(lastDay(from.slice(0, 7)), 1), n++
		) {
			const to = lastDay(from.slice(0, 7)) < stop ? lastDay(from.slice(0, 7)) : stop;
			const row = leaveRow(
				'job',
				'MATERNITY_LEAVE',
				from,
				to,
				{
					half_day_start: false,
					half_day_end: false,
					facts: { event_kind: 'BIRTH', event_date: m.maternityFrom },
					...(n > 0 ? { episode_id: '@maternity' } : {})
				},
				{ certificate_file: 'maternity_leave-certificate.pdf' }
			);
			time.push(n === 0 ? { ...row, ref: 'maternity' } : row);
		}
	}
	const pay: ProbeInput[] = [
		...(j.travelAllowanceOfficial > 0
			? [
					adhocRow(
						'job',
						'TRAVEL_OFFICIAL',
						j.travelAllowanceOfficial,
						`${s.period}-15` < end ? `${s.period}-15` : end,
						'Official travel'
					)
				]
			: []),
		...(m.bonus > 0
			? [
					adhocRow(
						'job',
						'BONUS',
						m.bonus,
						`${s.period}-15` < end ? `${s.period}-15` : end,
						'Bonus'
					)
				]
			: [])
	];
	let exit: Row = {};
	if (x !== null) {
		const given = x.noticeServed
			? { notice_given: true, notice_given_on: addDays(x.date, -60) }
			: { notice_given: false };
		const notice = (party: string) => ({
			leaving_malaysia: false,
			wages_12m: x.wages12m,
			notice_termination_party: party,
			notice_approved_apprenticeship: false,
			notice_exception: 'NONE',
			notice_waived_days: 0,
			...given
		});
		const byCause: Record<NonNullable<MyScenario['employment']['exit']>['cause'], Row> = {
			RESIGNATION: {
				exit_ground: 'RESIGNATION',
				exit_facts: { terminated_without_notice: false, ...notice('EMPLOYEE') }
			},
			EMPLOYER_TERMINATION: {
				exit_ground: 'RETRENCHMENT',
				exit_facts: {
					...notice('EMPLOYER'),
					notice_structural_ground: 'REDUCED_WORK',
					notice_exception_reference: 'DIFF retrenchment'
				}
			},
			MISCONDUCT_DISMISSAL: {
				exit_ground: 'DISMISSAL',
				exit_facts: { misconduct_dismissal: true, leaving_malaysia: false, wages_12m: x.wages12m }
			},
			CONTRACT_RETIREMENT: {
				exit_ground: 'RETIREMENT',
				exit_facts: {
					leaving_malaysia: false,
					wages_12m: x.wages12m,
					notice_termination_party: 'NEITHER'
				}
			},
			FIXED_TERM_EXPIRY: {
				exit_ground: 'END_OF_CONTRACT',
				exit_facts: {
					leaving_malaysia: false,
					wages_12m: x.wages12m,
					notice_termination_party: 'NEITHER'
				}
			}
		};
		exit = byCause[x.cause];
		for (const code of ['TERMINATION_BENEFIT', 'NOTICE_IN_LIEU'])
			if (oracle[code] !== undefined)
				pay.push(adhocRow('job', code, 0, x.date, `${code} on departure`));
		const encash = oracle.ENCASHMENT?.amount;
		if (encash !== undefined) {
			const d = Math.round((encash / ((j.rate + j.fixedAllowance) / 26)) * 1000) / 1000;
			pay.push(
				leaveRow(
					'job',
					'ANNUAL_LEAVE',
					`${x.date.slice(0, 4)}-01-01`,
					`${x.date.slice(0, 4)}-12-31`,
					{
						reference: 'DIFF-EXIT-ANNUAL',
						days: d,
						encash_days: d,
						effective_on: x.date,
						due_on: x.date
					}
				)
			);
		}
	}
	const c = s.company;
	const hrdFacts: Row =
		c.hrd === 'NOT_LIABLE'
			? {
					hrd_scope: 'PART_I',
					hrd_registration_class: 'NOT_REGISTERED',
					hrd_form2_count: c.hrdHeadcount ?? 0
				}
			: {
					hrd_scope: 'PART_I',
					hrd_registration_class: c.hrd,
					hrd_form2_count: c.hrdHeadcount ?? (c.hrd === 'COMPULSORY' ? 12 : 7),
					...(c.hrd === 'OPTIONAL' ? { hrd_optional_last_high_year: c.hrdHighRateYear ?? 0 } : {})
				};
	const married = e.pcbCategory !== 1;
	return {
		company: {
			facts: { ...hrdFacts, hrd_education_schedule_code: c.msic === '85302' ? '85302' : 'NONE' }
		},
		shared: [
			...week(['W', 'W', 'W', 'W', 'W', 'REST', 'REST'], dayVariant(8), 'MY'),
			...m.holidays.map((d) => holidayRow(d))
		],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: e.birthDate,
					gender: e.gender === 'F' || m.maternityFrom !== undefined ? 'FEMALE' : 'MALE',
					nationality: foreign ? 'Indonesian' : 'Malaysian',
					marital_status: married ? 'MARRIED' : 'SINGLE',
					spouse_status:
						e.pcbCategory === 2 ? 'WITHOUT_INCOME' : e.pcbCategory === 3 ? 'WITH_INCOME' : 'NONE',
					children: Array.from({ length: e.children }, () => ({
						child_birthdate: '2015-04-01',
						relationship: 'CHILD'
					}))
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'MY',
					effective_range: range,
					...exit
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: e.citizenship,
					...(e.taxResidency === 'UNKNOWN' ? {} : { tax_residency: e.taxResidency }),
					currency: 'MYR',
					base_salary: j.rate,
					...(j.fixedAllowance > 0
						? {
								allowances: [
									{ catalogue_id: '@law:allowance_catalogue:SUA', amount: j.fixedAllowance }
								]
							}
						: {}),
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: j.contractEnd === null ? 'PERMANENT' : 'CONTRACT',
					facts: { worksite_state: 'SELANGOR' },
					shift_pattern_id: '@rweek',
					effective_range: range
				}
			},
			...facts,
			...time,
			...pay
		],
		employment: 'job',
		runs: [s.period]
	};
}
const my = profile('MY', myScenarios, myMap, (s) => {
	const r = myOracle.computePayslip(s);
	return verdictOf(
		r,
		myOracle.probeLines(r),
		r.unresolved.map((u) => u.key)
	);
});

// ---------------------------------------------------------------------------------------------------------------
// PH (precedents: tests/e2e/probes/PH.ts `company`, `hire`, `separation`, the published holidays, work days)
// ---------------------------------------------------------------------------------------------------------------

/** The 2026 national days the PH oracle prices (tests/e2e/oracle/PH.ts REGULAR_HOLIDAYS / SPECIAL_DAYS, [PROC]). */
const PH_REGULAR = [
	'2026-01-01',
	'2026-03-20',
	'2026-04-02',
	'2026-04-03',
	'2026-04-09',
	'2026-05-01',
	'2026-05-27',
	'2026-06-12',
	'2026-08-31',
	'2026-11-30',
	'2026-12-25',
	'2026-12-30'
];
const PH_SPECIAL = [
	'2026-02-17',
	'2026-04-04',
	'2026-08-21',
	'2026-11-01',
	'2026-11-02',
	'2026-12-08',
	'2026-12-24',
	'2026-12-31'
];
const PH_TZ = '+08:00';
const PH_EXIT: Record<NonNullable<PHScenario['exitCause']>, Row> = {
	RESIGNATION: { exit_ground: 'RESIGNATION' },
	JUST_CAUSE: { exit_ground: 'DISMISSAL' },
	REDUNDANCY: { exit_ground: 'REDUNDANCY', exit_facts: { termination_cause: 'REDUNDANCY' } },
	LABOUR_SAVING: {
		exit_ground: 'REDUNDANCY',
		exit_facts: { termination_cause: 'LABOR_SAVING_DEVICES' }
	},
	RETRENCHMENT: { exit_ground: 'RETRENCHMENT', exit_facts: { termination_cause: 'RETRENCHMENT' } },
	CLOSURE: {
		exit_ground: 'RETRENCHMENT',
		exit_facts: { termination_cause: 'CLOSURE_NOT_DUE_TO_SERIOUS_LOSSES' }
	},
	DISEASE: {
		exit_ground: 'DISMISSAL',
		exit_facts: { termination_cause: 'DISEASE', terminated_for_disease: true }
	},
	RETIREMENT: { exit_ground: 'RETIREMENT' },
	KASAMBAHAY_UNJUST_DISMISSAL: {
		exit_ground: 'DISMISSAL',
		exit_facts: { kasambahay_unjust_dismissal: true }
	},
	KASAMBAHAY_UNJUSTIFIED_DEPARTURE: {
		exit_ground: 'RESIGNATION',
		exit_facts: { kasambahay_unjustified_departure: true }
	}
};
const PH_TAX: Record<PHScenario['employee']['residency'], string> = {
	CITIZEN: 'RESIDENT',
	RESIDENT_ALIEN: 'RESIDENT',
	NRA_ETB: 'NON_RESIDENT',
	NRA_NETB: 'NON_RESIDENT_NETB'
};
function phMap(s: PHScenario): Mapped {
	const e = s.employee;
	const j = s.employment;
	if (s.sector !== 'NON_AGRICULTURE')
		unmapped('a retail/service establishment of 15 or fewer (evidenced sector facts)');
	if (j.type === 'PART_TIME' || j.hoursPerDay !== 8) unmapped('part-time four-hour days');
	if (e.sssMemberBeforeSixty) unmapped('SSS membership before sixty');
	const oracle = phOracle.computePayslip(s).lines;
	const last = lastDay(s.period);
	const exit = j.exitDate ?? null;
	const end = exit !== null && exit < last ? exit : last;
	const mid = `${s.period}-15` < end ? `${s.period}-15` : end;
	const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
	const time: ProbeInput[] = s.work.map((w) => {
		// a shift that ends at or before its start ends on the next calendar day
		const overnight = minutes(w.end) <= minutes(w.start);
		const worked =
			(minutes(w.end) + (overnight ? 24 * 60 : 0) - minutes(w.start) - w.breakMinutes) / 60;
		const off =
			weekday(w.date) === 0 ||
			weekday(w.date) === 6 ||
			PH_REGULAR.includes(w.date) ||
			PH_SPECIAL.includes(w.date);
		const row = workDay('job', w.date, [[w.start, w.end]], PH_TZ, {
			...(weekday(w.date) >= 1 && weekday(w.date) <= 5 ? { shift_definition_id: '@office' } : {}),
			approved_overtime_hours: off ? worked : Math.max(0, worked - 8)
		});
		return overnight
			? {
					...row,
					values: {
						...row.values,
						worked_intervals: [
							{
								start: `${w.date}T${w.start}:00${PH_TZ}`,
								end: `${addDays(w.date, 1)}T${w.end}:00${PH_TZ}`
							}
						]
					}
				}
			: row;
	});
	for (const [from, to] of ranges(s.unpaidLeave))
		time.push(
			leaveRow('job', `UNPAID_LEAVE@${from}`, from, to, {
				half_day_start: false,
				half_day_end: false
			})
		);
	if (s.commission !== undefined)
		time.push(adhocRow('job', `COMMISSION@${mid}`, s.commission, mid, 'Commission'));
	if (s.performanceBonus !== undefined)
		time.push(adhocRow('job', `bonus@${mid}`, s.performanceBonus, mid, 'Performance bonus'));
	// separation classes and the 13th month are raised at 0 and priced by their catalogue formula
	const on = exit ?? (s.period.endsWith('-12') ? `${s.period}-15` : mid);
	for (const code of [
		'SEPARATION_PAY',
		'RETIREMENT_PAY',
		'KASAMBAHAY_INDEMNITY',
		'KASAMBAHAY_FORFEITURE',
		'THIRTEENTH_MONTH_PAY'
	])
		if (oracle[code] !== undefined)
			time.push(adhocRow('job', `${code}@${on}`, 0, on, `${code} on ${on}`));
	if (s.silDaysToEncash !== undefined && exit !== null)
		time.push(
			leaveRow(
				'job',
				`ANNUAL_LEAVE@${exit}`,
				`${exit.slice(0, 4)}-01-01`,
				`${exit.slice(0, 4)}-12-31`,
				{
					reference: 'DIFF-EXIT-SIL',
					days: s.silDaysToEncash,
					encash_days: s.silDaysToEncash,
					effective_on: exit,
					due_on: exit
				}
			)
		);
	const holidays = [
		...PH_REGULAR.filter((d) => d.startsWith(s.period)).map((d) =>
			holidayRow(d, 'Regular holiday')
		),
		...PH_SPECIAL.filter((d) => d.startsWith(s.period)).map((d) =>
			holidayRow(d, 'Special day', 'SPECIAL_HOLIDAY')
		)
	];
	const domestic = j.type === 'DOMESTIC';
	const foreign = e.citizenship === 'FOREIGN';
	const first =
		j.hireDate.slice(0, 4) === s.period.slice(0, 4)
			? j.hireDate.slice(0, 7)
			: `${s.period.slice(0, 4)}-01`;
	return {
		company: {
			facts: {
				small_establishment: false,
				retirement_exempt_establishment: false,
				minimum_wage_exemption_approved: j.minimumWageExemption
			}
		},
		shared: [...OFFICE, ...holidays],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					...(e.birthDate === null ? {} : { date_of_birth: e.birthDate }),
					gender: domestic ? 'FEMALE' : 'MALE',
					nationality: foreign ? 'Foreign' : 'Filipino'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'PH',
					effective_range: { from: j.hireDate, to: exit },
					...(s.exitCause === undefined ? {} : PH_EXIT[s.exitCause])
				}
			},
			// RA 11199 s.9(a): coverage at 60 is judged on the first contribution due date (this hire)
			...(e.birthDate !== null &&
			`${Number(e.birthDate.slice(0, 4)) + 60}${e.birthDate.slice(4)}` <= last
				? [
						registration('person', 'job', 'SSS', j.hireDate, {
							kind: 'REGISTERED',
							reference_number: 'DIFF-SSS',
							first_contribution_due_on: j.hireDate,
							elections: {}
						})
					]
				: []),
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: foreign ? 'FOREIGNER' : 'CITIZEN',
					tax_residency: PH_TAX[e.residency],
					currency: 'PHP',
					base_salary: j.monthlyBasic,
					pay_frequency: 'MONTHLY',
					work_classification: j.managerial ? 'MANAGERIAL' : 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: domestic
						? 'DOMESTIC'
						: j.type === 'APPRENTICE'
							? 'APPRENTICE'
							: 'PERMANENT',
					worksite: 'NCR/Manila',
					...(domestic ? {} : { worksite_sector: 'OTHER_NONAGRI' }),
					...(j.type === 'APPRENTICE' ? { facts: { ebet_program: 'APPRENTICESHIP' } } : {}),
					shift_pattern_id: '@week',
					effective_range: { from: j.hireDate, to: exit }
				}
			},
			...time
		],
		employment: 'job',
		runs: s.history === 'CONSTANT_BASIC' ? periodsFrom(first, s.period) : [s.period]
	};
}
const ph = profile('PH', phScenarios, phMap, (s) => {
	const r = phOracle.computePayslip(s);
	return verdictOf(r, r.refused === undefined ? phOracle.probeLines(r) : {});
});

// ---------------------------------------------------------------------------------------------------------------
// JP (precedents: tests/e2e/probes/JP.ts `jpWeek`, `personInputs`, `bonus`, `retirementAllowance`, `noticePay`,
// `worked`/`asked`, the company LABOUR facts)
// ---------------------------------------------------------------------------------------------------------------

const JP_TZ = '+09:00';
const JP_EXIT: Record<jpOracle.ExitCause, string> = {
	RESIGNATION: 'RESIGNATION',
	DISMISSAL: 'DISMISSAL',
	CONTRACT_END: 'END_OF_CONTRACT',
	RETIREMENT_AGE: 'RETIREMENT'
};
/** Completed service years, a part year counting as one (JP-TAX-25). */
const jpServiceYears = (hire: string, last: string) => {
	const end = addDays(last, 1);
	let y = 0;
	while (`${Number(hire.slice(0, 4)) + y + 1}${hire.slice(4)}` <= end) y += 1;
	return `${Number(hire.slice(0, 4)) + y}${hire.slice(4)}` < end ? y + 1 : y;
};
function jpMap(s: jpOracle.Scenario): Mapped {
	const e = s.employee;
	const x = s.exit;
	if (e.pensionCertificate) unmapped('a social-security agreement certificate');
	if (e.premiumExemptMonths.length > 0) unmapped('premium-exempt insurance months');
	const result = jpOracle.computePayslip(s);
	const last = lastDay(s.period);
	const end = x !== null && x.date < last ? x.date : last;
	const range = { from: e.hireDate, to: x?.date ?? null };
	const fact = (code: string, elections: Row): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			employment_id: '@job',
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: range,
			status: {
				kind: 'REGISTERED',
				reference_number: `DIFF-${code}`,
				since: e.hireDate,
				first_contribution_due_on: e.hireDate,
				elections
			}
		}
	});
	const c = e.commuting;
	const terms: Row = {
		annual_scheduled_hours: e.annualScheduledHours,
		withholding_column: e.withholding.column,
		withholding_dependants: e.withholding.dependants,
		...(e.residentTax === null
			? {}
			: {
					resident_tax_collection: 'SPECIAL',
					resident_tax_fiscal_year:
						Number(s.period.slice(0, 4)) - (Number(s.period.slice(5, 7)) < 6 ? 1 : 0),
					resident_tax_june_amount: e.residentTax.june,
					resident_tax_monthly_amount: e.residentTax.monthly,
					resident_tax_notice_reference: 'DIFF 特別徴収税額の決定通知書'
				}),
		...(c === null
			? {}
			: {
					...(c.mode === 'TRANSIT' ? { commute_transit_fare: c.amount } : {}),
					...(c.mode === 'MIXED' ? { commute_transit_fare: c.transitFare ?? 0 } : {}),
					...(c.mode === 'TRANSIT' ? {} : { commute_vehicle_km: c.km }),
					...(c.parking === undefined ? {} : { commute_parking_fee: c.parking })
				})
	};
	const notRegistered = (code: string, why: string): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			employment_id: '@job',
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: range,
			status: { kind: 'NOT_REGISTERED', reason: why, declaration_reference: `DIFF-${code}-NOT-REG` }
		}
	});
	const facts: ProbeInput[] = [
		e.health.registered
			? fact('HEALTH', { standard_monthly_remuneration: e.health.grade })
			: notRegistered('HEALTH', '健康保険法 §3: outside compulsory cover'),
		e.employmentInsurance.registered
			? fact(
					'EMPLOYMENT_INSURANCE',
					e.employmentInsurance.category === 'GENERAL'
						? {}
						: { insured_category: e.employmentInsurance.category }
				)
			: notRegistered('EMPLOYMENT_INSURANCE', '雇用保険法 §6: not an insured person'),
		// 所得税法 §190: the December last payment of a 甲欄 resident settles the year on the 基礎控除申告書
		...(s.period.endsWith('-12') && e.taxResident && e.withholding.column === 'KOU'
			? [fact('INCOME_TAX', { yearend_basic_declaration: true })]
			: [])
	];
	const time: ProbeInput[] = [
		...s.time.unpaidLeaveDays.map((d) => workDay('job', d, [], JP_TZ)),
		...ranges(s.time.paidLeaveDays).map(([from, to]) =>
			leaveRow('job', 'ANNUAL_LEAVE', from, to, { half_day_start: false, half_day_end: false })
		),
		...s.time.work.map((w) => {
			const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
			const at = (m: number) =>
				new Date(Date.parse(`${w.date}T00:00:00${JP_TZ}`) + m * 60_000).toISOString();
			const [a, b] = [min(w.start), min(w.end)];
			const noon = 12 * 60;
			const spans =
				w.breakMinutes > 0 && a < noon && noon + w.breakMinutes < b
					? [
							[a, noon],
							[noon + w.breakMinutes, b]
						]
					: [[a, b - w.breakMinutes]];
			const hours = (b - a - w.breakMinutes) / 60;
			const off = weekendSkip(w.date);
			return {
				collection: 'work_days',
				values: {
					employment_id: '@job',
					work_date: w.date,
					worked_intervals: spans.map(([f, t]) => ({ start: at(f!), end: at(t!) })),
					approved_overtime_hours: off ? hours : Math.max(0, hours - e.dailyHours)
				}
			} satisfies ProbeInput;
		})
	];
	const pay: ProbeInput[] = [];
	const mid = `${s.period}-15` < end ? `${s.period}-15` : end;
	if (s.bonus !== null) {
		pay.push(
			adhocRow('job', 'BONUS', s.bonus.amount, mid, '賞与'),
			fact('HEALTH_BONUS', {
				standard_bonus_fiscal_year_prior: s.bonus.priorFiscalStandardBonus,
				...(s.bonus.exempt ? { premium_exempt: true } : {})
			}),
			fact('INCOME_TAX_BONUS', { prior_month_net_pay: jpOracle.priorMonthNetPay(s) })
		);
	}
	let exit: Row = {};
	if (x !== null) {
		const mm = Number(x.date.slice(5, 7));
		exit = {
			exit_ground: JP_EXIT[x.cause],
			exit_facts: {
				retirement_income_declaration: x.retirementDeclaration,
				retirement_service_years: jpServiceYears(e.hireDate, x.date),
				...(e.residentTax === null
					? {}
					: {
							resident_tax_exit_collection:
								x.residentTaxLumpRequested || mm <= 4 ? 'LUMP_SUM' : 'ORDINARY'
						})
			}
		};
		if (x.retirementAllowance > 0)
			pay.push(adhocRow('job', 'RETIREMENT_ALLOWANCE', x.retirementAllowance, x.date, '退職手当'));
		const notice = result.lines.NOTICE_PAY?.amount ?? 0;
		if (notice > 0) {
			const row = adhocRow('job', 'DISMISSAL_NOTICE_PAY', 0, x.date, '解雇予告手当');
			// the recorded 平均賃金 is the oracle's art.12 average: the engine prices the days short of 30 on it
			const average_wage = notice / (30 - x.noticeDays);
			pay.push({
				...row,
				values: { ...row.values, facts: { notice_days_given: x.noticeDays, average_wage } }
			});
		}
	}
	return {
		company: {
			region: s.company.prefecture,
			facts: {
				employment_insurance_class: s.company.eiClass,
				workers_comp_business_type: s.company.wcBusinessType,
				...(s.company.wcMeritRate === null
					? {}
					: { workers_comp_merit_rate: s.company.wcMeritRate }),
				...(e.withholding.method === 'ELECTRONIC' ? { gensen_electronic_calculation: true } : {})
			}
		},
		shared: week(['W', 'W', 'W', 'W', 'W', 'REST', 'STAT'], dayVariant(e.dailyHours), 'JP'),
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: e.birthDate,
					gender: 'MALE',
					nationality: e.nationality === 'JP' ? 'Japanese' : 'Foreign'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'JP',
					effective_range: range,
					...exit
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: e.nationality === 'JP' ? 'CITIZEN' : 'FOREIGNER',
					tax_residency: e.taxResident ? 'RESIDENT' : 'NON_RESIDENT',
					currency: 'JPY',
					base_salary: e.monthlySalary,
					pay_frequency: 'MONTHLY',
					work_classification: 'LSA_COVERED',
					employment_type: e.dailyHours < 8 ? 'PART_TIME' : 'PERMANENT',
					worksite: s.company.prefecture,
					shift_pattern_id: '@rweek',
					facts: terms,
					...(c === null
						? {}
						: {
								allowances: [
									{ catalogue_id: '@law:allowance_catalogue:COMMUTING', amount: c.amount }
								]
							}),
					effective_range: range
				}
			},
			...facts,
			...time,
			...pay
		],
		employment: 'job',
		runs: [s.period]
	};
}
const jp = profile('JP', jpScenarios, jpMap, (s) => {
	const r = jpOracle.computePayslip(s);
	const star = r.unsupported.find((u) => u.startsWith('*'));
	if (star !== undefined) unmapped(`the oracle declines the slip: ${star}`);
	// "INCOME_TAX (…)" / "RETIREMENT_INCOME_TAX, RESIDENT_TAX_RETIREMENT (…)": those codes are not priced
	const codes = r.unsupported.flatMap((u) => u.split(' (')[0]!.split(', '));
	return verdictOf(r, r.refused === null ? jpOracle.probeLines(r) : {}, codes);
});

// ---------------------------------------------------------------------------------------------------------------
// ID (precedents: tests/e2e/probes/ID.ts `week`, `sixDayWeek`, `worker`, `registered`, `adhoc`, `punch`/`ordered`,
// `leave`, `company`, `departure`)
// ---------------------------------------------------------------------------------------------------------------

const ID_TZ = '+07:00';
const ID_PLACE: Record<idOracle.Workplace, string> = {
	DKI: 'Provinsi DKI Jakarta',
	KOTA_BEKASI: 'Provinsi Jawa Barat/Kota Bekasi',
	KAB_BEKASI: 'Provinsi Jawa Barat/Kabupaten Bekasi',
	KOTA_BANJAR: 'Provinsi Jawa Barat/Kota Banjar',
	SURABAYA: 'Provinsi Jawa Timur/Kota Surabaya',
	SEMARANG: 'Provinsi Jawa Tengah/Kota Semarang',
	DENPASAR: 'Provinsi Bali/Kota Denpasar',
	BADUNG: 'Provinsi Bali/Kabupaten Badung'
};
const ID_EXIT: Partial<Record<idOracle.ExitCause, [ground: string, cause: string | null]>> = {
	MERGER: ['REDUNDANCY', 'MERGER_CONSOLIDATION_SEPARATION'],
	TAKEOVER: ['REDUNDANCY', 'ACQUISITION'],
	TAKEOVER_TERMS_REFUSED: ['RESIGNATION', 'ACQUISITION_TERMS_CHANGE_REJECTED'],
	EFFICIENCY_LOSS: ['REDUNDANCY', 'EFFICIENCY_ACTUAL_LOSS'],
	EFFICIENCY_PREVENT_LOSS: ['REDUNDANCY', 'EFFICIENCY_PREVENT_LOSS'],
	CLOSURE_LOSS: ['RETRENCHMENT', 'CLOSURE_LOSS'],
	CLOSURE_NO_LOSS: ['RETRENCHMENT', 'CLOSURE_NO_LOSS'],
	FORCE_MAJEURE_CLOSURE: ['RETRENCHMENT', 'FORCE_MAJEURE_CLOSURE'],
	FORCE_MAJEURE_NO_CLOSURE: ['RETRENCHMENT', 'FORCE_MAJEURE_NO_CLOSURE'],
	PKPU_LOSS: ['RETRENCHMENT', 'DEBT_SUSPENSION_LOSS'],
	PKPU_NO_LOSS: ['RETRENCHMENT', 'DEBT_SUSPENSION_NO_LOSS'],
	BANKRUPTCY: ['RETRENCHMENT', 'BANKRUPTCY'],
	EMPLOYER_MISCONDUCT_REQUEST: ['RESIGNATION', 'EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT'],
	MISCONDUCT_CLAIM_REJECTED: ['DISMISSAL', 'EMPLOYEE_REQUEST_REJECTED'],
	RESIGNATION: ['RESIGNATION', 'VOLUNTARY_RESIGNATION'],
	ABSENT_FIVE_DAYS: ['DISMISSAL', 'UNEXCUSED_ABSENCE'],
	WARNED_VIOLATION: ['DISMISSAL', 'VIOLATION_AFTER_WARNINGS'],
	URGENT_VIOLATION: ['DISMISSAL', 'URGENT_VIOLATION'],
	LONG_ILLNESS: ['DISMISSAL', 'LONG_ILLNESS_OR_WORK_ACCIDENT_DISABILITY'],
	RETIREMENT: ['RETIREMENT', 'RETIREMENT'],
	DEATH: ['DEATH', 'DEATH'],
	CONTRACT_END: ['END_OF_CONTRACT', null]
};
const ID_UMSP: Record<idOracle.UmspCondition, Row> = {
	EXPORT: { umsp_export_oriented: true },
	ASSETS_OVER_1T: { umsp_assets_over_1_trillion: true },
	ASTRA_GROUP: { umsp_astra_group: true },
	HOTEL_4_5_STAR: { umsp_hotel_star: 5 }
};
function idMap(s: idOracle.Scenario): Mapped {
	const co = s.company;
	const ee = s.employee;
	const em = s.employment;
	const inp = s.inputs;
	if (em.type === 'NON_EMPLOYEE') unmapped('a non-employee service fee');
	if (em.payBasis !== 'MONTHLY' || em.partTime) unmapped('an hourly, daily or part-time wage');
	if (co.padatKarya) unmapped('PP 7/2025 labour-intensive JKK relief');
	if (co.dtpKlu) unmapped('PMK 105/2025 DTP incentive');
	if (ee.foreignWorkMonths > 0 || ee.subjectivePartYear || ee.jpDeferral || ee.zakat > 0)
		unmapped('foreign prior work, a part-year subject, a JP deferral or zakat');
	if (em.nonFixedAllowance > 0 || inp.bonus > 0 || inp.reducedPay !== null)
		unmapped('a non-fixed allowance, a bonus or reduced pay');
	if (em.exitCause !== null && ID_EXIT[em.exitCause] === undefined)
		unmapped(`exit ${em.exitCause}`);
	const verdict = idOracle.computePayslip(s);
	const period = s.period;
	const last = lastDay(period);
	const end = em.exitDate !== null && em.exitDate < last ? em.exitDate : last;
	const holidaysNeeded = inp.overtime
		.filter((o) => o.kind === 'HOLIDAY' || o.kind === 'HOLIDAY_SHORT_DAY')
		.map((o) => o.date);
	const married = ee.ptkp.startsWith('K/');
	const dependants = Number(ee.ptkp.slice(-1));
	const citizen = ee.citizen;
	const range = { from: em.hireDate, to: em.exitDate ?? em.contractEnd };
	const segments =
		em.raise === null
			? [{ wage: em.basic, from: em.hireDate, to: range.to }]
			: [
					{ wage: em.basic, from: em.hireDate, to: addDays(em.raise.from, -1) },
					{ wage: em.raise.basic, from: em.raise.from, to: range.to }
				];
	const reg = (code: string, elections: Row, employment = true): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			...(employment ? { employment_id: '@job' } : {}),
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from: em.hireDate, to: null },
			status: { kind: 'REGISTERED', reference_number: `DIFF-${code}`, elections }
		}
	});
	const rows: ProbeInput[] = [
		...(ee.taxResident
			? [
					reg(
						'PPH21',
						{
							recipient_class: 'REGULAR_EMPLOYEE',
							ptkp_marital_status: married ? 'MARRIED' : 'SINGLE',
							ptkp_dependants: dependants,
							no_tax_id: !ee.hasTaxId
						},
						false
					)
				]
			: []),
		...(ee.jpRegistered ? [reg('JP', {})] : []),
		...(ee.kesehatanExtraMembers > 0
			? [reg('KESEHATAN', { extra_members: ee.kesehatanExtraMembers })]
			: [])
	];
	// UU 13/2003 art 93(4): per-event leave carries its dated event
	const EVENT: Partial<Record<string, Row>> = {
		MARRIAGE: { event_kind: 'MARRIAGE', event_relationship: 'SELF' },
		BEREAVEMENT: { event_kind: 'DEATH', event_relationship: 'PARENT' },
		PATERNITY: { event_kind: 'BIRTH', event_relationship: 'CHILD' }
	};
	const time: ProbeInput[] = [
		...ranges(inp.unpaidDates).map(([from, to]) => leaveRow('job', 'UNPAID_LEAVE', from, to)),
		...inp.paidLeave.flatMap((l) =>
			ranges(l.dates).map(([from, to]) =>
				leaveRow(
					'job',
					`${l.kind}_LEAVE`,
					from,
					to,
					EVENT[l.kind] === undefined ? {} : { facts: { ...EVENT[l.kind], event_date: from } },
					l.kind === 'MENSTRUAL' ? { certificate_file: 'menstrual-leave.pdf' } : undefined
				)
			)
		),
		...inp.overtime.map((o) => {
			const weekdayOt = o.kind === 'ORDINARY';
			const hours = weekdayOt ? (co.workWeek === 6 ? 7 : 8) + o.hours : o.hours;
			return workDay('job', o.date, clock(hours, co.workWeek === 6 ? '08:00' : '09:00'), ID_TZ, {
				approved_overtime_hours: o.hours
			});
		})
	];
	const oracleCodes = verdict.components;
	const pay: ProbeInput[] = [];
	if (inp.wageDeduction > 0)
		pay.push(
			adhocRow(
				'job',
				'DEDUCTION',
				inp.wageDeduction,
				`${period}-15` < end ? `${period}-15` : end,
				'PP 36/2021 art.63 deduction'
			)
		);
	const thr = inp.thrHolidayDate;
	// raised whenever the scenario asks for THR, so an ineligible request is refused as the oracle refuses it;
	// dated H−7, the seed's THR_HOLIDAY due date (Permenaker 6/2016 art 5(4))
	if (thr !== null) {
		const due = addDays(thr, -7) < end ? addDays(thr, -7) : end;
		pay.push(adhocRow('job', 'THR', 0, due < `${period}-01` ? `${period}-01` : due, 'THR'));
	}
	let exit: Row = {};
	if (em.exitCause !== null && em.exitDate !== null) {
		const [ground, cause] = ID_EXIT[em.exitCause]!;
		exit = {
			exit_ground: ground,
			exit_facts: {
				micro_small_enterprise: co.microSmall,
				pension_offset_applies: false,
				thr_holiday_date: thr ?? '2026-03-21',
				...(cause === null ? {} : { termination_cause: cause }),
				separation_wage_basis: 'MONTHLY',
				...(inp.uangPisah > 0
					? {
							separation_pay_amount: inp.uangPisah,
							separation_pay_reference: 'DIFF-PKB-UANG-PISAH'
						}
					: {})
			}
		};
		for (const code of ['PESANGON', 'UPMK', 'UANG_PISAH', 'PKWT_COMPENSATION'])
			if (oracleCodes[code] !== undefined)
				pay.push(adhocRow('job', code, 0, em.exitDate, `${code} on departure`));
	}
	const sixDay = co.workWeek === 6;
	return {
		company: {
			region: ID_PLACE[co.workplace],
			...(co.jkkRiskGroup === null ? {} : { risk_class: co.jkkRiskGroup }),
			facts: {
				enterprise_size_class: co.microSmall ? 'MICRO_OR_SMALL' : 'OTHER',
				...Object.assign({}, ...co.umspConditions.map((c) => ID_UMSP[c]))
			}
		},
		shared: [
			...(sixDay
				? week(
						// PP 35/2021 art 21(2)(a): six days of 40 hours, the sixth a 5-hour day
						['W', 'W', 'W', 'W', 'W', 'SHORT', 'REST'],
						{ start_time: '08:00', end_time: '16:00', break_minutes: 60 },
						'ID6',
						{ start_time: '08:00', end_time: '13:00', break_minutes: 0 }
					)
				: week(['W', 'W', 'W', 'W', 'W', 'REST', 'REST'], dayVariant(8), 'ID')),
			...holidaysNeeded.map((d) => holidayRow(d))
		],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: ee.birthDate,
					gender: inp.paidLeave.some((l) => l.kind === 'MENSTRUAL') ? 'FEMALE' : 'MALE',
					marital_status: married ? 'MARRIED' : 'SINGLE',
					spouse_status: married ? 'WITHOUT_INCOME' : 'NONE',
					dependents_count: dependants,
					nationality: citizen ? 'Indonesian' : 'Malaysian',
					...(thr === null ? {} : { religion: thr.endsWith('12-25') ? 'CHRISTIAN' : 'ISLAM' })
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'ID',
					effective_range: range,
					...exit
				}
			},
			...segments.map((seg): ProbeInput => ({
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: citizen ? 'CITIZEN' : 'FOREIGNER',
					tax_residency: ee.taxResident ? 'RESIDENT' : 'NON_RESIDENT',
					currency: 'IDR',
					base_salary: seg.wage,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: em.type === 'PKWT' ? 'CONTRACT' : 'PERMANENT',
					worksite: ID_PLACE[co.workplace],
					worksite_sector: co.kbli,
					facts: { worksite_sector_edition: '2020' },
					...(em.fixedAllowance > 0
						? {
								allowances: [
									{
										catalogue_id: '@law:allowance_catalogue:HOUSE_ALLOWANCE',
										amount: em.fixedAllowance
									}
								]
							}
						: {}),
					shift_pattern_id: '@rweek',
					effective_range: { from: seg.from, to: seg.to }
				}
			})),
			...rows,
			...time,
			...pay
		],
		employment: 'job',
		runs: s.runs
	};
}
const id = profile('ID', idScenarios, idMap, (s) => {
	const r = idOracle.computePayslip(s);
	const refused = r.refused ?? (r.inputsRefused.length > 0 ? r.inputsRefused.join('; ') : null);
	return { ...verdictOf({ refused }, refused === null ? idOracle.probeLines(r) : {}) };
});

// ---------------------------------------------------------------------------------------------------------------
// CN-shanghai (precedents: tests/e2e/probes/CN-shanghai.ts `cnWeek`, `hire`, `iitRegistration`, `bonus`, `run`, the
// published holidays, the paid-leave and exit rows)
// ---------------------------------------------------------------------------------------------------------------

const CN_TZ = '+08:00';
/** Whole-period wages before the first run, as opening wage periods: LCL Implementing Regulation art.27 and
 * 年休假实施办法 art.11 average the twelve months before the exit. A part first month records its covered share. */
const cnOpenings = (hire: string, firstRun: string, wage: number): ProbeInput[] =>
	periodsFrom(
		hire.slice(0, 7) > addDays(`${firstRun}-01`, -365).slice(0, 7)
			? hire.slice(0, 7)
			: addDays(`${firstRun}-01`, -365).slice(0, 7),
		addDays(`${firstRun}-01`, -1).slice(0, 7)
	).map((ym) => {
		const from = hire > `${ym}-01` ? hire : `${ym}-01`;
		const share = (monthDays(ym).length - monthDays(ym).indexOf(from)) / monthDays(ym).length;
		return {
			collection: 'employment_wage_periods',
			values: {
				employment_id: '@job',
				period: { from, to: lastDay(ym) },
				currency: 'CNY',
				normal_wages: Math.round(wage * share * 100) / 100,
				due_on: lastDay(ym),
				paid_on: lastDay(ym),
				reference: `${ym} opening`
			}
		};
	});
const SH_EXIT: Partial<Record<NonNullable<ShScenario['exit']>['ground'], [string, string]>> = {
	ART36_EMPLOYER: ['MUTUAL', 'ART_36_EMPLOYER'],
	ART36_EMPLOYEE: ['MUTUAL', 'ART_36_WORKER'],
	ART37: ['RESIGNATION', 'ART_37'],
	ART38: ['RESIGNATION', 'ART_38'],
	ART39: ['DISMISSAL', 'ART_39'],
	ART40: ['DISMISSAL', 'ART_40'],
	ART41: ['REDUNDANCY', 'ART_41'],
	ART44_EXPIRY: ['END_OF_CONTRACT', 'ART_44_1'],
	ART87: ['DISMISSAL', 'ART_87']
};
/** A statutory paid leave's event facts by catalogue code (tests/e2e/probes/CN-shanghai.ts paid-leave rows). */
const cnLeaveFacts = (code: string, from: string, detail?: string): Row =>
	code === 'MARRIAGE_LEAVE'
		? { event_kind: 'MARRIAGE', event_date: addDays(from, -2) }
		: code === 'FUNERAL_LEAVE'
			? { event_kind: 'DEATH', event_relationship: 'PARENT', event_date: addDays(from, -2) }
			: code === 'PATERNITY_LEAVE'
				? { event_kind: 'BIRTH', event_date: addDays(from, -2) }
				: code === 'FAMILY_PLANNING_PROCEDURE_LEAVE'
					? { event_kind: (detail ?? '').toUpperCase().replaceAll(' ', '_'), event_date: from }
					: {};
/** One overtime entry on the CN calendar: extended hours on a working day, whole hours on a rest day or holiday. */
function cnOvertime(
	o: { date: string; hours: number; compensatoryRest?: boolean },
	type: string,
	weekend: boolean,
	budget: { left: number }
) {
	if (o.compensatoryRest) unmapped('rest-day work with compensatory rest');
	if ((type === 'WORKDAY' && weekend) || (type === 'REST' && !weekend))
		unmapped(`overtime on a 调休 day ${o.date}`);
	// LL art.41: at most 3 approved hours a day and 36 a month; the excess is keyed as incentive hours (CN-N40)
	const ok = type === 'WORKDAY' ? Math.max(0, Math.min(o.hours, 3, budget.left)) : o.hours;
	if (type === 'WORKDAY') budget.left -= ok;
	return workDay('job', o.date, clock(type === 'WORKDAY' ? 8 + o.hours : o.hours), CN_TZ, {
		approved_overtime_hours: ok,
		...(o.hours > ok ? { incentive_hours: o.hours - ok } : {})
	});
}
function shMap(s: ShScenario): Mapped {
	const w = s.worker;
	const e = s.employment;
	const m = s.month;
	const x = s.exit;
	if (e.kind !== 'FULL_TIME') unmapped('part-time hourly work');
	if (m.maternity !== undefined || m.internalRetirement !== undefined)
		unmapped('maternity or internal retirement');
	if (Object.keys(s.claims).length > 0)
		unmapped('contract claims (probation, written contract, open-ended)');
	if (x?.earlyRetirement !== undefined || (x !== null && SH_EXIT[x.ground] === undefined))
		unmapped('early retirement');
	if (s.tax.annualBonusSeparateUsedThisYear)
		unmapped('a separate annual bonus already used this year');
	if (m.paidLeave.some((l) => l.code === 'WORK_INJURY_LEAVE'))
		unmapped('Shanghai work-injury leave (CN-SH20 GAP: no catalogue class)');
	const result = shOracle.computePayslip(s);
	const runs = shOracle.runsFor(s);
	const range = { from: e.hireDate, to: e.exitDate };
	const holidays = runs.flatMap((ym) =>
		monthDays(ym).filter((d) => shOracle.dayType(d) === 'HOLIDAY')
	);
	const workdays = monthDays(s.period).filter(
		(d) =>
			shOracle.dayType(d) === 'WORKDAY' &&
			d >= e.hireDate &&
			(e.exitDate === null || d <= e.exitDate)
	);
	const take = days(workdays);
	const last = lastDay(s.period);
	const end = e.exitDate !== null && e.exitDate < last ? e.exitDate : last;
	const mid = `${s.period}-15` < end ? `${s.period}-15` : end;
	// one 36-hour art.41 budget per month, spent in date order
	const budgets = new Map<string, { left: number }>();
	const overtime = (list: readonly Parameters<typeof cnOvertime>[0][]) =>
		[...list]
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((o) => {
				const ym = o.date.slice(0, 7);
				if (!budgets.has(ym)) budgets.set(ym, { left: 36 });
				return cnOvertime(o, shOracle.dayType(o.date), weekendSkip(o.date), budgets.get(ym)!);
			});
	const inputs: ProbeInput[] = [
		...ranges(take(m.unpaidLeaveDays)).map(([from, to]) =>
			leaveRow('job', 'UNPAID_LEAVE', from, to)
		),
		...overtime(m.overtime),
		...s.earlier.flatMap((x) => [
			...overtime(x.overtime ?? []),
			...(x.bonus ? [adhocRow('job', 'BONUS', x.bonus, `${x.ym}-15`, 'Bonus')] : [])
		]),
		...(m.bonus > 0 ? [adhocRow('job', 'BONUS', m.bonus, mid, 'Bonus')] : []),
		...(m.annualBonusSeparate > 0
			? [adhocRow('job', 'ANNUAL_BONUS_SEPARATE', m.annualBonusSeparate, mid, 'Annual bonus')]
			: []),
		...Object.entries(m.nonWage).map(([code, amount]) =>
			adhocRow('job', code, amount ?? 0, mid, code, {
				files: { evidence_file: `${code.toLowerCase()}.pdf` }
			})
		),
		...m.paidLeave.map((l) =>
			leaveRow(
				'job',
				l.code,
				l.from,
				l.to,
				{ facts: cnLeaveFacts(l.code, l.from, l.detail) },
				['FAMILY_PLANNING_PROCEDURE_LEAVE', 'SICK_LEAVE', 'WORK_INJURY_LEAVE'].includes(l.code)
					? { certificate_file: `${l.code.toLowerCase()}.pdf` }
					: undefined
			)
		)
	];
	let exit: Row = {};
	if (x !== null && e.exitDate !== null) {
		inputs.push(...cnOpenings(e.hireDate, runs[0]!, e.monthlyWage));
		const [ground, lcl] = SH_EXIT[x.ground]!;
		exit = {
			exit_ground: ground,
			exit_facts: {
				lcl_termination_ground: lcl,
				notice_days_given: x.noticeDaysGiven,
				renewal_offer_refused: x.renewalOfferRefused
			}
		};
		if (result.components.SEVERANCE_PAY !== undefined)
			inputs.push(adhocRow('job', 'SEVERANCE_PAY', 0, e.exitDate, 'Economic compensation'));
		const encash = result.components.ANNUAL_LEAVE_ENCASHMENT;
		if (encash !== undefined) {
			// the payable days: the encashment is days × 200% of the 21.75-day wage
			const d = Math.round((encash * 21.75) / (2 * e.monthlyWage));
			inputs.push(
				leaveRow(
					'job',
					'ANNUAL_LEAVE',
					`${e.exitDate.slice(0, 4)}-01-01`,
					`${e.exitDate.slice(0, 4)}-12-31`,
					{
						reference: 'DIFF-EXIT-ANNUAL',
						encash_days: d,
						effective_on: e.exitDate,
						due_on: e.exitDate
					}
				)
			);
		}
	}
	const sd = s.tax.specialDeductions;
	const claims = runs.flatMap((ym) =>
		(
			[
				['CHILD_EDUCATION', 2000 * sd.childEducationChildren],
				['INFANT_CARE', 2000 * sd.infantCareChildren],
				['ELDERLY_SUPPORT', sd.elderSupport],
				['HOUSING_RENT', sd.rent ? 1500 : 0],
				['HOUSING_LOAN_INTEREST', sd.loanInterest ? 1000 : 0]
			] as const
		)
			.filter(([, amount]) => amount > 0)
			.map(([category, amount]) => ({
				period: ym,
				category,
				amount,
				source: 'EMPLOYEE',
				reference: `${category}-${ym}`
			}))
	);
	const reg = (code: string, status: Row): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			employment_id: '@job',
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from: e.hireDate, to: null },
			status: { kind: 'REGISTERED', reference_number: `DIFF-${code}`, ...status }
		}
	});
	const c = s.contributions;
	const pct = (r: number) => Math.round(r * 1e6) / 1e4;
	return {
		// The Shanghai profile of the CN lineage: a Shanghai-registered entity, SHANGHAI worksites.
		company: {
			settings_code: 'CN',
			region: 'SHANGHAI',
			facts: {
				injury_rate: pct(c.injuryRate),
				unemployment_employer_rate: pct(c.unemploymentEmployerRate2026),
				unemployment_employee_rate: 0.5,
				housing_fund_rate: pct(c.hfRate),
				housing_fund_supplementary_rate: pct(c.hfSupplementaryRate)
			}
		},
		shared: [
			...week(['W', 'W', 'W', 'W', 'W', 'REST', 'REST'], dayVariant(8), 'CN'),
			...holidays.map((d) => holidayRow(d, '法定节假日'))
		],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: w.birthDate,
					gender: w.sex === 'F' ? 'FEMALE' : 'MALE',
					nationality: w.citizenship === 'CN' ? 'Chinese' : 'Foreign',
					receiving_pension: w.pensionRecipient,
					...(m.paidLeave.some((l) => l.code === 'PATERNITY_LEAVE' || l.code === 'CHILDCARE_LEAVE')
						? { marital_status: 'MARRIED' }
						: {}),
					...(m.paidLeave.some((l) => l.code === 'CHILDCARE_LEAVE')
						? {
								children: [
									{ child_birthdate: '2024-06-01', relationship: 'CHILD', citizenship: 'CITIZEN' }
								]
							}
						: {})
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'SH',
					effective_range: range,
					...(w.priorServiceMonths > 0 ? { prior_service_months: w.priorServiceMonths } : {}),
					...exit
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: w.citizenship === 'CN' ? 'CITIZEN' : 'FOREIGNER',
					tax_residency: w.taxResident ? 'RESIDENT' : 'NON_RESIDENT',
					currency: 'CNY',
					base_salary: e.monthlyWage,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: x?.ground === 'ART44_EXPIRY' ? 'CONTRACT' : 'PERMANENT',
					worksite: 'SHANGHAI',
					...(m.heatExposed
						? {
								allowances: [
									{
										catalogue_id: '@law:allowance_catalogue:HEAT_ALLOWANCE',
										amount: Math.max(300, m.heatAllowanceContract)
									}
								]
							}
						: {}),
					shift_pattern_id: '@rweek',
					effective_range: range
				}
			},
			...(w.pensionRecipient
				? []
				: [
						reg('PENSION', { elections: { contribution_base: c.siBase } }),
						reg('HOUSING_FUND', {
							elections: {
								contribution_base: c.hfBase,
								first_ever_account: c.hfFirstEver,
								...(w.citizenship === 'CN' ? {} : { voluntary_agreement: w.housingFundAgreement })
							}
						})
					]),
			reg('IIT', {
				elections: {
					first_wage_income_this_year: s.tax.firstWageIncomeThisYear,
					annual_60000_from_january: s.tax.annual60kElection,
					// The national cap reads it: above a sibling's 1,500 share, the declarant is an only child.
					...(sd.elderSupport > 1500 ? { elderly_support_only_child: true } : {})
				},
				...(claims.length > 0 ? { deduction_claims: claims } : {})
			}),
			...inputs
		],
		employment: 'job',
		runs
	};
}
const sh = profile('CN-shanghai', shScenarios, shMap, (s) => {
	const r = shOracle.computePayslip(s);
	// an unpriced item names its code first ("INJURY for a pensioned retiree …")
	return verdictOf(
		r,
		undefined,
		r.unpriced.map((u) => u.what.split(' ')[0]!)
	);
});

// ---------------------------------------------------------------------------------------------------------------
// CN-kunming (precedents: tests/e2e/probes/CN-kunming.ts `worker`, `adhoc`, `leave`, `punch`, the company facts)
// ---------------------------------------------------------------------------------------------------------------

const KM_SITE: Record<string, string> = {
	'Wuhua District': '云南省/昆明市/五华区',
	'Fumin County': '云南省/昆明市/富民县',
	'Mo Han': '云南省/西双版纳傣族自治州/勐腊县/磨憨镇'
};
const KM_EXIT: Record<NonNullable<KmScenario['exit']>['cause'], [string, string]> = {
	RESIGNATION: ['RESIGNATION', 'ART_37'],
	MISCONDUCT: ['DISMISSAL', 'ART_39'],
	MUTUAL_EMPLOYER: ['MUTUAL', 'ART_36_EMPLOYER'],
	ART40: ['DISMISSAL', 'ART_40'],
	ART41: ['REDUNDANCY', 'ART_41'],
	EXPIRY: ['END_OF_CONTRACT', 'ART_44_1'],
	UNLAWFUL: ['DISMISSAL', 'ART_87'],
	RETIREMENT: ['RETIREMENT', 'ART_44_2_3']
};
function kmMap(s: KmScenario): Mapped {
	const ee = s.employee;
	const em = s.employment;
	const f = s.facts;
	const t = s.time;
	const p = s.pay;
	const x = s.exit;
	if (em.partTime !== undefined || em.agreedRegion !== undefined || em.probationWage !== undefined)
		unmapped('part-time, an agreed region or a probation wage');
	if (ee.chinaWorkDays !== undefined) unmapped('non-resident China workdays');
	if (f.siWaiverSigned || f.treatyExempt !== undefined)
		unmapped('an SI waiver or treaty exemption');
	if (s.contract !== undefined) unmapped('contract-formation claims');
	if (
		s.tax.specialDeductionsMonthly !== undefined ||
		s.tax.personalPensionMonthly !== undefined ||
		s.tax.commercialHealthMonthly !== undefined
	)
		unmapped('a declared monthly deduction total, personal pension or commercial health');
	if (s.tax.special?.continuingEducation !== undefined) unmapped('continuing education');
	if (t.stoppageDays !== undefined || t.nightHours !== undefined || t.leave !== undefined)
		unmapped('stoppage, night work or statutory leave');
	if (t.overtime?.restDayCompensatoryRest) unmapped('rest-day work with compensatory rest');
	if (p.bonus?.kind === 'MULTI_MONTH_NONRESIDENT' || p.bonus?.usedThisYear)
		unmapped('a multi-month non-resident bonus or a used separate bonus');
	if (
		p.maternity !== undefined ||
		p.heatDays !== undefined ||
		p.earlyRetirement !== undefined ||
		p.internalRetirement !== undefined ||
		p.courtOrder !== undefined ||
		p.lossClaim !== undefined
	)
		unmapped('maternity, heat days, retirement subsidies, a court order or a loss claim');
	if (x?.pre2008Compensation !== undefined) unmapped('pre-2008 compensation');
	const result = kmOracle.computePayslip(s);
	const runs = periodsFrom(s.runsFrom, s.period);
	const range = { from: em.hireDate, to: em.exitDate };
	const last = lastDay(s.period);
	const end = em.exitDate !== null && em.exitDate < last ? em.exitDate : last;
	const mid = `${s.period}-15` < end ? `${s.period}-15` : end;
	const holidays = runs.flatMap((ym) =>
		monthDays(ym).filter((d) => shOracle.dayType(d) === 'HOLIDAY')
	);
	const free = monthDays(s.period).filter(
		(d) => shOracle.dayType(d) === 'WORKDAY' && !weekendSkip(d) && d >= em.hireDate && d <= end
	);
	const take = days(free);
	const prorated =
		em.hireDate > `${s.period}-01` ||
		end < last ||
		(em.raise !== undefined && em.raise.from.startsWith(s.period));
	if (prorated && kmOracle.touchesAdjustedDay(`${s.period}-01`, last))
		unmapped('a prorated month holding a 调休 day (CN-N03.adjusted-workdays GAP)');
	const inputs: ProbeInput[] = [];
	for (const [from, to] of ranges(take(t.unpaidDays ?? 0)))
		inputs.push(
			leaveRow('job', 'UNPAID_LEAVE', from, to, { half_day_start: false, half_day_end: false })
		);
	const ot = t.overtime;
	if (ot !== undefined) {
		const daily = ot.maxDailyWeekdayHours ?? 3;
		// LL art.41: at most 3 approved hours a day and 36 a month; the excess is keyed as incentive hours (CN-N40)
		let approved = 0;
		for (let left = ot.weekdayHours ?? 0; left > 0; left -= daily) {
			const h = Math.min(daily, left);
			const ok = Math.max(0, Math.min(h, 3, 36 - approved));
			approved += ok;
			inputs.push(
				workDay('job', take(1)[0]!, clock(8 + h), CN_TZ, {
					approved_overtime_hours: ok,
					...(h > ok ? { incentive_hours: h - ok } : {}),
					time_off_in_lieu: false
				})
			);
		}
		const rest = monthDays(s.period).filter(
			(d) => shOracle.dayType(d) === 'REST' && weekendSkip(d) && d >= em.hireDate && d <= end
		);
		let r = 0;
		for (let left = ot.restDayHours ?? 0; left > 0; left -= 8) {
			const d = rest[r++] ?? unmapped('more rest-day overtime than rest days');
			inputs.push(
				workDay('job', d, clock(Math.min(8, left)), CN_TZ, {
					approved_overtime_hours: Math.min(8, left),
					time_off_in_lieu: false
				})
			);
		}
		let h = 0;
		const own = holidays.filter((d) => d.startsWith(s.period) && d >= em.hireDate && d <= end);
		for (let left = ot.holidayHours ?? 0; left > 0; left -= 8) {
			const d = own[h++] ?? unmapped('holiday overtime without a statutory holiday in the month');
			inputs.push(
				workDay('job', d, clock(Math.min(8, left)), CN_TZ, {
					approved_overtime_hours: Math.min(8, left),
					time_off_in_lieu: false
				})
			);
		}
	}
	if (p.bonus !== undefined)
		inputs.push(adhocRow('job', p.bonus.kind, p.bonus.amount, mid, p.bonus.kind.toLowerCase()));
	if (p.priorBonus !== undefined)
		inputs.push(
			adhocRow('job', 'BONUS', p.priorBonus.amount, `${p.priorBonus.period}-15`, 'bonus')
		);
	for (const sub of p.subsidies ?? [])
		inputs.push(
			adhocRow('job', sub.code, sub.amount, mid, sub.code, {
				files: { evidence_file: `${sub.code.toLowerCase()}.pdf` }
			})
		);
	let exit: Row = {};
	if (x !== undefined && em.exitDate !== null) {
		inputs.push(...cnOpenings(em.hireDate, runs[0]!, em.monthlyWage));
		const [ground, lcl] = KM_EXIT[x.cause];
		exit = {
			exit_ground: ground,
			exit_facts: {
				lcl_termination_ground: lcl,
				renewal_offer_refused: x.renewalOfferRefused ?? false,
				...(x.noticeDaysGiven === undefined ? {} : { notice_days_given: x.noticeDaysGiven }),
				...(x.transferredServiceMonths === undefined
					? {}
					: { lcl10_transferred_service_months: x.transferredServiceMonths })
			}
		};
		if (result.lines.SEVERANCE_PAY !== undefined)
			inputs.push(adhocRow('job', 'SEVERANCE_PAY', 0, em.exitDate, 'LCL art.47 经济补偿'));
		const encash = result.lines.ANNUAL_LEAVE_ENCASHMENT;
		if (encash !== undefined) {
			const d = Math.round((encash * 21.75) / (2 * em.monthlyWage));
			inputs.push(
				leaveRow(
					'job',
					'ANNUAL_LEAVE',
					`${em.exitDate.slice(0, 4)}-01-01`,
					`${em.exitDate.slice(0, 4)}-12-31`,
					{
						reference: 'DIFF-EXIT-ANNUAL',
						encash_days: d,
						effective_on: em.exitDate,
						due_on: em.exitDate
					}
				)
			);
		}
	}
	const d = s.tax.special;
	const claims =
		d === undefined
			? []
			: runs
					.filter((ym) => d.from === undefined || ym >= d.from)
					.flatMap((ym) =>
						(
							[
								['CHILD_EDUCATION', (d.children ?? 0) * 2000 * (d.childShare ?? 1)],
								['INFANT_CARE', (d.infants ?? 0) * 2000 * (d.childShare ?? 1)],
								['ELDERLY_SUPPORT', d.elderlyOnlyChild ? 3000 : (d.elderlyShare ?? 0)],
								['HOUSING_RENT', d.rent ? 1500 : 0],
								['HOUSING_LOAN_INTEREST', d.loanInterest ? 1000 : 0]
							] as const
						)
							.filter(([, amount]) => amount > 0)
							.map(([category, amount]) => ({
								period: ym,
								category,
								amount,
								source: 'EMPLOYEE',
								reference: `${category}-${ym}`
							}))
					);
	const siBase = f.siBase ?? em.monthlyWage;
	const status = (code: string, st: Row, employment = true): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			...(employment ? { employment_id: '@job' } : {}),
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from: em.hireDate, to: null },
			status: st
		}
	});
	const pensioner = ee.pensionRecipient === true;
	const regs: ProbeInput[] = [
		...(pensioner
			? []
			: [
					status(
						'PENSION',
						f.siRegistered
							? {
									kind: 'REGISTERED',
									reference_number: 'DIFF-SI',
									elections: { contribution_base: siBase }
								}
							: {
									kind: 'NOT_REGISTERED',
									reason: 'Registration pending',
									elections: { contribution_base: siBase },
									declaration_reference: 'DIFF-SI'
								},
						false
					)
				]),
		...(f.fundRate === null || pensioner
			? []
			: [
					status(
						'HOUSING_FUND',
						{
							kind: 'REGISTERED',
							reference_number: 'DIFF-HF',
							elections: {
								...(f.fundAccount === 'FIRST_EVER' ? { first_ever_account: true } : {}),
								contribution_base: f.fundAccount === 'EXISTING' ? (f.fundBase ?? siBase) : siBase,
								...(ee.citizenship === 'CN' ? {} : { voluntary_agreement: true })
							}
						},
						f.fundAccount === 'FIRST_EVER'
					)
				]),
		status('IIT', {
			kind: 'REGISTERED',
			reference_number: 'DIFF-IIT',
			elections: {
				first_wage_income_this_year: s.tax.firstIncomeThisYear ?? false,
				annual_60000_from_january: s.tax.basic60kElection ?? false
			},
			...(claims.length > 0 ? { deduction_claims: claims } : {})
		})
	];
	const segments =
		em.raise === undefined
			? [{ wage: em.monthlyWage, from: em.hireDate, to: em.exitDate }]
			: [
					{ wage: em.monthlyWage, from: em.hireDate, to: addDays(em.raise.from, -1) },
					{ wage: em.raise.monthlyWage, from: em.raise.from, to: em.exitDate }
				];
	const u = f.unemploymentRates ?? { employer: 0.007, employee: 0.003 };
	const pct = (r: number) => Math.round(r * 1e6) / 1e4;
	return {
		// The Kunming profile of the CN lineage: a Kunming-registered entity, Kunming worksites.
		company: {
			settings_code: 'CN',
			region: 'KUNMING',
			facts: {
				injury_rate: pct(f.injuryRate),
				housing_fund_rate: pct(f.fundRate ?? 0.12),
				...(s.period >= '2026-01'
					? {
							unemployment_employer_rate: pct(u.employer),
							unemployment_employee_rate: pct(u.employee)
						}
					: {})
			}
		},
		shared: [
			...week(['W', 'W', 'W', 'W', 'W', 'REST', 'REST'], dayVariant(8), 'KM'),
			...holidays.map((d) => holidayRow(d, '法定节假日'))
		],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: ee.name,
					date_of_birth: ee.birthDate,
					gender: 'MALE',
					nationality: ee.citizenship === 'CN' ? 'Chinese' : 'Foreign',
					receiving_pension: pensioner
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'KM',
					prior_service_months: ee.priorServiceMonths ?? 0,
					effective_range: range,
					...exit
				}
			},
			...segments.map((seg): ProbeInput => ({
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: ee.citizenship === 'CN' ? 'CITIZEN' : 'FOREIGNER',
					...(ee.taxResident === null
						? {}
						: { tax_residency: ee.taxResident ? 'RESIDENT' : 'NON_RESIDENT' }),
					currency: 'CNY',
					base_salary: seg.wage,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: x?.cause === 'EXPIRY' ? 'CONTRACT' : 'PERMANENT',
					worksite: KM_SITE[em.worksite] ?? unmapped(`worksite ${em.worksite}`),
					shift_pattern_id: '@rweek',
					effective_range: { from: seg.from, to: seg.to }
				}
			})),
			...regs,
			...inputs
		],
		employment: 'job',
		runs
	};
}
const km = profile('CN-kunming', kmScenarios, kmMap, (s) => {
	const r = kmOracle.computePayslip(s);
	return verdictOf(r, undefined, r.unpriced);
});

/** Every profile's adapter, by code. */
export const PROFILES: readonly Profile[] = [sg, th, tw, vn, my, ph, jp, id, sh, km];
