<script lang="ts">
	/** A supplier: who it is and its buying terms stay open; the contact person, phone, email and address fold away. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'suppliers'> } = $props();
	const t = bolt.t;
	const sections: RecordSection[] = [
		{
			name: 'supplier',
			title: t('models.suppliers.singular'),
			fields: [
				'name',
				'code',
				'external_code',
				'category',
				'currency',
				'payment_terms_days',
				'active'
			]
		},
		{
			name: 'contact_details',
			title: t('section.contact_details'),
			fields: ['contact', 'phone', 'email', 'address'],
			defaultOpen: false,
			summary: (r) =>
				[r.contact, r.phone, r.email]
					.map((v) => String(v ?? ''))
					.filter(Boolean)
					.join(' · ') || t('section.not_set')
		}
	];
</script>

{#if view.mode === 'update'}
	<RecordShell of="suppliers" id={view.record.id} {sections} />
{:else}
	<RecordShell of="suppliers" mode="create" values={view.values} {sections} />
{/if}
