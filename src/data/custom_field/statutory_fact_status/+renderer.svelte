<script lang="ts">
	import RowList from '../../../lib/ui/row-list.svelte';
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';

	import { nullableNumberFrom } from '../../../lib/ui/renderer-input.js';
	import { Button, Combobox, DateInput, Input, MonthInput } from '@norbital-ai/ui';
	import { Cluster, Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type {
		StatutoryFactInstalment as Instalment,
		StatutoryFactStatus as Value
	} from '../../../lib/datatypes/statutory_fact_status.js';
	import ElectionsEditor from '../entity_facts/+renderer.svelte';
	import DeductionClaims from './deduction-claims.svelte';
	import { live } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';

	type StatusKind = Value['kind'];

	const KIND_OPTIONS: { value: StatusKind; label: string; description: string }[] = $derived([
		{
			value: 'REGISTERED',
			label: t('statutory_status.registered'),
			description: t('statutory_status.registered_hint')
		},
		{
			value: 'NOT_REGISTERED',
			label: t('statutory_status.not_registered'),
			description: t('statutory_status.not_registered_hint')
		}
	]);

	let {
		view,
		...props
	}: { view: CustomFieldView<Value> } & {
		schemeId?: Id<'statutory_contributions'> | null;
		class?: string;
	} = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const scheme = live(() =>
		view.mode === 'edit' && props.schemeId != null
			? bolt.get('statutory_contributions', props.schemeId, {
					elections: true,
					deduction_categories: true,
					child_claims_hint: true
				})
			: null
	);
	// Preserve incomplete edits; the collection schema validates on submission.
	const current = $derived(view.value ?? null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'NOT_REGISTERED')
			return `${t('statutory_status.not_registered')} — ${current.reason}`;
		const override = current.rate_override == null ? '' : ` @ ${current.rate_override}`;
		return `${t('statutory_status.registered')} ${current.reference_number}${override}`;
	});

	function emit(next: Value | null): void {
		if (view.mode === 'edit') view.onChange(next);
	}

	type Opening = NonNullable<Extract<Value, { kind: 'REGISTERED' }>['opening']>[number];
	type ChildClaim = NonNullable<Extract<Value, { kind: 'REGISTERED' }>['child_claims']>[number];
	const CHILD_CLASSES = $derived([
		{ value: 'UNDER_18', label: t('statutory_status.child_under_18') },
		{ value: 'STUDYING', label: t('statutory_status.child_studying') },
		{ value: 'TERTIARY', label: t('statutory_status.child_tertiary') },
		{ value: 'DISABLED', label: t('statutory_status.child_disabled') },
		{ value: 'DISABLED_TERTIARY', label: t('statutory_status.child_disabled_tertiary') }
	]);
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
	type UnitAssessment = NonNullable<Registered['unit_assessments']>[number];
	function editUnit(index: number, change: Partial<UnitAssessment> | null): void {
		if (current?.kind !== 'REGISTERED') return;
		const rows = current.unit_assessments ?? [];
		emit({
			...current,
			unit_assessments:
				change === null
					? rows.filter((_, position) => position !== index)
					: rows.map((row, position) => (position === index ? { ...row, ...change } : row))
		});
	}

	const numberOr = (text: string, fallback = 0) =>
		text.trim() === '' ? fallback : decodeNumber(text) || fallback;

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

