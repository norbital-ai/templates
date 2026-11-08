<script lang="ts">
	import { bolt } from '$bolt';
	import { Button } from '@norbital-ai/ui';
	import { Bound, Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { getAbortSignal } from 'svelte';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

	let { url, title }: { url: string; title: string } = $props();
	let pdf = $state.raw<PDFDocumentProxy>();
	let canvas = $state<HTMLCanvasElement>();
	let pageNumber = $state(1);
	let renderedPage = $state(0);
	let failed = $state(false);

	$effect(() => {
		const signal = getAbortSignal();
		const source = url;
		let task: PDFDocumentLoadingTask | undefined;
		async function load() {
			const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
			if (signal.aborted) return;
			GlobalWorkerOptions.workerSrc = workerUrl;
			task = getDocument({ url: source, useWasm: false });
			const document = await task.promise;
			if (!signal.aborted) pdf = document;
		}
		void load().catch(() => {
			if (!signal.aborted) failed = true;
		});
		return () => {
			void task?.destroy().catch(() => {});
		};
	});

	$effect(() => {
		const target = canvas;
		const document = pdf;
		const number = pageNumber;
		if (!target || !document) return;
		const signal = getAbortSignal();
		let task: RenderTask | undefined;
		async function render(target: HTMLCanvasElement, document: PDFDocumentProxy) {
			const page = await document.getPage(number);
			if (signal.aborted) return;
			const viewport = page.getViewport({ scale: 1.8 });
			target.width = Math.ceil(viewport.width);
			target.height = Math.ceil(viewport.height);
			task = page.render({ canvas: target, viewport });
			await task.promise;
			if (!signal.aborted) renderedPage = number;
		}
		void render(target, document).catch(() => {
			if (!signal.aborted) failed = true;
		});
		return () => task?.cancel();
	});
</script>

{#if failed}
	<p role="alert">{bolt.t('component.pdf_preview_failed')}</p>
{:else}
	<Stack gap="sm">
		{#if pdf && pdf.numPages > 1}
			<Cluster gap="sm" align="center">
				<Button variant="outline" disabled={pageNumber === 1} onclick={() => pageNumber--}>
					{bolt.t('component.pdf_previous')}
				</Button>
				<span aria-live="polite">{pageNumber} / {pdf.numPages}</span>
				<Button
					variant="outline"
					disabled={pageNumber === pdf.numPages}
					onclick={() => pageNumber++}
				>
					{bolt.t('component.pdf_next')}
				</Button>
			</Cluster>
		{/if}
		{#if renderedPage !== pageNumber}
			<p role="status">{bolt.t('component.preparing_pdf')}</p>
		{/if}
		<Bound size="viewport"
			><Scroll name="order-pdf" size="fill" class="bg-muted">
				{#key pageNumber}
					<canvas
						bind:this={canvas}
						role="img"
						aria-label={`${title} · ${pageNumber}`}
						class="mx-auto block h-auto max-w-full bg-white"
						class:invisible={renderedPage !== pageNumber}
					></canvas>
				{/key}
			</Scroll></Bound
		>
	</Stack>
{/if}
