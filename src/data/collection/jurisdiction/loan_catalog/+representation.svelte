<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'loan_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="loan_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{ name: 'identity', title: t('section.identity'), fields: ['code', 'name'] },
		{
			name: 'rules',
			title: t('section.rules'),
			fields: [
				'eligibility',
				'evidence',
				'loan_type',
				'minimum_repayment',
				'approval_reference_required',
				'order_recovery_rule',
				'order_payment_when',
				'order_authority'
			]
		},
		{
			name: 'settlement',
			title: t('section.settlement'),
			fields: ['destination', 'direction', 'bands']
		}
	]}
/>
