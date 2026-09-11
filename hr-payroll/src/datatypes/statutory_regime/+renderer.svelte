<script lang="ts">
	/**
	 * The working-time regime as the RFC's segments, in its order: Overtime (who is covered, the
	 * pricing rules, then the night premium), Limits, Rest (breaks, then the weekly rest day) and the
	 * holiday-on-a-rest-day precedence. The form renders this column once under its Overtime section; the three sections
	 * after it are drawn here with the same `FormSection` the form uses.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { nullableNumberFrom, numberFrom, splitList } from '../../lib/ui/renderer-input.js';
	import {
		RULE_DAY_TYPES,
		statutoryRegimeSchema,
		type NightPremium,
		type StatutoryRegime,
		type StatutoryRestBreakRule,
		type StatutoryWeeklyRestRule
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
	};
	type LimitRow = Limit & { readonly id: string };
	type BreakRow = {
		readonly id: string;
		readonly applies_when: StatutoryRestBreakRule['applies_when'];
		readonly after_consecutive_hours: number | null;
		readonly minimum_minutes: number | null;
		readonly paid_status: 'UNSTATED' | 'WORKING_TIME' | 'NOT_WORKING_TIME';
		readonly on_exceed: StatutoryRestBreakRule['on_exceed'];
	};

	const { t } = useI18n<TenantI18nKeys>();
	const r = (key: string) => t(`renderer.statutory_regime.${key}` as TenantI18nKeys);

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

	const PRICING_COLUMNS = [
		{
			key: 'day_type',
			label: r('day_type'),
			field: enumField('day_type', RULE_DAY_TYPES)
		},
		{
			key: 'measure',
			label: r('measure'),
			field: enumField('measure', ['BEYOND_NORMAL', 'FROM_START_OF_DAY'])
		},
		{ key: 'from', label: r('from'), field: numericField('from'), width: 110 },
		{
			key: 'to',
			label: r('to'),
			field: numericField('to', true),
			placeholder: r('no_limit')
		},
		{
			key: 'award',
			label: r('award'),
			field: enumField('award', ['HOURLY_MULTIPLE', 'DAY_WAGE_MULTIPLE'])
		},
		{ key: 'multiple', label: r('multiple'), field: numericField('multiple'), width: 120 }
	] satisfies readonly MatrixColumn<PricingRow>[];

	const LIMIT_COLUMNS = [
		{
			key: 'period',
			label: r('period'),
			field: enumField('period', ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'])
		},
		{
			key: 'measures',
			label: r('measures'),
			field: enumField('measures', ['OVERTIME_HOURS', 'TOTAL_WORK_HOURS'])
		},
		{ key: 'max_hours', label: r('max_hours'), field: numericField('max_hours'), width: 150 },
		{
			key: 'on_exceed',
			label: r('on_exceed'),
			field: enumField('on_exceed', ['WARN', 'BLOCK', 'INCENTIVE'])
		}
	] satisfies readonly MatrixColumn<LimitRow>[];

	const BREAK_COLUMNS = [
		{
			key: 'applies_when',
			label: r('applies_when'),
			field: enumField('applies_when', ['ALWAYS', 'CONTINUOUS_ATTENDANCE'])
		},
		{
			key: 'after_consecutive_hours',
			label: r('after_hours'),
			field: numericField('after_consecutive_hours', true),
			placeholder: r('every_day')
		},
		{
			key: 'minimum_minutes',
			label: r('minimum_minutes'),
			field: integerField('minimum_minutes', true),
			placeholder: r('not_stated')
		},
		{
			key: 'paid_status',
			label: r('working_time'),
			field: enumField('paid_status', ['UNSTATED', 'WORKING_TIME', 'NOT_WORKING_TIME'])
		},
		{
			key: 'on_exceed',
			label: r('on_shortfall'),
			field: enumField('on_exceed', ['WARN', 'BLOCK'])
		}
	] satisfies readonly MatrixColumn<BreakRow>[];

	const CATEGORY_BASES: { value: CategoryBasis; label: string }[] = [
		{ value: 'STATUTORY_WORK_CATEGORY', label: r('statutory_work_category') },
		{ value: 'WORK_CLASSIFICATION', label: r('work_classification') }
	];
	const WAGE_BASES: { value: WageBasis; label: string }[] = [
		{ value: 'STATUTORY_WAGES', label: r('statutory_wages') },
		{ value: 'BASE_SALARY', label: r('base_salary') }
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(statutoryRegimeSchema)(props.value));
	const current = $derived<StatutoryRegime>(
		Result.isSuccess(parsed)
			? parsed.success
			: {
					holiday_rest_precedence: 'PUBLIC_HOLIDAY',
					overtime_coverage: null,
					overtime_rules: [],
					overtime_limits: []
				}
	);
	const breakRules = $derived<readonly StatutoryRestBreakRule[]>(current.rest_break_rules ?? []);
	const weeklyRest = $derived<StatutoryWeeklyRestRule | null>(current.weekly_rest_rule ?? null);
	const nightPremium = $derived<NightPremium | null>(current.night_premium ?? null);
	const summary = $derived(
		[
			`${current.overtime_rules.length} ${r('summary_rules')}`,
			`${current.overtime_limits.length} ${r('summary_limits')}`,
			...(breakRules.length > 0 ? [`${breakRules.length} ${r('summary_breaks')}`] : [])
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
			multiple: rule.award.multiple
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
			on_exceed: rule.on_exceed
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
			excluded_categories: []
		};
	}

	/** A "none" state is the key being absent: the strict view refuses `null` there. */
	function replaceWeeklyRest(next: StatutoryWeeklyRestRule | null): void {
		const { weekly_rest_rule: _previous, ...rest } = current;
		emit(next === null ? rest : { ...rest, weekly_rest_rule: next });
	}

	function replaceNightPremium(next: NightPremium | null): void {
		const { night_premium: _previous, ...rest } = current;
		emit(next === null ? rest : { ...rest, night_premium: next });
	}

	function pricingRules(rows: PricingRow[]): Rule[] {
		return rows.map((row) => ({
			day_type: row.day_type,
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
			on_exceed: row.on_exceed
		}));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="lg">
		<Stack gap="sm">
			<Inline justify="between" align="start" gap="md">
				<Stack gap="xs">
					<h4 class="text-sm font-semibold">{r('coverage')}</h4>
					<p class="text-meta">{r('coverage_hint')}</p>
				</Stack>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => replaceCoverage(current.overtime_coverage ? null : defaultCoverage())}
				>
					{current.overtime_coverage ? r('remove_coverage') : r('add_coverage')}
				</Button>
			</Inline>

			{#if current.overtime_coverage}
				{@const coverage = current.overtime_coverage}
				<Grid gap="sm" minimum="compact">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('category_basis')}
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
							{r('wage_basis')}
							<Combobox
								options={WAGE_BASES}
								value={coverage.wage_basis}
								{disabled}
								searchable={false}
								emptyPlaceholder={r('no_ceiling')}
								onValueChange={(value) => {
									if (value) replaceCoverage({ ...coverage, wage_basis: value });
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('ceiling')}
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
							{r('currency')}
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
							{r('at_ceiling')}
							<Combobox
								options={[
									{ value: 'inclusive', label: r('covered') },
									{ value: 'exclusive', label: r('not_covered') }
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
							{r('always_covered')}
							<Input
								value={coverage.exempt_categories.join(', ')}
								{disabled}
								placeholder={r('comma_separated')}
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
							{r('excluded')}
							<Input
								value={coverage.excluded_categories.join(', ')}
								{disabled}
								placeholder={r('comma_separated')}
								oninput={(event) =>
									replaceCoverage({
										...coverage,
										excluded_categories: splitList(event.currentTarget.value)
									})}
							/>
						</Stack>
					</label>
				</Grid>
			{/if}
		</Stack>

		<MatrixRenderer
			class="w-full"
			rows={pricingRows}
			columns={PRICING_COLUMNS}
			{disabled}
			emptyMessage={r('rules_empty')}
			addRowLabel={r('add_rule')}
			createRow={(): PricingRow => ({
				id: crypto.randomUUID(),
				day_type: 'ORDINARY',
				measure: 'BEYOND_NORMAL',
				from: 0,
				to: null,
				award: 'HOURLY_MULTIPLE',
				multiple: 1.5
			})}
			bounded={false}
			onChange={(rows) => emit({ ...current, overtime_rules: pricingRules(rows) })}
		/>

		<Stack gap="sm">
			<Inline justify="between" align="start" gap="md">
				<Stack gap="xs">
					<h4 class="text-sm font-semibold">{r('night_premium')}</h4>
					<p class="text-meta">{r('night_premium_hint')}</p>
				</Stack>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						replaceNightPremium(
							nightPremium
								? null
								: { from: '22:00', to: '06:00', ordinary_add: 10, overtime_add: 10 }
						)}
				>
					{nightPremium ? r('remove_night_premium') : r('add_night_premium')}
				</Button>
			</Inline>
			{#if nightPremium}
				{@const night = nightPremium}
				<Grid gap="sm" minimum="compact">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('night_from')}
							<Input
								type="time"
								value={night.from}
								{disabled}
								oninput={(event) =>
									replaceNightPremium({ ...night, from: event.currentTarget.value })}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('night_to')}
							<Input
								type="time"
								value={night.to}
								{disabled}
								oninput={(event) =>
									replaceNightPremium({ ...night, to: event.currentTarget.value })}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('night_ordinary_add')}
							<Input
								type="number"
								min="0"
								step="0.01"
								value={night.ordinary_add}
								{disabled}
								oninput={(event) =>
									replaceNightPremium({
										...night,
										ordinary_add: numberFrom(event.currentTarget.value, 0)
									})}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('night_overtime_add')}
							<Input
								type="number"
								min="0"
								step="0.01"
								value={night.overtime_add}
								{disabled}
								oninput={(event) =>
									replaceNightPremium({
										...night,
										overtime_add: numberFrom(event.currentTarget.value, 0)
									})}
							/>
						</Stack>
					</label>
				</Grid>
			{/if}
		</Stack>

		<FormSection
			title={t('component.work_section_limits')}
			hint={t('component.work_section_limits_hint')}
		>
			<MatrixRenderer
				class="w-full"
				rows={limitRows}
				columns={LIMIT_COLUMNS}
				{disabled}
				emptyMessage={r('limits_empty')}
				addRowLabel={r('add_limit')}
				createRow={(): LimitRow => ({
					id: crypto.randomUUID(),
					period: 'MONTH',
					measures: 'OVERTIME_HOURS',
					max_hours: 1,
					on_exceed: 'BLOCK'
				})}
				bounded={false}
				onChange={(rows) =>
					emit({
						...current,
						overtime_limits: rows.map(({ id: _, ...limit }) => limit)
					})}
			/>
		</FormSection>

		<FormSection
			title={t('component.work_section_rest')}
			hint={t('component.work_section_rest_hint')}
		>
			<MatrixRenderer
				class="w-full"
				rows={breakRows}
				columns={BREAK_COLUMNS}
				{disabled}
				emptyMessage={r('breaks_empty')}
				addRowLabel={r('add_break')}
				createRow={(): BreakRow => ({
					id: crypto.randomUUID(),
					applies_when: 'ALWAYS',
					after_consecutive_hours: 5,
					minimum_minutes: 30,
					paid_status: 'UNSTATED',
					on_exceed: 'WARN'
				})}
				bounded={false}
				onChange={(rows) => emit({ ...current, rest_break_rules: statutoryBreakRules(rows) })}
			/>

			<Inline justify="between" align="start" gap="md">
				<Stack gap="xs">
					<h4 class="text-sm font-semibold">{r('weekly_rest')}</h4>
					<p class="text-meta">{r('weekly_rest_hint')}</p>
				</Stack>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						replaceWeeklyRest(
							weeklyRest
								? null
								: { max_consecutive_work_days: 6, discharged_by: 'REST_OR_OFF', on_exceed: 'BLOCK' }
						)}
				>
					{weeklyRest ? r('remove_weekly_rest') : r('add_weekly_rest')}
				</Button>
			</Inline>
			{#if weeklyRest}
				{@const rule = weeklyRest}
				<Grid gap="sm" minimum="compact">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('max_consecutive_work_days')}
							<Input
								type="number"
								min="1"
								max="30"
								step="1"
								value={rule.max_consecutive_work_days}
								{disabled}
								oninput={(event) =>
									replaceWeeklyRest({
										...rule,
										max_consecutive_work_days: numberFrom(event.currentTarget.value, 1)
									})}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('discharged_by')}
							<Combobox
								options={[
									{ value: 'REST', label: r('discharged_rest') },
									{ value: 'REST_OR_OFF', label: r('discharged_rest_or_off') }
								]}
								value={rule.discharged_by}
								{disabled}
								searchable={false}
								onValueChange={(value) => {
									if (value === 'REST' || value === 'REST_OR_OFF')
										replaceWeeklyRest({ ...rule, discharged_by: value });
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{r('on_exceed')}
							<Combobox
								options={[
									{ value: 'WARN', label: 'WARN' },
									{ value: 'BLOCK', label: 'BLOCK' }
								]}
								value={rule.on_exceed}
								{disabled}
								searchable={false}
								onValueChange={(value) => {
									if (value === 'WARN' || value === 'BLOCK')
										replaceWeeklyRest({ ...rule, on_exceed: value });
								}}
							/>
						</Stack>
					</label>
				</Grid>
			{/if}
		</FormSection>

		<FormSection
			title={t('component.work_section_holiday')}
			hint={t('component.work_section_holiday_hint')}
		>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{r('precedence')}
					<Combobox
						{disabled}
						searchable={false}
						value={current.holiday_rest_precedence}
						options={[
							{ value: 'PUBLIC_HOLIDAY', label: t('holiday_calendar.public_holiday_rate') },
							{ value: 'REST_DAY', label: t('holiday_calendar.rest_day_rate') },
							{ value: 'SUBSTITUTE', label: t('holiday_calendar.substitute_rate') }
						]}
						onValueChange={(value) => {
							if (value === 'PUBLIC_HOLIDAY' || value === 'REST_DAY' || value === 'SUBSTITUTE')
								emit({ ...current, holiday_rest_precedence: value });
						}}
					/>
				</Stack>
			</label>
		</FormSection>
	</Stack>
{/if}
