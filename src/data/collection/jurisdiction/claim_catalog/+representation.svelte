<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'claim_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="claim_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{ name: 'identity', title: t('section.identity'), fields: ['code', 'name'] },
		{ name: 'authority', title: t('section.authority'), fields: ['authority'] },
		{
			name: 'rules',
			title: t('section.rules'),
			fields: [
				'eligibility',
				'qualifies_when',
				'evidence',
				'leave_code',
				'unit_cap',
				'claim_window_months',
				'employer_premium_scheme',
				'minimum_service_months'
			]
		},
		{
			name: 'settlement',
			title: t('section.settlement'),
			fields: ['destination', 'direction', 'bands', 'counts_toward']
		}
	]}
/>
