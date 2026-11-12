<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { attach } from '@norbital-ai/ui/effect';
	import { type Id } from '@norbital-ai/bolt';
	import { Button, Dialog } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { FetchHttpClient, HttpClient } from 'effect/http';
	import OrderPdfViewer from './order-pdf-viewer.svelte';
	import {
		DocumentUnavailable,
		documentSource,
		documentRead,
		orderDocument
	} from '../../../lib/order-document.js';
	import { contractSignatureRead } from '../../../lib/salesperson-signatures.js';

	let {
		order,
		version = null,
		on_close,
		ctx
	}: {
		order: Id<'orders'>;
		version?: number | null;
		on_close: () => void;
		ctx: PageContext;
	} = $props();

	let file = $state<{ title: string; url: string; name: string } | null>(null);
	let error = $state<string | null>(null);
	let stampAvailable = $state(false);
	let includeStamp = $state(false);
	let signatureAvailable = $state(false);
	let includeSignature = $state(false);
	const loadPdf = attach(() => {
		const request = documentRead(order);
		const selectedVersion = version;
		const stamp = includeStamp;
		const withSignature = includeSignature;
		const actor = ctx.actor;
		return Effect.gen(function* () {
			file = null;
			error = null;
			const document = yield* orderDocument(yield* ctx.query(request), {
				version: selectedVersion
			});
			stampAvailable = document.stamp != null;
			const signing = document.signing;
			signatureAvailable = !!signing && actor?.kind === 'member' && actor.id === signing.owner;
			const signature =
				withSignature && signatureAvailable && signing
					? (yield* ctx.query(contractSignatureRead(signing))).salesperson_signatures.rows[0]
							?.signature?.png
					: null;
			if (withSignature && signatureAvailable && !signature)
				return yield* Effect.fail(new Error('The retained signature is unavailable.'));
			const source = yield* documentSource(
				{ ...document, stamp: stamp ? document.stamp : null, signature: signature ?? null },
				(asset) =>
					HttpClient.get(ctx.file_url(asset)).pipe(
						Effect.flatMap((response) => response.arrayBuffer),
						Effect.map((bytes) => new Uint8Array(bytes)),
						Effect.provide(FetchHttpClient.layer)
					)
			);
			const bytes = yield* ctx.preview_pdf(source, { page: 'A4' });
			const url = yield* Effect.acquireRelease(
				Effect.sync(() =>
					URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
				),
				(url) => Effect.sync(() => URL.revokeObjectURL(url))
			);
			file = { title: document.title, url, name: document.filename };
			yield* Effect.never;
		}).pipe(
			Effect.catch((cause) =>
				Effect.sync(() => {
					error =
						cause instanceof DocumentUnavailable &&
						cause.message === 'errors.document_layout_unpublished'
							? ctx.t('errors.document_layout_unpublished')
							: ctx.t('component.document_unavailable');
				})
			)
		);
	});
</script>

<Dialog.Root
	open
	on_open_change={(open) => {
		if (!open) on_close();
	}}
>
	<Dialog.Content class="sm:max-w-4xl">
		<Dialog.Title>{ctx.t('component.preview_document')}</Dialog.Title>
		<div {@attach loadPdf}>
			{#if stampAvailable || signatureAvailable}
				<div class="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
					{#if stampAvailable}
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={includeStamp} />
							{ctx.t('component.include_company_stamp')}
						</label>
					{/if}
					{#if signatureAvailable}
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={includeSignature} />
							{ctx.t('component.include_sales_signature')}
						</label>
					{/if}
				</div>
			{/if}
			{#if file}
				<Stack gap="md">
					<OrderPdfViewer {ctx} url={file.url} title={file.title} />
					<Button href={file.url} download={file.name}>{ctx.t('component.export_pdf')}</Button>
				</Stack>
			{:else if error}
				<p role="alert">{error}</p>
			{:else}
				<p role="status">{ctx.t('component.preparing_pdf')}</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
