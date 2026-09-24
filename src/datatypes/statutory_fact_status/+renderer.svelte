<script lang="ts">
	import type { Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { nullableNumberFrom } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { statutoryFactInstalmentSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';
	import ElectionsEditor from '../entity_facts/+renderer.svelte';
	import DeductionClaims from './deduction-claims.svelte';
	import { client } from '../../lib/workspace-client.js';

	type Instalment = Schema.Schema.Type<typeof statutoryFactInstalmentSchema>;

	const { t } = useI18n<TenantI18nKeys>();

	type StatusKind = Value['kind'];

	const KIND_OPTIONS: { value: StatusKind; label: string; description: string }[] = [
		{
			value: 'REGISTERED',
			label: 'Registered',
			description: 'Has a reference number with the authority'
		},
		{
			value: 'NOT_REGISTERED',
			label: 'Not registered',
			description: 'Exempt or out of scope — a reason is required'
		}
	];

	let props: RendererProps & { schemeId?: string; class?: string } = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const schemeQuery = $derived(
		props.mode === 'edit' && props.schemeId
			? client.db.statutory_contributions.findFirst({
					where: { id: { eq: props.schemeId } },
					columns: { elections: true }
				})
			: null
	);
	// Preserve incomplete edits; the collection schema validates on submission.
	const current = $derived(props.value ?? null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'NOT_REGISTERED') return `Not registered — ${current.reason}`;
		const override = current.rate_override == null ? '' : ` @ ${current.rate_override}`;
		return `Registered ${current.reference_number}${override}`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	type Opening = NonNullable<Extract<Value, { kind: 'REGISTERED' }>['opening']>[number];
	type ChildClaim = NonNullable<Extract<Value, { kind: 'REGISTERED' }>['child_claims']>[number];
	const CHILD_CLASSES = [
		{ value: 'UNDER_18', label: 'Under 18 during the tax year' },
		{ value: 'STUDYING', label: 'Adult in qualifying full-time education' },
		{ value: 'TERTIARY', label: 'Adult in qualifying higher education' },
		{ value: 'DISABLED', label: 'Certified disabled child' },
		{ value: 'DISABLED_TERTIARY', label: 'Disabled adult in qualifying higher education' }
	];
	/**
	 * The registered arm with one row of a list — the instalments or the earlier-employer openings —
	 * replaced, or the list without it.
	 */
	type Registered = Extract<Value, { kind: 'REGISTERED' }>;
	function editRow<Row extends Instalment | Opening | ChildClaim>(
		list: Row extends Instalment ? 'instalments' : Row extends Opening ? 'opening' : 'child_claims',
		index: number,
		change: Partial<Row> | null
	): void {
		if (current?.kind !== 'REGISTERED') return;
		const rows = ((current as Registered)[list] ?? []) as readonly Row[];
		const next =
			change === null
				? rows.filter((_: Row, position: number) => position !== index)
				: rows.map((row: Row, position: number) =>
						position === index ? { ...row, ...change } : row
					);
		emit({ ...current, [list]: next });
	}
	const editInstalment = (index: number, change: Partial<Instalment> | null) =>
		editRow('instalments', index, change);
	const editOpening = (index: number, change: Partial<Opening> | null) =>
		editRow('opening', index, change);
	const editChildClaim = (index: number, change: Partial<ChildClaim> | null) =>
		editRow('child_claims', index, change);

	const numberOr = (text: string, fallback = 0) =>
		text.trim() === '' ? fallback : Number(text) || fallback;

	function defaultFor(kind: StatusKind): Value {
		switch (kind) {
			case 'REGISTERED':
				return { kind: 'REGISTERED', reference_number: '', rate_override: null };
			case 'NOT_REGISTERED':
				return { kind: 'NOT_REGISTERED', reason: '' };
		}
	}

	/*
	 * Every variant renderer needs this same three-line guard, but it closes over this file's
	 * `current`, `emit` and `defaultFor`. Sharing it would mean a generic taking three callbacks —
	 * `controller-surfaces.md` §2 calls that a wrapper thinner than the thing it wraps. The pure
	 * coercions these renderers used to duplicate did move, to lib/ui/renderer-input.ts.
	 */
	// repository-health:allow D1 -- closes over this file's current/emit/defaultFor; see the note above.
	function selectKind(kind: StatusKind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(defaultFor(kind));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate {props.class ?? ''}" title={summary}>{summary}</span>
{:else}
	<Grid
		class="rounded-md border border-border bg-muted/20 p-3 {props.class ?? ''}"
		gap="sm"
		minimum="compact"
	>
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Status
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.statutory_fact_status.select_status')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>
		{#if current?.kind === 'REGISTERED'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Reference number
					<Input
						value={current.reference_number}
						{disabled}
						placeholder={t('component.authority_reference')}
						oninput={(event) => emit({ ...current, reference_number: event.currentTarget.value })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Rate override (blank = use the band)
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.rate_override ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, rate_override: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.statutory_fact_status.since')}
					<Input
						type="date"
						value={current.since ?? ''}
						{disabled}
						oninput={(event) => emit({ ...current, since: event.currentTarget.value || null })}
					/>
				</Stack>
			</label>
			<Column span="all">
				<Stack gap="xs">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{t('renderer.statutory_fact_status.first_contribution_due_on')}
							<Input
								type="date"
								value={current.first_contribution_due_on ?? ''}
								{disabled}
								oninput={(event) =>
									emit({
										...current,
										first_contribution_due_on: event.currentTarget.value || null
									})}
							/>
						</Stack>
					</label>
					<p class="text-xs text-muted-foreground">
						{t('renderer.statutory_fact_status.first_contribution_due_help')}
					</p>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="xs">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.elections')}</span>
					<ElectionsEditor
						mode="edit"
						field={props.field}
						value={current.elections ?? {}}
						declarations={schemeQuery?.current?.elections ?? []}
						{disabled}
						onValueChange={(elections) => {
							// The value declares `elections` optional, never null: a cleared editor drops the key.
							const { elections: _prior, ...rest } = current;
							emit(elections === null ? rest : { ...rest, elections });
						}}
					/>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">Child relief claims</span>
					<p class="text-xs text-muted-foreground">
						Record eligible claims from the employee’s declaration for each tax year. Family records
						do not grant tax relief. For Malaysia, a 50% claim requires entitlement under section
						48(4); spouses living together allocate children between their claims.
					</p>
					{#each current.child_claims ?? [] as row, index (index)}
						<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
							<label class="text-sm"
								><Stack gap="xs"
									>Tax year<Input
										value={row.year}
										{disabled}
										inputmode="numeric"
										maxlength={4}
										oninput={(event) => editChildClaim(index, { year: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>Relief category<Combobox
										options={CHILD_CLASSES}
										value={row.relief_class}
										{disabled}
										searchable={false}
										onValueChange={(value) => {
											if (value) editChildClaim(index, { relief_class: value });
										}}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>Children claimed at 100%<Input
										type="number"
										min="0"
										step="1"
										value={row.full_count}
										{disabled}
										oninput={(event) =>
											editChildClaim(index, { full_count: numberOr(event.currentTarget.value) })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>Children claimed at 50%<Input
										type="number"
										min="0"
										step="1"
										value={row.half_count}
										{disabled}
										oninput={(event) =>
											editChildClaim(index, { half_count: numberOr(event.currentTarget.value) })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>Declaration reference<Input
										value={row.reference}
										{disabled}
										oninput={(event) =>
											editChildClaim(index, { reference: event.currentTarget.value })}
									/></Stack
								></label
							>
							<Cluster
								><Button
									variant="ghost"
									size="sm"
									{disabled}
									onclick={() => editChildClaim(index, null)}>Remove claim</Button
								></Cluster
							>
						</Grid>
					{/each}
					<Cluster
						><Button
							variant="outline"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									child_claims: [
										...(current.child_claims ?? []),
										{
											year: String(new Date().getFullYear()),
											relief_class: 'UNDER_18',
											full_count: 0,
											half_count: 0,
											reference: ''
										}
									]
								})}>Add child claim</Button
						></Cluster
					>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.instalments')}</span>
					{#each current.instalments ?? [] as row, index (index)}
						<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_amount')}<Input
										type="number"
										min="0"
										step="0.01"
										value={row.amount}
										{disabled}
										oninput={(event) =>
											editInstalment(index, { amount: Number(event.currentTarget.value) || 0 })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_from')}<Input
										type="month"
										value={row.from}
										{disabled}
										oninput={(event) => editInstalment(index, { from: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_to')}<Input
										type="month"
										value={row.to}
										{disabled}
										oninput={(event) => editInstalment(index, { to: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_reference')}<Input
										value={row.reference}
										{disabled}
										oninput={(event) =>
											editInstalment(index, { reference: event.currentTarget.value })}
									/></Stack
								></label
							>
							<Cluster>
								<Button
									variant="ghost"
									size="sm"
									{disabled}
									onclick={() => editInstalment(index, null)}
									>{t('renderer.statutory_fact_status.remove_instalment')}</Button
								>
							</Cluster>
						</Grid>
					{/each}
					<Cluster
						><Button
							variant="outline"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									instalments: [
										...(current.instalments ?? []),
										{ amount: 0, from: '', to: '', reference: '' }
									]
								})}>{t('renderer.statutory_fact_status.add_instalment')}</Button
						></Cluster
					>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.opening')}</span>
					<p class="text-meta">{t('renderer.statutory_fact_status.opening_hint')}</p>
					{#each current.opening ?? [] as row, index (index)}
						<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.opening_year')}<Input
										value={row.year}
										placeholder="2026"
										{disabled}
										oninput={(event) =>
											editOpening(index, { year: event.currentTarget.value.trim() })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.opening_base')}<Input
										type="number"
										step="0.01"
										value={row.base}
										{disabled}
										oninput={(event) =>
											editOpening(index, { base: numberOr(event.currentTarget.value) })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.opening_employee')}<Input
										type="number"
										step="0.01"
										value={row.employee}
										{disabled}
										oninput={(event) =>
											editOpening(index, { employee: numberOr(event.currentTarget.value) })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.opening_employer')}<Input
										type="number"
										step="0.01"
										value={row.employer}
										{disabled}
										oninput={(event) =>
											editOpening(index, { employer: numberOr(event.currentTarget.value) })}
									/></Stack
								></label
							>
							<label class="text-sm">
								<Stack gap="xs">
									Prior-employer rebatable payments
									<Input
										type="number"
										min="0"
										step="0.01"
										value={row.rebate ?? 0}
										{disabled}
										oninput={(event) =>
											editOpening(index, { rebate: numberOr(event.currentTarget.value) })}
									/>
									<span class="text-meta">Tax-year total, such as zakat declared on TP3.</span>
								</Stack>
							</label>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.opening_months')}<Input
										type="number"
										min="0"
										step="1"
										value={row.months ?? ''}
										{disabled}
										oninput={(event) =>
											editOpening(index, {
												months:
													event.currentTarget.value.trim() === ''
														? null
														: Math.max(0, Math.trunc(numberOr(event.currentTarget.value)))
											})}
									/></Stack
								></label
							>
							<label class="text-sm">
								<Stack gap="xs">
									{t('renderer.statutory_fact_status.opening_payroll_periods')}
									<Input
										type="number"
										min="0"
										step="1"
										value={row.payroll_periods ?? ''}
										{disabled}
										oninput={(event) =>
											editOpening(index, {
												payroll_periods: nullableNumberFrom(event.currentTarget.value)
											})}
									/>
									<span class="text-meta"
										>{t('renderer.statutory_fact_status.opening_payroll_periods_help')}</span
									>
								</Stack>
							</label>
							<label class="text-sm">
								<Stack gap="xs">
									{t('renderer.statutory_fact_status.opening_payroll_frequency')}
									<Combobox
										value={row.payroll_frequency ?? ''}
										{disabled}
										options={[
											{ value: 'MONTHLY', label: 'Monthly' },
											{ value: 'SEMI_MONTHLY', label: 'Semi-monthly' },
											{ value: 'WEEKLY', label: 'Weekly' }
										]}
										onValueChange={(value) => {
											if (value === 'MONTHLY' || value === 'SEMI_MONTHLY' || value === 'WEEKLY')
												editOpening(index, { payroll_frequency: value });
										}}
									/>
								</Stack>
							</label>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.opening_reference')}<Input
										value={row.reference}
										placeholder="TP3 / 2316"
										{disabled}
										oninput={(event) =>
											editOpening(index, { reference: event.currentTarget.value })}
									/></Stack
								></label
							>
							<Cluster>
								<Button
									variant="ghost"
									size="sm"
									{disabled}
									onclick={() => editOpening(index, null)}
									>{t('renderer.statutory_fact_status.remove_opening')}</Button
								>
							</Cluster>
						</Grid>
					{/each}
					<Cluster
						><Button
							variant="outline"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									opening: [
										...(current.opening ?? []),
										{
											year: String(new Date().getFullYear()),
											base: 0,
											employee: 0,
											employer: 0,
											reference: ''
										}
									]
								})}>{t('renderer.statutory_fact_status.add_opening')}</Button
						></Cluster
					>
				</Stack>
			</Column>
			<Column span="all">
				<details>
					<summary class="cursor-pointer text-sm font-medium"
						>{t('renderer.statutory_deductions.title')}</summary
					>
					<DeductionClaims
						value={current.deduction_claims ?? []}
						elections={current.elections ?? {}}
						{disabled}
						onChange={(deduction_claims) => emit({ ...current, deduction_claims })}
						onElectionsChange={(elections) => emit({ ...current, elections })}
					/>
				</details>
			</Column>
		{:else if current?.kind === 'NOT_REGISTERED'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Reason
					<Input
						value={current.reason}
						{disabled}
						placeholder={t('component.why_out_of_scope')}
						oninput={(event) => emit({ kind: 'NOT_REGISTERED', reason: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{/if}
	</Grid>
{/if}
