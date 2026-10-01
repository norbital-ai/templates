<script lang="ts">
	import { bolt } from '$bolt';
	import {
		Button,
		Field,
		Form,
		Picker,
		RecordShell,
		Section,
		type FormState,
		type RecordView
	} from '@norbital-ai/ui';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { t } from '../../../lib/ui/t.js';
	import { decodeNumber } from '../../../lib/wire.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';
	import DeclaredFactsField from '../../../lib/ui/declared-facts-field.svelte';

	let { view }: { view: RecordView<'payment_events'> } = $props();
	/** Each entity's lineage, so the payment's inputs render the declarations that govern it. */
	const payers = liveRows<{ id: string; settings_code: string }>(() =>
		bolt.read('companies', { select: { settings_code: true }, all: true })
	);
	const payerCode = (companyId: unknown): string =>
		payers.current?.find((row) => row.id === String(companyId ?? ''))?.settings_code ?? '';
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
</script>

<RecordShell of="payment_events" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	{#if record}
		<Stack gap="md">
			<Section first name="payment" title={t('component.payment_event_record')}>
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
			</Section>
			<Section name="sources" title={t('component.payment_sources')}>
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
			</Section>
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
					<Section
						first
						name="payment"
						title={t('component.payment_event_record')}
						hint={t('component.payment_entry_hint')}
					>
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
							<Column span="all">
								<Field
									name="facts"
									label={t('component.payment_facts')}
									help={t('component.payment_facts_hint')}
								>
									{#snippet editor(field)}
										<DeclaredFactsField
											view={{
												mode: 'edit',
												name: field.name,
												value: field.value as never,
												disabled: field.disabled,
												onChange: field.onChange as never
											}}
											settingsCode={payerCode(form.get('company_id'))}
											schema="payment_facts"
											day={typeof form.get('paid_on') === 'string'
												? (form.get('paid_on') as string)
												: null}
										/>
									{/snippet}
								</Field>
							</Column>
						</Grid>
					</Section>
					<Section
						name="sources"
						title={t('component.payment_sources')}
						hint={t('component.payment_sources_hint')}
					>
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
					</Section>
				</Stack>
			{/snippet}
		</Form>
	{/if}
</RecordShell>
