<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		Combobox,
		Input,
		Label,
		RecordShell,
		Show,
		Textarea,
		enum_text,
		format,
		use_act,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import { isAdvanceSettlement } from '../../../lib/credit-release.js';
	import RecordLink from '../../../lib/ui/record-link.svelte';

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
	const words: { t(key: string): string } = ctx;

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

	const moneyKind = { kind: 'money', currency: 'currency', optional: true } as const;
	const statusKind = {
		kind: 'enum',
		values: ['blocked', 'approved', 'released', 'cleared', 'superseded', 'withdrawn', 'bypassed']
	} as const;
	const routeKind = { kind: 'enum', values: ['one_time', 'permanent'], optional: true } as const;
</script>

{#snippet details(shown: RecordView<'credit_releases'>)}
	{#if shown.mode !== 'create'}
		{@const rec = shown.record}
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

			<Grid as="dl" gap="md">
				<div>
					<dt class="text-label">{ctx.t('models.credit_releases.fields.bill_number')}</dt>
					<dd class="tabular-nums">{rec.bill_number}</dd>
				</div>
				<div>
					<dt class="text-label">{ctx.t('models.credit_releases.fields.status')}</dt>
					<dd>
						<Show {ctx} kind={statusKind} value={rec.status} name="status" row={rec} />
					</dd>
				</div>
				<div>
					<dt class="text-label">{ctx.t('models.credit_releases.fields.party')}</dt>
					<dd><RecordLink {ctx} of="parties" id={String(rec.party)} /></dd>
				</div>
				{#if rec.order}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.order')}</dt>
						<dd><RecordLink {ctx} of="orders" id={String(rec.order)} /></dd>
					</div>
				{/if}
				{#if rec.delivery}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.delivery')}</dt>
						<dd><RecordLink {ctx} of="transactions" id={String(rec.delivery)} /></dd>
					</div>
				{/if}
				{#if rec.bill_on}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.bill_on')}</dt>
						<dd><Show {ctx} kind={{ kind: 'date', optional: true }} value={rec.bill_on} /></dd>
					</div>
				{/if}
				{#if rec.settlement_name}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.settlement_name')}</dt>
						<dd>{rec.settlement_name}</dd>
					</div>
				{/if}
				{#if rec.block_reasons?.length}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.block_reasons')}</dt>
						<dd>
							<Inline as="span" gap="xs">
								{#each rec.block_reasons as item (item)}
									<Badge variant="outline">
										{enum_text(item, {
											t: (key) => words.t(key),
											model: 'credit_releases',
											field: 'block_reasons'
										})}
									</Badge>
								{/each}
							</Inline>
						</dd>
					</div>
				{/if}
				{#if commercial}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.bill_amount')}</dt>
						<dd class="tabular-nums">
							<Show {ctx} kind={moneyKind} value={rec.bill_amount} row={rec} />
						</dd>
					</div>
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.credit_limit')}</dt>
						<dd class="tabular-nums">
							<Show {ctx} kind={moneyKind} value={rec.credit_limit} row={rec} />
						</dd>
					</div>
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.credit_used')}</dt>
						<dd class="tabular-nums">
							<Show {ctx} kind={moneyKind} value={rec.credit_used} row={rec} />
						</dd>
					</div>
					{#if rec.over_limit != null}
						<div>
							<dt class="text-label">{ctx.t('models.credit_releases.fields.over_limit')}</dt>
							<dd class="tabular-nums">
								<Show {ctx} kind={moneyKind} value={rec.over_limit} row={rec} />
							</dd>
						</div>
					{/if}
					{#if rec.overdue_days != null}
						<div>
							<dt class="text-label">{ctx.t('models.credit_releases.fields.overdue_days')}</dt>
							<dd class="tabular-nums">{rec.overdue_days}</dd>
						</div>
					{/if}
					{#if rec.oldest_overdue_bill}
						<div>
							<dt class="text-label">
								{ctx.t('models.credit_releases.fields.oldest_overdue_bill')}
							</dt>
							<dd class="tabular-nums">{rec.oldest_overdue_bill}</dd>
						</div>
					{/if}
				{/if}
				{#if rec.route}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.route')}</dt>
						<dd><Show {ctx} kind={routeKind} value={rec.route} name="route" row={rec} /></dd>
					</div>
				{/if}
				{#if commercial && rec.proposed_limit != null}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.proposed_limit')}</dt>
						<dd class="tabular-nums">
							<Show {ctx} kind={moneyKind} value={rec.proposed_limit} row={rec} />
						</dd>
					</div>
				{/if}
				{#if commercial && rec.reason}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.reason')}</dt>
						<dd>{rec.reason}</dd>
					</div>
				{/if}
				{#if rec.released_by}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.released_by')}</dt>
						<dd>{rec.released_by}</dd>
					</div>
				{/if}
				{#if rec.released_at}
					<div>
						<dt class="text-label">{ctx.t('models.credit_releases.fields.released_at')}</dt>
						<dd>
							<Show {ctx} kind={{ kind: 'instant', optional: true }} value={rec.released_at} />
						</dd>
					</div>
				{/if}
				<div>
					<dt class="text-label">{ctx.t('models.credit_releases.fields.observed_at')}</dt>
					<dd><Show {ctx} kind={{ kind: 'instant' }} value={rec.observed_at} /></dd>
				</div>
			</Grid>

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

<RecordShell
	{ctx}
	of="credit_releases"
	mode={view.mode}
	{...view.mode !== 'create' ? { id: view.record.id } : { values: view.values }}
	children={details}
/>
