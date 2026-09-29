<script lang="ts">
	import { bolt } from '$bolt';
	import {
		Button,
		Field,
		Form,
		Picker,
		RecordShell,
		type FormState,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { t } from '../../../lib/ui/t.js';
	import { decodeNumber } from '../../../lib/wire.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'payment_events'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const allocations = liveRows(() =>
		record == null
			? null
			: bolt.read('payment_allocations', {
					where: { payment_event_id: { eq: record.id } },
					select: {
						payable_tranche_id: {
							select: { reference: true, source_category: true, due_on: true }
						},
						gross_amount: true,
						non_event_deduction_amount: true,
						currency: true
					},
					all: true
				})
	);
	type Draft = {
		id: string;
		payable_tranche_id: string;
		gross_amount: string;
		non_event_deduction_amount: string;
	};
	let drafts = $state<Draft[]>([
		{
			id: crypto.randomUUID(),
			payable_tranche_id: '',
			gross_amount: '',
			non_event_deduction_amount: '0'
		}
	]);
	let vnFacts = $state(false);
	let vnRequest = $state(false);
	let vnRequestOn = $state('');
	let vnRequestRef = $state('');
	let vnCommitment = $state('');
	let vnCommitmentOn = $state('');
	let vnCommitmentYear = $state('');
	let vnCommitmentTaxId = $state('');
	let vnSoleIncome = $state(false);
	let vnBelowThreshold = $state(false);

	function syncAllocations(form: FormState): void {
		form.set('payment_allocations', {
			create: drafts
				.filter((row) => row.payable_tranche_id !== '' && row.gross_amount !== '')
				.map((row) => ({
					payable_tranche_id: row.payable_tranche_id,
					gross_amount: decodeNumber(row.gross_amount),
					non_event_deduction_amount: decodeNumber(row.non_event_deduction_amount || 0)
				}))
		});
	}
	function changeDraft(
		id: string,
		field: keyof Omit<Draft, 'id'>,
		value: string,
		form: FormState
	): void {
		drafts = drafts.map((row) => (row.id === id ? { ...row, [field]: value } : row));
		syncAllocations(form);
	}
	function syncVn(form: FormState): void {
		form.set('vn_payment_tax_facts', {
			create: vnFacts
				? [
						{
							withhold_below_threshold_requested: vnRequest,
							...(vnRequestOn === '' ? {} : { request_received_on: vnRequestOn }),
							...(vnRequestRef === '' ? {} : { request_reference: vnRequestRef }),
							...(vnCommitment === '' ? {} : { commitment_form_reference: vnCommitment }),
							...(vnCommitmentOn === '' ? {} : { commitment_received_on: vnCommitmentOn }),
							...(vnCommitmentYear === ''
								? {}
								: { commitment_tax_year: decodeNumber(vnCommitmentYear) }),
							...(vnCommitmentTaxId === '' ? {} : { commitment_tax_id: vnCommitmentTaxId }),
							...(vnCommitment === ''
								? {}
								: {
										commitment_sole_income_declared: vnSoleIncome,
										commitment_below_taxable_threshold_declared: vnBelowThreshold
									})
						}
					]
				: []
		});
	}
</script>

