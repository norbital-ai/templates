<script lang="ts">
	/** The wage-history record a payslip priced statutory rates with: frozen, shown as stored. */
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'payslip_wage_periods'> } = $props();
</script>

<RecordShell
	of="payslip_wage_periods"
	{...view.mode === 'update' ? { id: view.record.id } : {}}
	sections={[
		{
			name: 'capture',
			title: bolt.t('component.wage_period_capture'),
			fields: ['payslip_id', 'wage_period_id', 'title']
		}
	]}
	subtitle={bolt.t('component.wage_period_capture')}
/>
