import type { PageContext } from '@norbital-ai/bolt/page';
import type { Id } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { documentRead, documentSource, orderDocument } from '../../../lib/order-document.js';
import { zip } from '../../../lib/xlsx.js';

/** One order's document as a PDF; a sales document carries the seller's stamp unless `stamp` is off. */
export const orderPdf = (ctx: PageContext, order: Id<'orders'>, stamp: boolean) =>
	Effect.gen(function* () {
		const document = yield* orderDocument(yield* ctx.query(documentRead(order)));
		const source = yield* documentSource(
			{ ...document, stamp: stamp ? document.stamp : null },
			(asset) =>
				HttpClient.get(ctx.file_url(asset)).pipe(
					Effect.flatMap((response) => response.arrayBuffer),
					Effect.map((bytes) => new Uint8Array(bytes)),
					Effect.provide(FetchHttpClient.layer)
				)
		);
		const bytes = yield* ctx.preview_pdf(source, { page: 'A4' });
		return { document, bytes: new Uint8Array(bytes) };
	});

/** The selected orders' documents, stamped, as one zip download. */
export const downloadOrderPdfs = (
	ctx: PageContext,
	orders: readonly Id<'orders'>[],
	name: string
) =>
	Effect.forEach(orders, (order) => orderPdf(ctx, order, true)).pipe(
		Effect.map((files) => {
			const url = URL.createObjectURL(
				new Blob([zip(files.map(({ document, bytes }) => ({ name: document.filename, bytes })))], {
					type: 'application/zip'
				})
			);
			const link = Object.assign(document.createElement('a'), { href: url, download: name });
			link.click();
			URL.revokeObjectURL(url);
		})
	);
