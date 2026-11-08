<script lang="ts">
	import { attach, bolt } from '$bolt';
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
		onClose
	}: {
		order: Id<'orders'>;
		version?: number | null;
		onClose: () => void;
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
		const actor = bolt.actor;
		return Effect.gen(function* () {
			file = null;
			error = null;
			const document = yield* orderDocument(yield* bolt.query(request), {
				version: selectedVersion
			});
			stampAvailable = document.stamp != null;
			const signing = document.signing;
			signatureAvailable = !!signing && actor?.kind === 'member' && actor.id === signing.owner;
			const signature =
				withSignature && signatureAvailable && signing
					? (yield* bolt.query(contractSignatureRead(signing))).salesperson_signatures.rows[0]
							?.signature?.png
					: null;
			if (withSignature && signatureAvailable && !signature)
				return yield* Effect.fail(new Error('The retained signature is unavailable.'));
			const source = yield* documentSource(
				{ ...document, stamp: stamp ? document.stamp : null, signature: signature ?? null },
				(asset) =>
					HttpClient.get(bolt.fileUrl(asset)).pipe(
						Effect.flatMap((response) => response.arrayBuffer),
						Effect.map((bytes) => new Uint8Array(bytes)),
						Effect.provide(FetchHttpClient.layer)
					)
			);
			const bytes = yield* bolt.previewPdf(source, { page: 'A4' });
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
							? bolt.t('errors.document_layout_unpublished')
							: bolt.t('component.document_unavailable');
				})
			)
		);
	});
</script>

<Dialog.Root
	open
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
	<Dialog.Content class="sm:max-w-4xl">
		<Dialog.Title>{bolt.t('component.preview_document')}</Dialog.Title>
		<div {@attach loadPdf}>
			{#if stampAvailable || signatureAvailable}
				<div class="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
					{#if stampAvailable}
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={includeStamp} />
							{bolt.t('component.include_company_stamp')}
						</label>
					{/if}
					{#if signatureAvailable}
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={includeSignature} />
							{bolt.t('component.include_sales_signature')}
						</label>
					{/if}
				</div>
			{/if}
			{#if file}
				<Stack gap="md">
					<OrderPdfViewer url={file.url} title={file.title} />
					<Button href={file.url} download={file.name}>{bolt.t('component.export_pdf')}</Button>
				</Stack>
			{:else if error}
				<p role="alert">{error}</p>
			{:else}
				<p role="status">{bolt.t('component.preparing_pdf')}</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
