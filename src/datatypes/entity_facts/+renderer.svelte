<script lang="ts">
	/**
	 * The editor for an entity's recorded facts.
	 *
	 * Each row is one key the settings version declares, its type and its value; the engine reads a
	 * value as `person.company.facts.<key>`. The type switch decides the control, so a boolean is a
	 * yes/no and a number a figure.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { entityFactsValueSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type FactType = 'boolean' | 'number' | 'string';
	type Row = {
		readonly key: string;
		readonly type: FactType;
		readonly value: string | number | boolean;
	};

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(entityFactsValueSchema)(props.value ?? {}));
	const entries = $derived(Result.isSuccess(parsed) ? Object.entries(parsed.success) : []);
	const types = ['boolean', 'number', 'string'] as const;
	const typeOf = (value: string | number | boolean): FactType =>
		typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
	const rows = $derived<Row[]>(
		entries.map(([key, value]) => ({ key, type: typeOf(value), value }))
	);

	function emit(next: Row[]): void {
		if (props.mode !== 'edit') return;
		props.onValueChange(
			Object.fromEntries(
				next.map((row) => [
					row.key,
					row.type === 'boolean'
						? row.value === true
						: row.type === 'number'
							? Number(row.value)
							: String(row.value)
				])
			)
		);
	}
	function edit(index: number, change: Partial<Row>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
</script>

{#if props.mode === 'display'}
	<span>{entries.map(([key, value]) => `${key}: ${String(value)}`).join(', ') || '—'}</span>
{:else}
	<Stack gap="md">
		{#each rows as row, index (index)}
			<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
				<label class="text-sm"
					><Stack gap="xs"
						>{t('entity_facts.key')}<Input
							value={row.key}
							{disabled}
							oninput={(event) => edit(index, { key: event.currentTarget.value })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('entity_facts.type')}<select
							class="h-9 rounded-md border border-input bg-background px-2 text-sm"
							value={row.type}
							{disabled}
							onchange={(event) =>
								edit(index, { type: event.currentTarget.value as FactType, value: '' })}
						>
							{#each types as type (type)}
								<option value={type}>{type}</option>
							{/each}
						</select></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('entity_facts.value')}
						{#if row.type === 'boolean'}
							<select
								class="h-9 rounded-md border border-input bg-background px-2 text-sm"
								value={row.value === true ? 'true' : 'false'}
								{disabled}
								onchange={(event) => edit(index, { value: event.currentTarget.value === 'true' })}
							>
								<option value="true">{t('entity_facts.yes')}</option>
								<option value="false">{t('entity_facts.no')}</option>
							</select>
						{:else if row.type === 'number'}
							<Input
								type="number"
								value={Number.isFinite(Number(row.value)) ? Number(row.value) : ''}
								{disabled}
								oninput={(event) => edit(index, { value: event.currentTarget.value })}
							/>
						{:else}
							<Input
								value={String(row.value)}
								{disabled}
								oninput={(event) => edit(index, { value: event.currentTarget.value })}
							/>
						{/if}
					</Stack></label
				>
				<Cluster>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => emit(rows.filter((_, position) => position !== index))}
						>{t('entity_facts.remove')}</Button
					>
				</Cluster>
			</Grid>
		{/each}
		<Cluster
			><Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...rows, { key: '', type: 'string', value: '' }])}
				>{t('entity_facts.add')}</Button
			></Cluster
		>
	</Stack>
{/if}
