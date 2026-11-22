<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Row } from '@norbital-ai/bolt';
	let { ctx }: { ctx: PageContext } = $props();
	import { Badge, Table, open_record } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { openCreate } from '../../lib/ui/create-values.js';
	import { newestFirst } from '../../lib/order-document.js';

	type Template = Row<'document_templates'>;
	const kinds = ['quotation', 'sales_contract', 'purchase_contract'] as const;
	const locales = ['en', 'zh'] as const;
	const read = ctx.query({ document_templates: { limit: 1000 } });
	const newest = (rows: readonly Template[]) => [...rows].sort(newestFirst)[0];
	type Kind = (typeof kinds)[number];
	type Locale = (typeof locales)[number];
	// in each case and language, the version orders print now and a revision not yet published
	const slot = (kind: Kind, locale: Locale) => {
		const rows = (read.current?.document_templates.rows ?? []).filter(
			(row) => row.kind === kind && row.locale === locale
		);
		return {
			current: newest(rows.filter((row) => row.status === 'published')),
			draft: newest(rows.filter((row) => row.status === 'draft'))
		};
	};
	// one row per document and language: what orders print now and any unpublished draft
	const cases = $derived(
		kinds.flatMap((kind) =>
			locales.map((locale) => {
				const { current, draft } = slot(kind, locale);
				return {
					id: `${kind}:${locale}`,
					kind,
					locale,
					current: current?.title ?? '',
					draft: draft?.version ?? null
				};
			})
		)
	);
	type Case = (typeof cases)[number];
	// a revision starts from what orders print now; publishing it makes it current for orders not yet confirmed
	const revise = (kind: Kind, locale: Locale, from: Template | undefined) =>
		openCreate('document_templates', {
			kind,
			locale,
			...(from
				? {
						title: from.title,
						body: from.body,
						layout: from.layout,
						print_fields: from.print_fields,
						...(from.print_layout ? { print_layout: from.print_layout } : {}),
						...(from.letterhead ? { letterhead: from.letterhead } : {}),
						...(from.contract_stamp ? { contract_stamp: from.contract_stamp } : {})
					}
				: {})
		});
</script>

{#snippet caseName({ row }: { row: Case })}
	<Stack as="span" gap="none">
		<span class="font-medium">{ctx.t(`models.document_templates.fields.kind.${row.kind}`)}</span>
		<span class="text-meta">{ctx.t(`settings.documents.when.${row.kind}`)}</span>
	</Stack>
{/snippet}
{#snippet localeCell({ row }: { row: Case })}
	{ctx.t(`models.document_templates.fields.locale.${row.locale}`)}
{/snippet}
{#snippet publishedCell({ row }: { row: Case })}
	{@const { current } = slot(row.kind, row.locale)}
	{#if current}
		{current.title} · {ctx.t('settings.documents.version', { version: current.version })}
	{:else}
		<Badge variant="warning">{ctx.t('settings.documents.missing')}</Badge>
	{/if}
{/snippet}
{#snippet draftCell({ row }: { row: Case })}
	{@const { draft } = slot(row.kind, row.locale)}
	{#if draft}
		<Badge variant="outline">{ctx.t('settings.documents.draft', { version: draft.version })}</Badge>
	{:else}
		—
	{/if}
{/snippet}

<AppShell
	description={ctx.t('settings.documents.description')}
	title={ctx.t('section.documents')}
	icon="lucide:file-text"
>
	<Table
		{ctx}
		of={cases}
		key="document_cases"
		columns={[
			{ field: 'kind', label: ctx.t('models.document_templates.fields.kind'), cell: caseName },
			{
				field: 'locale',
				label: ctx.t('models.document_templates.fields.locale'),
				cell: localeCell
			},
			{
				field: 'current',
				label: ctx.t('models.document_templates.fields.status.published'),
				cell: publishedCell
			},
			{
				field: 'draft',
				label: ctx.t('models.document_templates.fields.status.draft'),
				cell: draftCell
			}
		]}
		on_open={(row) => {
			const { current, draft } = slot(row.kind, row.locale);
			if (current) open_record('document_templates', current.id);
			else if (draft) open_record('document_templates', draft.id);
			else revise(row.kind, row.locale, undefined);
		}}
		actions={[
			{
				label: ctx.t('settings.documents.revise'),
				run: (row) => {
					const { current, draft } = slot(row.kind, row.locale);
					if (draft) open_record('document_templates', draft.id);
					else revise(row.kind, row.locale, current);
				}
			}
		]}
		toolbar={{ title: false, description: ctx.t('settings.documents.help'), new: false }}
	/>
</AppShell>
