<script lang="ts">
	/**
	 * A contact: their details and one chronological Activities tab. A voice profile (saved
	 * from meetings, `MeetingVoices`) is never shown; the header says it exists and removes it.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { Button, RecordShell, use_act } from '@norbital-ai/ui';
	import ActivityTimeline from '../../../../lib/ActivityTimeline.svelte';

	let { view, ctx }: { view: RecordView<'contacts'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const sections: RecordSection[] = [
		{
			name: 'contact',
			icon: 'lucide:contact',
			title: t('models.contacts.singular'),
			fields: [
				'full_name',
				'company_id',
				'job_title',
				'email',
				'phone',
				'telegram',
				'is_primary',
				'company_signatory',
				'notes'
			]
		},
		{
			name: 'research',
			icon: 'lucide:sparkles',
			title: t('lead.research'),
			fields: ['seniority', 'angle'],
			default_open: false
		},
		{
			name: 'matching',
			icon: 'lucide:search-check',
			title: t('section.matching'),
			hint: t('section.matching_hint'),
			fields: ['email_key', 'phone_key', 'telegram_key'],
			default_open: false,
			summary: (r) =>
				[r.email_key, r.phone_key, r.telegram_key]
					.map((v) => String(v ?? ''))
					.filter(Boolean)
					.join(' · ') || t('summary.not_set')
		}
	];
	const act = use_act(ctx);
	const removeVoice = (contact: Pick<NonNullable<typeof record>, 'id' | 'revision'>) =>
		act.run(
			ctx.act({
				'contacts.update': [
					{
						target: { id: contact.id, revision: contact.revision },
						set: {
							voice_embedding: null,
							voice_consent_at: null,
							voice_enrolled_at: null,
							voice_last_match_at: null,
							voice_samples: 0
						}
					}
				]
			})
		);
</script>

{#snippet voice()}
	{#if record !== null && record.voice_samples > 0}
		<span class="text-meta">{t('voice.profile_samples', { count: record.voice_samples })}</span>
		<Button variant="outline" disabled={act.pending} onclick={() => removeVoice(record)}
			>{t('voice.remove')}</Button
		>
	{/if}
{/snippet}

{#snippet activities()}
	{#if record}<ActivityTimeline
			{ctx}
			contact={record.id}
			{...record.company_id ? { company: record.company_id } : {}}
		/>{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="contacts"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell
		{ctx}
		of="contacts"
		id={record.id}
		subtitle={['job_title', 'email']}
		fields={[
			'full_name',
			'company_id',
			'job_title',
			'email',
			'phone',
			'telegram',
			'is_primary',
			'company_signatory',
			'notes',
			'seniority',
			'angle',
			'email_key',
			'phone_key',
			'telegram_key'
		]}
		{sections}
		actions={voice}
		tabs={[
			{
				name: 'activities',
				title: t('crm.section.activities'),
				icon: 'lucide:activity',
				body: activities
			}
		]}
	/>
{/if}
