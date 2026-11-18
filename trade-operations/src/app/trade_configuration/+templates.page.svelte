<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Row } from '@norbital-ai/bolt';
	let { ctx }: { ctx: PageContext } = $props();
	import { Badge, Button, Table, open_record } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
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
	// one row per case; each language column shows the title orders print now
	const cases = $derived(
		kinds.map((kind) => ({
			id: kind,
			kind,
			en: slot(kind, 'en').current?.title ?? '',
			zh: slot(kind, 'zh').current?.title ?? ''
		}))
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
	<span class="flex min-w-0 flex-col"
		><span class="font-medium">{ctx.t(`models.document_templates.fields.kind.${row.kind}`)}</span
		><span class="text-xs text-muted-foreground"
			>{ctx.t(`settings.documents.when.${row.kind}`)}</span
		></span
	>
{/snippet}
{#snippet layout(row: Case, locale: Locale)}
	{@const { current, draft } = slot(row.kind, locale)}
	<span class="flex flex-wrap items-center gap-2">
		{#if current}<Button
				variant="ghost"
				onclick={() => open_record('document_templates', current.id)}
				>{current.title} · {ctx.t('settings.documents.version', {
					version: current.version
				})}</Button
			>{:else}<Badge variant="warning">{ctx.t('settings.documents.missing')}</Badge>{/if}
		{#if draft}<Button variant="outline" onclick={() => open_record('document_templates', draft.id)}
				>{ctx.t('settings.documents.draft', { version: draft.version })}</Button
			>{:else}<Button variant="outline" onclick={() => revise(row.kind, locale, current)}
				>{ctx.t(current ? 'settings.documents.revise' : 'settings.documents.add')}</Button
			>{/if}
	</span>
{/snippet}
{#snippet english({ row }: { row: Case })}{@render layout(row, 'en')}{/snippet}
{#snippet chinese({ row }: { row: Case })}{@render layout(row, 'zh')}{/snippet}

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
			{ field: 'en', label: ctx.t('models.document_templates.fields.locale.en'), cell: english },
			{ field: 'zh', label: ctx.t('models.document_templates.fields.locale.zh'), cell: chinese }
		]}
		toolbar={{ title: false, description: ctx.t('settings.documents.help'), new: false }}
	/>
</AppShell>
