<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Accordion,
		Button,
		DescriptionHint,
		EmptyState,
		Icon,
		Popover,
		enum_text,
		label,
		use_record_controller
	} from '@norbital-ai/ui';
	import { Cluster } from '@norbital-ai/ui/layout';
	import type { Law } from '../../../data/model/jurisdiction/service/law.js';
	import type { JsonObject } from '../../../lib/foundation.js';
	import type { LawRowTarget } from '../../../lib/ui/settings/law_row.svelte';

	let {
		ctx,
		law,
		on_open
	}: { ctx: PageContext; law: Law; on_open: (target: LawRowTarget) => void } = $props();
	// a row of the law is added while the law is being edited
	const record = use_record_controller();
	const editing = $derived(record?.current != null && record.current.mode !== 'view');
	/** The checkpoints the viewer opened; until they choose, the first. */
	let chosen = $state<string[] | null>(null);

	const chain = $derived(
		law.rows.subtotal.map((row): JsonObject & { readonly code: string } => ({
			...row,
			code: String(row.code)
		}))
	);
	const open = $derived(chosen ?? chain.slice(0, 1).map((node) => node.code));

	const producers = $derived.by(() => {
		const families = [
			'allowance_catalog',
			'overtime_catalog',
			'leave_catalog',
			'claim_catalog',
			'adhoc_catalog',
			'loan_catalog',
			'workplace_case_catalog'
		] as const;
		return new Map(
			chain.map((node) => [
				node.code,
				families.flatMap((model) =>
					law.rows[model].filter((row) => row.subtotal === node.code).map((row) => ({ model, row }))
				)
			])
		);
	});

	const statutories = $derived(
		new Map(
			chain.map((node) => [
				node.code,
				law.rows.statutory_contribution_catalog.filter((row) => row.subtotal === node.code)
			])
		)
	);

	/** What a checkpoint holds, for the codes every chain shares; any other is its name. */
	const GUIDED = [
		'BASIC',
		'PRORATED',
		'PAID_BASIC',
		'ORDINARY_WAGES',
		'ADDITIONAL_WAGES',
		'GROSS',
		'FINAL_PAY',
		'RETIREMENT',
		'NET'
	] as const;
	const guide = (code: string) =>
		ctx.t(`checkpoint.${GUIDED.find((known) => known === code) ?? 'other'}`);
	const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
	const directionOf = (row: Record<string, unknown>, model: string): string => {
		const direction = textOf(row.direction);
		if (direction === 'DEDUCT') return '−';
		if (direction === 'ADD') return '+';
		return model === 'loan_catalog' ? '−' : '+';
	};
	const codeOf = (value: unknown): string => textOf(value).replace(/^\/\/ js\n/, '');
	const eligibilityOf = (row: object): string => codeOf(Reflect.get(row, 'eligibility'));
	const amountOf = (row: Record<string, unknown>, model: string): string => {
		if (model === 'statutory_contribution_catalog') {
			const employee = codeOf(row.employee_amount);
			const employer = codeOf(row.employer_amount);
			return (
				[
					employee === '' ? '' : `// Employee\n${employee}`,
					employer === '' ? '' : `// Employer\n${employer}`
				]
					.filter((part) => part !== '')
					.join('\n\n') || 'return 0;'
			);
		}
		if (model === 'leave_catalog')
			return (
				[
					codeOf(row.paid_share) === '' ? '' : `// Paid share\n${codeOf(row.paid_share)}`,
					codeOf(row.payout) === '' ? '' : `// Payout\n${codeOf(row.payout)}`
				]
					.filter((part) => part !== '')
					.join('\n\n') || '// Paid share\n1'
			);
		return codeOf(row.conversion) || codeOf(row.amount) || 'return 0;';
	};
	const nodeDirection = (code: string): string =>
		code === 'NET' ? 'net' : code === 'BASIC' ? 'base' : '+ additions';
</script>

