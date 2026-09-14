<script lang="ts">
	/**
	 * One version's work rules (RFC 0001 §4–§6, §7), compact.
	 *
	 * Work is a producer, not a catalogue: it prices a day through ordered `rates.bands` (each
	 * band consuming a slice and optionally funnelling the portion above a named limit to the
	 * incentive line), states the `limits` schedules must respect and the `breaks` the law owes.
	 * Every attribute whose value is a money decision is CEL over the `work_day` context; a CEL
	 * cell carries the Fields popover and prints the same refusal the write hook would.
	 *
	 * The lists — ordinary rates, bands, limits, breaks — are matrices: one row each, one column
	 * per fact, no card per row. The scalars share a compact labelled grid.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { Schema } from 'effect';
	import { watch } from 'runed';
	import type { MoneyValue } from '@norbital-ai/std/finance';
	import type { NightPremium } from '../../lib/payroll/work-rules-values.js';
	import { workRulesValueSchema } from './+definition.js';
	import ProrationBasisRenderer from '../proration_basis/+renderer.svelte';
	import EngineLineOptIns from '../../lib/ui/engine-line-opt-ins.svelte';
	import ExpressionCell from '../../lib/ui/expression-cell.svelte';
	import OptInsCell from '../../lib/ui/statutory-opt-ins-cell.svelte';
	import { numberFrom, numberOrExpression, splitList } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	type WorkRules = Schema.Schema.Type<typeof workRulesValueSchema>;
	type WorkRateBand = WorkRules['rates']['bands'][number];
	type WorkLimit = WorkRules['limits'][number];
	type WorkBreak = WorkRules['breaks'][number];
	type Coverage = NonNullable<WorkRules['coverage']>;

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	/** A readonly form renders values, not muted controls. */
	const readonly = $derived(props.mode !== 'edit');
	const current = $derived((props.value ?? null) as WorkRules | null);

	/** A matrix column's field metadata: the cell kind and any option bag the cell reads. */
	const fieldOf = (
		name: string,
		kind: string,
		extra: Partial<CollectionField> = {}
	): CollectionField => ({ name, kind, nullable: true, ...extra });
	const exprField = (name: string, site: 'work_day' | 'person', type: 'boolean' | 'number') =>
		fieldOf(name, 'text', { options: { site, type } });

	const option = <T extends string>(values: readonly T[], label: (value: T) => string) =>
		values.map((value) => ({ value, label: label(value) }));
	const precedenceOptions = option(['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE'] as const, (value) =>
		t(`renderer.work_rules.precedence.${value}` as TenantI18nKeys)
	);
	const restOptions = option(['REST', 'REST_OR_OFF'] as const, (value) =>
		t(`renderer.work_rules.discharged.${value}` as TenantI18nKeys)
	);
	const wageBasisOptions = option(['STATUTORY_WAGES', 'BASE_SALARY'] as const, (value) =>
		t(`renderer.work_rules.wage_basis.${value}` as TenantI18nKeys)
	);
	const categoryBasisOptions = option(
		['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION'] as const,
		(value) => t(`renderer.work_rules.category_basis.${value}` as TenantI18nKeys)
	);

	function emit(next: WorkRules): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
	function edit(change: Partial<WorkRules>): void {
		if (current != null) emit({ ...current, ...change });
	}
	function editCoverage(change: Partial<Coverage>): void {
		if (current?.coverage != null) edit({ coverage: { ...current.coverage, ...change } });
	}
	function editNight(change: Partial<NightPremium>): void {
		if (current?.night_premium != null)
			edit({ night_premium: { ...current.night_premium, ...change } });
	}
	function checkFrom(value: boolean | null): string {
		return value == null ? 'STATED' : value ? 'YES' : 'NO';
	}
	function checkTo(value: string): boolean | null {
		return value === 'STATED' ? null : value === 'YES';
	}
	function moneyValue(value: MoneyValue | null, patch: Partial<MoneyValue>): MoneyValue {
		return { value: value?.value ?? 0, currency: value?.currency ?? '', ...patch };
	}

	/* ── Ordinary rates ───────────────────────────────────────────────────────────────────── */
	type OrdinaryRow = { id: string; when: string; unit: 'DAY' | 'HOUR'; divisor: string };
	const projectOrdinary = (rules: WorkRules | null): OrdinaryRow[] =>
		(rules?.rates.ordinary ?? []).map((row, index) => ({
			id: String(index),
			when: row.when,
			unit: row.unit,
			divisor: String(row.divisor)
		}));
	let ordinaryRows = $state<OrdinaryRow[]>([]);
	watch(
		() => current,
		(rules) => {
			ordinaryRows = projectOrdinary(rules);
		},
		{ lazy: false }
	);
	const ordinaryColumns: MatrixColumn<OrdinaryRow>[] = [
		{
			key: 'when',
			label: t('renderer.work_rules.when'),
			field: exprField('when', 'person', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'terms.grade == "M1"',
			width: 440
		},
		{
			key: 'unit',
			label: t('renderer.work_rules.ordinary_unit'),
			field: fieldOf('unit', 'enum', { values: ['DAY', 'HOUR'] }),
			width: 150
		},
		{
			key: 'divisor',
			label: t('renderer.work_rules.divisor'),
			field: fieldOf('divisor', 'text'),
			placeholder: '26',
			width: 170
		}
	];
	function commitOrdinary(rows: OrdinaryRow[]): void {
		ordinaryRows = rows;
		if (current == null) return;
		edit({
			rates: {
				...current.rates,
				ordinary: rows.map((row) => ({
					when: row.when,
					unit: row.unit,
					divisor:
						row.divisor.trim() === 'WORKING_DAYS' ? 'WORKING_DAYS' : numberFrom(row.divisor, 1)
				}))
			}
		});
	}

	/* ── Day-pricing bands ─────────────────────────────────────────────────────────────────── */
	type BandRow = {
		id: string;
		label: string;
		line: string;
		when: string;
		take: string;
		price: string;
		funnel_above: string;
		funnel_line: string;
		statutory_opt_ins: WorkRateBand['statutory_opt_ins'];
	};
	const projectBands = (rules: WorkRules | null): BandRow[] =>
		(rules?.rates.bands ?? []).map((band, index) => ({
			id: String(index),
			label: band.label,
			line: band.line,
			when: band.when,
			take: band.take,
			price: band.price,
			funnel_above: band.funnel?.above ?? '',
			funnel_line: band.funnel?.line ?? '',
			statutory_opt_ins: [...band.statutory_opt_ins]
		}));
	let bandRows = $state<BandRow[]>([]);
	watch(
		() => current,
		(rules) => {
			bandRows = projectBands(rules);
		},
		{ lazy: false }
	);
	const bandColumns: MatrixColumn<BandRow>[] = [
		{
			key: 'label',
			label: t('renderer.work_rules.label'),
			field: fieldOf('label', 'text'),
			width: 90
		},
		{
			key: 'line',
			label: t('renderer.work_rules.line'),
			field: fieldOf('line', 'text'),
			width: 120
		},
		{
			key: 'when',
			label: t('renderer.work_rules.when'),
			field: exprField('when', 'work_day', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'day_type == "ORDINARY"',
			width: 280
		},
		{
			key: 'take',
			label: t('renderer.work_rules.take'),
			field: exprField('take', 'work_day', 'number'),
			renderer: ExpressionCell,
			placeholder: 'hours_beyond_normal',
			width: 180
		},
		{
			key: 'price',
			label: t('renderer.work_rules.price'),
			field: exprField('price', 'work_day', 'number'),
			renderer: ExpressionCell,
			placeholder: 'ordinary_hour * 1.5',
			width: 210
		},
		{
			key: 'funnel_above',
			label: t('renderer.work_rules.funnel_above'),
			field: exprField('funnel_above', 'work_day', 'number'),
			renderer: ExpressionCell,
			placeholder: 'limits.daily_total',
			width: 190
		},
		{
			key: 'funnel_line',
			label: t('renderer.work_rules.funnel_line'),
			field: fieldOf('funnel_line', 'text'),
			placeholder: 'INCENTIVE',
			width: 120
		},
		{
			key: 'statutory_opt_ins',
			label: t('component.statutory_opt_ins'),
			field: fieldOf('statutory_opt_ins', 'json'),
			renderer: OptInsCell,
			width: 120
		}
	];
	function commitBands(rows: BandRow[]): void {
		bandRows = rows;
		if (current == null) return;
		edit({
			rates: {
				...current.rates,
				bands: rows.map((row) => {
					const base = {
						label: row.label,
						line: row.line,
						when: row.when,
						take: row.take,
						price: row.price,
						statutory_opt_ins: [...row.statutory_opt_ins]
					};
					return row.funnel_above.trim() !== '' || row.funnel_line.trim() !== ''
						? { ...base, funnel: { above: row.funnel_above, line: row.funnel_line } }
						: base;
				})
			}
		});
	}

	/* ── Limits ────────────────────────────────────────────────────────────────────────────── */
	type LimitRow = {
		id: string;
		key: string;
		period: WorkLimit['period'];
		measure: WorkLimit['measure'];
		max_hours: number;
		unit: WorkLimit['unit'];
		authority: string;
	};
	const projectLimits = (rules: WorkRules | null): LimitRow[] =>
		(rules?.limits ?? []).map((limit, index) => ({
			id: String(index),
			key: limit.key,
			period: limit.period,
			measure: limit.measure,
			max_hours: limit.max_hours,
			unit: limit.unit,
			authority: limit.authority ?? ''
		}));
	let limitRows = $state<LimitRow[]>([]);
	watch(
		() => current,
		(rules) => {
			limitRows = projectLimits(rules);
		},
		{ lazy: false }
	);
	const limitColumns: MatrixColumn<LimitRow>[] = [
		{ key: 'key', label: t('renderer.work_rules.key'), field: fieldOf('key', 'text'), width: 150 },
		{
			key: 'period',
			label: t('renderer.work_rules.period_label'),
			field: fieldOf('period', 'enum', { values: ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] }),
			width: 110
		},
		{
			key: 'measure',
			label: t('renderer.work_rules.measure_label'),
			field: fieldOf('measure', 'enum', {
				values: ['TOTAL_WORK_HOURS', 'OVERTIME_HOURS', 'NORMAL_HOURS', 'SPREAD_HOURS']
			}),
			width: 190
		},
		{
			key: 'max_hours',
			label: t('renderer.work_rules.max_hours'),
			field: fieldOf('max_hours', 'number'),
			width: 90
		},
		{
			key: 'unit',
			label: t('renderer.work_rules.unit_label'),
			field: fieldOf('unit', 'enum', { values: ['WORKED_HOURS', 'CLOCK_HOURS'] }),
			width: 150
		},
		{
			key: 'authority',
			label: t('component.authority'),
			field: fieldOf('authority', 'text'),
			width: 280
		}
	];
	function commitLimits(rows: LimitRow[]): void {
		limitRows = rows;
		if (current == null) return;
		edit({
			limits: rows.map((row) => ({
				key: row.key,
				period: row.period,
				measure: row.measure,
				max_hours: row.max_hours,
				unit: row.unit,
				...(row.authority.trim() === '' ? {} : { authority: row.authority })
			}))
		});
	}

	/* ── Breaks ────────────────────────────────────────────────────────────────────────────── */
	type BreakRow = { id: string; when: string; owed_minutes: string; check: string };
	const projectBreaks = (rules: WorkRules | null): BreakRow[] =>
		(rules?.breaks ?? []).map((rule, index) => ({
			id: String(index),
			when: rule.when,
			owed_minutes: String(rule.owed_minutes),
			check: checkFrom(rule.counts_as_worked_time)
		}));
	let breakRows = $state<BreakRow[]>([]);
	watch(
		() => current,
		(rules) => {
			breakRows = projectBreaks(rules);
		},
		{ lazy: false }
	);
	const breakColumns: MatrixColumn<BreakRow>[] = [
		{
			key: 'when',
			label: t('renderer.work_rules.when'),
			field: exprField('when', 'work_day', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'consecutive_hours > 5.0',
			width: 420
		},
		{
			key: 'owed_minutes',
			label: t('renderer.work_rules.owed_minutes'),
			field: exprField('owed_minutes', 'work_day', 'number'),
			renderer: ExpressionCell,
			placeholder: '30',
			width: 200
		},
		{
			key: 'check',
			label: t('renderer.work_rules.counts_as_worked_time'),
			field: fieldOf('check', 'enum', { values: ['STATED', 'YES', 'NO'] }),
			width: 210
		}
	];
	function commitBreaks(rows: BreakRow[]): void {
		breakRows = rows;
		if (current == null) return;
		edit({
			breaks: rows.map((row): WorkBreak => ({
				when: row.when,
				owed_minutes: numberOrExpression(row.owed_minutes),
				counts_as_worked_time: checkTo(row.check)
			}))
		});
	}
</script>

{#if current != null}
	<Stack gap="lg" class="w-full">
		<!-- Scalars, in one compact labelled grid. -->
		<Grid gap="sm" minimum="compact">
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted-foreground">{t('renderer.work_rules.proration')}</span>
				<ProrationBasisRenderer
					mode="edit"
					field={{ name: 'proration', type: 'proration_basis' }}
					value={current.proration}
					{disabled}
					onValueChange={(next) => {
						if (next != null) edit({ proration: next });
					}}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted-foreground">{t('renderer.work_rules.precedence_label')}</span>
				<Combobox
					options={precedenceOptions}
					value={current.holiday_rest_precedence}
					{disabled}
					searchable={false}
					onValueChange={(holiday_rest_precedence) => {
						if (holiday_rest_precedence) edit({ holiday_rest_precedence });
					}}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted-foreground">{t('renderer.work_rules.consecutive_days')}</span>
				<Input
					type="number"
					min="1"
					max="30"
					step="1"
					value={current.weekly_rest_rule.max_consecutive_work_days}
					{disabled}
					oninput={(event) =>
						edit({
							weekly_rest_rule: {
								...current.weekly_rest_rule,
								max_consecutive_work_days: numberFrom(event.currentTarget.value, 6)
							}
						})}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted-foreground">{t('renderer.work_rules.discharged_by')}</span>
				<Combobox
					options={restOptions}
					value={current.weekly_rest_rule.discharged_by}
					{disabled}
					searchable={false}
					onValueChange={(discharged_by) => {
						if (discharged_by)
							edit({ weekly_rest_rule: { ...current.weekly_rest_rule, discharged_by } });
					}}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted-foreground">{t('component.authority')}</span>
				<Input
					value={current.authority ?? ''}
					{disabled}
					oninput={(event) => edit({ authority: event.currentTarget.value || undefined })}
				/>
			</label>
		</Grid>

		<!-- Engine pay lines and their opt-ins, one (line, scheme, effect) matrix. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.lines')}</span>
			<p class="text-meta">{t('renderer.work_rules.lines_hint')}</p>
			<EngineLineOptIns
				value={current.engine_lines}
				{disabled}
				{readonly}
				onValueChange={(engine_lines) => edit({ engine_lines })}
			/>
		</Stack>

		<!-- Ordinary rate rows. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.ordinary')}</span>
			<p class="text-meta">{t('renderer.work_rules.ordinary_hint')}</p>
			<MatrixRenderer
				bind:rows={ordinaryRows}
				columns={ordinaryColumns}
				allowAddRows={!disabled}
				bounded={false}
				getRowId={(row) => String(row.id)}
				addRowLabel={t('renderer.work_rules.add_ordinary')}
				createRow={() => ({
					id: String(ordinaryRows.length),
					when: '',
					unit: 'DAY' as const,
					divisor: '26'
				})}
				onChange={commitOrdinary}
			/>
		</Stack>

		<!-- Day-pricing bands. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.bands')}</span>
			<p class="text-meta">{t('renderer.work_rules.bands_hint')}</p>
			<MatrixRenderer
				bind:rows={bandRows}
				columns={bandColumns}
				allowAddRows={!disabled}
				bounded={false}
				getRowId={(row) => String(row.id)}
				addRowLabel={t('renderer.work_rules.add_band')}
				createRow={() => ({
					id: String(bandRows.length),
					label: '',
					line: 'OVERTIME',
					when: '',
					take: '',
					price: '',
					funnel_above: '',
					funnel_line: '',
					statutory_opt_ins: []
				})}
				onChange={commitBands}
			/>
		</Stack>

		<!-- Limits. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.limits')}</span>
			<p class="text-meta">{t('renderer.work_rules.limits_hint')}</p>
			<MatrixRenderer
				bind:rows={limitRows}
				columns={limitColumns}
				allowAddRows={!disabled}
				bounded={false}
				getRowId={(row) => String(row.id)}
				addRowLabel={t('renderer.work_rules.add_limit')}
				createRow={() => ({
					id: String(limitRows.length),
					key: '',
					period: 'DAY' as const,
					measure: 'TOTAL_WORK_HOURS' as const,
					max_hours: 12,
					unit: 'WORKED_HOURS' as const,
					authority: ''
				})}
				onChange={commitLimits}
			/>
		</Stack>

		<!-- Breaks. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.breaks')}</span>
			<p class="text-meta">{t('renderer.work_rules.breaks_hint')}</p>
			<MatrixRenderer
				bind:rows={breakRows}
				columns={breakColumns}
				allowAddRows={!disabled}
				bounded={false}
				getRowId={(row) => String(row.id)}
				addRowLabel={t('renderer.work_rules.add_break')}
				createRow={() => ({
					id: String(breakRows.length),
					when: '',
					owed_minutes: '30',
					check: 'STATED'
				})}
				onChange={commitBreaks}
			/>
		</Stack>

		<!-- Coverage and the night premium: optional blocks, each one compact section. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.coverage')}</span>
			<p class="text-meta">{t('renderer.work_rules.coverage_hint')}</p>
			{#if current.coverage == null}
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground"
						>{t('renderer.work_rules.coverage_not_stated')}</span
					>
					<Button
						variant="outline"
						size="sm"
						{disabled}
						onclick={() =>
							edit({
								coverage: {
									wage_ceiling: null,
									ceiling_is_inclusive: null,
									wage_basis: null,
									category_basis: 'STATUTORY_WORK_CATEGORY',
									exempt_categories: [],
									excluded_categories: []
								}
							})}
					>
						{t('renderer.work_rules.add_coverage')}
					</Button>
				</div>
			{:else}
				<Grid gap="sm" minimum="compact">
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.wage_ceiling')}</span>
						<Input
							type="number"
							step="0.01"
							value={current.coverage.wage_ceiling?.value ?? ''}
							{disabled}
							oninput={(event) =>
								editCoverage({
									wage_ceiling: moneyValue(current.coverage!.wage_ceiling, {
										value: numberFrom(event.currentTarget.value, 0)
									})
								})}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('component.currency')}</span>
						<Input
							value={current.coverage.wage_ceiling?.currency ?? ''}
							maxlength={3}
							{disabled}
							oninput={(event) =>
								editCoverage({
									wage_ceiling: moneyValue(current.coverage!.wage_ceiling, {
										currency: event.currentTarget.value.toUpperCase()
									})
								})}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.wage_basis')}</span>
						<Combobox
							options={wageBasisOptions}
							value={current.coverage.wage_basis}
							{disabled}
							searchable={false}
							onValueChange={(wage_basis) => editCoverage({ wage_basis })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">
							{t('renderer.work_rules.ceiling_is_inclusive')}
						</span>
						<select
							class="h-8 rounded-sm border border-input bg-background px-2 text-sm"
							{disabled}
							value={checkFrom(current.coverage.ceiling_is_inclusive)}
							onchange={(event) =>
								editCoverage({ ceiling_is_inclusive: checkTo(event.currentTarget.value) })}
						>
							<option value="STATED">{t('renderer.work_rules.worked_time.stated')}</option>
							<option value="YES">{t('renderer.work_rules.worked_time.yes')}</option>
							<option value="NO">{t('renderer.work_rules.worked_time.no')}</option>
						</select>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.category_basis')}</span>
						<Combobox
							options={categoryBasisOptions}
							value={current.coverage.category_basis}
							{disabled}
							searchable={false}
							onValueChange={(category_basis) => {
								if (category_basis) editCoverage({ category_basis });
							}}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.exempt_categories')}</span>
						<Input
							value={current.coverage.exempt_categories.join(', ')}
							{disabled}
							oninput={(event) =>
								editCoverage({ exempt_categories: splitList(event.currentTarget.value) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.excluded_categories')}</span
						>
						<Input
							value={current.coverage.excluded_categories.join(', ')}
							{disabled}
							oninput={(event) =>
								editCoverage({ excluded_categories: splitList(event.currentTarget.value) })}
						/>
					</label>
				</Grid>
				<div class="flex justify-end">
					<Button variant="ghost" size="sm" {disabled} onclick={() => edit({ coverage: null })}>
						{t('renderer.work_rules.remove_coverage')}
					</Button>
				</div>
			{/if}
		</Stack>

		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.night_premium')}</span>
			<p class="text-meta">{t('renderer.work_rules.night_premium_hint')}</p>
			{#if current.night_premium == null}
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">
						{t('renderer.work_rules.night_premium_not_stated')}
					</span>
					<Button
						variant="outline"
						size="sm"
						{disabled}
						onclick={() =>
							edit({
								night_premium: { from: '22:00', to: '06:00', ordinary_add: 10, overtime_add: 0 }
							})}
					>
						{t('renderer.work_rules.add_night_premium')}
					</Button>
				</div>
			{:else}
				<Grid gap="sm" minimum="compact">
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.night_from')}</span>
						<Input
							type="time"
							value={current.night_premium.from}
							{disabled}
							oninput={(event) => editNight({ from: event.currentTarget.value })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.night_to')}</span>
						<Input
							type="time"
							value={current.night_premium.to}
							{disabled}
							oninput={(event) => editNight({ to: event.currentTarget.value })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.night_ordinary_add')}</span>
						<Input
							type="number"
							min="0"
							step="0.01"
							value={current.night_premium.ordinary_add}
							{disabled}
							oninput={(event) =>
								editNight({ ordinary_add: numberFrom(event.currentTarget.value, 0) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-muted-foreground">{t('renderer.work_rules.night_overtime_add')}</span>
						<Input
							type="number"
							min="0"
							step="0.01"
							value={current.night_premium.overtime_add}
							{disabled}
							oninput={(event) =>
								editNight({ overtime_add: numberFrom(event.currentTarget.value, 0) })}
						/>
					</label>
				</Grid>
				<div class="flex justify-end">
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => edit({ night_premium: null })}
					>
						{t('renderer.work_rules.remove_night_premium')}
					</Button>
				</div>
			{/if}
		</Stack>
	</Stack>
{/if}
