<script lang="ts">
	/**
	 * A statutory row's references as compact chips: the instrument's title and locator, linked to the official text when
	 * one is known; the quoted wording and the effective day on hover or focus. Edited as the field's list of objects.
	 */
	import { bolt } from '$bolt';
	import { Badge, Editor, Tooltip, type CustomFieldView } from '@norbital-ai/ui';
	import { Bound, Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { formatCalendarDate } from '../../../lib/ui/format/display_formatters.js';
	import { REFERENCES_SHAPE } from '../../../lib/payroll_engine/references.js';

	let { view }: { view: CustomFieldView } = $props();

	const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
	const References = Schema.Array(
		Schema.Struct({
			title: Schema.String,
			locator: Text,
			url: Text,
			quote: Text,
			effective_from: Text
		})
	);
	type Reference = (typeof References.Type)[number];
	const rows = $derived<readonly Reference[]>(Schema.is(References)(view.value) ? view.value : []);
</script>

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
			<Scroll as="span" name="Reference details" max="compact" class="max-w-96 text-xs">
				<Stack as="span" gap="xs">
					<span class="font-semibold">{reference.title}</span>
					{#if reference.locator}<span>{reference.locator}</span>{/if}
					{#if reference.quote}<q class="italic">{reference.quote}</q>{/if}
					{#if reference.effective_from}
						<span
							>{bolt.t('component.references_effective_from', {
								date: formatCalendarDate(reference.effective_from)
							})}</span
						>
					{/if}
				</Stack>
			</Scroll>
		{/snippet}
	</Tooltip>
{/snippet}

{#if view.mode === 'edit'}
	<Editor
		kind={REFERENCES_SHAPE}
		name={view.name}
		{...view.id === undefined ? {} : { id: view.id }}
		value={view.value}
		onChange={view.onChange}
		disabled={view.disabled}
	/>
{:else if rows.length === 0}
	<span class="text-muted-foreground">—</span>
{:else}
	{#snippet chips()}
		{#each rows as reference, index (index)}
			{@render chip(reference)}
		{/each}
	{/snippet}
	{#if view.dense}
		<Bound as="span" size="auto" clip>
			<Inline as="span" gap="xs">{@render chips()}</Inline>
		</Bound>
	{:else}
		<Cluster as="span" gap="xs">{@render chips()}</Cluster>
	{/if}
{/if}
