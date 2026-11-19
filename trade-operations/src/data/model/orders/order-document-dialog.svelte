<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { attach } from '@norbital-ai/ui/effect';
	import { type Id } from '@norbital-ai/bolt';
	import { Button, Dialog } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import OrderPdfViewer from './order-pdf-viewer.svelte';
	import { DocumentUnavailable } from '../../../lib/order-document.js';
	import { orderPdf } from './order-pdf.js';

	let {
		order,
		on_close,
		ctx
	}: {
		order: Id<'orders'>;
		on_close: () => void;
		ctx: PageContext;
	} = $props();

	let file = $state<{ title: string; url: string; name: string } | null>(null);
	let error = $state<string | null>(null);
	let stampAvailable = $state(false);
	// sales documents are stamped unless a clean copy is asked for
	let includeStamp = $state(true);
	const loadPdf = attach(() => {
		const stamp = includeStamp;
		return Effect.gen(function* () {
			file = null;
			error = null;
			const { document, bytes } = yield* orderPdf(ctx, order, stamp);
			stampAvailable = document.stamp != null;
			const url = yield* Effect.acquireRelease(
				Effect.sync(() => URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))),
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
			{#if stampAvailable}
				<div class="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={includeStamp} />
						{ctx.t('component.include_company_stamp')}
					</label>
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
