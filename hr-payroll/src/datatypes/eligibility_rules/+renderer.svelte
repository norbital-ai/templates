<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { nullableNumberFrom, numberFrom, splitList } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		eligibilityRulesSchema,
		type EligibilityRule,
		type EligibilityRules
	} from './+definition.js';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type Rule = EligibilityRule;
	type RuleField = Rule['field'];
	type EmploymentType = Extract<Rule, { field: 'EMPLOYMENT_TYPE' }>['in'][number];
	type Classification = Extract<Rule, { field: 'WORK_CLASSIFICATION' }>['in'][number];
	type Gender = Extract<Rule, { field: 'GENDER' }>['in'][number];

	const FIELD_OPTIONS: { value: RuleField; label: string }[] = [
		{ value: 'EMPLOYMENT_TYPE', label: 'Employment type' },
		{ value: 'WORK_CLASSIFICATION', label: 'Work classification' },
		{ value: 'SERVICE_MONTHS', label: 'Service months' },
		{ value: 'GENDER', label: 'Gender' },
		{ value: 'DEPARTMENT', label: 'Department' },
		{ value: 'PAYROLL_GROUP', label: 'Payroll group' }
	];
	const EMPLOYMENT_TYPES: EmploymentType[] = [
		'PERMANENT',
		'CONTRACT',
		'PROBATION',
		'INTERN',
		'CONSULTANT'
	];
	const CLASSIFICATIONS: Classification[] = ['EA_COVERED', 'NON_EA', 'MANAGERIAL'];
	const GENDERS: Gender[] = ['MALE', 'FEMALE'];

	/**
	 * The platform hands every custom renderer the full `CollectionField` (name, kind, nullable,
	 * options, …); the generated `$types` only declare the `{ name, type }` minimum, so the field is
	 * restated against the design-system shape the callers and the runtime actually speak.
	 */
	type WithStdField<P> = P extends unknown
		? Omit<P, 'field'> & { readonly field: CollectionField }
		: never;
	type Props = WithStdField<RendererProps>;
	let props: Props = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(eligibilityRulesSchema)(props.value, { onExcessProperty: 'error' })
	);
	const rules = $derived<EligibilityRules>(Result.isSuccess(parsed) ? parsed.success : []);
	const summary = $derived(
		rules.length === 0
			? 'Everyone'
			: rules
					.map((rule) =>
						rule.field === 'SERVICE_MONTHS'
							? `SERVICE_MONTHS ${rule.from}–${rule.to ?? '∞'}`
							: `${rule.field} in [${rule.in.join(', ')}]`
					)
					.join(' AND ')
	);

	function emit(next: EligibilityRules): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultRule(field: RuleField): Rule {
		switch (field) {
			case 'EMPLOYMENT_TYPE':
				return { field: 'EMPLOYMENT_TYPE', in: ['PERMANENT'] };
			case 'WORK_CLASSIFICATION':
				return { field: 'WORK_CLASSIFICATION', in: ['EA_COVERED'] };
			case 'SERVICE_MONTHS':
				return { field: 'SERVICE_MONTHS', from: 0, to: null };
			case 'GENDER':
				return { field: 'GENDER', in: ['FEMALE'] };
			case 'DEPARTMENT':
				return { field: 'DEPARTMENT', in: [] };
			case 'PAYROLL_GROUP':
				return { field: 'PAYROLL_GROUP', in: [] };
		}
	}

	function addRule(field: RuleField | null): void {
		if (field === null) return;
		emit([...rules, defaultRule(field)]);
	}

	function replaceAt(index: number, rule: Rule): void {
		emit(rules.map((entry, position) => (position === index ? rule : entry)));
	}

	function removeAt(index: number): void {
		emit(rules.filter((_, position) => position !== index));
	}

	/** Returns `null` when the toggle would empty the list — every `in` needs ≥ 1 member. */
	function toggled<T extends string>(list: readonly T[], option: T): T[] | null {
		const next = list.includes(option)
			? list.filter((entry) => entry !== option)
			: [...list, option];
		return next.length === 0 ? null : next;
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack class="rounded-md border border-border bg-muted/20 p-3" gap="sm">
		{#if rules.length === 0}
			<p class="text-sm text-muted-foreground">No rules — everyone is eligible.</p>
		{/if}

		{#each rules as rule, index (index)}
			<Grid gap="xs" class="rounded-md border border-border bg-background p-2" minimum="compact">
				<Inline justify="between" gap="xs">
					<span class="text-sm font-medium">{rule.field.replaceAll('_', ' ').toLowerCase()}</span>
					<Button variant="ghost" size="sm" {disabled} onclick={() => removeAt(index)}>
						Remove
					</Button>
				</Inline>

				{#if rule.field === 'EMPLOYMENT_TYPE'}
					<Cluster gap="sm">
						{#each EMPLOYMENT_TYPES as option (option)}
							<label class="text-sm">
								<Inline gap="xs">
									<input
										type="checkbox"
										class="size-4"
										checked={rule.in.includes(option)}
										{disabled}
										onchange={() => {
											const next = toggled(rule.in, option);
											if (next !== null) replaceAt(index, { field: 'EMPLOYMENT_TYPE', in: next });
										}}
									/>
									{option}
								</Inline>
							</label>
						{/each}
					</Cluster>
				{:else if rule.field === 'WORK_CLASSIFICATION'}
					<Cluster gap="sm">
						{#each CLASSIFICATIONS as option (option)}
							<label class="text-sm">
								<Inline gap="xs">
									<input
										type="checkbox"
										class="size-4"
										checked={rule.in.includes(option)}
										{disabled}
										onchange={() => {
											const next = toggled(rule.in, option);
											if (next !== null)
												replaceAt(index, { field: 'WORK_CLASSIFICATION', in: next });
										}}
									/>
									{option}
								</Inline>
							</label>
						{/each}
					</Cluster>
				{:else if rule.field === 'GENDER'}
					<Cluster gap="sm">
						{#each GENDERS as option (option)}
							<label class="text-sm">
								<Inline gap="xs">
									<input
										type="checkbox"
										class="size-4"
										checked={rule.in.includes(option)}
										{disabled}
										onchange={() => {
											const next = toggled(rule.in, option);
											if (next !== null) replaceAt(index, { field: 'GENDER', in: next });
										}}
									/>
									{option}
								</Inline>
							</label>
						{/each}
					</Cluster>
				{:else if rule.field === 'SERVICE_MONTHS'}
					<Grid gap="xs" minimum="compact">
						<label class="text-sm font-medium">
							<Stack gap="xs">
								From (months)
								<Input
									type="number"
									min="0"
									step="1"
									value={rule.from}
									{disabled}
									oninput={(event) =>
										replaceAt(index, {
											...rule,
											from: numberFrom(event.currentTarget.value, 0)
										})}
								/>
							</Stack>
						</label>
						<label class="text-sm font-medium">
							<Stack gap="xs">
								To (blank = no upper bound)
								<Input
									type="number"
									min="0"
									step="1"
									value={rule.to ?? ''}
									{disabled}
									oninput={(event) =>
										replaceAt(index, {
											...rule,
											to: nullableNumberFrom(event.currentTarget.value)
										})}
								/>
							</Stack>
						</label>
					</Grid>
				{:else if rule.field === 'DEPARTMENT'}
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Departments (comma separated)
							<Input
								value={rule.in.join(', ')}
								{disabled}
								placeholder={t('component.operations_finance')}
								oninput={(event) =>
									replaceAt(index, {
										field: 'DEPARTMENT',
										in: splitList(event.currentTarget.value)
									})}
							/>
						</Stack>
					</label>
				{:else if rule.field === 'PAYROLL_GROUP'}
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Payroll groups (comma separated)
							<Input
								value={rule.in.join(', ')}
								{disabled}
								placeholder={t('component.monthly_weekly')}
								oninput={(event) =>
									replaceAt(index, {
										field: 'PAYROLL_GROUP',
										in: splitList(event.currentTarget.value)
									})}
							/>
						</Stack>
					</label>
				{/if}
			</Grid>
		{/each}

		<Combobox
			options={FIELD_OPTIONS}
			value={null}
			{disabled}
			searchable={false}
			emptyPlaceholder={t('renderer.eligibility_rules.add_rule')}
			onValueChange={addRule}
		/>
	</Stack>
{/if}
