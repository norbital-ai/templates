import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	loadPack,
	openPglite,
	readPack,
	type EngineManifest,
	type Outcome
} from '@norbital-ai/bolt/engine';
import { testWorkspace } from '@norbital-ai/bolt/test';

/** The template root: `bolt test` runs from it. */
const root = `${process.cwd()}/`;
const built = (file: string) => readFileSync(`${root}.norbital/artifact/${file}`, 'utf8');

/** Two SG entities, the MY-nihon plant and the ID and PH companies of the bank's norbital_hr tree. */
export const NORBITAL_SG = '0cc7cdd4-848b-598e-8e4c-b8769c97f12b';
export const NIHON_MY = 'e7b313fc-e947-5b78-8066-97bea6644915';
export const OPS_PH = 'c09a2dc4-94bd-5d1c-adb7-e46a4f7cbe3f';
export const KDIT_ID = '5032dab9-8010-538a-ac4c-ce2219b84767';
/** Norbital Pte. Ltd.'s employment NHPADM03 (SGD 7,500 a month) and the SG version in force January–March 2026. */
export const SG_EMPLOYMENT = 'b1e00003-0000-4000-8000-000000000003';
export const SG_2026_Q1 = '91aec78c-9674-563c-8a1c-5390d670520b';
export const SG_2026_H2 = '04f345bd-7068-587d-888d-b0c073163300';
/** Dion Neo's employee record and email: NHPADM05 at Norbital Pte. Ltd. */
export const DION = 'dion.neo@norbital.ai';

/** Synthetic event facts absent from the bank's three Nihon family-leave rows. */
export async function recordNihonBirthDates(t: Awaited<ReturnType<typeof workspace>>) {
	for (const [id, date] of [
		['9e2712ee-9efa-5d32-ad52-734c34be0ae8', '2025-12-29'],
		['5b083fc2-cdd9-49e9-93ed-54af7e2fc4c1', '2026-01-12'],
		['0962001f-ec98-4e28-a243-10948e062eaa', '2026-01-12']
	] as const)
		await t.db.write({
			text: 'UPDATE leave_entries SET event_kind = $1, event_date = $2 WHERE id = $3',
			params: ['BIRTH', date, id]
		});
}

/**
 * A declared Peninsular worksite (`terms.facts.worksite_state`) for Nihon's otherwise state-less
 * sample terms.
 */
export async function recordNihonWorksites(t: Awaited<ReturnType<typeof workspace>>) {
	await t.db.write({
		text: `UPDATE employment_terms
		       SET facts = COALESCE(facts, '{}'::jsonb) || jsonb_build_object('worksite_state', $1::text)
		       WHERE employment_id IN (SELECT id FROM employments WHERE company_id = $2)`,
		params: ['SELANGOR', NIHON_MY]
	});
}

/** Synthetic negative MyKAS declaration for the plant's EIS registration facts. */
export async function recordNihonEisFacts(t: Awaited<ReturnType<typeof workspace>>) {
	await t.db.write({
		text: `UPDATE employment_statutory_facts AS fact
		       SET status = jsonb_set(status, '{elections}',
		         COALESCE(status->'elections', '{}'::jsonb) || '{"mykas_resident":false}'::jsonb)
		       WHERE statutory_contribution_id IN
		         (SELECT id FROM statutory_contributions WHERE code = 'EIS')
		       AND employee_id IN
		         (SELECT employee_id FROM employments WHERE company_id = $1)`,
		params: [NIHON_MY]
	});
}

/** Synthetic negative pre-1998 EPF membership declaration for this isolated payroll probe. */
export async function recordNihonEpfFacts(t: Awaited<ReturnType<typeof workspace>>) {
	await t.db.write({
		text: `UPDATE employment_statutory_facts AS fact
		       SET status = jsonb_set(status, '{elections}',
		         COALESCE(status->'elections', '{}'::jsonb) || '{"member_before_1998":false}'::jsonb)
		       WHERE statutory_contribution_id IN
		         (SELECT id FROM statutory_contributions WHERE code IN ('EPF', 'EPF_NON_CITIZEN'))
		       AND employee_id IN
		         (SELECT employee_id FROM employments WHERE company_id = $1)`,
		params: [NIHON_MY]
	});
}

/**
 * This template on the test kit, read from the build (`pnpm test` runs `bolt build --bank` first) so no suite
 * recompiles it, with the bank's sample pack: the public law, the entities, their people and their history.
 */
