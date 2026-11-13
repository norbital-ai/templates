<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Accordion, EmptyState, Icon, Popover } from '@norbital-ai/ui';

	let { ctx, versionId }: { ctx: PageContext; versionId: Id<'jurisdiction_settings'> } = $props();
	let open = $state<string[]>([]);
	let initialized = $state(false);

	const data = $derived(
		ctx.query({
			subtotal: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			allowance_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			overtime_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			statutory_contribution_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			leave_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			claim_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			adhoc_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			loan_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 },
			workplace_case_catalog: { where: { settings_id: { eq: versionId } }, limit: 10000 }
		})
	);

	const chain = $derived.by(() => {
		const rows = data.current?.subtotal.rows ?? [];
		const first = rows.find((row) => row.previous_id == null);
		if (first == null) return [];
		const byPrevious = new Map(
			rows.flatMap((row) => (row.previous_id == null ? [] : [[row.previous_id, row] as const]))
		);
		const ordered = [first];
		while (ordered.length < rows.length) {
			const next = byPrevious.get(ordered.at(-1)!.id);
			if (next == null) break;
			ordered.push(next);
		}
		return ordered;
	});

	$effect(() => {
		if (!initialized && chain.length > 0) {
			open = [chain[0]!.id];
			initialized = true;
		}
	});

	const producers = $derived.by(() => {
		const families = [
			['allowance_catalog', data.current?.allowance_catalog.rows ?? []],
			['overtime_catalog', data.current?.overtime_catalog.rows ?? []],
			['leave_catalog', data.current?.leave_catalog.rows ?? []],
			['claim_catalog', data.current?.claim_catalog.rows ?? []],
			['adhoc_catalog', data.current?.adhoc_catalog.rows ?? []],
			['loan_catalog', data.current?.loan_catalog.rows ?? []],
			['workplace_case_catalog', data.current?.workplace_case_catalog.rows ?? []]
		] as const;
		return new Map(
			chain.map((node) => [
				node.id,
				families.flatMap(([model, rows]) =>
					rows.filter((row) => row.subtotal_id === node.id).map((row) => ({ model, row }))
				)
			])
		);
	});

	const statutories = $derived.by(
		() =>
			new Map(
				chain.map((node) => [
					node.id,
					(data.current?.statutory_contribution_catalog.rows ?? []).filter(
						(row) => row.subtotal_id === node.id
					)
				])
			)
	);

	/** What a checkpoint holds, for the codes every chain shares; any other is its name. */
	const guide = (code: string): string => {
		switch (code) {
			case 'BASIC':
				return 'The contract salary for the period. An off-cycle run starts at 0.';
			case 'PRORATED':
				return 'Basic less the days before a joiner started or after a leaver left, and less absences.';
			case 'PAID_BASIC':
				return 'Prorated basic less unpaid leave. Allowances, overtime, claims, one-off items and loans post after this.';
			case 'ORDINARY_WAGES':
				return 'Paid basic plus ordinary pay lines: fixed and recurring allowances, ordinary overtime and ordinary one-off items. Schemes that count ordinary wages read this value.';
			case 'ADDITIONAL_WAGES':
				return 'Ordinary wages plus bonus, backpay and other additional-wage lines. Tax schemes that work on the year so far read this running total.';
			case 'GROSS':
				return 'Additional wages plus gross wage adjustments. Tax schemes that read gross use this value before final settlements.';
			case 'FINAL_PAY':
				return 'Final and non-wage settlements: severance, notice, retirement lump sums, injury compensation. Not part of ordinary or additional wages.';
			case 'RETIREMENT':
				return 'Retirement allowances, kept outside gross wages. Separate retirement tax schemes read this checkpoint.';
			case 'NET':
				return 'What the employee is paid: everything above less employee contributions, tax, deductions and loan repayments.';
			default:
				return 'The previous checkpoint plus every line posted here.';
		}
	};
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

