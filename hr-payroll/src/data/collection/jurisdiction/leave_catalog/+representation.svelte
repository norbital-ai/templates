<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'leave_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="leave_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{ name: 'identity', title: t('section.identity'), fields: ['code', 'name', 'description'] },
		{ name: 'entitlement', title: t('section.entitlement'), fields: ['entitlement'] },
		{
			name: 'rules',
			title: t('section.rules'),
			fields: [
				'eligibility',
				'evidence',
				'unit',
				'schedule',
				'preceding_leave_same_event',
				'preceding_leave_contiguous',
				'requires_no_pay_origin',
				'pay_fraction',
				'paid_by',
				'evidence_after_days',
				'consumes_code'
			]
		},
		{ name: 'cash', title: t('section.cash'), fields: ['can_encash', 'encash_on_exit', 'is_npl'] },
		{ name: 'authority', title: t('section.authority'), fields: ['authority'] }
	]}
/>
