<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Button, Field, Icon, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'payment_claims'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);

	const INFLOW_TYPES = [
		'progress',
		'variation',
		'milestone',
		'final',
		'retention_release',
		'adjustment'
	] as const;
	const OUTFLOW_TYPES = ['subcon_claim', 'supplier_invoice', 'adjustment'] as const;

	/** Step-based polymorphic create: step 1 picks inflow vs outflow (auto-skipped if prefilled). */
	let chosenStep = $state<1 | 2 | null>(null);
	const createStep = $derived<1 | 2>(
		chosenStep ?? (view.mode === 'create' && view.values.direction != null ? 2 : 1)
	);
</script>

<RecordForm {ctx} {view} subtitle={['direction', 'claim_type', 'status']}>
	{#snippet children(form)}
		{@const activeDirection =
			form.get('direction') === 'outflow' ||
			(form.get('direction') == null && record?.direction === 'outflow')
				? 'outflow'
				: 'inflow'}
		{@const allowedTypes = activeDirection === 'inflow' ? INFLOW_TYPES : OUTFLOW_TYPES}
		{@const isStepOne = view.mode === 'create' && createStep === 1}

		<div class={isStepOne ? '' : 'hidden'}>
			<Section
				icon="lucide:banknote"
				first
				name="step_kind"
				title={ctx.t('claims.step_choose_kind')}
			>
				<Stack gap="sm">
					<p class="text-sm text-muted-foreground">{ctx.t('claims.step_choose_hint')}</p>
					<Grid minimum="compact" gap="sm">
						<button
							type="button"
							class="rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-primary"
							onclick={() => {
								form.set('direction', 'inflow');
								form.set('claim_type', 'progress');
								chosenStep = 2;
							}}
						>
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<Icon name="lucide:arrow-down-left" class="size-4 text-tone-success-text" />
									<span class="font-medium text-foreground">{ctx.t('claims.variant_inflow')}</span>
								</Inline>
								<span class="text-xs text-muted-foreground">
									{ctx.t('claims.variant_inflow_desc')}
								</span>
							</Stack>
						</button>
						<button
							type="button"
							class="rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-primary"
							onclick={() => {
								form.set('direction', 'outflow');
								form.set('claim_type', 'subcon_claim');
								chosenStep = 2;
							}}
						>
							<Stack gap="xs">
								<Inline gap="xs" align="center">
									<Icon name="lucide:arrow-up-right" class="size-4 text-tone-warning-text" />
									<span class="font-medium text-foreground">{ctx.t('claims.variant_outflow')}</span>
								</Inline>
								<span class="text-xs text-muted-foreground">
									{ctx.t('claims.variant_outflow_desc')}
								</span>
							</Stack>
						</button>
					</Grid>
				</Stack>
			</Section>
		</div>

		<!-- Keep step-2 fields mounted while on step 1 so FormState retains values cleanly. -->
		<div class={isStepOne ? 'hidden' : ''}>
			{#if view.mode === 'create'}
				<Inline align="center" justify="between" class="mb-2">
					<Button variant="ghost" onclick={() => (chosenStep = 1)}>
						<Icon name="lucide:arrow-left" class="size-3.5" />
						{ctx.t('claims.change_variant')}
					</Button>
				</Inline>
			{/if}

			<Section icon="lucide:banknote" first name="claim" title={ctx.t('section.claim')}>
				<Grid minimum="compact">
					{#if view.mode !== 'create' || view.values.project_id == null}
						<Field {ctx} name="project_id" />
					{/if}
					<Field {ctx} name="direction" readonly />
					<Field {ctx} name="claim_type">
						{#snippet editor({ value, on_change, disabled })}
							<Inline gap="xs" class="flex-wrap">
								{#each allowedTypes as opt (opt)}
									<Button
										variant={value === opt ? 'secondary' : 'outline'}
										{disabled}
										onclick={() => on_change(opt)}
									>
										{opt.replaceAll('_', ' ')}
									</Button>
								{/each}
							</Inline>
						{/snippet}
					</Field>
					<Field {ctx} name="status" />
					<Field {ctx} name="valuation_date" />
					<Field {ctx} name="due_date" />
					{#if activeDirection === 'inflow'}
						<Field {ctx} name="claim_period" />
					{:else}
						<Field {ctx} name="contact_id" />
						<Field {ctx} name="quote_id" />
						<Field {ctx} name="cost_item_id" />
					{/if}
					<Field {ctx} name="currency" />
					<Field {ctx} name="claimed_amount" />
					<Field {ctx} name="certified_amount" />
					<Column span="all"><Field {ctx} name="description" /></Column>
				</Grid>
			</Section>

			{#if activeDirection === 'inflow'}
				<Section
					icon="lucide:table-properties"
					name="valuation"
					title={ctx.t('section.valuation_breakdown')}
				>
					<Field {ctx} name="valuation" />
				</Section>
			{/if}

			<Section
				icon="lucide:send"
				name="submission"
				title={ctx.t('section.submission')}
				default_open={false}
				summary={record?.submitted_date ?? ctx.t('section.not_submitted')}
			>
				<Grid minimum="compact">
					<Field {ctx} name="submitted_date" />
					<Field {ctx} name="paid_date" />
					{#if activeDirection === 'inflow'}
						<Field {ctx} name="contact_id" />
					{/if}
					<Column span="all"><Field {ctx} name="supporting_documents" /></Column>
				</Grid>
			</Section>
		</div>
	{/snippet}
</RecordForm>
