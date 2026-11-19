<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ReadonlyMarkdown } from '@norbital-ai/ui';
	import { documentLayout } from './document-layout.js';
	let {
		body,
		title,
		signature,
		signaturesLabel = 'Signatures',
		children
	}: {
		body: string;
		title: string;
		signature?: string | undefined;
		signaturesLabel?: string;
		children?: Snippet;
	} = $props();
	const document = $derived(documentLayout(body));
</script>

<div class="document-canvas">
	{#if children}<div class="document-meta">{@render children()}</div>{/if}
	{#if document.cover}
		<article class="document-paper document-cover" aria-label={document.cover.title}>
			<div class="cover-date"><ReadonlyMarkdown value={document.cover.date} /></div>
			<div class="cover-provider"><ReadonlyMarkdown value={document.cover.provider} /></div>
			<div class="cover-company"><ReadonlyMarkdown value={document.cover.company} /></div>
			<div class="cover-title">{document.cover.title}</div>
		</article>
	{/if}
	<article class="document-paper document-body" aria-label={title}>
		<ReadonlyMarkdown value={document.body} />
		{#if document.signatures}
			<section class="document-signatures" aria-label={signaturesLabel}>
				{#if document.signatures.introduction}<p>{document.signatures.introduction}</p>{/if}
				<div class="signature-parties">
					{#each document.signatures.parties as party, index}
						<div class="signature-party">
							<div class="signature-space">
								{#if index === 0 && signature}<img
										src={signature}
										alt="Company signatory signature"
									/>{/if}
							</div>
							<div class="signature-line"></div>
							{#each party as line}<p>{line}</p>{/each}
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</article>
</div>

<style>
	.document-canvas {
		padding: 1.5rem;
		background: var(--color-muted);
	}
	.document-paper {
		box-sizing: border-box;
		width: 210mm;
		max-width: 100%;
		min-height: 297mm;
		margin-inline: auto;
		padding: 25.4mm;
		background: white;
		color: #000;
		color-scheme: light;
		font-family: Calibri, Carlito, Arial, sans-serif;
		font-size: 10pt;
		line-height: 1.2;
	}
	.document-paper + .document-paper {
		margin-top: 1.5rem;
	}
	.document-meta {
		max-width: 210mm;
		margin: 0 auto 1rem;
	}
	.document-cover {
		position: relative;
		height: auto;
		aspect-ratio: 210 / 297;
		min-height: 0;
		break-after: page;
	}
	.cover-date {
		position: absolute;
		top: 8.55%;
		right: 12.095%;
		text-align: right;
		font-size: 8pt;
	}
	.cover-provider,
	.cover-company,
	.cover-title {
		position: absolute;
		left: 12.095%;
		right: 12.095%;
		text-align: center;
	}
	.cover-provider {
		top: 27.27%;
	}
	.cover-company {
		top: 38.38%;
	}
	.cover-title {
		top: 52.86%;
		font-weight: 700;
	}
	.document-paper :global([data-markdown]),
	.document-paper :global([data-markdown] *) {
		color: inherit;
		font-family: inherit;
	}
	.document-paper :global([data-markdown]) {
		max-width: none;
		font-size: inherit;
		line-height: inherit;
	}
	.document-paper :global([data-markdown] p) {
		margin: 0 0 10pt;
	}
	.document-paper :global([data-markdown] :is(h1, h2, h3, h4)) {
		margin: 14pt 0 7pt;
		font-size: 10pt;
		line-height: 1.2;
		font-weight: 700;
		break-after: avoid;
	}
	.document-body :global([data-markdown] > h1:first-child) {
		margin-top: 0;
		text-align: center;
		font-size: 14pt;
	}
	.document-paper :global([data-markdown] :is(ul, ol)) {
		margin: 0 0 10pt;
		padding-left: 22pt;
	}
	.document-paper :global([data-markdown] li) {
		margin-block: 0 5pt;
	}
	.document-paper :global([data-markdown] table) {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		font-size: 10pt;
	}
	.document-paper :global([data-markdown] :is(th, td)) {
		padding: 6pt;
		border: 1px solid #000;
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	.document-paper :global([data-markdown] th) {
		background: #f2f2f2;
		color: #000;
	}
	.document-paper :global([data-markdown] tr) {
		break-inside: avoid;
	}
	.document-paper :global([data-markdown] blockquote) {
		color: inherit;
		border: 0;
		padding: 0;
	}
	.document-signatures {
		margin-top: 10pt;
		break-inside: avoid;
	}
	.signature-parties {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12mm;
		margin-top: 6mm;
	}
	.signature-space {
		height: 24mm;
		display: flex;
		align-items: flex-end;
	}
	.signature-space img {
		max-width: 80%;
		max-height: 22mm;
		object-fit: contain;
	}
	.signature-line {
		width: 80%;
		border-top: 0.5pt solid #000;
		margin-bottom: 3mm;
	}
	.document-signatures p {
		margin: 0 0 2mm;
		overflow-wrap: break-word;
	}
	@media (max-width: 640px) {
		.document-canvas {
			padding: 0.75rem;
		}
		.document-paper {
			padding: 1.25rem;
			min-height: 0;
		}
		.document-cover {
			aspect-ratio: 210 / 297;
			height: auto;
		}
		.signature-parties {
			gap: 1rem;
		}
		.cover-date {
			top: 8.5%;
			right: 6%;
		}
		.cover-provider {
			top: 27%;
		}
		.cover-company {
			top: 38%;
		}
		.cover-title {
			top: 53%;
		}
		.cover-provider,
		.cover-company,
		.cover-title {
			left: 6%;
			right: 6%;
		}
	}
	@media print {
		.document-canvas {
			padding: 0;
			background: white;
		}
		.document-paper {
			max-width: none;
			margin: 0;
		}
		.document-paper + .document-paper {
			margin-top: 0;
		}
		.document-meta {
			display: none;
		}
	}
</style>
