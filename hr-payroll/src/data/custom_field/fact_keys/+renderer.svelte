<script lang="ts">
	import RowList from '../../../lib/ui/row-list.svelte';
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';
	import type { Patch } from '../../../lib/ui/renderer-input.js';
	/**
	 * The list editor for a row's declared fact keys.
	 *
	 * Each row is one key and the type of value it expects; the engine reads the declaration to
	 * refuse an undeclared mention and to offer the right control. Used by a scheme's elections and
	 * by a settings version's entity facts.
	 */
	import { EMPTY_OF } from '../../../lib/expressions/compile.js';

	import { Combobox, Input } from '@norbital-ai/ui';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Textarea } from '@norbital-ai/ui';
	import type { FactKey } from '../../../lib/datatypes/fact_keys.js';
	import type { CustomFieldView } from '@norbital-ai/ui';

	type Value = readonly FactKey[];

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const rows = $derived<Value>(view.value ?? []);
	const types = ['boolean', 'number', 'string'] as const;

	function emit(value: Value): void {
		if (view.mode === 'edit') view.onChange(value);
	}
	function edit(index: number, change: Patch<Value[number]>): void {
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

{#if view.mode === 'show'}
	<span>{rows.map((row) => `${row.key}:${row.type}`).join(', ') || '—'}</span>
{:else}
	<Stack gap="md">
		<RowList
			{rows}
			{disabled}
			addLabel={t('fact_keys.add')}
			add={() => emit([...rows, { key: '', type: 'string' }])}
			removeLabel={t('fact_keys.remove')}
			remove={(index) => emit(rows.filter((_, position) => position !== index))}
		>
			{#snippet row(row, index)}
				<Labelled label={t('fact_keys.key')}>
					<Input
						value={row.key}
						{disabled}
						oninput={(event) => edit(index, { key: event.currentTarget.value })}
					/>
				</Labelled>
				<Labelled label={t('fact_keys.type')}>
					<Combobox
						options={types.map((type) => ({ value: type, label: type }))}
						value={row.type}
						{disabled}
						onChange={(type) =>
							type != null &&
							emit(
								rows.map((row, position) =>
									position === index
										? ({
												key: row.key,
												label: row.label,
												description: row.description,
												scope: row.scope,
												valid_when: row.valid_when,
												validation_message: row.validation_message,
												type
											} as Value[number])
										: row
								)
							)}
					/>
				</Labelled>
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
							<Labelled label={t('fact_keys.label')}>
								<Input
									{disabled}
									value={row.label ?? ''}
									oninput={(event) => edit(index, { label: event.currentTarget.value })}
								/>
							</Labelled>
							<Labelled label={t('fact_keys.description')}>
								<Input
									{disabled}
									value={row.description ?? ''}
									oninput={(event) => edit(index, { description: event.currentTarget.value })}
								/>
							</Labelled>
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
								<Labelled label={t('fact_keys.required_when')}>
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
								</Labelled>
								<p class="text-xs text-muted-foreground">{t('fact_keys.required_when_help')}</p>
							</Column>
							<Column span="all">
								<Labelled label={t('fact_keys.valid_when')}>
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
								</Labelled>
							</Column>
							<Column span="all">
								<Labelled label={t('fact_keys.validation_message')}>
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
								</Labelled>
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
											<Combobox
												options={[
													{ value: 'false', label: t('entity_facts.no') },
													{ value: 'true', label: t('entity_facts.yes') }
												]}
												{disabled}
												value={String(row.default_value === true)}
												onChange={(next) =>
													next != null && edit(index, { default_value: next === 'true' })}
											/>
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
								<Labelled label={t('fact_keys.minimum')}>
									<Input
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
									/>
								</Labelled>
								<Labelled label={t('fact_keys.maximum')}>
									<Input
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
									/>
								</Labelled>
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
								<Labelled label={t('fact_keys.min_length')}>
									<Input
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
									/>
								</Labelled>
							{/if}
							{#if row.type !== 'boolean'}
								<Labelled label={t('fact_keys.options')}>
									<Textarea
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
									/>
								</Labelled>
							{/if}
						</Grid>
					</details>
				</Column>
			{/snippet}
		</RowList>
	</Stack>
{/if}
