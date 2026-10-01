<script lang="ts">
	/** An account: who it is and its credit stay open (quoting reads them); phone, website and address fold away. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'accounts'> } = $props();
	const t = bolt.t;
	const sections: RecordSection[] = [
		{
			name: 'account',
			title: t('models.accounts.singular'),
			fields: ['name', 'external_code', 'industry', 'active']
		},
		{
			name: 'credit',
			title: t('section.credit'),
			fields: ['currency', 'credit_limit', 'credit_used', 'credit_hold']
		},
		{
			name: 'contact_details',
			title: t('section.contact_details'),
			fields: ['phone', 'website', 'address'],
			defaultOpen: false,
			summary: (r) =>
				[r.phone, r.website]
					.map((v) => String(v ?? ''))
					.filter(Boolean)
					.join(' · ') || t('section.not_set')
		}
	];
</script>

{#if view.mode === 'update'}
	<RecordShell of="accounts" id={view.record.id} {sections} />
{:else}
	<RecordShell of="accounts" mode="create" values={view.values} {sections} />
{/if}
