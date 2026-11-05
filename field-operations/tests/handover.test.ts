import { Effect, Layer, Schema } from 'effect';
import { Files, Port } from '@norbital-ai/bolt/engine';
import { createHash } from 'node:crypto';
/** The site handover (L-TPL-field-operations-018): per selected site, one JSON bundle and a CSV per table on the run. */
import { expect, it } from '@effect/vitest';
import { CONTROLLER, rows, siteWithJob, workspace } from './kit.ts';
it.live('bundles each selected site with its jobs and photos, as the starter reads them', () =>
	Effect.gen(function* () {
		const put = new Map<string, string>();
		const blobs = new Map<string, Uint8Array>();
		const t = yield* workspace({
			ports: Layer.succeed(Files, {
				put: (bytes, meta) =>
					Effect.sync(() => {
						const key = crypto.randomUUID();
						blobs.set(key, bytes);
						put.set(meta.name, new TextDecoder().decode(bytes));
						return {
							key,
							bytes: bytes.byteLength,
							mime: meta.mime,
							sha256: createHash('sha256').update(bytes).digest('hex')
						};
					}),
				get: (key) =>
					Effect.suspend(() => {
						const bytes = blobs.get(key);
						return bytes === undefined
							? Port.unavailable('files', `Missing fixture blob ${key}`)
							: Effect.succeed(bytes);
					}),
				url: (key) => Effect.succeed(`memory://${key}`),
				remove: (key) =>
					Effect.sync(() => {
						blobs.delete(key);
					}),
				download: () => Port.unavailable('files', 'the handover downloads nothing')
			})
		});
		const { site } = yield* siteWithJob(t);
		const outcome = yield* t.as(t.member(CONTROLLER)).start('site_handover', { ids: [site] });
		expect(outcome.kind).toBe('committed');
		yield* t.runDue();
		const [run] = yield* rows(
			t,
			`SELECT state, output, error FROM sys_run WHERE automation = 'site_handover'`
		);
		expect(run).toMatchObject({ state: 'succeeded', error: null });
		const files = Schema.decodeUnknownSync(
			Schema.Struct({
				files: Schema.Array(
					Schema.Struct({ name: Schema.String, id: Schema.String, mime: Schema.String })
				)
			})
		)(run?.output).files;
		expect(files.map((f) => f.name.replace(/field_ops_.*?(_job|_photo|\.json)/, '$1'))).toEqual([
			'.json',
			'_job_assignments.csv',
			'_photo_evidence.csv'
		]);
		const json = [...put.entries()].find(([name]) => name.endsWith('.json'))?.[1];
		expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(json)).toMatchObject({
			schema: 'norbital.field_operations.interoperability.v2',
			job_assignments: [{ title: 'Installation — Kismis' }]
		});
	})
);
