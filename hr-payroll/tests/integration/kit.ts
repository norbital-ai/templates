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