{#if view.mode === 'show'}
	<span class="block truncate {props.class ?? ''}" title={summary}>{summary}</span>
{:else}
	<Grid
		class="rounded-md border border-border bg-muted/20 p-3 {props.class ?? ''}"
		gap="sm"
		minimum="compact"
	>
		<Labelled label={t('statutory_status.status')} class="text-sm font-medium">
			<Combobox
				class="w-64 max-w-full"
				size="sm"
				options={KIND_OPTIONS}
				value={current?.kind ?? null}
				{disabled}
				placeholder={t('renderer.statutory_fact_status.select_status')}
				onChange={selectKind}
			/>
		</Labelled>
		{#if current?.kind === 'REGISTERED'}
			<Labelled label={t('statutory_status.reference_number')} class="text-sm font-medium">
				<Input
					value={current.reference_number}
					{disabled}
					placeholder={t('component.authority_reference')}
					oninput={(event) => emit({ ...current, reference_number: event.currentTarget.value })}
				/>
			</Labelled>
			<Labelled label={t('statutory_status.rate_override')} class="text-sm font-medium">
				<Input
					type="number"
					min="0"
					step="0.01"
					value={current.rate_override ?? ''}
					{disabled}
					oninput={(event) =>
						emit({ ...current, rate_override: nullableNumberFrom(event.currentTarget.value) })}
				/>
			</Labelled>
			<Labelled label={t('renderer.statutory_fact_status.since')} class="text-sm font-medium">
				<DateInput
					value={current.since ?? null}
					{disabled}
					onChange={(since) => emit({ ...current, since })}
				/>
			</Labelled>
			<Column span="all">
				<Stack gap="xs">
					<Labelled
						label={t('renderer.statutory_fact_status.first_contribution_due_on')}
						class="text-sm font-medium"
					>
						<DateInput
							value={current.first_contribution_due_on ?? null}
							{disabled}
							onChange={(first_contribution_due_on) =>
								emit({ ...current, first_contribution_due_on })}
						/>
					</Labelled>
					<p class="text-xs text-muted-foreground">
						{t('renderer.statutory_fact_status.first_contribution_due_help')}
					</p>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="xs">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.elections')}</span>
					<ElectionsEditor
						view={{
							mode: 'edit',
							name: `${view.name}.elections`,
							value: current.elections ?? {},
							disabled,
							onChange: (elections) => {
								// The value declares `elections` optional, never null: a cleared editor drops the key.
								const { elections: _prior, ...rest } = current;
								emit(elections === null ? rest : { ...rest, elections });
							}
						}}
						declarations={scheme.current?.elections ?? []}
					/>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">Child relief claims</span>
					<p class="text-xs text-muted-foreground">
						Record eligible claims from the employee’s declaration for each tax year. Family records
						do not grant tax relief. {scheme.current?.child_claims_hint ?? ''}
					</p>
					<RowList
						rows={current.child_claims ?? []}
						{disabled}
						addLabel="Add child claim"
						add={() =>
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
							})}
						removeLabel="Remove claim"
						remove={(index) => editChildClaim(index, null)}
					>
						{#snippet row(row, index)}
							<Labelled label={t('statutory_status.tax_year')}>
								<Input
									value={row.year}
									{disabled}
									inputmode="numeric"
									maxlength={4}
									oninput={(event) => editChildClaim(index, { year: event.currentTarget.value })}
								/>
							</Labelled>
							<Labelled label={t('statutory_status.relief_category')}>
								<Combobox
									class="w-64 max-w-full"
									size="sm"
									options={CHILD_CLASSES}
									value={row.relief_class}
									{disabled}
									onChange={(value) => {
										if (value) editChildClaim(index, { relief_class: value });
									}}
								/>
							</Labelled>
							<Labelled label={t('statutory_status.children_full')}>
								<Input
									type="number"
									min="0"
									step="1"
									value={row.full_count}
									{disabled}
									oninput={(event) =>
										editChildClaim(index, { full_count: numberOr(event.currentTarget.value) })}
								/>
							</Labelled>
							<Labelled label={t('statutory_status.children_half')}>
								<Input
									type="number"
									min="0"
									step="1"
									value={row.half_count}
									{disabled}
									oninput={(event) =>
										editChildClaim(index, { half_count: numberOr(event.currentTarget.value) })}
								/>
							</Labelled>
							<Labelled label={t('statutory_status.declaration_reference')}>
								<Input
									value={row.reference}
									{disabled}
									oninput={(event) =>
										editChildClaim(index, { reference: event.currentTarget.value })}
								/>
							</Labelled>
						{/snippet}
					</RowList>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.instalments')}</span>
					<RowList
						rows={current.instalments ?? []}
						{disabled}
						addLabel={t('renderer.statutory_fact_status.add_instalment')}
						add={() =>
							emit({
								...current,
								instalments: [
									...(current.instalments ?? []),
									{ amount: 0, from: '', to: '', reference: '' }
								]
							})}
						removeLabel={t('renderer.statutory_fact_status.remove_instalment')}
						remove={(index) => editInstalment(index, null)}
					>
						{#snippet row(row, index)}
							<Labelled label={t('renderer.statutory_fact_status.instalment_amount')}>
								<Input
									type="number"
									min="0"
									step="0.01"
									value={row.amount}
									{disabled}
									oninput={(event) =>
										editInstalment(index, { amount: Number(event.currentTarget.value) || 0 })}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.instalment_from')}>
								<MonthInput
									value={row.from || null}
									{disabled}
									onChange={(from) => editInstalment(index, { from: from ?? '' })}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.instalment_to')}>
								<MonthInput
									value={row.to || null}
									{disabled}
									onChange={(to) => editInstalment(index, { to: to ?? '' })}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.instalment_reference')}>
								<Input
									value={row.reference}
									{disabled}
									oninput={(event) =>
										editInstalment(index, { reference: event.currentTarget.value })}
								/>
							</Labelled>
						{/snippet}
					</RowList>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.opening')}</span>
					<p class="text-meta">{t('renderer.statutory_fact_status.opening_hint')}</p>
					<RowList
						rows={current.opening ?? []}
						{disabled}
						addLabel={t('renderer.statutory_fact_status.add_opening')}
						add={() =>
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
							})}
						removeLabel={t('renderer.statutory_fact_status.remove_opening')}
						remove={(index) => editOpening(index, null)}
					>
						{#snippet row(row, index)}
							<Labelled label={t('renderer.statutory_fact_status.opening_year')}>
								<Input
									value={row.year}
									placeholder="2026"
									{disabled}
									oninput={(event) =>
										editOpening(index, { year: event.currentTarget.value.trim() })}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_base')}>
								<Input
									type="number"
									step="0.01"
									value={row.base}
									{disabled}
									oninput={(event) =>
										editOpening(index, { base: numberOr(event.currentTarget.value) })}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_employee')}>
								<Input
									type="number"
									step="0.01"
									value={row.employee}
									{disabled}
									oninput={(event) =>
										editOpening(index, { employee: numberOr(event.currentTarget.value) })}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_employer')}>
								<Input
									type="number"
									step="0.01"
									value={row.employer}
									{disabled}
									oninput={(event) =>
										editOpening(index, { employer: numberOr(event.currentTarget.value) })}
								/>
							</Labelled>
							<Labelled label={t('statutory_status.prior_rebatable')}>
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
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_months')}>
								<Input
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
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_payroll_periods')}>
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
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_payroll_frequency')}>
								<Combobox
									class="w-64 max-w-full"
									size="sm"
									value={row.payroll_frequency ?? ''}
									{disabled}
									options={[
										{ value: 'MONTHLY', label: t('statutory_status.monthly') },
										{ value: 'SEMI_MONTHLY', label: t('statutory_status.semi_monthly') },
										{ value: 'WEEKLY', label: t('statutory_status.weekly') }
									]}
									onChange={(value) => {
										if (value === 'MONTHLY' || value === 'SEMI_MONTHLY' || value === 'WEEKLY')
											editOpening(index, { payroll_frequency: value });
									}}
								/>
							</Labelled>
							<Labelled label={t('renderer.statutory_fact_status.opening_reference')}>
								<Input
									value={row.reference}
									placeholder="TP3 / 2316"
									{disabled}
									oninput={(event) => editOpening(index, { reference: event.currentTarget.value })}
								/>
							</Labelled>
						{/snippet}
					</RowList>
				</Stack>
			</Column>
			<Column span="all">
				<details>
					<summary class="cursor-pointer text-sm font-medium"
						>{t('renderer.statutory_deductions.title')}</summary
					>
					<DeductionClaims
						value={current.deduction_claims ?? []}
						declared={scheme.current?.deduction_categories ?? []}
						elections={current.elections ?? {}}
						{disabled}
						onChange={(deduction_claims) => emit({ ...current, deduction_claims })}
						onElectionsChange={(elections) => emit({ ...current, elections })}
					/>
				</details>
			</Column>

			<Column span="all">
				<details>
					<summary class="cursor-pointer text-sm font-medium"
						>{t('renderer.unit_assessments.title')}</summary
					>
					<Stack gap="sm">
						<p class="text-sm text-muted-foreground">
							{t('renderer.unit_assessments.description')}
						</p>
						{#each current.unit_assessments ?? [] as row, index (index)}
							<Cluster gap="sm">
								<label
									>{t('renderer.unit_assessments.period')}<Input
										value={row.period}
										{disabled}
										placeholder="YYYY-MM"
										oninput={(event) => editUnit(index, { period: event.currentTarget.value })}
									/></label
								>
								<label
									>{t('renderer.unit_assessments.gross')}<Input
										type="number"
										min="0"
										value={row.gross}
										{disabled}
										oninput={(event) =>
											editUnit(index, { gross: Number(event.currentTarget.value) })}
									/></label
								>
								<label
									>{t('renderer.unit_assessments.units')}<Input
										type="number"
										min="1"
										step="1"
										value={row.units}
										{disabled}
										oninput={(event) =>
											editUnit(index, { units: Number(event.currentTarget.value) })}
									/></label
								>
								<label
									>{t('renderer.unit_assessments.reference')}<Input
										value={row.reference}
										{disabled}
										oninput={(event) => editUnit(index, { reference: event.currentTarget.value })}
									/></label
								>
								<Labelled label={t('renderer.unit_assessments.paid_on')}>
									<DateInput
										value={row.paid_on ?? null}
										{disabled}
										onChange={(paid_on) => editUnit(index, { paid_on })}
									/>
								</Labelled>
								<label>
									<input
										type="checkbox"
										checked={row.withhold_below_threshold_requested === true}
										{disabled}
										onchange={(event) =>
											editUnit(index, {
												withhold_below_threshold_requested: event.currentTarget.checked
											})}
									/>
									{t('renderer.unit_assessments.withhold_below_threshold_requested')}
								</label>
								<Button {disabled} onclick={() => editUnit(index, null)}
									>{t('renderer.unit_assessments.remove')}</Button
								>
							</Cluster>
						{/each}
						<Button
							{disabled}
							onclick={() =>
								current?.kind === 'REGISTERED' &&
								emit({
									...current,
									unit_assessments: [
										...(current.unit_assessments ?? []),
										{ period: '', gross: 0, units: 1, reference: '', paid_on: null }
									]
								})}>{t('renderer.unit_assessments.add')}</Button
						>
					</Stack>
				</details>
			</Column>
		{:else if current?.kind === 'NOT_REGISTERED'}
			<Labelled label={t('statutory_status.reason')} class="text-sm font-medium">
				<Input
					value={current.reason}
					{disabled}
					placeholder={t('component.why_out_of_scope')}
					oninput={(event) => emit({ ...current, reason: event.currentTarget.value })}
				/>
			</Labelled>
			<Labelled label={t('statutory_status.declaration_reference')} class="text-sm font-medium">
				<Input
					value={current.declaration_reference ?? ''}
					{disabled}
					placeholder={t('component.authority_reference')}
					oninput={(event) =>
						emit({ ...current, declaration_reference: event.currentTarget.value })}
				/>
			</Labelled>
			<Column span="all">
				<Stack gap="xs">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.elections')}</span>
					<ElectionsEditor
						view={{
							mode: 'edit',
							name: `${view.name}.elections`,
							value: current.elections ?? {},
							disabled,
							onChange: (elections) => {
								const { elections: _prior, ...rest } = current;
								emit(elections === null ? rest : { ...rest, elections });
							}
						}}
						declarations={scheme.current?.elections ?? []}
					/>
				</Stack>
			</Column>
		{/if}
	</Grid>
{/if}