<RecordShell of="payment_events" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	{#if record}
		<Stack gap="md">
			<h2 class="text-heading">{t('component.payment_event_record')}</h2>
			<Grid as="dl" gap="sm" minimum="compact">
				<Stack gap="xs"
					><dt class="text-meta">{t('component.reference')}</dt>
					<dd>{record.reference}</dd></Stack
				>
				<Stack gap="xs"
					><dt class="text-meta">{t('component.paid')}</dt>
					<dd>{formatCalendarDate(record.paid_on)}</dd></Stack
				>
				<Stack gap="xs"
					><dt class="text-meta">{t('component.payment_gross_allocated')}</dt>
					<dd>{formatNumeric(record.gross_amount)} {record.currency}</dd></Stack
				>
				<Stack gap="xs"
					><dt class="text-meta">{t('component.payment_cash')}</dt>
					<dd>{formatNumeric(record.cash_amount)} {record.currency}</dd></Stack
				>
			</Grid>
			<h3 class="text-subhead">{t('component.payment_sources')}</h3>
			{#each allocations.current ?? [] as allocation (allocation.id)}
				<Inline justify="between" class="border-b border-border py-2 text-sm">
					<span
						>{allocation.payable_tranche_id.reference} · {allocation.payable_tranche_id
							.source_category} · {formatCalendarDate(allocation.payable_tranche_id.due_on)}</span
					>
					<span class="tabular-nums"
						>{formatNumeric(allocation.gross_amount)} {allocation.currency}</span
					>
				</Inline>
			{/each}
		</Stack>
	{:else}
		<Form
			of="payment_events"
			mode="create"
			values={createValues(view)}
			submit={t('component.payment_record')}
			onOutcome={openCreated(view)}
		>
			{#snippet children(form)}
				<Stack gap="lg">
					<p class="text-meta">{t('component.payment_entry_hint')}</p>
					<Grid gap="sm" minimum="compact">
						<Field name="company_id" label={t('component.legal_entity')} />
						<Field name="employee_id" label={t('component.person')} />
						<Field name="paid_on" label={t('component.pay_date')} />
						<Field name="reference" label={t('component.reference')} />
						<Field name="currency" label={t('component.currency')} />
						<Field name="cash_amount" label={t('component.payment_cash')} />
						<Field name="kind" label={t('component.payment_kind')} />
						{#if form.get('kind') === 'NON_CASH_SETTLEMENT'}
							<Field
								name="non_cash_basis_reference"
								label={t('component.payment_non_cash_basis')}
							/>
						{/if}
						<Field name="external_source_kind" label={t('component.payment_external_kind')} />
						<Field name="external_source_id" label={t('component.payment_external_id')} />
					</Grid>
					<Stack gap="sm">
						<h3 class="text-subhead">{t('component.payment_sources')}</h3>
						<p class="text-meta">{t('component.payment_sources_hint')}</p>
						{#each drafts as draft (draft.id)}
							<Grid gap="sm" minimum="compact">
								<Stack gap="xs">
									<span class="text-meta">{t('component.payment_source')}</span>
									<Picker
										of="payable_tranches"
										label={['reference', 'source_category']}
										value={draft.payable_tranche_id || null}
										onChange={(value) =>
											changeDraft(draft.id, 'payable_tranche_id', value ?? '', form)}
									/>
								</Stack>
								<Stack gap="xs">
									<label class="text-meta" for={`payment-gross-${draft.id}`}
										>{t('component.payment_gross_portion')}</label
									>
									<input
										id={`payment-gross-${draft.id}`}
										class="w-full rounded border border-border bg-background px-2 py-1"
										type="number"
										min="0"
										step="any"
										value={draft.gross_amount}
										oninput={(event) =>
											changeDraft(draft.id, 'gross_amount', event.currentTarget.value, form)}
									/>
								</Stack>
								<Stack gap="xs">
									<label class="text-meta" for={`payment-deduction-${draft.id}`}
										>{t('component.payment_priced_deduction')}</label
									>
									<input
										id={`payment-deduction-${draft.id}`}
										class="w-full rounded border border-border bg-background px-2 py-1"
										type="number"
										min="0"
										step="any"
										value={draft.non_event_deduction_amount}
										oninput={(event) =>
											changeDraft(
												draft.id,
												'non_event_deduction_amount',
												event.currentTarget.value,
												form
											)}
									/>
								</Stack>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onclick={() => {
										drafts = drafts.filter((row) => row.id !== draft.id);
										syncAllocations(form);
									}}>{t('component.payment_remove_source')}</Button
								>
							</Grid>
						{/each}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onclick={() => {
								drafts = [
									...drafts,
									{
										id: crypto.randomUUID(),
										payable_tranche_id: '',
										gross_amount: '',
										non_event_deduction_amount: '0'
									}
								];
								syncAllocations(form);
							}}>{t('component.payment_add_source')}</Button
						>
					</Stack>
					<Stack gap="sm">
						<label class="text-sm"
							><input
								type="checkbox"
								checked={vnFacts}
								onchange={(event) => {
									vnFacts = event.currentTarget.checked;
									syncVn(form);
								}}
							/>
							{t('component.payment_vn_facts')}</label
						>
						{#if vnFacts}
							<label class="text-sm"
								><input
									type="checkbox"
									checked={vnRequest}
									onchange={(event) => {
										vnRequest = event.currentTarget.checked;
										syncVn(form);
									}}
								/>
								{t('component.payment_vn_request')}</label
							>
							{#if vnRequest}
								<input
									class="rounded border border-border bg-background px-2 py-1"
									aria-label={t('component.payment_vn_request_on')}
									type="date"
									value={vnRequestOn}
									oninput={(event) => {
										vnRequestOn = event.currentTarget.value;
										syncVn(form);
									}}
								/>
								<input
									class="rounded border border-border bg-background px-2 py-1"
									aria-label={t('component.payment_vn_request_ref')}
									placeholder={t('component.payment_vn_request_ref')}
									value={vnRequestRef}
									oninput={(event) => {
										vnRequestRef = event.currentTarget.value;
										syncVn(form);
									}}
								/>
							{/if}
							<input
								class="rounded border border-border bg-background px-2 py-1"
								aria-label={t('component.payment_vn_commitment')}
								placeholder={t('component.payment_vn_commitment')}
								value={vnCommitment}
								oninput={(event) => {
									vnCommitment = event.currentTarget.value;
									syncVn(form);
								}}
							/>
							{#if vnCommitment !== ''}
								<input
									class="rounded border border-border bg-background px-2 py-1"
									aria-label={t('component.payment_vn_commitment_on')}
									type="date"
									value={vnCommitmentOn}
									oninput={(event) => {
										vnCommitmentOn = event.currentTarget.value;
										syncVn(form);
									}}
								/>
								<input
									class="rounded border border-border bg-background px-2 py-1"
									aria-label={t('component.payment_vn_commitment_year')}
									type="number"
									min="2000"
									step="1"
									value={vnCommitmentYear}
									oninput={(event) => {
										vnCommitmentYear = event.currentTarget.value;
										syncVn(form);
									}}
								/>
								<input
									class="rounded border border-border bg-background px-2 py-1"
									aria-label={t('component.payment_vn_commitment_tax_id')}
									placeholder={t('component.payment_vn_commitment_tax_id')}
									value={vnCommitmentTaxId}
									oninput={(event) => {
										vnCommitmentTaxId = event.currentTarget.value;
										syncVn(form);
									}}
								/>
								<label class="text-sm"
									><input
										type="checkbox"
										checked={vnSoleIncome}
										onchange={(event) => {
											vnSoleIncome = event.currentTarget.checked;
											syncVn(form);
										}}
									/>
									{t('component.payment_vn_sole_income')}</label
								>
								<label class="text-sm"
									><input
										type="checkbox"
										checked={vnBelowThreshold}
										onchange={(event) => {
											vnBelowThreshold = event.currentTarget.checked;
											syncVn(form);
										}}
									/>
									{t('component.payment_vn_below_threshold')}</label
								>
							{/if}
						{/if}
					</Stack>
				</Stack>
			{/snippet}
		</Form>
	{/if}
</RecordShell>
