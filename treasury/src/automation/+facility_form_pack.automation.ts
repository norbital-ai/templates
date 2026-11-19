import { automation } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { PDFDocument, PageSizes, ParseSpeeds, StandardFonts } from 'pdf-lib';

/** Native record printing owns the form layout; this business operation adds its sign-off page and supporting files. */
export default automation({
	description:
		'Download a facility requisition with its sign-off page and supporting documents as one PDF.',
	input: { form: { kind: 'rows', of: 'facility_form' } },
	output: {
		kind: 'object',
		fields: { file: { kind: 'file', accept: ['application/pdf'], max: '4MiB' } }
	},
	policies: ['facility_forms'],
	run: function* ({ form }, ctx) {
		const f = form[0];
		if (f === undefined || form.length !== 1) return yield* ctx.refuse('errors.one_form');
		const { facility_attachment } = yield* ctx.query({
			facility_attachment: {
				where: { form: { eq: f.id } },
				fields: ['title', 'file'],
				order_by: { created_at: 'asc' }
			}
		});
		const cover = yield* ctx.convert.record('facility_form', f.id, { to: 'pdf' });
		const attachments = [];
		let held = cover.bytes.byteLength;
		for (const attachment of facility_attachment.rows) {
			const bytes = yield* ctx.files.get(attachment.file);
			held += bytes.byteLength;
			if (held > 4 * 1024 * 1024) return yield* ctx.refuse('errors.pack_large');
			attachments.push({
				name: attachment.title ?? attachment.file.name,
				mime: attachment.file.mime,
				bytes
			});
		}
		const bytes = yield* pdfPack(cover.bytes, attachments).pipe(
			Effect.catchTag('PdfPackFailure', (error) =>
				ctx.refuse('errors.pack_failed', { values: { file: error.file, detail: error.detail } })
			)
		);
		if (bytes.byteLength > 4 * 1024 * 1024) return yield* ctx.refuse('errors.pack_large');
		const file = yield* ctx.files.put(bytes, {
			name: `Facility form-${f.po_number ?? 'draft'}-pack.pdf`,
			mime: 'application/pdf',
			for: 'facility_form_pack'
		});
		return { file };
	}
});

class PdfPackFailure extends Schema.TaggedError<PdfPackFailure>()('PdfPackFailure', {
	file: Schema.String,
	detail: Schema.String
}) {}

/** The native printed record, a sign-off page, then every original attachment in order. */
const pdfPack = (
	cover: Uint8Array,
	attachments: readonly {
		readonly name: string;
		readonly mime: string;
		readonly bytes: Uint8Array;
	}[]
) => {
	let current = 'printed form';
	return Effect.tryPromise({
		try: async () => {
			const result = await PDFDocument.create();
			const append = async (bytes: Uint8Array) => {
				// The guest owns CPU metering; pdf-lib's browser timer yields are unavailable here.
				const source = await PDFDocument.load(bytes, { parseSpeed: ParseSpeeds.Fastest });
				for (const page of await result.copyPages(source, source.getPageIndices()))
					result.addPage(page);
			};
			await append(cover);
			const signature = result.addPage(PageSizes.A4);
			const font = await result.embedFont(StandardFonts.Helvetica);
			signature.drawText('Facility requisition sign-off', { x: 40, y: 785, size: 18, font });
			for (const [i, title] of [
				'Affirmed by',
				'Approved by',
				'Acknowledged by Treasury'
			].entries()) {
				const y = 690 - i * 190;
				signature.drawText(title, { x: 40, y, size: 12, font });
				signature.drawText('Name: ____________________    Date: ____________________', {
					x: 40,
					y: y - 45,
					size: 10,
					font
				});
				signature.drawText('Signature: ___________________________________________', {
					x: 40,
					y: y - 90,
					size: 10,
					font
				});
			}
			for (const attachment of attachments) {
				current = attachment.name;
				if (attachment.mime === 'application/pdf') await append(attachment.bytes);
				else {
					const image =
						attachment.mime === 'image/png'
							? await result.embedPng(attachment.bytes)
							: await result.embedJpg(attachment.bytes);
					const page = result.addPage(PageSizes.A4);
					const scale = Math.min(
						(page.getWidth() - 80) / image.width,
						(page.getHeight() - 80) / image.height
					);
					const width = image.width * scale,
						height = image.height * scale;
					page.drawImage(image, {
						x: (page.getWidth() - width) / 2,
						y: (page.getHeight() - height) / 2,
						width,
						height
					});
				}
			}
			return await result.save({ objectsPerTick: Infinity });
		},
		catch: (error) =>
			new PdfPackFailure({
				file: current,
				detail: error instanceof Error ? error.message : String(error)
			})
	});
};