export async function workspace(options: { now?: string } = {}) {
	const now = options.now ?? '2026-02-25T02:00:00.000Z';
	const file = seedFile(now);
	const { db, pg } = await openPglite(
		existsSync(file) ? new Blob([readFileSync(file)]) : undefined
	);
	const t = await testWorkspace({
		manifest: JSON.parse(built('manifest.json')) as EngineManifest,
		guest: { source: built('guest.mjs') },
		transforms: (JSON.parse(built('artifact.json')) as { transforms: string[] }).transforms,
		now,
		db
	});
	if (!existsSync(file)) {
		await loadPack(t.db, t.manifest, readPack(`${root}.norbital/seed/sample`), t.clock.now());
		const partial = `${file}.${process.pid}`;
		writeFileSync(partial, new Uint8Array(await (await pg.dumpDataDir('none')).arrayBuffer()));
		renameSync(partial, file);
	}
	return t;
}
/**
 * The sample pack takes seconds to load (every entity, person and law row), so it loads once per build and clock and
 * each test starts from a copy of that database. The key holds the artifact, the pack and the Bolt build that made the
 * schema; a stale copy can only come from a Bolt build with the same path and mtime.
 */
function seedFile(now: string) {
	const bolt = statSync(createRequire(import.meta.url).resolve('@norbital-ai/bolt/engine'));
	const key = createHash('sha256')
		.update(
			[
				JSON.parse(built('artifact.json')).hash,
				JSON.parse(readFileSync(`${root}.norbital/seed/sample/pack.json`, 'utf8')).hash,
				now,
				bolt.mtimeMs,
				bolt.size
			].join('|')
		)
		.digest('hex')
		.slice(0, 24);
	const dir = join(tmpdir(), 'norbital-scratch', 'hr-seed');
	mkdirSync(dir, { recursive: true });
	return join(dir, `${key}.tar`);
}

/** Explicit valid SDL inputs for the three Singapore sample employments used by saved-write probes. */
export async function declareSgSdl(t: Awaited<ReturnType<typeof workspace>>, settingsId: string) {
	const admin = t.as(t.admin);
	const scheme = (
		await admin.read('statutory_contributions', {
			where: { settings_id: { eq: settingsId }, code: { eq: 'SDL' } },
			limit: 1
		})
	).rows[0]!;
	const employments = (
		await admin.read('employments', { where: { company_id: { eq: NORBITAL_SG } }, all: true })
	).rows;
	for (const employment of employments)
		committed(
			await admin.act('employment_statutory_facts.create', {
				employee_id: employment.employee_id,
				employment_id: employment.id,
				statutory_contribution_id: scheme.id,
				effective_range: { from: '2025-12-01', to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: 'SG-SDL-TEST',
					elections: {
						sdl_service_scope: 'SINGAPORE_SERVICE',
						sdl_household_role: 'NONE',
						sdl_wholly_exclusive: false,
						sdl_nonbusiness: false,
						sdl_student_class: 'NONE'
					}
				}
			})
		);
}

/**
 * The bank's Philippine people carry no birth date, and SSS coverage (with MPF) turns on age: the run refuses to guess.
 * Record one for each OPS PH employee, as HR must before assessing, so the probes price a working-age payroll.
 */
export async function recordPhBirthDates(
	t: Awaited<ReturnType<typeof workspace>>,
	born = '1990-01-15'
) {
	const admin = t.as(t.admin);
	const employments = (
		await admin.read('employments', { where: { company_id: { eq: OPS_PH } }, all: true })
	).rows;
	const people = [...new Set(employments.map((row) => String(row.employee_id)))];
	for (const id of people)
		committed(await admin.act('employees.update', { target: id, set: { date_of_birth: born } }));
	const company = await admin.get('companies', OPS_PH);
	committed(
		await admin.act('companies.update', {
			target: OPS_PH,
			set: {
				facts: {
					...(company?.facts ?? {}),
					ph_wage_one_establishment: true,
					ph_wage_worker_count: 20
				}
			}
		})
	);
	// The bank's earlier terms are consumed by saved sample slips. Supply this probe's site facts
	// in its isolated database fixture; the product correctly forbids rewriting consumed terms.
	await t.db.write({
		text: `UPDATE employment_terms SET worksite = $1, worksite_sector = $2
		       WHERE employment_id IN (SELECT id FROM employments WHERE company_id = $3)`,
		params: ['Laguna/Calamba', 'OTHER_NONAGRI', OPS_PH]
	});
}

/**
 * The bank's Philippine attendance punches one continuous span across the 60 minutes the shift
 * grants, and since the rest break became observational (PD 442 art.84(b)) that hour is worked
 * time, so a run refuses to price unplanned premium. Punch the granted break as a gap, from the
 * shift's midpoint, as the day sheet records it, and state the planned premium the clock still
 * overruns: a punch that ends after the shift is overtime the day must plan (owner's rule
 * 2026-09-23). Idempotent: a row already split is not split again, and a plan that already covers
 * the overrun is left alone.
 */
