<script lang="ts">
	/**
	 * The list editor for a row's declared fact keys.
	 *
	 * Each row is one key and the type of value it expects; the engine reads the declaration to
	 * refuse an undeclared mention and to offer the right control. Used by a scheme's elections and
	 * by a settings version's entity facts.
	 */
	import { EMPTY_OF } from '../../lib/expressions/compile.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Textarea } from '@norbital-ai/ui/textarea';
	import type { FactKey } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const rows = $derived<readonly FactKey[]>(props.value ?? []);
	const types = ['boolean', 'number', 'string'] as const;

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(
			rows.map((row, position) =>
				position === index
					? (Object.fromEntries(
							Object.entries({ ...row, ...change }).filter(([, value]) => value !== undefined)
						) as Value[number])
					: row
			)
		);
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
								emit(
									rows.map((row, position) =>
										position === index
											? {
													key: row.key,
													label: row.label,
													description: row.description,
													scope: row.scope,
													valid_when: row.valid_when,
													validation_message: row.validation_message,
													type: event.currentTarget.value as Value[number]['type']
												}
											: row
									)
								)}
						>
							{#each types as type (type)}
								<option value={type}>{type}</option>
							{/each}
						</select></Stack
					></label
				>
				<Column span="all">
					<details>
						<summary class="cursor-pointer text-sm">{t('fact_keys.validation')}</summary>
						<Grid gap="sm" minimum="compact" class="pt-3">
							<label class="text-sm"
								><Inline as="span" gap="sm"
									><input
										type="checkbox"
										{disabled}
										checked={row.scope === 'EMPLOYMENT'}
										onchange={(event) =>
											edit(index, {
												scope: event.currentTarget.checked ? 'EMPLOYMENT' : undefined
											})}
									/>{t('fact_keys.employment_scope')}</Inline
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('fact_keys.label')}<Input
										{disabled}
										value={row.label ?? ''}
										oninput={(event) => edit(index, { label: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('fact_keys.description')}<Input
										{disabled}
										value={row.description ?? ''}
										oninput={(event) => edit(index, { description: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Inline as="span" gap="sm"
									><input
										type="checkbox"
										{disabled}
										checked={row.required === true}
										onchange={(event) =>
											edit(index, {
												required: event.currentTarget.checked,
												...(event.currentTarget.checked
													? { default_value: undefined, required_when: undefined }
													: {})
											})}
									/>{t('fact_keys.required')}</Inline
								></label
							>
							<Column span="all">
								<label class="text-sm"
									><Stack gap="xs">
										{t('fact_keys.required_when')}
										<Input
											{disabled}
											value={row.required_when ?? ''}
											oninput={(event) =>
												edit(index, {
													required_when:
														event.currentTarget.value.trim() === ''
															? undefined
															: event.currentTarget.value,
													...(event.currentTarget.value.trim() === '' ? {} : { required: false })
												})}
										/>
									</Stack></label
								>
								<p class="text-xs text-muted-foreground">{t('fact_keys.required_when_help')}</p>
							</Column>
							<Column span="all">
								<label class="text-sm"
									><Stack gap="xs">
										{t('fact_keys.valid_when')}
										<Input
											{disabled}
											value={row.valid_when ?? ''}
											oninput={(event) =>
												edit(index, {
													valid_when:
														event.currentTarget.value.trim() === ''
															? undefined
															: event.currentTarget.value
												})}
										/>
									</Stack></label
								>
							</Column>
							<Column span="all">
								<label class="text-sm"
									><Stack gap="xs">
										{t('fact_keys.validation_message')}
										<Input
											{disabled}
											value={row.validation_message ?? ''}
											oninput={(event) =>
												edit(index, {
													validation_message:
														event.currentTarget.value.trim() === ''
															? undefined
															: event.currentTarget.value
												})}
										/>
									</Stack></label
								>
							</Column>
							<label class="text-sm"
								><Inline as="span" gap="sm"
									><input
										type="checkbox"
										{disabled}
										checked={row.default_value !== undefined}
										onchange={(event) =>
											edit(index, {
												default_value: event.currentTarget.checked ? EMPTY_OF[row.type] : undefined,
												...(event.currentTarget.checked ? { required: false } : {})
											})}
									/>{t('fact_keys.use_default')}</Inline
								></label
							>
							{#if row.default_value !== undefined}
								<label class="text-sm"
									><Stack gap="xs"
										>{t('fact_keys.default')}
										{#if row.type === 'boolean'}
											<select
												class="h-9 rounded-md border border-input bg-background px-2 text-sm"
												{disabled}
												value={String(row.default_value)}
												onchange={(event) =>
													edit(index, { default_value: event.currentTarget.value === 'true' })}
												><option value="false">{t('entity_facts.no')}</option><option value="true"
													>{t('entity_facts.yes')}</option
												></select
											>
										{:else if row.type === 'number'}
											<Input
												type="number"
												{disabled}
												value={Number(row.default_value)}
												oninput={(event) =>
													edit(index, {
														default_value:
															event.currentTarget.value === ''
																? undefined
																: Number(event.currentTarget.value)
													})}
											/>
										{:else}<Input
												{disabled}
												value={String(row.default_value)}
												oninput={(event) =>
													edit(index, { default_value: event.currentTarget.value })}
											/>{/if}
									</Stack></label
								>
							{/if}
							{#if row.type === 'number'}
								<label class="text-sm"
									><Stack gap="xs"
										>{t('fact_keys.minimum')}<Input
											type="number"
											{disabled}
											value={row.minimum ?? ''}
											oninput={(event) =>
												edit(index, {
													minimum:
														event.currentTarget.value === ''
															? undefined
															: Number(event.currentTarget.value)
												})}
										/></Stack
									></label
								>
								<label class="text-sm"
									><Stack gap="xs"
										>{t('fact_keys.maximum')}<Input
											type="number"
											{disabled}
											value={row.maximum ?? ''}
											oninput={(event) =>
												edit(index, {
													maximum:
														event.currentTarget.value === ''
															? undefined
															: Number(event.currentTarget.value)
												})}
										/></Stack
									></label
								>
								<label class="text-sm"
									><Inline as="span" gap="sm"
										><input
											type="checkbox"
											{disabled}
											checked={row.integer === true}
											onchange={(event) => edit(index, { integer: event.currentTarget.checked })}
										/>{t('fact_keys.integer')}</Inline
									></label
								>
							{:else if row.type === 'string'}
								<label class="text-sm"
									><Stack gap="xs"
										>{t('fact_keys.min_length')}<Input
											type="number"
											min="0"
											step="1"
											{disabled}
											value={row.min_length ?? ''}
											oninput={(event) =>
												edit(index, {
													min_length:
														event.currentTarget.value === ''
															? undefined
															: Number(event.currentTarget.value)
												})}
										/></Stack
									></label
								>
							{/if}
							{#if row.type !== 'boolean'}
								<label class="text-sm"
									><Stack gap="xs"
										>{t('fact_keys.options')}<Textarea
											{disabled}
											value={row.options?.join('\n') ?? ''}
											oninput={(event) =>
												edit(index, {
													options:
														event.currentTarget.value === ''
															? undefined
															: event.currentTarget.value
																	.split('\n')
																	.map((value) =>
																		row.type === 'number' ? Number(value.trim()) : value.trim()
																	)
												})}
										/></Stack
									></label
								>
							{/if}
						</Grid>
					</details>
				</Column>
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
