<script lang="ts">
	import OvertimeAwardRenderer from '../overtime_award/+renderer.svelte';
	import OvertimeBandRenderer from '../overtime_band/+renderer.svelte';
	import { splitList, nullableNumberFrom, numberFrom } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { statutoryRegimeSchema, type StatutoryRegime } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Rule = Value['overtime_rules'][number];
	type Limit = Value['overtime_limits'][number];
	type BreakRule = Value['rest_breaks'][number];
	type Coverage = NonNullable<Value['overtime_coverage']>;
	type CategoryBasis = Coverage['category_basis'];
	type WageBasis = NonNullable<Coverage['wage_basis']>;

	const BAND_FIELD = {
		name: 'band',
		kind: 'overtime_band',
		nullable: false
	} satisfies CollectionField;
	const AWARD_FIELD = {
		name: 'award',
		kind: 'overtime_award',
		nullable: false
	} satisfies CollectionField;
	const CATEGORY_BASES: { value: CategoryBasis; label: string }[] = [
		{ value: 'STATUTORY_WORK_CATEGORY', label: 'Statutory work category' },
		{ value: 'WORK_CLASSIFICATION', label: 'Work classification' }
	];
	const WAGE_BASES: { value: WageBasis; label: string }[] = [
		{ value: 'STATUTORY_WAGES', label: 'Statutory wages' },
		{ value: 'BASE_SALARY', label: 'Base salary' }
	];
	const DAY_TYPES: { value: Rule['day_type']; label: string }[] = [
		{ value: 'ORDINARY', label: 'Ordinary day' },
		{ value: 'REST_DAY', label: 'Rest day' },
		{ value: 'PUBLIC_HOLIDAY', label: 'Public holiday' }
	];
	const PERIODS: { value: Limit['period']; label: string }[] = [
		{ value: 'DAY', label: 'Day' },
		{ value: 'WEEK', label: 'Week' },
		{ value: 'MONTH', label: 'Month' }
	];
	const MEASURES: { value: Limit['measures']; label: string }[] = [
		{ value: 'OVERTIME_HOURS', label: 'Overtime hours' },
		{ value: 'TOTAL_WORK_HOURS', label: 'Total work hours' }
	];
	const LIMIT_ACTIONS: { value: Limit['on_exceed']; label: string }[] = [
		{ value: 'WARN', label: 'Warn' },
		{ value: 'BLOCK', label: 'Block' }
	];
	const BREAK_KINDS: { value: BreakRule['applies_when']; label: string }[] = [
		{ value: 'ALWAYS', label: 'Always' },
		{ value: 'CONTINUOUS_ATTENDANCE', label: 'Continuous attendance' },
		{ value: 'OVERTIME', label: 'Overtime' }
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(statutoryRegimeSchema.safeParse(props.value));
	const current = $derived<StatutoryRegime>(
		parsed.success
			? parsed.data
			: { overtime_coverage: null, overtime_rules: [], overtime_limits: [], rest_breaks: [] }
	);
	const summary = $derived(
		`${current.overtime_rules.length} pricing bands · ${current.overtime_limits.length} limits · ${current.rest_breaks.length} break rules`
	);

	function emit(next: Value): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function replaceRule(index: number, next: Rule): void {
		emit({
			...current,
			overtime_rules: current.overtime_rules.map((entry, position) =>
				position === index ? next : entry
			)
		});
	}

	function replaceLimit(index: number, next: Limit): void {
		emit({
			...current,
			overtime_limits: current.overtime_limits.map((entry, position) =>
				position === index ? next : entry
			)
		});
	}

	function replaceBreak(index: number, next: BreakRule): void {
		emit({
			...current,
			rest_breaks: current.rest_breaks.map((entry, position) => (position === index ? next : entry))
		});
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
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="lg">
		<section class="grid gap-3">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Overtime coverage</h3>
					<p class="text-xs text-muted-foreground">Who enters the pricing ladder.</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => replaceCoverage(current.overtime_coverage ? null : defaultCoverage())}
				>
					{current.overtime_coverage ? 'Remove coverage test' : 'Add coverage test'}
				</Button>
			</Inline>

			{#if current.overtime_coverage}
				{@const coverage = current.overtime_coverage}
				<Grid gap="sm" minimum="compact">
					<label class="grid gap-1.5 text-sm font-medium">
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
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
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
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
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
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Ceiling currency
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
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Ceiling treatment
						<Combobox
							options={[
								{ value: 'inclusive', label: 'Ceiling amount is covered' },
								{ value: 'exclusive', label: 'Ceiling amount is excluded' }
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
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Always covered categories
						<Input
							value={coverage.exempt_categories.join(', ')}
							{disabled}
							oninput={(event) =>
								replaceCoverage({
									...coverage,
									exempt_categories: splitList(event.currentTarget.value)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Never covered categories
						<Input
							value={coverage.excluded_categories.join(', ')}
							{disabled}
							oninput={(event) =>
								replaceCoverage({
									...coverage,
									excluded_categories: splitList(event.currentTarget.value)
								})}
						/>
					</label>
					<label class="col-span-full grid gap-1.5 text-sm font-medium">
						Authority
						<Input
							value={coverage.authority}
							{disabled}
							oninput={(event) =>
								replaceCoverage({ ...coverage, authority: event.currentTarget.value })}
						/>
					</label>
				</Grid>
			{/if}
		</section>

		<section class="grid gap-3 border-t border-border pt-4">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Overtime pricing</h3>
					<p class="text-xs text-muted-foreground">Bands are evaluated within each day type.</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						emit({
							...current,
							overtime_rules: [
								...current.overtime_rules,
								{
									day_type: 'ORDINARY',
									authority: '',
									band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
									award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
								}
							]
						})}>Add pricing band</Button
				>
			</Inline>
			{#each current.overtime_rules as rule, index (index)}
				<Stack gap="sm" class="border-t border-border py-3 first:border-t-0">
					<Inline justify="between" align="center" gap="sm">
						<Combobox
							options={DAY_TYPES}
							value={rule.day_type}
							{disabled}
							searchable={false}
							onValueChange={(value) => {
								if (value) replaceRule(index, { ...rule, day_type: value });
							}}
						/>
						<Button
							variant="ghost"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									overtime_rules: current.overtime_rules.filter((_, position) => position !== index)
								})}>Remove</Button
						>
					</Inline>
					<Grid gap="sm" minimum="panel">
						<OvertimeBandRenderer
							field={BAND_FIELD}
							value={rule.band}
							mode="edit"
							{disabled}
							onValueChange={(value) => {
								if (value) replaceRule(index, { ...rule, band: value });
							}}
						/>
						<OvertimeAwardRenderer
							field={AWARD_FIELD}
							value={rule.award}
							mode="edit"
							{disabled}
							onValueChange={(value) => {
								if (value) replaceRule(index, { ...rule, award: value });
							}}
						/>
					</Grid>
					<label class="grid gap-1.5 text-sm font-medium">
						Authority
						<Input
							value={rule.authority}
							{disabled}
							oninput={(event) =>
								replaceRule(index, { ...rule, authority: event.currentTarget.value })}
						/>
					</label>
				</Stack>
			{/each}
		</section>

		<section class="grid gap-3 border-t border-border pt-4">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Working-time limits</h3>
					<p class="text-xs text-muted-foreground">A period and measure identify one ceiling.</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						emit({
							...current,
							overtime_limits: [
								...current.overtime_limits,
								{
									period: 'MONTH',
									measures: 'OVERTIME_HOURS',
									max_hours: 0,
									on_exceed: 'BLOCK',
									authority: ''
								}
							]
						})}>Add limit</Button
				>
			</Inline>
			{#each current.overtime_limits as limit, index (index)}
				<Grid gap="sm" minimum="compact" class="border-t border-border py-3 first:border-t-0">
					<Combobox
						options={PERIODS}
						value={limit.period}
						{disabled}
						searchable={false}
						onValueChange={(value) => {
							if (value) replaceLimit(index, { ...limit, period: value });
						}}
					/>
					<Combobox
						options={MEASURES}
						value={limit.measures}
						{disabled}
						searchable={false}
						onValueChange={(value) => {
							if (value) replaceLimit(index, { ...limit, measures: value });
						}}
					/>
					<Input
						type="number"
						min="0.01"
						step="0.25"
						value={limit.max_hours}
						{disabled}
						oninput={(event) =>
							replaceLimit(index, {
								...limit,
								max_hours: numberFrom(event.currentTarget.value, 0)
							})}
					/>
					<Combobox
						options={LIMIT_ACTIONS}
						value={limit.on_exceed}
						{disabled}
						searchable={false}
						onValueChange={(value) => {
							if (value) replaceLimit(index, { ...limit, on_exceed: value });
						}}
					/>
					<label class="col-span-full grid gap-1.5 text-sm font-medium">
						Authority
						<Input
							value={limit.authority}
							{disabled}
							oninput={(event) =>
								replaceLimit(index, { ...limit, authority: event.currentTarget.value })}
						/>
					</label>
					<Cluster class="col-span-full" justify="end">
						<Button
							variant="ghost"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									overtime_limits: current.overtime_limits.filter(
										(_, position) => position !== index
									)
								})}>Remove</Button
						>
					</Cluster>
				</Grid>
			{/each}
		</section>

		<section class="grid gap-3 border-t border-border pt-4">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Rest and meal breaks</h3>
					<p class="text-xs text-muted-foreground">One rule for each application condition.</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						emit({
							...current,
							rest_breaks: [
								...current.rest_breaks,
								{
									after_consecutive_hours: null,
									minimum_minutes: 30,
									counts_as_worked_time: null,
									applies_when: 'ALWAYS',
									authority: ''
								}
							]
						})}>Add break rule</Button
				>
			</Inline>
			{#each current.rest_breaks as rule, index (index)}
				<Grid gap="sm" minimum="compact" class="border-t border-border py-3 first:border-t-0">
					<Combobox
						options={BREAK_KINDS}
						value={rule.applies_when}
						{disabled}
						searchable={false}
						onValueChange={(value) => {
							if (value) replaceBreak(index, { ...rule, applies_when: value });
						}}
					/>
					<label class="grid gap-1.5 text-sm font-medium">
						After consecutive hours
						<Input
							type="number"
							min="0.01"
							step="0.25"
							value={rule.after_consecutive_hours ?? ''}
							{disabled}
							oninput={(event) =>
								replaceBreak(index, {
									...rule,
									after_consecutive_hours: nullableNumberFrom(event.currentTarget.value)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Minimum minutes
						<Input
							type="number"
							min="1"
							step="1"
							value={rule.minimum_minutes}
							{disabled}
							oninput={(event) =>
								replaceBreak(index, {
									...rule,
									minimum_minutes: numberFrom(event.currentTarget.value, 0)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Counts as worked time
						<Combobox
							options={[
								{ value: 'stated-paid', label: 'Yes' },
								{ value: 'stated-unpaid', label: 'No' },
								{ value: 'not-stated', label: 'Not stated' }
							]}
							value={rule.counts_as_worked_time === null
								? 'not-stated'
								: rule.counts_as_worked_time
									? 'stated-paid'
									: 'stated-unpaid'}
							{disabled}
							searchable={false}
							onValueChange={(value) => {
								if (value)
									replaceBreak(index, {
										...rule,
										counts_as_worked_time: value === 'not-stated' ? null : value === 'stated-paid'
									});
							}}
						/>
					</label>
					<label class="col-span-full grid gap-1.5 text-sm font-medium">
						Authority
						<Input
							value={rule.authority}
							{disabled}
							oninput={(event) =>
								replaceBreak(index, { ...rule, authority: event.currentTarget.value })}
						/>
					</label>
					<Cluster class="col-span-full" justify="end">
						<Button
							variant="ghost"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									rest_breaks: current.rest_breaks.filter((_, position) => position !== index)
								})}>Remove</Button
						>
					</Cluster>
				</Grid>
			{/each}
		</section>
	</Stack>
{/if}
