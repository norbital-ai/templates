<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button } from '@norbital-ai/ui';
	import { create_pagination } from '@norbital-ai/ui/behaviors';
	import { Bound, Center, Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { getAbortSignal, untrack } from 'svelte';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

	let { url, title, ctx }: { url: string; title: string; ctx: PageContext } = $props();
	let pdf = $state.raw<PDFDocumentProxy>();
	let canvas = $state<HTMLCanvasElement>();
	let pageNumber = $state(1);
	let renderedPage = $state(0);
	let failed = $state(false);

	const pager = create_pagination({
		page: () => pageNumber,
		total_pages: () => pdf?.numPages ?? 1,
		on_page_change: (next) => {
			pageNumber = next;
		},
		control: { id: 'construction-report-pdf:page', label: untrack(() => title) }
	});

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
			if (!signal.aborted) {
				pdf = document;
				pageNumber = 1;
			}
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
			const viewport = page.getViewport({ scale: 1.75 });
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
	<p role="alert" class="text-sm text-destructive">{ctx.t('reports.pdf_preview_failed')}</p>
{:else}
	<Stack gap="sm">
		{#if pdf && pdf.numPages > 1}
			<Cluster gap="sm" align="center">
				<Button variant="outline" disabled={!pager.has_previous} onclick={pager.previous}>
					{ctx.t('reports.pdf_previous')}
				</Button>
				<span class="font-mono text-xs tabular-nums" aria-live="polite">
					{`${pager.page} / ${pager.pages}`}
				</span>
				<Button variant="outline" disabled={!pager.has_next} onclick={pager.next}>
					{ctx.t('reports.pdf_next')}
				</Button>
			</Cluster>
		{/if}
		{#if renderedPage !== pageNumber}
			<p role="status" class="text-xs text-muted-foreground">{ctx.t('reports.preparing_pdf')}</p>
		{/if}
		<Bound size="viewport">
			<Scroll name={title} size="fill" class="bg-surface-muted">
				{#key pageNumber}
					<Center>
						<canvas
							bind:this={canvas}
							role="img"
							aria-label={`${title} · ${pageNumber}`}
							class="block h-auto max-w-full"
							class:invisible={renderedPage !== pageNumber}
						></canvas>
					</Center>
				{/key}
			</Scroll>
		</Bound>
	</Stack>
{/if}
