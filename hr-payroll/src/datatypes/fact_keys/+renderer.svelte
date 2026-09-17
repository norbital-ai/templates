<script lang="ts">
	/**
	 * The list editor for a row's declared fact keys.
	 *
	 * Each row is one key and the type of value it expects; the engine reads the declaration to
	 * refuse an undeclared mention and to offer the right control. Used by a scheme's elections and
	 * by a settings version's entity facts.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { factKeysValueSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(factKeysValueSchema)(props.value ?? []));
	const rows = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	const types = ['boolean', 'number', 'string'] as const;

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
</script>

{#if props.mode === 'display'}
	<span>{rows.map((row) => `${row.key}:${row.type}`).join(', ') || '—'}</span>
{:else}
	<Stack gap="md">
		{#each rows as row, index (index)}
			<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
				<label class="text-sm"
					><Stack gap="xs"
						>{t('fact_keys.key')}<Input
							value={row.key}
							{disabled}
							oninput={(event) => edit(index, { key: event.currentTarget.value })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('fact_keys.type')}<select
							class="h-9 rounded-md border border-input bg-background px-2 text-sm"
							value={row.type}
							{disabled}
							onchange={(event) =>
								edit(index, { type: event.currentTarget.value as Value[number]['type'] })}
						>
							{#each types as type (type)}
								<option value={type}>{type}</option>
							{/each}
						</select></Stack
					></label
				>
				<Cluster>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => emit(rows.filter((_, position) => position !== index))}
						>{t('fact_keys.remove')}</Button
					>
				</Cluster>
			</Grid>
		{/each}
		<Cluster
			><Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...rows, { key: '', type: 'string' }])}>{t('fact_keys.add')}</Button
			></Cluster
		>
	</Stack>
{/if}
