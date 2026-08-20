<script lang="ts">
	import { Result, Schema } from 'effect';
	import OvertimeAwardRenderer from '../overtime_award/+renderer.svelte';
	import OvertimeBandRenderer from '../overtime_band/+renderer.svelte';
	import { splitList, nullableNumberFrom, numberFrom } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		statutoryRegimeSchema,
		type StatutoryRegime,
		type StatutoryRestBreakRule
	} from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Rule = Value['overtime_rules'][number];
	type Limit = Value['overtime_limits'][number];
	/**
	 * Taken from the definition rather than from `Value['rest_break_rules'][number]`, because the
	 * member is an optional key: the generated indexed access is `readonly Break[] | undefined`, and
	 * every use below would have to unwrap it again.
	 */
	type BreakRule = StatutoryRestBreakRule;
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
	const BREAK_ARMS: { value: BreakRule['applies_when']; label: string }[] = [
		{ value: 'ALWAYS', label: 'Every working day' },
		{ value: 'CONTINUOUS_ATTENDANCE', label: 'Work requiring continual attendance' }
	];
	/**
	 * Three states, because the field has three. "Not stated" is the answer wherever the primary text
	 * is silent — Malaysia's s.60A(1)(a) calls the period "leisure" and says nothing about payment —
	 * and it must stay distinguishable from "unpaid", which is what Indonesia's ps.79(2)(a) actually
	 * says. Collapsing the two would let a later reader price a statute that never spoke.
	 */
	const BREAK_PAID: { value: string; label: string }[] = [
		{ value: 'unstated', label: 'The statute does not say' },
		{ value: 'paid', label: 'Counted as working time' },
		{ value: 'unpaid', label: 'Not counted as working time' }
	];
	const BREAK_ACTIONS: { value: BreakRule['on_exceed']; label: string }[] = [
		{ value: 'WARN', label: 'Warn' },
		{ value: 'BLOCK', label: 'Block' }
	];
	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(statutoryRegimeSchema)(props.value));
	const current = $derived<StatutoryRegime>(
		Result.isSuccess(parsed)
			? parsed.success
			: { overtime_coverage: null, overtime_rules: [], overtime_limits: [] }
	);
	const breakRules = $derived<readonly BreakRule[]>(current.rest_break_rules ?? []);
	const summary = $derived(
		[
			`${current.overtime_rules.length} pricing bands`,
			`${current.overtime_limits.length} limits`,
			// Only mentioned once declared. A snapshot that predates this member says nothing about
			// breaks, and "0 break rules" would read as a decision nobody made.
			...(breakRules.length > 0 ? [`${breakRules.length} break rules`] : [])
		].join(' · ')
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

	function replaceCoverage(next: Coverage | null): void {
		emit({ ...current, overtime_coverage: next });
	}

	function replaceBreakRule(index: number, next: BreakRule): void {
		emit({
			...current,
			rest_break_rules: breakRules.map((entry, position) => (position === index ? next : entry))
		});
	}

	/** The three-state control's value, and the field it writes back. */
	function paidValue(rule: BreakRule): string {
		if (rule.counts_as_worked_time === null) return 'unstated';
		return rule.counts_as_worked_time ? 'paid' : 'unpaid';
	}

	function paidFrom(value: string): boolean | null {
		return value === 'unstated' ? null : value === 'paid';
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
		<Stack as="section" gap="md">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Who is entitled to overtime</h3>
					<p class="text-meta">
						Leave this off where the law entitles everyone; add it where the law names a wage
						ceiling or work categories that decide entitlement.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => replaceCoverage(current.overtime_coverage ? null : defaultCoverage())}
				>
					{current.overtime_coverage ? 'Remove entitlement rule' : 'Add entitlement rule'}
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
								{ value: 'inclusive', label: 'Earning exactly the ceiling is entitled' },
								{ value: 'exclusive', label: 'Earning exactly the ceiling is not entitled' }
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
						Always entitled, whatever they earn
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
						Never entitled
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
		</Stack>

		<Stack as="section" gap="md" class="border-t border-border pt-4">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Overtime pricing</h3>
					<p class="text-meta">Bands are evaluated within each day type.</p>
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
		</Stack>

		<Stack as="section" gap="md" class="border-t border-border pt-4">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Working-time limits</h3>
					<p class="text-meta">A period and measure identify one ceiling.</p>
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
		</Stack>

		<Stack as="section" gap="md" class="border-t border-border pt-4">
			<Inline justify="between" align="center" gap="sm">
				<div>
					<h3 class="text-sm font-semibold">Rest and meal breaks</h3>
					<p class="text-meta">
						A consecutive-hours rule, measured from the punches. This is a compliance check and
						never changes pay. Leave the minimum empty where the statute names no length, and the
						trigger empty where it owes the break every day.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						emit({
							...current,
							rest_break_rules: [
								...breakRules,
								{
									after_consecutive_hours: 5,
									minimum_minutes: 30,
									counts_as_worked_time: null,
									applies_when: 'ALWAYS',
									on_exceed: 'WARN',
									authority: ''
								}
							]
						})}>Add break rule</Button
				>
			</Inline>
			{#each breakRules as rule, index (index)}
				<Grid gap="sm" minimum="compact" class="border-t border-border py-3 first:border-t-0">
					<label class="grid gap-1.5 text-sm font-medium">
						Applies to
						<Combobox
							options={BREAK_ARMS}
							value={rule.applies_when}
							{disabled}
							searchable={false}
							onValueChange={(value) => {
								if (value) replaceBreakRule(index, { ...rule, applies_when: value });
							}}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						After consecutive hours
						<Input
							type="number"
							min="0"
							step="0.25"
							value={rule.after_consecutive_hours ?? ''}
							{disabled}
							placeholder="Owed every day"
							oninput={(event) =>
								replaceBreakRule(index, {
									...rule,
									after_consecutive_hours: nullableNumberFrom(event.currentTarget.value)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Minimum length (minutes)
						<Input
							type="number"
							min="0"
							step="1"
							value={rule.minimum_minutes ?? ''}
							{disabled}
							placeholder="The statute names none"
							oninput={(event) =>
								replaceBreakRule(index, {
									...rule,
									minimum_minutes: nullableNumberFrom(event.currentTarget.value)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Paid status
						<Combobox
							options={BREAK_PAID}
							value={paidValue(rule)}
							{disabled}
							searchable={false}
							onValueChange={(value) => {
								if (value)
									replaceBreakRule(index, { ...rule, counts_as_worked_time: paidFrom(value) });
							}}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						On shortfall
						<Combobox
							options={BREAK_ACTIONS}
							value={rule.on_exceed}
							{disabled}
							searchable={false}
							onValueChange={(value) => {
								if (value) replaceBreakRule(index, { ...rule, on_exceed: value });
							}}
						/>
					</label>
					<label class="col-span-full grid gap-1.5 text-sm font-medium">
						Authority
						<Input
							value={rule.authority}
							{disabled}
							oninput={(event) =>
								replaceBreakRule(index, { ...rule, authority: event.currentTarget.value })}
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
									rest_break_rules: breakRules.filter((_, position) => position !== index)
								})}>Remove</Button
						>
					</Cluster>
				</Grid>
			{/each}
		</Stack>
	</Stack>
{/if}
