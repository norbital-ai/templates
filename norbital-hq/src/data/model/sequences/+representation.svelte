<script lang="ts">
	/**
	 * A sequence: its name and steps (the native list editor: day offset, channel, subject, body), and a preview of
	 * every step rendered for a chosen PIC with the same helpers Apollo's copy is made with: their first name, company,
	 * the company's kept potential projects as bullets and the sender from Settings.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import { Combobox, EmptyState, ReadonlyMarkdown, RecordShell } from '@norbital-ai/ui';
	import { Scroll, Stack } from '@norbital-ai/ui/layout';
	import { bullets, leadValues, renderSteps, VARIABLES } from '../../../lib/outreach.js';
	let { view, ctx }: { view: RecordView<'sequences'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	let search = $state('');
	let chosen = $state<Id<'contacts'> | null>(null);
	const found = $derived(
		ctx.query({
			contacts: {
				output: 'crm',
				where: search.trim() === '' ? {} : { full_name: { like: `%${search.trim()}%` } },
				fields: ['full_name'],
				order_by: { full_name: 'asc' },
				limit: 20,
				company_id: { fields: ['name'] }
			}
		})
	);
	const options = $derived(
		(found.current?.contacts.rows ?? []).map((row) => ({
			value: row.id,
			label: row.full_name,
			...(row.company_id ? { description: row.company_id.name } : {})
		}))
	);
	const lead = $derived(
		chosen === null
			? null
			: ctx.query({
					contacts: {
						output: 'crm',
						where: { id: { eq: chosen } },
						fields: ['full_name', 'company_id'],
						limit: 1,
						company_id: { fields: ['name'] }
					},
					outreach_settings: { fields: ['sender_name'], limit: 1 }
				})
	);
	const contact = $derived(lead?.current?.contacts.rows[0]);
	const company = $derived(contact?.company_id ?? null);
	const kept = $derived(
		company === null
			? null
			: ctx.query({
					potential_projects: {
						where: { company: { eq: company.id }, status: { eq: 'kept' } },
						fields: ['summary', 'rank', 'status']
					}
				})
	);
	const steps = $derived(
		record === null || contact === undefined
			? []
			: renderSteps(
					record.steps,
					leadValues({
						full_name: contact.full_name,
						company: company?.name ?? '',
						projects: bullets(kept?.current?.potential_projects.rows ?? []),
						sender_name: lead?.current?.outreach_settings.rows[0]?.sender_name ?? null
					})
				)
	);
</script>

{#snippet preview()}
	<Scroll name={t('sequences.preview')} size="fill" inset>
		<Stack gap="md" class="py-3">
			<p class="text-sm text-muted-foreground">
				{t('sequences.preview_help', {
					variables: VARIABLES.map((name) => `{{${name}}}`).join(' ')
				})}
			</p>
			<Combobox
				{options}
				value={chosen}
				on_change={(next) => (chosen = next)}
				on_search={(query) => (search = query)}
				loading={found.loading}
				placeholder={t('sequences.choose_contact')}
				clearable
			/>
			{#if contact === undefined}
				<EmptyState title={t('sequences.preview_empty')} />
			{:else}
				{#each steps as step, index (index)}
					<Stack gap="xs">
						<strong
							>{t(step.channel === 'call' ? 'sequences.step_call' : 'sequences.step_email', {
								day: step.day_offset
							})}</strong
						>
						{#if step.subject}<p class="text-sm font-medium">{step.subject}</p>{/if}
						<ReadonlyMarkdown value={step.body} />
					</Stack>
				{/each}
			{/if}
		</Stack>
	</Scroll>
{/snippet}
{#if record === null}
	<RecordShell
		{ctx}
		of="sequences"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		fields={['name', 'steps']}
	/>
{:else}
	<RecordShell
		{ctx}
		of="sequences"
		id={record.id}
		fields={['name', 'steps']}
		tabs={[{ name: 'preview', title: t('sequences.preview'), icon: 'lucide:eye', body: preview }]}
	/>
{/if}
