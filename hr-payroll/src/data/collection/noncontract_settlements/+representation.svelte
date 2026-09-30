<script lang="ts">
	/** A non-contract obligation: recorded once, its inputs rendered with the declarations of the payer's lineage. */
	import { bolt } from '$bolt';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { t } from '../../../lib/ui/t.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';
	import DeclaredFactsField from '../../../lib/ui/declared-facts-field.svelte';

	let { view }: { view: RecordView<'noncontract_settlements'> } = $props();
	const payers = liveRows<{ id: string; settings_code: string }>(() =>
		bolt.read('companies', { select: { settings_code: true }, all: true })
	);
	const payerCode = (companyId: unknown): string =>
		payers.current?.find((row) => row.id === String(companyId ?? ''))?.settings_code ?? '';
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell
	of="noncontract_settlements"
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
>
	{#if record}
		<Grid as="dl" gap="sm" minimum="compact">
			<Stack gap="xs"
				><dt class="text-meta">{t('component.reference')}</dt>
				<dd>{record.reference}</dd></Stack
			>
			<Stack gap="xs"
				><dt class="text-meta">{t('component.pay_date')}</dt>
				<dd>{formatCalendarDate(record.agreed_due_on)}</dd></Stack
			>
			<Stack gap="xs"
				><dt class="text-meta">{t('component.payment_gross_allocated')}</dt>
				<dd>{formatNumeric(record.agreed_gross)} {record.currency}</dd></Stack
			>
		</Grid>
	{:else}
		<Form
			of="noncontract_settlements"
			mode="create"
			values={createValues(view)}
			submit={t('component.noncontract_settlement_record')}
			onOutcome={openCreated(view)}
		>
			{#snippet children(form)}
				<Grid gap="sm" minimum="compact">
					<Field name="company_id" label={t('component.legal_entity')} />
					<Field name="employee_id" label={t('component.person')} />
					<Field name="reference" label={t('component.reference')} />
					<Field name="currency" label={t('component.currency')} />
					<Field name="agreed_gross" />
					<Field name="agreed_due_on" />
					<Field name="tax_residency" />
					<Field name="tax_residency_range" />
					<Column span="all">
						<Field
							name="facts"
							label={t('component.settlement_facts')}
							help={t('component.settlement_facts_hint')}
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
									schema="settlement_facts"
									day={typeof form.get('agreed_due_on') === 'string'
										? (form.get('agreed_due_on') as string)
										: null}
								/>
							{/snippet}
						</Field>
					</Column>
				</Grid>
			{/snippet}
		</Form>
	{/if}
</RecordShell>
