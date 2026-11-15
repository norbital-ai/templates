import { Effect, Layer, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { Render } from '@norbital-ai/bolt/engine';
import { JobResult, TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';
import { PDFDocument } from 'pdf-lib';

const ports = Layer.effect(
	Render,
	Effect.promise(async () => {
		const cover = await PDFDocument.create();
		cover.addPage([300, 500]);
		const bytes = await cover.save();
		return { pdf: () => Effect.succeed(bytes) };
	})
);

it.layer(TestWorkspace.layer({ root: new URL('..', import.meta.url).pathname, ports }))(
	'facility PDF pack',
	(it) => {
		it.effect(
			'prints the native record, adds a sign-off page, and preserves every attachment page in order',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const purchaser = yield* t.as(t.member(['purchasing']));
					t.clock.set('2026-11-01T00:00:00Z');
					const original = yield* Effect.promise(async () => {
						const pdf = await PDFDocument.create();
						pdf.addPage([101, 201]);
						pdf.addPage([102, 202]);
						return await pdf.save();
					});
					const upload = yield* purchaser.upload('facility_attachment.file', {
						name: 'synthetic.pdf',
						mime: 'application/pdf',
						bytes: original
					});
					if (upload.kind !== 'committed') throw new Error('Expected the PDF upload.');
					const created = yield* purchaser.act({
						'facility_form.create': [
							{
								po_number: 'PACK-001',
								attachments: [
									{ kind: 'purchase_order', title: 'Synthetic order', file: upload.output }
								]
							}
						]
					});
					const form = created.records[0];
					if (form === undefined) throw new Error('Expected the facility form.');
					const image = Uint8Array.from(
						atob(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
						),
						(c) => c.charCodeAt(0)
					);
					const picture = yield* purchaser.upload('facility_attachment.file', {
						name: 'synthetic.png',
						mime: 'image/png',
						bytes: image
					});
					if (picture.kind !== 'committed') throw new Error('Expected the picture upload.');
					t.clock.set('2026-11-01T00:00:01Z');
					yield* purchaser.act({
						'facility_form.update': [
							{
								target: {
									id: Schema.decodeUnknownSync(id_of('facility_form'))(form.id),
									revision: form.revision
								},
								set: {
									attachments: {
										create: [{ kind: 'other', title: 'Synthetic picture', file: picture.output }]
									}
								}
							}
						]
					});
					const started = yield* purchaser.run(
						'facility_form_pack',
						{ form: [Schema.decodeUnknownSync(id_of('facility_form'))(form.id)] },
						JobResult
					);
					if (started.kind !== 'committed') throw new Error('Expected the pack run.');
					yield* t.run_due();
					const output = yield* t.db.value(
						Schema.Struct({ file: Schema.Struct({ id: Schema.String, mime: Schema.String }) }),
						{ text: 'SELECT output FROM sys_run WHERE id = $1', params: [started.output.id] }
					);
					expect(output.file.mime).toBe('application/pdf');
					const key = yield* t.db.value(Schema.String, {
						text: 'SELECT key FROM sys_file WHERE id = $1',
						params: [output.file.id]
					});
					const bytes = t.fakes.files.blobs.get(key);
					if (bytes === undefined) throw new Error('Expected the PDF pack bytes.');
					const result = yield* Effect.promise(() => PDFDocument.load(bytes));
					expect(result.getPageCount()).toBe(5);
					expect(result.getPages().map((p) => p.getWidth())).toEqual([
						300,
						expect.closeTo(595.28, 1),
						101,
						102,
						expect.closeTo(595.28, 1)
					]);
					const sourceKey = yield* t.db.value(Schema.String, {
						text: 'SELECT key FROM sys_file WHERE id = $1',
						params: [upload.output.id]
					});
					expect(t.fakes.files.blobs.get(sourceKey)).toEqual(original);
				})
		);
		it.effect('refuses a broken attachment instead of publishing an incomplete pack', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const purchaser = yield* t.as(t.member(['purchasing']));
				const viewer = yield* t.as(t.member(['viewer']));
				const upload = yield* purchaser.upload('facility_attachment.file', {
					name: 'broken.pdf',
					mime: 'application/pdf',
					bytes: new TextEncoder().encode('This is not a PDF.')
				});
				if (upload.kind !== 'committed') throw new Error('Expected the stored file.');
				const created = yield* purchaser.act({
					'facility_form.create': [
						{
							po_number: 'PACK-BROKEN',
							attachments: [{ kind: 'other', title: 'Broken attachment', file: upload.output }]
						}
					]
				});
				const form = created.records[0];
				if (form === undefined) throw new Error('Expected the facility form.');
				const started = yield* viewer.run(
					'facility_form_pack',
					{ form: [Schema.decodeUnknownSync(id_of('facility_form'))(form.id)] },
					JobResult
				);
				if (started.kind !== 'committed') throw new Error('Expected the pack run.');
				yield* t.run_due();
				const row = yield* t.db.value(
					Schema.Struct({
						state: Schema.String,
						error: Schema.NullOr(Schema.Json),
						output: Schema.NullOr(Schema.Json)
					}),
					{
						text: "SELECT jsonb_build_object('state', state, 'error', error, 'output', output) FROM sys_run WHERE id = $1",
						params: [started.output.id]
					}
				);
				expect(row).toMatchObject({ state: 'failed', output: null });
				expect(JSON.stringify(row.error)).toContain('Broken attachment');
			})
		);
	}
);
