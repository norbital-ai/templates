/** The site handover (L-TPL-field-operations-018): per selected site, one JSON bundle and a CSV per table on the run. */
import { expect, it } from 'vitest';
import { CONTROLLER, rows, siteWithJob, workspace } from './kit.ts';

it('bundles each selected site with its jobs, variations and photos, as the starter reads them', async () => {
	// the host's `files.put` (bolt-server serves none yet): kept here by name
	const put = new Map<string, string>();
	const facility = async (
		c: {
			facility: string;
			method: string;
			args: [Uint8Array | { $bin: number }, { name: string; mime: string }];
		},
		_s: unknown
	) => {
		if (c.facility !== 'files' || c.method !== 'put')
			return { ok: false, error: { kind: 'unavailable', facility: c.facility, reason: 'fake' } };
		const [, meta] = c.args;
		put.set(meta.name, new TextDecoder().decode((c as unknown as { bins: Uint8Array[] }).bins[0]!));
		return { ok: true, value: { id: crypto.randomUUID(), name: meta.name, mime: meta.mime } };
	};
	const t = await workspace({ runs: { facility: facility as never } });
	const { site } = await siteWithJob(t);
	const outcome = await t.as(t.member(CONTROLLER)).start('site_handover', { ids: [site] });
	expect(outcome.kind).toBe('committed');
	await t.runDue();
	const [run] = await rows(
		t,
		`SELECT state, output, error FROM sys_run WHERE automation = 'site_handover'`
	);
	expect(run).toMatchObject({ state: 'succeeded', error: null });
	const files = (run!['output'] as { files: { name: string; id: string }[] }).files;
	expect(files.map((f) => f.name.replace(/field_ops_.*?(_job|_var|_photo|\.json)/, '$1'))).toEqual([
		'.json',
		'_job_assignments.csv',
		'_variations.csv',
		'_photo_evidence.csv'
	]);
	const json = [...put.entries()].find(([name]) => name.endsWith('.json'))![1];
	expect(JSON.parse(json)).toMatchObject({
		schema: 'norbital.field_operations.interoperability.v2',
		job_assignments: [{ title: 'Installation — Kismis' }]
	});
});
