<script lang="ts">
	import { Result, Schema } from 'effect';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { nullableNumberFrom, splitList } from '../../lib/ui/renderer-input.js';
	import {
		statutoryRegimeSchema,
		type StatutoryRegime,
		type StatutoryRestBreakRule
	} from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Rule = Value['overtime_rules'][number];
	type Limit = Value['overtime_limits'][number];
	type Coverage = NonNullable<Value['overtime_coverage']>;
	type CategoryBasis = Coverage['category_basis'];
	type WageBasis = NonNullable<Coverage['wage_basis']>;

	type PricingRow = {
		readonly id: string;
		readonly day_type: Rule['day_type'];
		readonly measure: Rule['band']['measure'];
		readonly from: number;
		readonly to: number | null;
		readonly award: Rule['award']['kind'];
		readonly multiple: number;
		readonly authority: string;
	};
	type LimitRow = Limit & { readonly id: string };
	type BreakRow = {
		readonly id: string;
		readonly applies_when: StatutoryRestBreakRule['applies_when'];
		readonly after_consecutive_hours: number | null;
		readonly minimum_minutes: number | null;
		readonly paid_status: 'UNSTATED' | 'WORKING_TIME' | 'NOT_WORKING_TIME';
		readonly on_exceed: StatutoryRestBreakRule['on_exceed'];
		readonly authority: string;
	};

	const enumField = (name: string, values: readonly string[]): CollectionField => ({
		name,
		kind: 'enum',
		nullable: false,
		values
	});
	const numericField = (name: string, nullable = false): CollectionField => ({
		name,
		kind: 'numeric',
		nullable
	});
	const integerField = (name: string, nullable = false): CollectionField => ({
		name,
		kind: 'integer',
		nullable
	});
	const textField = (name: string): CollectionField => ({ name, kind: 'text', nullable: false });

	const PRICING_COLUMNS = [
		{
			key: 'day_type',
			label: 'Day type',
			field: enumField('day_type', ['ORDINARY', 'REST_DAY', 'PUBLIC_HOLIDAY']),
			width: 170
		},
		{
			key: 'measure',
			label: 'Measured from',
			field: enumField('measure', ['BEYOND_NORMAL', 'FROM_START_OF_DAY']),
			width: 190
		},
		{ key: 'from', label: 'From', field: numericField('from'), width: 110 },
		{
			key: 'to',
			label: 'To',
			field: numericField('to', true),
			placeholder: 'No limit',
			width: 110
		},
		{
			key: 'award',
			label: 'Award basis',
			field: enumField('award', ['HOURLY_MULTIPLE', 'DAY_WAGE_MULTIPLE']),
			width: 180
		},
		{ key: 'multiple', label: 'Multiple', field: numericField('multiple'), width: 120 },
		{ key: 'authority', label: 'Authority', field: textField('authority'), width: 220 }
	] satisfies readonly MatrixColumn<PricingRow>[];

	const LIMIT_COLUMNS = [
		{
			key: 'period',
			label: 'Period',
			field: enumField('period', ['DAY', 'WEEK', 'MONTH']),
			width: 130
		},
		{
			key: 'measures',
			label: 'Measures',
			field: enumField('measures', ['OVERTIME_HOURS', 'TOTAL_WORK_HOURS']),
			width: 190
		},
		{ key: 'max_hours', label: 'Maximum hours', field: numericField('max_hours'), width: 150 },
		{
			key: 'on_exceed',
			label: 'When exceeded',
			field: enumField('on_exceed', ['WARN', 'BLOCK']),
			width: 150
		},
		{ key: 'authority', label: 'Authority', field: textField('authority'), width: 240 }
	] satisfies readonly MatrixColumn<LimitRow>[];

	const BREAK_COLUMNS = [
		{
			key: 'applies_when',
			label: 'Applies to',
			field: enumField('applies_when', ['ALWAYS', 'CONTINUOUS_ATTENDANCE']),
			width: 200
		},
		{
			key: 'after_consecutive_hours',
			label: 'After hours',
			field: numericField('after_consecutive_hours', true),
			placeholder: 'Every day',
			width: 140
		},
		{
			key: 'minimum_minutes',
			label: 'Minimum minutes',
			field: integerField('minimum_minutes', true),
			placeholder: 'Not stated',
			width: 150
		},
		{
			key: 'paid_status',
			label: 'Working time',
			field: enumField('paid_status', ['UNSTATED', 'WORKING_TIME', 'NOT_WORKING_TIME']),
			width: 180
		},
		{
			key: 'on_exceed',
			label: 'On shortfall',
			field: enumField('on_exceed', ['WARN', 'BLOCK']),
			width: 140
		},
		{ key: 'authority', label: 'Authority', field: textField('authority'), width: 240 }
	] satisfies readonly MatrixColumn<BreakRow>[];

	const CATEGORY_BASES: { value: CategoryBasis; label: string }[] = [
		{ value: 'STATUTORY_WORK_CATEGORY', label: 'Statutory work category' },
		{ value: 'WORK_CLASSIFICATION', label: 'Work classification' }
	];
	const WAGE_BASES: { value: WageBasis; label: string }[] = [
		{ value: 'STATUTORY_WAGES', label: 'Statutory wages' },
		{ value: 'BASE_SALARY', label: 'Base salary' }
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(statutoryRegimeSchema)(props.value));
	const current = $derived<StatutoryRegime>(
		Result.isSuccess(parsed)
			? parsed.success
			: { overtime_coverage: null, overtime_rules: [], overtime_limits: [] }
	);
	const breakRules = $derived<readonly StatutoryRestBreakRule[]>(current.rest_break_rules ?? []);
	const summary = $derived(
		[
			`${current.overtime_rules.length} pricing bands`,
			`${current.overtime_limits.length} limits`,
			...(breakRules.length > 0 ? [`${breakRules.length} break rules`] : [])
		].join(' · ')
	);

	const pricingRows = $derived(
		current.overtime_rules.map((rule, index): PricingRow => ({
			id: `pricing-${index}`,
			day_type: rule.day_type,
			measure: rule.band.measure,
			from: rule.band.measure === 'BEYOND_NORMAL' ? rule.band.from_hours : rule.band.from_fraction,
			to: rule.band.measure === 'BEYOND_NORMAL' ? rule.band.to_hours : rule.band.to_fraction,
			award: rule.award.kind,
			multiple: rule.award.multiple,
			authority: rule.authority
		}))
	);
	const limitRows = $derived(
		current.overtime_limits.map((limit, index): LimitRow => ({ id: `limit-${index}`, ...limit }))
	);
	const breakRows = $derived(
		breakRules.map((rule, index): BreakRow => ({
			id: `break-${index}`,
			applies_when: rule.applies_when,
			after_consecutive_hours: rule.after_consecutive_hours,
			minimum_minutes: rule.minimum_minutes,
			paid_status:
				rule.counts_as_worked_time === null
					? 'UNSTATED'
					: rule.counts_as_worked_time
						? 'WORKING_TIME'
						: 'NOT_WORKING_TIME',
			on_exceed: rule.on_exceed,
			authority: rule.authority
		}))
	);

	function emit(next: Value): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function replaceCoverage(next: Coverage | null): void {
		emit({ ...current, overtime_coverage: next });
	}

	function defaultCoverage(): Coverage {
		return {
			wage_ceiling: null,
			ceiling_is_inclusive: null,
			wage_basis: null,
			category_basis: 'WORK_CLASSIFICATION',
			exempt_categories: [],
			excluded_categories: [],
			authority: ''
		};
	}

	function pricingRules(rows: PricingRow[]): Rule[] {
		return rows.map((row) => ({
			day_type: row.day_type,
			authority: row.authority,
			band:
				row.measure === 'BEYOND_NORMAL'
					? { measure: 'BEYOND_NORMAL', from_hours: row.from, to_hours: row.to }
					: { measure: 'FROM_START_OF_DAY', from_fraction: row.from, to_fraction: row.to },
			award:
				row.award === 'HOURLY_MULTIPLE'
					? { kind: 'HOURLY_MULTIPLE', multiple: row.multiple }
					: { kind: 'DAY_WAGE_MULTIPLE', multiple: row.multiple }
		}));
	}

	function statutoryBreakRules(rows: BreakRow[]): StatutoryRestBreakRule[] {
		return rows.map((row) => ({
			applies_when: row.applies_when,
			after_consecutive_hours: row.after_consecutive_hours,
			minimum_minutes: row.minimum_minutes,
			counts_as_worked_time:
				row.paid_status === 'UNSTATED' ? null : row.paid_status === 'WORKING_TIME',
			on_exceed: row.on_exceed,
			authority: row.authority
		}));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="lg">
		<Stack as="section" gap="md">
			<Inline justify="between" align="start" gap="md">
				<Stack gap="xs">
					<h3 class="text-sm font-semibold">Overtime eligibility</h3>
					<p class="text-meta">
						Only add this when a wage ceiling or work category limits who receives overtime.
					</p>
				</Stack>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => replaceCoverage(current.overtime_coverage ? null : defaultCoverage())}
				>
					{current.overtime_coverage ? 'Remove eligibility rule' : 'Add eligibility rule'}
				</Button>
			</Inline>

			{#if current.overtime_coverage}
				{@const coverage = current.overtime_coverage}
				<Grid gap="sm" minimum="compact">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Category basis
							<Combobox
								options={CATEGORY_BASES}
								value={coverage.category_basis}
								{disabled}
								searchable={false}
								onValueChange={(value) => {
									if (value) replaceCoverage({ ...coverage, category_basis: value });
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Wage basis
							<Combobox
								options={WAGE_BASES}
								value={coverage.wage_basis}
								{disabled}
								searchable={false}
								emptyPlaceholder="No wage ceiling"
								onValueChange={(value) => {
									if (value) replaceCoverage({ ...coverage, wage_basis: value });
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Ceiling amount
							<Input
								type="number"
								min="0"
								step="0.01"
								value={coverage.wage_ceiling?.value ?? ''}
								{disabled}
								oninput={(event) => {
									const value = nullableNumberFrom(event.currentTarget.value);
									replaceCoverage({
										...coverage,
										wage_ceiling:
											value === null
												? null
												: { value, currency: coverage.wage_ceiling?.currency ?? '' },
										wage_basis: value === null ? null : (coverage.wage_basis ?? 'STATUTORY_WAGES'),
										ceiling_is_inclusive:
											value === null ? null : (coverage.ceiling_is_inclusive ?? true)
									});
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Currency
							<Input
								value={coverage.wage_ceiling?.currency ?? ''}
								maxlength={3}
								{disabled}
								oninput={(event) => {
									if (coverage.wage_ceiling)
										replaceCoverage({
											...coverage,
											wage_ceiling: {
												...coverage.wage_ceiling,
												currency: event.currentTarget.value.toUpperCase()
											}
										});
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							At the ceiling
							<Combobox
								options={[
									{ value: 'inclusive', label: 'Eligible' },
									{ value: 'exclusive', label: 'Not eligible' }
								]}
								value={coverage.ceiling_is_inclusive === null
									? null
									: coverage.ceiling_is_inclusive
										? 'inclusive'
										: 'exclusive'}
								{disabled}
								searchable={false}
								onValueChange={(value) => {
									if (value)
										replaceCoverage({ ...coverage, ceiling_is_inclusive: value === 'inclusive' });
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Always eligible categories
							<Input
								value={coverage.exempt_categories.join(', ')}
								{disabled}
								placeholder="Comma separated"
								oninput={(event) =>
									replaceCoverage({
										...coverage,
										exempt_categories: splitList(event.currentTarget.value)
									})}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Excluded categories
							<Input
								value={coverage.excluded_categories.join(', ')}
								{disabled}
								placeholder="Comma separated"
								oninput={(event) =>
									replaceCoverage({
										...coverage,
										excluded_categories: splitList(event.currentTarget.value)
									})}
							/>
						</Stack>
					</label>
					<label class="col-span-full text-sm font-medium">
						<Stack gap="xs">
							Authority
							<Input
								value={coverage.authority}
								{disabled}
								oninput={(event) =>
									replaceCoverage({ ...coverage, authority: event.currentTarget.value })}
							/>
						</Stack>
					</label>
				</Grid>
			{/if}
		</Stack>

		<Stack as="section" gap="sm" class="border-t border-border pt-5">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Overtime pricing</h3>
				<p class="text-meta">Each row is one non-overlapping pricing band for a day type.</p>
			</Stack>
			<MatrixRenderer
				rows={pricingRows}
				columns={PRICING_COLUMNS}
				{disabled}
				emptyMessage="No overtime pricing bands"
				addRowLabel="Add pricing band"
				createRow={(): PricingRow => ({
					id: crypto.randomUUID(),
					day_type: 'ORDINARY',
					measure: 'BEYOND_NORMAL',
					from: 0,
					to: null,
					award: 'HOURLY_MULTIPLE',
					multiple: 1.5,
					authority: ''
				})}
				bounded={false}
				onChange={(rows) => emit({ ...current, overtime_rules: pricingRules(rows) })}
			/>
		</Stack>

		<Stack as="section" gap="sm" class="border-t border-border pt-5">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Working-time limits</h3>
				<p class="text-meta">Each period and measure may have one maximum.</p>
			</Stack>
			<MatrixRenderer
				rows={limitRows}
				columns={LIMIT_COLUMNS}
				{disabled}
				emptyMessage="No working-time limits"
				addRowLabel="Add limit"
				createRow={(): LimitRow => ({
					id: crypto.randomUUID(),
					period: 'MONTH',
					measures: 'OVERTIME_HOURS',
					max_hours: 1,
					on_exceed: 'BLOCK',
					authority: ''
				})}
				bounded={false}
				onChange={(rows) =>
					emit({
						...current,
						overtime_limits: rows.map(({ id: _, ...limit }) => limit)
					})}
			/>
		</Stack>

		<Stack as="section" gap="sm" class="border-t border-border pt-5">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Rest and meal breaks</h3>
				<p class="text-meta">
					Compliance checks only; these rules do not change pay. Leave a value empty when the law
					does not state it.
				</p>
			</Stack>
			<MatrixRenderer
				rows={breakRows}
				columns={BREAK_COLUMNS}
				{disabled}
				emptyMessage="No rest or meal-break rules"
				addRowLabel="Add break rule"
				createRow={(): BreakRow => ({
					id: crypto.randomUUID(),
					applies_when: 'ALWAYS',
					after_consecutive_hours: 5,
					minimum_minutes: 30,
					paid_status: 'UNSTATED',
					on_exceed: 'WARN',
					authority: ''
				})}
				bounded={false}
				onChange={(rows) => emit({ ...current, rest_break_rules: statutoryBreakRules(rows) })}
			/>
		</Stack>
	</Stack>
{/if}