{#snippet line(family: LawRowTarget['family'], row: JsonObject, sign: string, tag: string)}
	<div class="flex items-start gap-2 rounded border px-2 py-2">
		<span
			class="mt-0.5 grid size-4 shrink-0 place-items-center rounded border font-mono text-xs {sign ===
			'−'
				? 'border-destructive/30 bg-destructive/10 text-destructive'
				: 'border-tone-success-border bg-tone-success-bg text-tone-success-text'}">{sign}</span
		>
		<button
			type="button"
			class="min-w-0 flex-1 text-left"
			onclick={() => on_open({ family, code: String(row.code) })}
		>
			<span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
				<span class="min-w-0 font-mono text-xs font-medium">{row.code}</span>
				<span class="ml-auto shrink-0 text-micro text-muted-foreground">{tag}</span>
			</span>
			{#if textOf(row.description) !== ''}
				<span class="mt-0.5 block text-xs leading-snug text-muted-foreground">
					{textOf(row.description)}
				</span>
			{/if}
		</button>
		<Popover.Root>
			<Popover.Trigger
				class="shrink-0 text-muted-foreground hover:text-foreground"
				aria-label={ctx.t('overview.how', { code: String(row.code) })}
				title={ctx.t('overview.view')}
			>
				<Icon name="lucide:info" class="size-3.5" />
			</Popover.Trigger>
			<Popover.Content align="start" class="max-w-md space-y-3 text-xs">
				<div class="space-y-1">
					<span class="text-xs font-medium text-muted-foreground"
						>{ctx.t('overview.eligibility')}</span
					>
					{#if eligibilityOf(row) !== ''}
						<pre
							class="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 text-xs leading-snug"><code
								>{eligibilityOf(row)}</code
							></pre>
					{:else}
						<p class="text-muted-foreground">{ctx.t('overview.always_eligible')}</p>
					{/if}
				</div>
				<div class="space-y-1">
					<span class="text-xs font-medium text-muted-foreground">{ctx.t('overview.amount')}</span>
					<pre
						class="max-h-52 overflow-auto rounded-md border bg-muted/40 p-2 text-xs leading-snug"><code
							>{amountOf(row, family)}</code
						></pre>
				</div>
			</Popover.Content>
		</Popover.Root>
	</div>
{/snippet}

{#if chain.length === 0}
	<EmptyState title={ctx.t('v2.subtotals')} />
{:else}
	<div class="grid gap-2">
		<Cluster gap="sm" justify="between" align="center">
			<Cluster gap="xs" align="center">
				<span class="text-sm font-medium">{ctx.t('app.settings.overview')}</span>
				<DescriptionHint text={ctx.t('overview.about')} />
			</Cluster>
			<Button
				variant="outline"
				disabled={!editing}
				onclick={() => on_open({ family: 'subtotal', code: null })}>{ctx.t('law_row.new')}</Button
			>
		</Cluster>
		<Accordion.Root
			type="multiple"
			bind:value={() => open, (next) => (chosen = next)}
			class="w-full"
		>
			{#each chain as node (node.code)}
				<Accordion.Item value={node.code}>
					<div class="flex items-center gap-2">
						<Accordion.Trigger class="min-w-0 flex-1 py-1.5">
							<span class="flex w-full items-center gap-2">
								<span class="min-w-0 flex-1 truncate text-sm font-medium"
									>{textOf(node.name) || node.code}</span
								>
							</span>
						</Accordion.Trigger>
						<Popover.Root>
							<Popover.Trigger
								class="text-muted-foreground hover:text-foreground"
								aria-label={ctx.t('overview.how', { code: node.code })}
							>
								<Icon name="lucide:info" class="size-3.5" />
							</Popover.Trigger>
							<Popover.Content align="start" class="max-w-sm space-y-1.5 text-xs">
								<p>
									<span class="font-medium">{ctx.t('component.code')}.</span>
									<span class="font-mono">{node.code}</span>
								</p>
								<p>{guide(node.code)}</p>
							</Popover.Content>
						</Popover.Root>
						<span class="shrink-0 text-micro text-muted-foreground">{nodeDirection(node.code)}</span
						>
						<span class="shrink-0 text-micro tabular-nums text-muted-foreground">
							{(producers.get(node.code) ?? []).length + (statutories.get(node.code) ?? []).length}
						</span>
						<Button
							variant="ghost"
							size="icon"
							aria-label={ctx.t('law_row.edit', { code: node.code })}
							onclick={() => on_open({ family: 'subtotal', code: node.code })}
						>
							<Icon name="lucide:pencil" class="size-3.5" />
						</Button>
					</div>
					<Accordion.Content>
						<div class="grid gap-1 pb-2">
							{#each producers.get(node.code) ?? [] as producer (producer.model + producer.row.code)}
								{@render line(
									producer.model,
									producer.row,
									directionOf(producer.row, producer.model),
									ctx.t(`law_family.${producer.model}`)
								)}
							{/each}
							{#each statutories.get(node.code) ?? [] as scheme (scheme.code)}
								{@render line(
									'statutory_contribution_catalog',
									scheme,
									'−',
									label(ctx, 'law', `kind.${textOf(scheme.kind)}`, enum_text(textOf(scheme.kind)))
								)}
							{/each}
							{#if (producers.get(node.code) ?? []).length === 0 && (statutories.get(node.code) ?? []).length === 0}
								<p class="px-1 text-xs text-muted-foreground">
									{node.code === 'BASIC'
										? 'Contract salary is the checkpoint value.'
										: 'No catalogue posts here.'}
								</p>
							{/if}
						</div>
					</Accordion.Content>
				</Accordion.Item>
			{/each}
		</Accordion.Root>
	</div>
{/if}
