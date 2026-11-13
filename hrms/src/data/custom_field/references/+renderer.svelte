<script lang="ts">
	/**
	 * A statutory row's references. Read on its own, an expandable list: each instrument's title and locator, opened to
	 * the quoted wording, the day it took effect and a link to the official text. In a table cell, compact chips with
	 * the same details on hover or focus. Edited as a table of the field's list of objects.
	 */
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import { Badge, Editor, Icon, Tooltip, format, type UiContext } from '@norbital-ai/ui';
	import { Bound, Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { REFERENCES_SHAPE } from '../../../lib/payroll_engine/references.js';

	let { view, ctx }: { view: CustomFieldView<'references'>; ctx: UiContext } = $props();
	/** Outside a page (no view client) a text is named by its message key. */
	const t = (key: string, vars?: Readonly<Record<string, string>>) =>
		ctx.ui.bolt?.t(key, vars) ?? key;

	type Reference = NonNullable<CustomFieldView<'references'>['value']>[number];
	const rows = $derived(view.value ?? []);
	const FIELDS = REFERENCES_SHAPE.fields;
	// the quote is a passage: a textarea cell
	const EDIT_KIND = {
		kind: 'object',
		many: true,
		fields: {
			title: { ...FIELDS.title, label: t('references.title') },
			locator: { ...FIELDS.locator, label: t('references.locator') },
			url: { ...FIELDS.url, label: t('references.url') },
			quote: { ...FIELDS.quote, max: 100_000, label: t('references.quote') },
			effective_from: { ...FIELDS.effective_from, label: t('references.effective_from') }
		}
	} as const;
</script>

{#snippet details(reference: Reference)}
	{#if reference.quote}<q class="italic">{reference.quote}</q>{/if}
	{#if reference.effective_from}
		<span
			>{t('component.references_effective_from', {
				date: format({ kind: 'date' }, reference.effective_from, {
					locale: ctx.ui.bolt?.locale ?? 'en'
				})
			})}</span
		>
	{/if}
{/snippet}

{#snippet chip(reference: Reference)}
	<Tooltip>
		{#snippet trigger({ props })}
			<Badge
				{...props}
				variant="outline"
				href={reference.url ?? undefined}
				target={reference.url ? '_blank' : undefined}
				rel={reference.url ? 'noopener noreferrer' : undefined}
				class="max-w-80 font-medium"
			>
				<Inline as="span" gap="xs" class="min-w-0">
					<span class="truncate">{reference.title}</span>
					{#if reference.locator}
						<span class="shrink-0 text-muted-foreground">{reference.locator}</span>
					{/if}
				</Inline>
			</Badge>
		{/snippet}
		{#snippet content()}
			<Scroll name={t('references.details')} max="compact" class="max-w-96 text-xs">
				<Stack gap="xs">
					<span class="font-semibold">{reference.title}</span>
					{#if reference.locator}<span>{reference.locator}</span>{/if}
					{@render details(reference)}
				</Stack>
			</Scroll>
		{/snippet}
	</Tooltip>
{/snippet}

{#if view.mode === 'edit'}
	<Editor
		{ctx}
		kind={EDIT_KIND}
		name={view.name}
		{...view.id === undefined ? {} : { id: view.id }}
		value={view.value}
		on_change={view.on_change}
		disabled={view.disabled}
	/>
{:else if rows.length === 0}
	<span class="text-muted-foreground">—</span>
{:else if view.dense}
	<Bound as="span" clip>
		<Inline as="span" gap="xs">
			{#each rows as reference, index (index)}{@render chip(reference)}{/each}
		</Inline>
	</Bound>
{:else}
	<Stack as="ul" gap="xs">
		{#each rows as reference, index (index)}
			<li>
				<details class="group">
					<summary class="cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
						<!-- closed, one line: a title may be a whole passage, which opening shows in full -->
						<Cluster as="span" gap="xs" align="start" class="flex-nowrap">
							<Icon
								name="lucide:chevron-right"
								class="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
							/>
							<span class="line-clamp-1 min-w-0 font-medium group-open:line-clamp-none"
								>{reference.title}</span
							>
							{#if reference.locator}
								<span class="text-muted-foreground">{reference.locator}</span>
							{/if}
						</Cluster>
					</summary>
					<Stack gap="xs" class="py-1 pl-5 text-sm">
						{@render details(reference)}
						{#if reference.url}
							<a
								class="break-all underline-offset-2 hover:underline"
								href={reference.url}
								target="_blank"
								rel="noopener noreferrer">{t('references.open_official_text')}</a
							>
						{/if}
					</Stack>
				</details>
			</li>
		{/each}
	</Stack>
{/if}
