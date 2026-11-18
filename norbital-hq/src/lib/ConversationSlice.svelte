<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Field,
		Form,
		Picker,
		ReadonlyMarkdown,
		Sheet,
		format,
		open_record
	} from '@norbital-ai/ui';
	import { Inline } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import type { TimelineItem } from './activity-timeline.js';
	let { ctx, messages }: { ctx: PageContext; messages: readonly TimelineItem[] } = $props();
	let visible = $state(20);
	/** The message whose job is being reassigned through `activities_file` (filed manually, kept by the classifier). */
	let reassigning = $state<string | null>(null);
	/** The customer picked in that form, once changed from the message's own: it narrows the job and contact pickers. */
	let chosen = $state<Id<'companies'> | null | undefined>(undefined);
	const t = ctx.t;
</script>

<ol class="conversation">
	{#each messages.slice(0, visible) as message (message.id)}
		<li>
			<Inline align="center" gap="sm">
				<span>{message.handle ?? message.subject}</span>
				{#if message.direction}<span
						>{t(message.direction === 'outbound' ? 'timeline.outgoing' : 'timeline.incoming')}</span
					>{/if}
				<time datetime={message.occurred_at}
					>{format({ kind: 'instant' }, message.occurred_at, { locale: ctx.locale })}</time
				>
				<Button variant="ghost" onclick={() => open_record('activities', message.id)}
					>{t('timeline.message_details')}</Button
				>
				<Button
					variant="ghost"
					onclick={() => {
						reassigning = reassigning === message.id ? null : message.id;
						chosen = undefined;
					}}>{t('timeline.reassign')}</Button
				>
			</Inline>
			{#await ctx.query( { activities: { where: { id: { eq: message.id } }, fields: ['detail', 'company', 'contact_id', 'project_id'], limit: 1 } } )}
				<p>{t('timeline.loading')}</p>
			{:then { activities: { rows: [record] } }}
				{#if record !== undefined && reassigning === message.id}
					<!-- reassigning is its own view: a sheet with its one Submit, never a form woven into the list -->
					<Sheet
						open
						on_open_change={(open) => !open && (reassigning = null)}
						title={t('timeline.reassign')}
						><Form
							{ctx}
							of={{ automation: 'activities_file' }}
							values={{
								activities: [message.id],
								...(record.company == null ? {} : { company: record.company }),
								...(record.project_id == null ? {} : { project: record.project_id }),
								...(record.contact_id == null ? {} : { contact: record.contact_id })
							}}
							on_outcome={(outcome) => outcome.kind === 'committed' && (reassigning = null)}
						>
							{#snippet children(form)}
								{@const company = chosen === undefined ? record.company : chosen}
								{@const narrowed =
									company === null ? {} : { where: { company_id: { eq: company } } }}
								<Field {ctx} name="company">
									{#snippet editor(field)}
										<Picker
											{ctx}
											of="companies"
											id={field.id}
											value={company}
											on_change={(next) => {
												chosen = next;
												field.on_change(next);
												// the job and contact belong to the customer: a new customer clears them
												form.set('project', null);
												form.set('contact', null);
											}}
											disabled={field.disabled}
										/>
									{/snippet}
								</Field>
								<Field {ctx} name="project">
									{#snippet editor(field)}
										<Picker
											{ctx}
											of="projects"
											id={field.id}
											value={typeof field.value === 'string' ? field.value : null}
											on_change={field.on_change}
											{...narrowed}
											disabled={field.disabled || company === null}
										/>
									{/snippet}
								</Field>
								<Field {ctx} name="contact">
									{#snippet editor(field)}
										<Picker
											{ctx}
											of="contacts"
											id={field.id}
											value={typeof field.value === 'string' ? field.value : null}
											on_change={field.on_change}
											{...narrowed}
											disabled={field.disabled || company === null}
										/>
									{/snippet}
								</Field>
							{/snippet}
						</Form></Sheet
					>
				{/if}
				<ReadonlyMarkdown value={record?.detail ?? ''} />
			{:catch}
				<p role="alert">{t('timeline.message_failed')}</p>
			{/await}
		</li>
	{/each}
</ol>
{#if visible < messages.length}<Button variant="outline" onclick={() => (visible += 20)}
		>{t('timeline.more_messages')}</Button
	>{/if}

<style>
	.conversation {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		padding: 12px 0;
		border-top: 1px solid var(--color-border);
	}
	li :global([data-markdown]) {
		font-size: 14px;
		line-height: 1.6;
	}
</style>
