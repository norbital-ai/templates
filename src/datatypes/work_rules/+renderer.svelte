<script lang="ts">
	/**
	 * One version's work rules (RFC 0001 §4–§6, §7).
	 *
	 * Work is a producer, not a catalogue: it prices a day through ordered `rates.bands` (each
	 * band consuming a slice and optionally funnelling the portion above a named limit to the
	 * incentive line), states the `limits` schedules must respect and the `breaks` the law owes.
	 * Every attribute whose value is a money decision is CEL over the `work_day` context; the
	 * Fields panel beside each one lists exactly the members that context carries, and a live
	 * compile prints the same refusal the write hook would.
	 *
	 * `proration` reuses the proration renderer; the engine-produced lines (salary, absence,
	 * night) state their statutory opt-ins here.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import type { MoneyValue } from '@norbital-ai/std/finance';
	import type { NightPremium } from '../../lib/payroll/work-rules-values.js';
	import { workRulesValueSchema } from './+definition.js';
	import ExpressionFields from '../../lib/ui/expression-fields.svelte';
	import ProrationBasisRenderer from '../proration_basis/+renderer.svelte';
	import StatutoryOptIns from '../../lib/ui/statutory-opt-ins.svelte';
	import { numberFrom, numberOrExpression, splitList } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	type WorkRules = Schema.Schema.Type<typeof workRulesValueSchema>;
	type WorkRateBand = WorkRules['rates']['bands'][number];
	type OrdinaryRateBand = WorkRules['rates']['ordinary'][number];
	type WorkLimit = WorkRules['limits'][number];
	type WorkBreak = WorkRules['breaks'][number];
	type Coverage = NonNullable<WorkRules['coverage']>;

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const current = $derived((props.value ?? null) as WorkRules | null);

	const option = <T extends string>(values: readonly T[], key: string) =>
		values.map((value) => ({ value, label: t(`${key}.${value}` as TenantI18nKeys) }));

	const periodOptions = option(
		['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const,
		'renderer.work_rules.period'
	);
	const measureOptions = option(
		['TOTAL_WORK_HOURS', 'OVERTIME_HOURS', 'NORMAL_HOURS', 'SPREAD_HOURS'] as const,
		'renderer.work_rules.measure'
	);
	const limitUnitOptions = option(
		['WORKED_HOURS', 'CLOCK_HOURS'] as const,
		'renderer.work_rules.unit'
	);
	const ordinaryUnitOptions = option(['DAY', 'HOUR'] as const, 'renderer.work_rules.ordinary_unit');
	const precedenceOptions = option(
		['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE'] as const,
		'renderer.work_rules.precedence'
	);
	const restOptions = option(['REST', 'REST_OR_OFF'] as const, 'renderer.work_rules.discharged');
	const wageBasisOptions = option(
		['STATUTORY_WAGES', 'BASE_SALARY'] as const,
		'renderer.work_rules.wage_basis'
	);
	const categoryBasisOptions = option(
		['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION'] as const,
		'renderer.work_rules.category_basis'
	);
	const workedTimeOptions: { value: string; label: string }[] = [
		{ value: 'STATED', label: t('renderer.work_rules.worked_time.stated') },
		{ value: 'YES', label: t('renderer.work_rules.worked_time.yes') },
		{ value: 'NO', label: t('renderer.work_rules.worked_time.no') }
	];

	function emit(next: WorkRules): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
	function edit(change: Partial<WorkRules>): void {
		if (current != null) emit({ ...current, ...change });
	}
	function editAt<T extends object>(rows: readonly T[], index: number, change: Partial<T>): T[] {
		return rows.map((row, position) => (position === index ? { ...row, ...change } : row));
	}
	function editBand(index: number, change: Partial<WorkRateBand>): void {
		if (current != null)
			edit({ rates: { ...current.rates, bands: editAt(current.rates.bands, index, change) } });
	}
	function removeBand(index: number): void {
		if (current != null)
			edit({
				rates: {
					...current.rates,
					bands: current.rates.bands.filter((_band, position) => position !== index)
				}
			});
	}
	function editOrdinary(index: number, change: Partial<OrdinaryRateBand>): void {
		if (current != null)
			edit({
				rates: { ...current.rates, ordinary: editAt(current.rates.ordinary, index, change) }
			});
	}
	function editLimit(index: number, change: Partial<WorkLimit>): void {
		if (current != null) edit({ limits: editAt(current.limits, index, change) });
	}
	function editBreak(index: number, change: Partial<WorkBreak>): void {
		if (current != null) edit({ breaks: editAt(current.breaks, index, change) });
	}
	function editCoverage(change: Partial<Coverage>): void {
		if (current?.coverage != null) edit({ coverage: { ...current.coverage, ...change } });
	}
	function editNight(change: Partial<NightPremium>): void {
		if (current?.night_premium != null)
			edit({ night_premium: { ...current.night_premium, ...change } });
	}
	function ordinaryDivisorFrom(raw: string): number | 'WORKING_DAYS' {
		return raw.trim() === 'WORKING_DAYS' ? 'WORKING_DAYS' : numberFrom(raw, 1);
	}
	function moneyValue(value: MoneyValue | null, patch: Partial<MoneyValue>): MoneyValue {
		return { value: value?.value ?? 0, currency: value?.currency ?? '', ...patch };
	}
	function removeFunnel(band: WorkRateBand): WorkRateBand {
		const { funnel: _funnel, ...rest } = band;
		return rest;
	}
</script>

{#snippet expressionField(
	label: string,
	value: string,
	type: 'boolean' | 'number',
	change: (value: string) => void,
	placeholder: string
)}
	<Stack gap="xs">
		<span class="text-sm font-medium">{label}</span>
		<Input
			{value}
			{disabled}
			{placeholder}
			oninput={(event) => change(event.currentTarget.value)}
		/>
		<ExpressionFields site="work_day" expression={value} {type} />
	</Stack>
{/snippet}

{#snippet removeButton(change: () => void)}
	<Button variant="ghost" size="sm" {disabled} onclick={change}>
		{t('component.remove')}
	</Button>
{/snippet}

{#if props.mode === 'display'}
	<span
		class="block truncate"
		title={t('renderer.work_rules.summary', {
			bands: current?.rates.bands.length ?? 0,
			limits: current?.limits.length ?? 0
		})}
	>
		{t('renderer.work_rules.summary', {
			bands: current?.rates.bands.length ?? 0,
			limits: current?.limits.length ?? 0
		})}
	</span>
{:else if current != null}
	<Stack gap="xl">
		<!-- Proration -->
		<Stack gap="sm">
			<span class="text-sm font-semibold">{t('renderer.work_rules.proration')}</span>
			<ProrationBasisRenderer
				mode="edit"
				field={{ name: 'proration', type: 'proration_basis' }}
				value={current.proration}
				{disabled}
				onValueChange={(next) => {
					if (next != null) edit({ proration: next });
				}}
			/>
		</Stack>

		<!-- Engine-produced lines and their opt-ins -->
		<Stack gap="md">
			<span class="text-sm font-semibold">{t('renderer.work_rules.lines')}</span>
			<Stack gap="xs">
				<span class="text-sm font-medium">{t('renderer.work_rules.line_salary')}</span>
				<StatutoryOptIns
					value={current.lines.salary.statutory_opt_ins}
					{disabled}
					onValueChange={(salary) =>
						edit({ lines: { ...current.lines, salary: { statutory_opt_ins: salary } } })}
				/>
			</Stack>
			<Stack gap="xs">
				<span class="text-sm font-medium">{t('renderer.work_rules.line_absence')}</span>
				<StatutoryOptIns
					value={current.lines.absence.statutory_opt_ins}
					{disabled}
					onValueChange={(absence) =>
						edit({ lines: { ...current.lines, absence: { statutory_opt_ins: absence } } })}
				/>
			</Stack>
			<Stack gap="xs">
				<span class="text-sm font-medium">{t('renderer.work_rules.line_night')}</span>
				<StatutoryOptIns
					value={current.lines.night.statutory_opt_ins}
					{disabled}
					onValueChange={(night) =>
						edit({ lines: { ...current.lines, night: { statutory_opt_ins: night } } })}
				/>
			</Stack>
		</Stack>

		<!-- Ordinary rate rows -->
		<Stack gap="sm">
			<span class="text-sm font-semibold">{t('renderer.work_rules.ordinary')}</span>
			<p class="text-meta">{t('renderer.work_rules.ordinary_hint')}</p>
			{#each current.rates.ordinary as row, index (index)}
				<Stack gap="xs" class="rounded-md border border-border p-3">
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('renderer.work_rules.when')}</span>
						<Input
							value={row.when}
							{disabled}
							placeholder={'terms.grade == "M1"'}
							oninput={(event) => editOrdinary(index, { when: event.currentTarget.value })}
						/>
						<ExpressionFields site="person" expression={row.when} type="boolean" />
					</Stack>
					<Grid gap="md" minimum="panel">
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.ordinary_unit')}
								<Combobox
									options={ordinaryUnitOptions}
									value={row.unit}
									{disabled}
									searchable={false}
									onValueChange={(unit) => {
										if (unit) editOrdinary(index, { unit });
									}}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.divisor')}
								<Input
									value={String(row.divisor)}
									{disabled}
									placeholder={'26 or WORKING_DAYS'}
									oninput={(event) =>
										editOrdinary(index, {
											divisor: ordinaryDivisorFrom(event.currentTarget.value)
										})}
								/>
							</Stack></label
						>
					</Grid>
					<div>
						{@render removeButton(() =>
							edit({
								rates: {
									...current.rates,
									ordinary: current.rates.ordinary.filter((_band, position) => position !== index)
								}
							})
						)}
					</div>
				</Stack>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						edit({
							rates: {
								...current.rates,
								ordinary: [
									...current.rates.ordinary,
									{ when: '', unit: 'DAY', divisor: 'WORKING_DAYS' }
								]
							}
						})}
				>
					{t('renderer.work_rules.add_ordinary')}
				</Button>
			</div>
		</Stack>

		<!-- Day-pricing bands -->
		<Stack gap="sm">
			<span class="text-sm font-semibold">{t('renderer.work_rules.bands')}</span>
			<p class="text-meta">{t('renderer.work_rules.bands_hint')}</p>
			{#each current.rates.bands as band, index (index)}
				<Stack gap="sm" class="rounded-md border border-border p-3">
					<Grid gap="md" minimum="panel">
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.label')}
								<Input
									value={band.label}
									{disabled}
									placeholder={'1.5'}
									oninput={(event) => editBand(index, { label: event.currentTarget.value })}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.line')}
								<Input
									value={band.line}
									{disabled}
									placeholder={'OVERTIME'}
									oninput={(event) => editBand(index, { line: event.currentTarget.value })}
								/>
							</Stack></label
						>
					</Grid>
					{@render expressionField(
						t('renderer.work_rules.when'),
						band.when,
						'boolean',
						(when) => editBand(index, { when }),
						'day_type == "ORDINARY"'
					)}
					{@render expressionField(
						t('renderer.work_rules.take'),
						band.take,
						'number',
						(take) => editBand(index, { take }),
						'hours_beyond_normal'
					)}
					{@render expressionField(
						t('renderer.work_rules.price'),
						band.price,
						'number',
						(price) => editBand(index, { price }),
						'ordinary_hour * 1.5'
					)}

					<Stack gap="xs" class="rounded-md bg-muted/30 p-2">
						<Cluster justify="between" align="center" gap="sm">
							<span class="text-sm font-medium">{t('renderer.work_rules.funnel')}</span>
							<Button
								variant="ghost"
								size="sm"
								{disabled}
								onclick={() =>
									editBand(
										index,
										band.funnel == null
											? { funnel: { above: 'limits.daily_total', line: 'INCENTIVE' } }
											: removeFunnel(band)
									)}
							>
								{band.funnel == null
									? t('renderer.work_rules.add_funnel')
									: t('renderer.work_rules.remove_funnel')}
							</Button>
						</Cluster>
						{#if band.funnel != null}
							<Grid gap="md" minimum="panel">
								{@render expressionField(
									t('renderer.work_rules.funnel_above'),
									band.funnel.above,
									'number',
									(above) => editBand(index, { funnel: { ...band.funnel!, above } }),
									'limits.daily_total'
								)}
								<label class="text-sm font-medium"
									><Stack gap="xs">
										{t('renderer.work_rules.funnel_line')}
										<Input
											value={band.funnel.line}
											{disabled}
											placeholder={'INCENTIVE'}
											oninput={(event) =>
												editBand(index, {
													funnel: { ...band.funnel!, line: event.currentTarget.value }
												})}
										/>
									</Stack></label
								>
							</Grid>
						{/if}
					</Stack>

					<Stack gap="xs">
						<span class="text-sm font-medium">{t('component.statutory_opt_ins')}</span>
						<StatutoryOptIns
							value={band.statutory_opt_ins}
							{disabled}
							onValueChange={(statutory_opt_ins) => editBand(index, { statutory_opt_ins })}
						/>
					</Stack>

					<div>{@render removeButton(() => removeBand(index))}</div>
				</Stack>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						edit({
							rates: {
								...current.rates,
								bands: [
									...current.rates.bands,
									{
										label: '',
										line: 'OVERTIME',
										when: '',
										take: '',
										price: '',
										statutory_opt_ins: []
									}
								]
							}
						})}
				>
					{t('renderer.work_rules.add_band')}
				</Button>
			</div>
		</Stack>

		<!-- Limits -->
		<Stack gap="sm">
			<span class="text-sm font-semibold">{t('renderer.work_rules.limits')}</span>
			<p class="text-meta">{t('renderer.work_rules.limits_hint')}</p>
			<ExpressionFields site="work_day" />
			{#each current.limits as limit, index (index)}
				<Grid gap="sm" minimum="panel" class="rounded-md border border-border p-3">
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('renderer.work_rules.key')}
							<Input
								value={limit.key}
								{disabled}
								placeholder={'daily_total'}
								oninput={(event) => editLimit(index, { key: event.currentTarget.value })}
							/>
						</Stack></label
					>
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('renderer.work_rules.period_label')}
							<Combobox
								options={periodOptions}
								value={limit.period}
								{disabled}
								searchable={false}
								onValueChange={(period) => {
									if (period) editLimit(index, { period });
								}}
							/>
						</Stack></label
					>
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('renderer.work_rules.measure_label')}
							<Combobox
								options={measureOptions}
								value={limit.measure}
								{disabled}
								searchable={false}
								onValueChange={(measure) => {
									if (measure) editLimit(index, { measure });
								}}
							/>
						</Stack></label
					>
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('renderer.work_rules.max_hours')}
							<Input
								type="number"
								min="0"
								step="0.5"
								value={limit.max_hours}
								{disabled}
								oninput={(event) =>
									editLimit(index, { max_hours: numberFrom(event.currentTarget.value, 1) })}
							/>
						</Stack></label
					>
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('renderer.work_rules.unit_label')}
							<Combobox
								options={limitUnitOptions}
								value={limit.unit}
								{disabled}
								searchable={false}
								onValueChange={(unit) => {
									if (unit) editLimit(index, { unit });
								}}
							/>
						</Stack></label
					>
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('component.authority')}
							<Input
								value={limit.authority ?? ''}
								{disabled}
								oninput={(event) =>
									editLimit(index, { authority: event.currentTarget.value || undefined })}
							/>
						</Stack></label
					>
					<div class="flex items-end">
						{@render removeButton(() =>
							edit({ limits: current.limits.filter((_limit, position) => position !== index) })
						)}
					</div>
				</Grid>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						edit({
							limits: [
								...current.limits,
								{
									key: '',
									period: 'DAY',
									measure: 'TOTAL_WORK_HOURS',
									max_hours: 12,
									unit: 'WORKED_HOURS'
								}
							]
						})}
				>
					{t('renderer.work_rules.add_limit')}
				</Button>
			</div>
		</Stack>

		<!-- Breaks -->
		<Stack gap="sm">
			<span class="text-sm font-semibold">{t('renderer.work_rules.breaks')}</span>
			<p class="text-meta">{t('renderer.work_rules.breaks_hint')}</p>
			{#each current.breaks as rule, index (index)}
				<Stack gap="sm" class="rounded-md border border-border p-3">
					{@render expressionField(
						t('renderer.work_rules.when'),
						rule.when,
						'boolean',
						(when) => editBreak(index, { when }),
						'consecutive_hours > 5.0'
					)}
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('renderer.work_rules.owed_minutes')}</span>
						<Input
							value={String(rule.owed_minutes)}
							{disabled}
							placeholder={'30 or 60.0'}
							oninput={(event) =>
								editBreak(index, { owed_minutes: numberOrExpression(event.currentTarget.value) })}
						/>
						<ExpressionFields
							site="work_day"
							expression={String(rule.owed_minutes)}
							type="number"
						/>
					</Stack>
					<label class="flex flex-col gap-1 text-sm font-medium">
						{t('renderer.work_rules.counts_as_worked_time')}
						<select
							class="h-8 rounded-sm border border-input bg-background px-2 text-sm"
							{disabled}
							value={rule.counts_as_worked_time == null
								? 'STATED'
								: rule.counts_as_worked_time
									? 'YES'
									: 'NO'}
							onchange={(event) => {
								const next = event.currentTarget.value;
								editBreak(index, {
									counts_as_worked_time: next === 'STATED' ? null : next === 'YES'
								});
							}}
						>
							{#each workedTimeOptions as choice (choice.value)}
								<option value={choice.value}>{choice.label}</option>
							{/each}
						</select>
					</label>
					<div>
						{@render removeButton(() =>
							edit({ breaks: current.breaks.filter((_rule, position) => position !== index) })
						)}
					</div>
				</Stack>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						edit({
							breaks: [
								...current.breaks,
								{ when: '', owed_minutes: 30, counts_as_worked_time: null }
							]
						})}
				>
					{t('renderer.work_rules.add_break')}
				</Button>
			</div>
		</Stack>

		<!-- Weekly rest, coverage, night premium, precedence -->
		<Grid gap="md" minimum="panel">
			<Stack gap="xs" class="rounded-md border border-border p-3">
				<span class="text-sm font-semibold">{t('renderer.work_rules.weekly_rest')}</span>
				<label class="text-sm font-medium"
					><Stack gap="xs">
						{t('renderer.work_rules.consecutive_days')}
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
					</Stack></label
				>
				<label class="text-sm font-medium"
					><Stack gap="xs">
						{t('renderer.work_rules.discharged_by')}
						<Combobox
							options={restOptions}
							value={current.weekly_rest_rule.discharged_by}
							{disabled}
							searchable={false}
							onValueChange={(discharged_by) => {
								if (discharged_by)
									edit({
										weekly_rest_rule: { ...current.weekly_rest_rule, discharged_by }
									});
							}}
						/>
					</Stack></label
				>
			</Stack>

			<Stack gap="xs" class="rounded-md border border-border p-3">
				<span class="text-sm font-semibold">{t('renderer.work_rules.precedence_label')}</span>
				<Combobox
					options={precedenceOptions}
					value={current.holiday_rest_precedence}
					{disabled}
					searchable={false}
					onValueChange={(holiday_rest_precedence) => {
						if (holiday_rest_precedence) edit({ holiday_rest_precedence });
					}}
				/>
			</Stack>

			<Stack gap="xs" class="rounded-md border border-border p-3">
				<Cluster justify="between" align="center" gap="sm">
					<span class="text-sm font-semibold">{t('renderer.work_rules.coverage')}</span>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() =>
							edit({
								coverage:
									current.coverage == null
										? {
												wage_ceiling: null,
												ceiling_is_inclusive: null,
												wage_basis: null,
												category_basis: 'STATUTORY_WORK_CATEGORY',
												exempt_categories: [],
												excluded_categories: []
											}
										: null
							})}
					>
						{current.coverage == null
							? t('renderer.work_rules.add_coverage')
							: t('renderer.work_rules.remove_coverage')}
					</Button>
				</Cluster>
				{#if current.coverage != null}
					<Grid gap="md" minimum="panel">
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.wage_ceiling')}
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
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('component.currency')}
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
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.wage_basis')}
								<Combobox
									options={wageBasisOptions}
									value={current.coverage.wage_basis}
									{disabled}
									searchable={false}
									onValueChange={(wage_basis) => editCoverage({ wage_basis })}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.ceiling_is_inclusive')}
								<select
									class="h-8 rounded-sm border border-input bg-background px-2 text-sm"
									{disabled}
									value={current.coverage.ceiling_is_inclusive == null
										? 'STATED'
										: current.coverage.ceiling_is_inclusive
											? 'YES'
											: 'NO'}
									onchange={(event) => {
										const next = event.currentTarget.value;
										editCoverage({
											ceiling_is_inclusive: next === 'STATED' ? null : next === 'YES'
										});
									}}
								>
									{#each workedTimeOptions as choice (choice.value)}
										<option value={choice.value}>{choice.label}</option>
									{/each}
								</select>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.category_basis')}
								<Combobox
									options={categoryBasisOptions}
									value={current.coverage.category_basis}
									{disabled}
									searchable={false}
									onValueChange={(category_basis) => {
										if (category_basis) editCoverage({ category_basis });
									}}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.exempt_categories')}
								<Input
									value={current.coverage.exempt_categories.join(', ')}
									{disabled}
									oninput={(event) =>
										editCoverage({ exempt_categories: splitList(event.currentTarget.value) })}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.excluded_categories')}
								<Input
									value={current.coverage.excluded_categories.join(', ')}
									{disabled}
									oninput={(event) =>
										editCoverage({ excluded_categories: splitList(event.currentTarget.value) })}
								/>
							</Stack></label
						>
					</Grid>
				{/if}
			</Stack>

			<Stack gap="xs" class="rounded-md border border-border p-3">
				<Cluster justify="between" align="center" gap="sm">
					<span class="text-sm font-semibold">{t('renderer.work_rules.night_premium')}</span>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() =>
							edit({
								night_premium:
									current.night_premium == null
										? { from: '22:00', to: '06:00', ordinary_add: 10, overtime_add: 0 }
										: null
							})}
					>
						{current.night_premium == null
							? t('renderer.work_rules.add_night_premium')
							: t('renderer.work_rules.remove_night_premium')}
					</Button>
				</Cluster>
				{#if current.night_premium != null}
					<Grid gap="md" minimum="panel">
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.night_from')}
								<Input
									type="time"
									value={current.night_premium.from}
									{disabled}
									oninput={(event) => editNight({ from: event.currentTarget.value })}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.night_to')}
								<Input
									type="time"
									value={current.night_premium.to}
									{disabled}
									oninput={(event) => editNight({ to: event.currentTarget.value })}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.night_ordinary_add')}
								<Input
									type="number"
									min="0"
									step="0.01"
									value={current.night_premium.ordinary_add}
									{disabled}
									oninput={(event) =>
										editNight({ ordinary_add: numberFrom(event.currentTarget.value, 0) })}
								/>
							</Stack></label
						>
						<label class="text-sm font-medium"
							><Stack gap="xs">
								{t('renderer.work_rules.night_overtime_add')}
								<Input
									type="number"
									min="0"
									step="0.01"
									value={current.night_premium.overtime_add}
									{disabled}
									oninput={(event) =>
										editNight({ overtime_add: numberFrom(event.currentTarget.value, 0) })}
								/>
							</Stack></label
						>
					</Grid>
				{/if}
			</Stack>
		</Grid>

		<label class="text-sm font-medium"
			><Stack gap="xs">
				{t('component.authority')}
				<Input
					value={current.authority ?? ''}
					{disabled}
					oninput={(event) => edit({ authority: event.currentTarget.value || undefined })}
				/>
			</Stack></label
		>
	</Stack>
{/if}
