<script lang="ts">
	/**
	 * One version's work rules (RFC 0001 §4–§6, §7), compact.
	 *
	 * Work is a producer, not a catalogue: it prices a day through ordered `bands` (each
	 * band consuming a slice and optionally funnelling the portion above a named limit to the
	 * incentive line), states the `limits` schedules must respect and the `breaks` the law owes.
	 * Every attribute whose value is a money decision is CEL over the `work_day` context; a CEL
	 * cell carries the Fields popover and prints the same refusal the write hook would.
	 *
	 * The lists — bands, limits, breaks — are matrices: one row each, one column
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
	import type { NightPremium } from '../../lib/payroll/work-rules-values.js';
	import { workRulesValueSchema } from './+definition.js';
	import ProrationBasisRenderer from '../proration_basis/+renderer.svelte';
	import ExpressionCell from '../../lib/ui/expression-cell.svelte';
	import ExpressionField from '../../lib/ui/expression-field.svelte';
	import ExpressionFields from '../../lib/ui/expression-fields.svelte';
	import type { ExpressionType } from '../../lib/expressions/contexts.js';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	type WorkRules = Schema.Schema.Type<typeof workRulesValueSchema>;
	type WorkLimit = WorkRules['limits'][number];
	type WorkBreak = WorkRules['breaks'][number];

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
	const exprField = (name: string, site: 'work_day' | 'person', type: ExpressionType) =>
		fieldOf(name, 'text', { options: { site, type } });

	const option = <T extends string>(values: readonly T[], label: (value: T) => string) =>
		values.map((value) => ({ value, label: label(value) }));
	const precedenceOptions = option(['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE'] as const, (value) =>
		t(`renderer.work_rules.precedence.${value}` as TenantI18nKeys)
	);
	const restOptions = option(['REST', 'REST_OR_OFF'] as const, (value) =>
		t(`renderer.work_rules.discharged.${value}` as TenantI18nKeys)
	);

	function emit(next: WorkRules): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
	function edit(change: Partial<WorkRules>): void {
		if (current != null) emit({ ...current, ...change });
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

	/* ── Day-pricing bands ─────────────────────────────────────────────────────────────────── */
	type BandRow = {
		id: string;
		label: string;
		when: string;
		take_hours: string;
		price_amount: string;
		funnel_above_hours: string;
	};
	const projectBands = (rules: WorkRules | null): BandRow[] =>
		(rules?.bands ?? []).map((band, index) => ({
			id: String(index),
			label: band.label,
			when: band.when,
			take_hours: band.take_hours,
			price_amount: band.price_amount,
			funnel_above_hours: band.funnel_above_hours ?? ''
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
			key: 'when',
			label: t('renderer.work_rules.when'),
			field: exprField('when', 'work_day', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'day_type == "ORDINARY"',
			width: 280
		},
		{
			key: 'take_hours',
			label: t('renderer.work_rules.take_hours'),
			field: exprField('take_hours', 'work_day', 'hours'),
			renderer: ExpressionCell,
			placeholder: 'hours_beyond_normal',
			width: 180
		},
		{
			key: 'price_amount',
			label: t('renderer.work_rules.price_amount'),
			field: exprField('price_amount', 'work_day', 'money'),
			renderer: ExpressionCell,
			placeholder: 'hours * ordinary_hour * 1.5',
			width: 210
		},
		{
			key: 'funnel_above_hours',
			label: t('renderer.work_rules.funnel_above_hours'),
			field: exprField('funnel_above_hours', 'work_day', 'hours'),
			renderer: ExpressionCell,
			placeholder: 'limits.daily_total',
			width: 190
		}
	];
	function commitBands(rows: BandRow[]): void {
		bandRows = rows;
		if (current == null) return;
		edit({
			bands: rows.map((row) => ({
				label: row.label,
				when: row.when,
				take_hours: row.take_hours,
				price_amount: row.price_amount,
				...(row.funnel_above_hours.trim() === ''
					? {}
					: { funnel_above_hours: row.funnel_above_hours })
			}))
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
			owed_minutes: rule.owed_minutes,
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
			field: exprField('owed_minutes', 'work_day', 'minutes'),
			renderer: ExpressionCell,
			placeholder: '30.0',
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
				owed_minutes: row.owed_minutes,
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

		<!-- The ordinary rate divisor and who the overtime ladder covers: expressions over the person. -->
		<Grid gap="md" minimum="card">
			<Stack gap="xs">
				<span class="text-sm font-semibold">{t('renderer.work_rules.ordinary')}</span>
				<p class="text-meta">{t('renderer.work_rules.ordinary_hint')}</p>
				<div class="flex items-start gap-1">
					<ExpressionField
						site="person"
						type="days"
						value={current.ordinary_divisor_days}
						mode={readonly ? 'display' : 'edit'}
						{disabled}
						placeholder="26.0"
						class="flex-1"
						onValueChange={(ordinary_divisor_days) => edit({ ordinary_divisor_days })}
					/>
					<ExpressionFields
						site="person"
						expression={current.ordinary_divisor_days}
						type="days"
						inline
					/>
				</div>
			</Stack>
			<Stack gap="xs">
				<span class="text-sm font-semibold">{t('renderer.work_rules.overtime_when')}</span>
				<p class="text-meta">{t('renderer.work_rules.overtime_when_hint')}</p>
				<div class="flex items-start gap-1">
					<ExpressionField
						site="person"
						type="boolean"
						value={current.overtime_when}
						mode={readonly ? 'display' : 'edit'}
						{disabled}
						empty={t('renderer.work_rules.overtime_when_empty')}
						placeholder={'employment.classification != "MANAGERIAL"'}
						class="flex-1"
						onValueChange={(overtime_when) => edit({ overtime_when })}
					/>
					<ExpressionFields
						site="person"
						expression={current.overtime_when}
						type="boolean"
						inline
					/>
				</div>
			</Stack>
		</Grid>

		<!-- Day-pricing bands. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.bands')}</span>
			<p class="text-meta">{t('renderer.work_rules.bands_hint')}</p>
			<MatrixRenderer
				{disabled}
				{readonly}
				bind:rows={bandRows}
				columns={bandColumns}
				allowAddRows={!disabled}
				bounded={false}
				getRowId={(row) => String(row.id)}
				addRowLabel={t('renderer.work_rules.add_band')}
				createRow={() => ({
					id: String(bandRows.length),
					label: '',
					when: '',
					take_hours: '',
					price_amount: '',
					funnel_above_hours: ''
				})}
				onChange={commitBands}
			/>
		</Stack>

		<!-- Limits. -->
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.work_rules.limits')}</span>
			<p class="text-meta">{t('renderer.work_rules.limits_hint')}</p>
			<MatrixRenderer
				{disabled}
				{readonly}
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
				{disabled}
				{readonly}
				bind:rows={breakRows}
				columns={breakColumns}
				allowAddRows={!disabled}
				bounded={false}
				getRowId={(row) => String(row.id)}
				addRowLabel={t('renderer.work_rules.add_break')}
				createRow={() => ({
					id: String(breakRows.length),
					when: '',
					owed_minutes: '30.0',
					check: 'STATED'
				})}
				onChange={commitBreaks}
			/>
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