export async function recordPhShiftBreaks(t: Awaited<ReturnType<typeof workspace>>) {
	const shifts = (
		await t
			.as(t.admin)
			.read('shift_definitions', { where: { company_id: { eq: OPS_PH } }, all: true })
	).rows;
	const night = shifts.find((row) => row.code === 'OPSPH-NIGHT')!.id as string;
	const [result] = await t.db.read([
		{
			text: `SELECT id::text, work_date::text,
			         shift_definition_id::text, worked_intervals::text,
			         approved_overtime_hours::text, incentive_hours::text
			       FROM work_days`,
			params: []
		}
	]);
	const rows = (result?.rows ?? []) as readonly {
		readonly id: string;
		readonly work_date: string;
		readonly shift_definition_id: string | null;
		readonly worked_intervals: string;
		readonly approved_overtime_hours: string | null;
		readonly incentive_hours: string | null;
	}[];
	const HOUR = 3_600_000;
	const updates = rows.flatMap((row) => {
		if (row.shift_definition_id == null || row.worked_intervals == null) return [];
		const intervals = JSON.parse(row.worked_intervals) as { start: string; end: string }[];
		if (intervals.length === 0 || intervals.some((interval) => interval.end == null)) return [];
		const isNight = row.shift_definition_id === night;
		const midnight = Date.parse(`${row.work_date}T00:00:00.000Z`);
		const gapFrom = midnight + (isNight ? 18.5 : 5) * HOUR;
		const gapTo = midnight + (isNight ? 19.5 : 6) * HOUR;
		let punched = intervals;
		if (intervals.length === 1) {
			const [span] = intervals;
			if (Date.parse(span!.start) < gapFrom && gapTo < Date.parse(span!.end))
				punched = [
					{ start: span!.start, end: new Date(gapFrom).toISOString() },
					{ start: new Date(gapTo).toISOString(), end: span!.end }
				];
		}
		const shiftStart = midnight + (isNight ? 12.5 : 0.5) * HOUR;
		const worked = punched.reduce(
			(total, interval) =>
				total +
				Math.max(0, Date.parse(interval.end) - Math.max(Date.parse(interval.start), shiftStart)) /
					HOUR,
			0
		);
		const ordinary = Math.min(isNight ? 11 : 8, worked);
		const approved = Number(row.approved_overtime_hours ?? 0);
		const incentive = Number(row.incentive_hours ?? 0);
		const needed = worked - ordinary;
		const shortfall = Math.max(0, needed - approved - incentive);
		const planned =
			shortfall <= 1e-9
				? approved
				: (Math.round(approved * 100) + Math.ceil(shortfall * 100)) / 100;
		const changed = punched !== intervals || Math.abs(planned - approved) > 1e-9;
		if (!changed) return [];
		return [
			JSON.stringify({
				id: row.id,
				intervals: punched,
				approved: String(planned)
			})
		];
	});
	if (updates.length === 0) return;
	await t.db.write({
		text: `UPDATE work_days AS day
		       SET worked_intervals = state.intervals,
		           approved_overtime_hours = state.approved::numeric
		       FROM jsonb_to_recordset($1::jsonb)
		         AS state(id uuid, intervals jsonb, approved text)
		       WHERE day.id = state.id`,
		params: [`[${updates.join(',')}]`]
	});
}

/**
 * The bank's Singapore people carry no NRIC race or religion, so the self-help funds (CDAC, ECF,
 * SINDA, MBMF) refuse a Singapore run rather than price a fund from an unstated fact. Record the
 * register's codes as HR must before assessing: `MALAY` is an ICA RaceCode that no fund's r.2
 * list reaches, and `OTHER` records a religion without asserting one of MBMF's.
 */
export async function recordSgShgFacts(
	t: Awaited<ReturnType<typeof workspace>>,
	companyId = NORBITAL_SG
) {
	const admin = t.as(t.admin);
	const employments = (
		await admin.read('employments', { where: { company_id: { eq: companyId } }, all: true })
	).rows;
	for (const id of new Set(employments.map((row) => String(row.employee_id))))
		committed(
			await admin.act('employees.update', {
				target: id,
				set: { race: 'MALAY', religion: 'OTHER' }
			})
		);
}

type Row = { readonly [field: string]: unknown };
/** The rows an act committed, or the outcome as the failure message. */
export function committed(o: Outcome): readonly Row[] {
	const x = o as { kind: string; records?: Row[] };
	if (x.kind !== 'committed') throw new Error(JSON.stringify(o));
	return x.records ?? [];
}
/** The refusal message of an act, or the outcome as the failure message. */
export function refused(o: Outcome): string {
	const x = o as { kind: string; message?: string };
	if (x.kind !== 'refused') throw new Error(`expected a refusal: ${JSON.stringify(o)}`);
	return x.message ?? '';
}