{#if data.loading}
	<div
		class="h-40 animate-pulse rounded-lg bg-muted/40"
		aria-label={ctx.t('component.loading')}
	></div>
{:else if data.error}
	<p role="alert" class="text-sm text-destructive">{data.error.message}</p>
{:else if chain.length === 0}
	<EmptyState title={ctx.t('v2.subtotals')} />
{:else}
	<div class="grid gap-2">
		<p class="text-xs text-muted-foreground">
			One linear chain, top to bottom. Every checkpoint can read all earlier values. Each catalogue
			row shows whether it adds (+) or deducts (−), what it calculates, and when it applies.
		</p>
		<Accordion.Root type="multiple" bind:value={open} class="w-full">
			{#each chain as node (node.id)}
				<Accordion.Item value={node.id}>
					<div class="flex items-center gap-2">
						<Accordion.Trigger class="min-w-0 flex-1 py-1.5">
							<span class="flex w-full items-center gap-2">
								<span class="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
							</span>
						</Accordion.Trigger>
						<Popover.Root>
							<Popover.Trigger
								class="text-muted-foreground hover:text-foreground"
								aria-label={`How ${node.code} is calculated`}
							>
								<Icon name="lucide:info" class="size-3.5" />
							</Popover.Trigger>
							<Popover.Content align="start" class="max-w-sm space-y-1.5 text-xs">
								<p>
									<span class="font-medium">Code.</span> <span class="font-mono">{node.code}</span>
								</p>
								<p>{guide(node.code)}</p>
							</Popover.Content>
						</Popover.Root>
						<span class="shrink-0 text-[10px] text-muted-foreground"
							>{nodeDirection(node.code)}</span
						>
						<span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
							{(producers.get(node.id) ?? []).length + (statutories.get(node.id) ?? []).length}
						</span>
					</div>
					<Accordion.Content>
						<div class="grid gap-1 pb-2">
							{#each producers.get(node.id) ?? [] as producer (producer.model + producer.row.code)}
								<div class="flex items-start gap-2 rounded border px-2 py-2">
									<span
										class="mt-0.5 grid size-4 shrink-0 place-items-center rounded border font-mono text-[11px] {directionOf(
											producer.row,
											producer.model
										) === '−'
											? 'border-destructive/30 bg-destructive/10 text-destructive'
											: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}"
										>{directionOf(producer.row, producer.model)}</span
									>
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
											<span class="min-w-0 text-xs"
												>{textOf(producer.row.description) || producer.row.code}</span
											>
											<Popover.Root>
												<Popover.Trigger
													class="shrink-0 text-muted-foreground hover:text-foreground"
													aria-label={`How ${producer.row.code} is calculated`}
													title="View eligibility and payroll amount"
												>
													<Icon name="lucide:info" class="size-3.5" />
												</Popover.Trigger>
												<Popover.Content align="start" class="max-w-md space-y-3 text-xs">
													<div class="space-y-1">
														<span class="text-xs font-medium text-muted-foreground"
															>Eligibility</span
														>
														{#if eligibilityOf(producer.row) !== ''}
															<pre
																class="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-snug"><code
																	>{eligibilityOf(producer.row)}</code
																></pre>
														{:else}
															<p class="text-muted-foreground">Always eligible</p>
														{/if}
													</div>
													<div class="space-y-1">
														<span class="text-xs font-medium text-muted-foreground"
															>Payroll amount</span
														>
														<pre
															class="max-h-52 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-snug"><code
																>{amountOf(producer.row, producer.model)}</code
															></pre>
													</div>
												</Popover.Content>
											</Popover.Root>
											<span class="ml-auto shrink-0 text-[10px] text-muted-foreground">
												{producer.model.replaceAll('_', ' ')}
											</span>
										</div>
										{#if textOf(producer.row.description) !== ''}
											<p class="mt-0.5 font-mono text-[11px] leading-snug text-muted-foreground">
												{producer.row.code}
											</p>
										{/if}
									</div>
								</div>
							{/each}
							{#if (statutories.get(node.id) ?? []).length > 0}
								<div class="grid gap-1">
									{#each statutories.get(node.id) ?? [] as scheme (scheme.code)}
										<div class="flex items-start gap-2 rounded border px-2 py-2">
											<span
												class="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-destructive/30 bg-destructive/10 font-mono text-[11px] text-destructive"
												>−</span
											>
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
													<span class="min-w-0 text-xs"
														>{textOf(scheme.description) || scheme.code}</span
													>
													<Popover.Root>
														<Popover.Trigger
															class="shrink-0 text-muted-foreground hover:text-foreground"
															aria-label={`How ${scheme.code} is calculated`}
															title="View eligibility and payroll amount"
														>
															<Icon name="lucide:info" class="size-3.5" />
														</Popover.Trigger>
														<Popover.Content align="start" class="max-w-md space-y-3 text-xs">
															<div class="space-y-1">
																<span class="text-xs font-medium text-muted-foreground"
																	>Eligibility</span
																>
																{#if eligibilityOf(scheme) !== ''}
																	<pre
																		class="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-snug"><code
																			>{eligibilityOf(scheme)}</code
																		></pre>
																{:else}
																	<p class="text-muted-foreground">Always eligible</p>
																{/if}
															</div>
															<div class="space-y-1">
																<span class="text-xs font-medium text-muted-foreground"
																	>Payroll amount</span
																>
																<pre
																	class="max-h-52 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-snug"><code
																		>{amountOf(scheme, 'statutory_contribution_catalog')}</code
																	></pre>
															</div>
														</Popover.Content>
													</Popover.Root>
													<span class="ml-auto shrink-0 text-[10px] text-muted-foreground"
														>{scheme.kind}</span
													>
												</div>
												{#if textOf(scheme.description) !== ''}
													<p
														class="mt-0.5 font-mono text-[11px] leading-snug text-muted-foreground"
													>
														{scheme.code}
													</p>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
							{#if (producers.get(node.id) ?? []).length === 0 && (statutories.get(node.id) ?? []).length === 0}
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
