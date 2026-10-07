import sys_channel_connection from '../seed/sys_channel_connection.json' with { type: 'json' };
import sys_envoy from '../seed/sys_envoy.json' with { type: 'json' };
import sys_envoy_channel from '../seed/sys_envoy_channel.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { loadPack, readPack, type EngineManifest, type Json } from '@norbital-ai/bolt/engine';
import { testWorkspace } from '@norbital-ai/bolt/test';

/** The template root: `bolt test` runs from it. */
const root = `${process.cwd()}/`;
const built = (file: string) => readFileSync(`${root}.norbital/artifact/${file}`, 'utf8');

/** Seeded members of the bank's field-operations tree. */
export const BOB = '019f6f10-0003-7000-8000-000000000012';
export const CONTROLLER = ['field_ops_controller'];
export const CONTRACTOR = ['field_ops_contractor'];

type Options = Omit<
	Parameters<typeof testWorkspace>[0],
	'root' | 'manifest' | 'guest' | 'transforms'
> & { sample?: true };

/**
 * This template on the test kit: compiled from source by `bolt check`, or, in a DOM environment (the sweep), read from
 * the build. `sample` restores the build's sample pack (`bolt build --bank=<seed bank>`), as provisioning does.
 */
export async function workspace(options: Options = {}) {
	const { sample, ...rest } = options;
	const t = await testWorkspace(
		typeof window === 'undefined'
			? {
					root,
					seed: sample ? 'none' : { sys_channel_connection, sys_envoy, sys_envoy_channel },
					...rest
				}
			: {
					manifest: JSON.parse(built('manifest.json')) as EngineManifest,
					guest: { source: built('guest.mjs') },
					transforms: (JSON.parse(built('artifact.json')) as { transforms: string[] }).transforms,
					seed: sample ? 'none' : { sys_channel_connection, sys_envoy, sys_envoy_channel },
					...rest
				}
	);
	if (sample)
		await loadPack(t.db, t.manifest, readPack(`${root}.norbital/seed/sample`), t.clock.now());
	await t.engine.refreshMessaging();
	if (sample) await t.engine.runs!.reconfigure();
	return t;
}

/** The ids an act committed, or the outcome as the failure. */
export function committed(o: unknown): string[] {
	const x = o as { kind: string; records?: { collection: string; id: string }[] };
	if (x.kind !== 'committed') throw new Error(JSON.stringify(o));
	return x.records!.map((r) => r.id);
}

export type T = Awaited<ReturnType<typeof workspace>>;

let postal = 500000;
/** A site (at a fresh postal code) and an unassigned job on it, as a controller files them. */
export async function siteWithJob(t: T, over: { [field: string]: Json } = {}) {
	const as = t.as(t.member(CONTROLLER));
	const [site] = committed(
		await as.act('sites.create', { name: `58 Kismis Avenue, Singapore ${++postal}` })
	);
	const [job] = committed(
		await as.act('job_assignments.create', {
			site_id: site!,
			title: 'Installation — Kismis',
			scheduled_for: '2026-09-25',
			description: 'Grab bars',
			...over
		})
	);
	return { site: site!, job: job! };
}

export const rows = async (t: T, text: string, params: Json[] = []) =>
	(await t.db.read([{ text, params }]))[0]!.rows;

/** A real member (a `sys_user` row) holding `policies`, with a WhatsApp number when given. */
export async function person(t: T, policies: readonly string[], phone: string | null = null) {
	const id = crypto.randomUUID();
	await t.db.write({
		text: `INSERT INTO sys_user (id, email, name, kind, admin, phone) VALUES ($1, $2, $3, 'staff', false, $4)`,
		params: [id, `${id}@field.test`, `Person ${id.slice(0, 4)}`, phone]
	});
	return t.member(policies, { id });
}
