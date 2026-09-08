<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import EntryFields from '../entry_component_definition/entry-fields.svelte';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { componentDefinitionSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type Source = Value['source'];
	type FormulaUnit = Extract<Value, { source: 'FORMULA' }>['unit'];

	function options<T extends string>(values: readonly T[]): { value: T; label: string }[] {
		return values.map((value) => ({ value, label: value.replaceAll('_', ' ').toLowerCase() }));
	}

	const SOURCE_OPTIONS: { value: Source; label: string; description: string }[] = [
		{ value: 'ENTRY', label: 'Entry', description: 'Supplied by a person or an import' },
		{ value: 'FORMULA', label: 'Formula', description: 'CEL expression over the payslip context' },
		{ value: 'SCHEDULE', label: 'Schedule', description: 'The contracted amount on the terms' },
		{
			value: 'DERIVED_OVERTIME',
			label: 'Derived overtime',
			description: 'Priced by the overtime regime from work days, never entered'
		}
	];
	const FORMULA_UNIT_OPTIONS = options<FormulaUnit>(['MONEY', 'DAYS', 'HOURS', 'RATE']);

	type ComponentDefinitionRendererProps = RendererProps & {
		/** The component being edited, which is what scopes the people a cap layer may name. */
		readonly row?: Record<string, unknown>;
	};

	let props: ComponentDefinitionRendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const companyId = $derived(
		typeof props.row?.company_id === 'string' ? props.row.company_id : null
	);
	const parsed = $derived(
		Schema.decodeUnknownResult(componentDefinitionSchema)(props.value, {
			onExcessProperty: 'error'
		})
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		switch (current.source) {
			case 'ENTRY':
				return `Entry · ${current.unit} · ${current.settlement}${current.cap === null ? '' : ' · capped'}`;
			case 'FORMULA':
				return `Formula · ${current.unit} · ${current.expr}`;
			case 'SCHEDULE':
				return `Schedule · ${current.reducible ? 'reducible' : 'not reducible'}`;
			case 'ABSENCE':
				return t('work.output_absence');
			case 'DERIVED_OVERTIME':
				return 'Derived overtime · priced by the regime';
		}
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultFor(source: Source): Value {
		switch (source) {
			case 'ENTRY':
				return {
					source: 'ENTRY',
					unit: 'MONEY',
					evidence: 'NONE',
					cap: null,
					settlement: 'PAYROLL'
				};
			case 'FORMULA':
				return { source: 'FORMULA', unit: 'MONEY', expr: '' };
			case 'SCHEDULE':
				return { source: 'SCHEDULE', unit: 'MONEY', reducible: true };
			case 'ABSENCE':
				return { source: 'ABSENCE', unit: 'MONEY' };
			case 'DERIVED_OVERTIME':
				return { source: 'DERIVED_OVERTIME', unit: 'MONEY' };
		}
	}

	function selectSource(source: Source | null): void {
		if (source === null) {
			emit(null);
			return;
		}
		if (current !== null && current.source === source) return;
		emit(defaultFor(source));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Source
				<Combobox
					options={SOURCE_OPTIONS}
					value={current?.source ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.component_definition.select_source')}
					onValueChange={selectSource}
				/>
			</Stack>
		</label>

		{#if current?.source === 'ENTRY'}
			<!--
				The ENTRY arm is `entry_component_definition` exactly, so its fields are drawn by that
				datatype's own editor rather than by a second copy here. The five event catalogues and
				the loan catalogue carry the narrow type and no source picker; this arm is the same
				fields reached through one.
			-->
			<Column span="all">
				<EntryFields value={current} {disabled} {companyId} onChange={emit} />
			</Column>
		{:else if current?.source === 'FORMULA'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Unit
					<Combobox
						options={FORMULA_UNIT_OPTIONS}
						value={current.unit}
						{disabled}
						searchable={false}
						onValueChange={(unit) => {
							if (unit !== null) emit({ ...current, unit });
						}}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Expression
					<Input
						value={current.expr}
						{disabled}
						placeholder={t('component.cel_expression')}
						oninput={(event) => emit({ ...current, expr: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{:else if current?.source === 'SCHEDULE'}
			<label class="self-end text-sm font-medium">
				<Inline gap="sm">
					<input
						type="checkbox"
						class="size-4"
						checked={current.reducible}
						{disabled}
						onchange={(event) => emit({ ...current, reducible: event.currentTarget.checked })}
					/>
					Reducible by unpaid absence
				</Inline>
			</label>
		{/if}
	</Grid>
{/if}
