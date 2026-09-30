<script lang="ts">
	import MatrixRenderer, { type MatrixColumn } from '../../../lib/ui/grid.svelte';
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';
	import type { Patch } from '../../../lib/ui/renderer-input.js';
	import { watch } from 'runed';
	import Icon from '@iconify/svelte';
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
	type KeyRow = FactKey & { id: string };

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const rows = $derived<Value>(view.value ?? []);
	const types = ['boolean', 'number', 'string', 'date', 'instant', 'code'] as const;
	const evidenceKinds = $derived([
		{ value: 'REFERENCE', label: t('fact_keys.evidence_reference') },
		{ value: 'FILE', label: t('fact_keys.evidence_file') },
		{ value: 'REFERENCE_AND_FILE', label: t('fact_keys.evidence_reference_and_file') }
	]);
	type EvidenceKind = NonNullable<FactKey['evidence']>['kind'];
	let projected = $state<KeyRow[]>([]);
	let expandedIndex = $state<number | null>(null);
	watch(
		() => rows,
		(next) => {
			projected = next.map((row, index) => ({ ...row, id: String(index) }));
		},
		{ lazy: false }
	);
	const columns: MatrixColumn<KeyRow>[] = $derived([
		{
			key: 'key',
			label: t('fact_keys.key'),
			field: { name: 'key', kind: 'text' },
			width: 220
		},
		{
			key: 'type',
			label: t('fact_keys.type'),
			field: { name: 'type', kind: 'enum', values: types },
			width: 160
		},
		{
			key: 'label',
			label: t('fact_keys.label'),
			field: { name: 'label', kind: 'text', nullable: true },
			width: 220
		}
	]);

	function emit(value: Value): void {
		if (view.mode === 'edit') view.onChange(value);
	}
	function commit(next: KeyRow[]): void {
		if (next.length !== rows.length) expandedIndex = null;
		projected = next;
		emit(
			next.map((row, index) => {
				const { id: _id, ...field } = row;
				return next.length !== rows.length || row.type === rows[index]?.type
					? field
					: (Object.fromEntries(
							Object.entries({
								key: row.key,
								label: row.label,
								description: row.description,
								scope: row.scope,
								valid_when: row.valid_when,
								validation_message: row.validation_message,
								evidence: row.evidence,
								type: row.type
							}).filter(([, value]) => value !== undefined)
						) as Value[number]);
			})
		);
	}
	function edit(index: number, change: Patch<Value[number]>): void {
		commit(
			projected.map((row, position) =>
				position === index
					? (Object.fromEntries(
							Object.entries({ ...row, ...change }).filter(([, value]) => value !== undefined)
						) as KeyRow)
					: row
			)
		);
	}
</script>

{#if view.mode === 'show'}
	<span>{rows.map((row) => `${row.key}:${row.type}`).join(', ') || '—'}</span>
{:else}
	<Stack gap="md">
		<MatrixRenderer
			bind:rows={projected}
			{columns}
			{disabled}
			allowAddRows={!disabled}
			addRowLabel={t('fact_keys.add')}
			removeRowLabel={t('fact_keys.remove')}
			createRow={() => ({ id: String(projected.length), key: '', type: 'string' as const })}
			onChange={commit}
		>
			{#snippet rowDetails(row, index)}
				<div>
					<Inline
						as="button"
						type="button"
						gap="xs"
						align="center"
						class="min-h-8 text-sm text-muted-foreground hover:text-foreground"
						aria-expanded={expandedIndex === index}
						onclick={() => (expandedIndex = expandedIndex === index ? null : index)}
						><Icon
							icon="lucide:chevron-right"
							class={expandedIndex === index ? 'size-3.5 rotate-90' : 'size-3.5'}
						/>{t('fact_keys.validation')}</Inline
					>
					{#if expandedIndex === index}
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
							{:else if row.type === 'code'}
								<Labelled label={t('fact_keys.table')}>
									<Input
										{disabled}
										value={row.table ?? ''}
										oninput={(event) =>
											edit(index, {
												table:
													event.currentTarget.value.trim() === ''
														? undefined
														: event.currentTarget.value.trim()
											})}
									/>
								</Labelled>
								<Labelled label={t('fact_keys.parent_fact')}>
									<Input
										{disabled}
										value={row.parent_fact ?? ''}
										oninput={(event) =>
											edit(index, {
												parent_fact:
													event.currentTarget.value.trim() === ''
														? undefined
														: event.currentTarget.value.trim()
											})}
									/>
								</Labelled>
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
							<Labelled label={t('fact_keys.evidence')}>
								<Combobox
									clearable
									placeholder={t('fact_keys.evidence_none')}
									options={evidenceKinds}
									{disabled}
									value={row.evidence?.kind ?? null}
									onChange={(next) =>
										edit(index, {
											evidence:
												next == null
													? undefined
													: {
															...(row.evidence?.when == null ? {} : { when: row.evidence.when }),
															kind: next as EvidenceKind
														}
										})}
								/>
							</Labelled>
							{#if row.evidence != null}
								<Column span="all">
									<Labelled label={t('fact_keys.evidence_when')}>
										<Input
											{disabled}
											value={row.evidence.when ?? ''}
											oninput={(event) =>
												edit(index, {
													evidence: {
														kind: row.evidence!.kind,
														...(event.currentTarget.value.trim() === ''
															? {}
															: { when: event.currentTarget.value })
													}
												})}
										/>
									</Labelled>
								</Column>
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
					{/if}
				</div>
			{/snippet}
		</MatrixRenderer>
	</Stack>
{/if}
