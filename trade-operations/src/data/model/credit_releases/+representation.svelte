<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Combobox,
		Input,
		Label,
		Textarea,
		format,
		use_act,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import { isAdvanceSettlement } from '../../../lib/credit-release.js';
	import RecordForm from '../../../lib/ui/record-form.svelte';

	let {
		view,
		ctx
	}: {
		view: RecordView<'credit_releases'>;
		ctx: PageContext;
	} = $props();

	const commercial = $derived(ctx.catalog?.credit_releases?.output === undefined);
	const canRequest = $derived(
		view.mode !== 'create' &&
			view.record.source_status === 'blocked' &&
			view.record.approval_status === 'none' &&
			!view.record.$approval &&
			Boolean(ctx.catalog?.credit_releases?.update)
	);
	const save = use_act(ctx);

	let route = $state<'one_time' | 'permanent'>('one_time');
	let proposedLimit = $state('');
	let reason = $state('');

	function submitRelease() {
		if (view.mode === 'create' || !canRequest || save.pending) return;
		save.run(
			ctx.act({
				'credit_releases.update': [
					{
						target: { id: view.record.id, revision: view.record.revision },
						set: {
							approval_status: 'approved',
							route,
							proposed_limit: route === 'permanent' ? proposedLimit.trim() || null : null,
							reason: reason.trim() || null
						}
					}
				]
			}),
			{
				saved: ctx.t('component.credit_release_submitted'),
				then: () => {
					route = 'one_time';
					proposedLimit = '';
					reason = '';
				}
			}
		);
	}
</script>

{#snippet noticesAndRequest()}
	{#if view.mode !== 'create'}
		{@const rec = view.record}
		<Stack gap="md">
			{#if rec.status === 'approved'}
				<Surface tone="subtle" padding="sm" radius="control">
					<p class="text-body">
						{rec.route === 'permanent' && commercial && rec.proposed_limit != null
							? ctx.t('component.credit_release_kis_permanent', {
									bill: rec.bill_number,
									limit: format({ kind: 'money' }, rec.proposed_limit, {
										locale: ctx.locale,
										currency: rec.currency
									})
								})
							: ctx.t('component.credit_release_kis_one_time', { bill: rec.bill_number })}
					</p>
				</Surface>
			{:else if rec.status === 'bypassed'}
				<Surface tone="subtle" padding="sm" radius="control">
					<p class="text-body text-destructive">
						{ctx.t('component.credit_release_bypass_notice', {
							bill: rec.bill_number,
							user: rec.released_by ?? '—'
						})}
					</p>
				</Surface>
			{:else if rec.status === 'superseded'}
				<Surface tone="subtle" padding="sm" radius="control">
					<p class="text-body">
						{ctx.t('component.credit_release_superseded_notice', { bill: rec.bill_number })}
					</p>
				</Surface>
			{/if}

			{#if canRequest}
				<Surface tone="subtle" padding="md" radius="control">
					<Stack gap="md">
						<h3 class="text-heading">{ctx.t('component.credit_release_request')}</h3>
						{#if isAdvanceSettlement(rec.settlement_name)}
							<p class="text-meta">
								{ctx.t('component.credit_release_advance_hint', {
									terms: rec.settlement_name ?? ''
								})}
							</p>
						{/if}
						<Grid gap="md" minimum="compact">
							<Stack gap="xs">
								<Label for="credit-release-route">
									{ctx.t('models.credit_releases.fields.route')}
								</Label>
								<Combobox
									id="credit-release-route"
									value={route}
									options={[
										{
											value: 'one_time',
											label: ctx.t('models.credit_releases.fields.route.one_time')
										},
										{
											value: 'permanent',
											label: ctx.t('models.credit_releases.fields.route.permanent')
										}
									]}
									on_change={(value) => {
										if (value === 'one_time' || value === 'permanent') route = value;
									}}
								/>
							</Stack>
							{#if route === 'permanent'}
								<Stack gap="xs">
									<Label for="credit-release-proposed-limit">
										{ctx.t('models.credit_releases.fields.proposed_limit')}
									</Label>
									<Input
										id="credit-release-proposed-limit"
										inputmode="decimal"
										bind:value={proposedLimit}
									/>
								</Stack>
							{/if}
						</Grid>
						<Stack gap="xs">
							<Label for="credit-release-reason">
								{ctx.t('models.credit_releases.fields.reason')}
							</Label>
							<Textarea id="credit-release-reason" bind:value={reason} />
						</Stack>
						<Inline>
							<Button disabled={save.pending} onclick={submitRelease}>
								{save.pending
									? ctx.t('component.credit_release_submitting')
									: ctx.t('component.credit_release_submit')}
							</Button>
						</Inline>
					</Stack>
				</Surface>
			{/if}
		</Stack>
	{/if}
{/snippet}

<RecordForm
	{ctx}
	{view}
	readonly
	after_form={noticesAndRequest}
	sections={[
		{
			name: 'credit_release',
			fields: [
				'bill_number',
				'status',
				'party',
				'order',
				'delivery',
				'bill_on',
				'settlement_name',
				'block_reasons',
				'bill_amount',
				'credit_limit',
				'credit_used',
				'over_limit',
				'overdue_days',
				'oldest_overdue_bill',
				'route',
				'proposed_limit',
				'released_by',
				'released_at',
				'observed_at',
				'reason'
			],
			wide: ['reason']
		}
	]}
/>
