<script lang="ts">
	import { translated } from '../../lib/ui/message.js';
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { run } from '@norbital-ai/ui/effect';
	import type { CurrencyCode } from '@norbital-ai/bolt';
	import { BigDecimal } from 'effect';
	import { Combobox, CustomView, Table, Tabs, TimeInput } from '@norbital-ai/ui';
	import { AppShell, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { openCreate } from '../../lib/ui/create-values.js';
	import {
		monthDays,
		priceBookMonths,
		priceBookRead,
		priceBookRows,
		type PriceRow
	} from '../../lib/price-book.js';

	const clock = ctx.clock('day');
	const today = clock.today;
	const currentMonth = today.slice(0, 7);
	const catalog = ctx.query({
		pricing_floors: { fields: ['group_code', 'currency'], limit: 10000 },
		warehouses: { fields: ['name', 'group_code', 'active'] }
	});
	const groups = $derived.by(() => {
		const names = new Map<string, string[]>();
		for (const warehouse of catalog.current?.warehouses.rows ?? []) {
			if (!warehouse.group_code) continue;
			const list = names.get(warehouse.group_code) ?? [];
			list.push(warehouse.name);
			names.set(warehouse.group_code, list);
		}
		const codes = new Set(names.keys());
		for (const row of catalog.current?.pricing_floors.rows ?? []) codes.add(row.group_code);
		return [...codes].sort().map((code) => ({
			value: code,
			label: names.has(code) ? `${code} · ${names.get(code)!.join(', ')}` : code
		}));
	});
	/** The group and currency that already hold the most prices, so the book opens on a real pair. */
	const defaultPair = $derived.by(() => {
		const counts = new Map<string, { group: string; currency: CurrencyCode; count: number }>();
		for (const row of catalog.current?.pricing_floors.rows ?? []) {
			const key = JSON.stringify([row.group_code, row.currency]);
			const found = counts.get(key);
			if (found) found.count++;
			else counts.set(key, { group: row.group_code, currency: row.currency, count: 1 });
		}
		return (
			[...counts.values()].sort(
				(a, b) =>
					b.count - a.count ||
					a.group.localeCompare(b.group) ||
					a.currency.localeCompare(b.currency)
			)[0] ?? null
		);
	});
	let chosenGroup = $state<string | null>(null);
	let chosenCurrency = $state<CurrencyCode | null>(null);
	let chosenMonth = $state<string | null>(null);
	const group = $derived(chosenGroup ?? defaultPair?.group ?? groups[0]?.value ?? null);
	const currencies = $derived(
		[
			...new Set(
				(catalog.current?.pricing_floors.rows ?? [])
					.filter((row) => row.group_code === group)
					.map((row) => row.currency)
			)
		].sort((a, b) => a.localeCompare(b))
	);
	const currency = $derived(
		chosenCurrency !== null && currencies.includes(chosenCurrency)
			? chosenCurrency
			: (currencies.find((value) => value === 'CNY') ?? currencies[0] ?? null)
	);
	const book = $derived(
		group !== null && currency !== null ? ctx.query(priceBookRead(group, currency)) : null
	);
	const months = $derived(book?.current ? priceBookMonths(book.current) : []);
	const month = $derived(
		chosenMonth ?? (months.includes(currentMonth) ? currentMonth : (months[0] ?? currentMonth))
	);
	const days = $derived(monthDays(month));
	const rows = $derived(book?.current ? priceBookRows(book.current, month) : []);

	let editing = $state<string | null>(null);
	let draft = $state('');
	let writing = $state<string | null>(null);
	let error = $state<string | null>(null);
	const keyOf = (row: PriceRow, day: string) => `${row.key}|${day}`;
	function start(row: PriceRow, day: string) {
		if (writing !== null) return;
		error = null;
		editing = keyOf(row, day);
		const cell = row.cells[day];
		draft = cell ? BigDecimal.format(BigDecimal.fromStringUnsafe(cell.floor_price)) : '';
	}
	function cancel() {
		editing = null;
		draft = '';
	}
	async function commit(row: PriceRow, day: string) {
		const key = keyOf(row, day);
		if (editing !== key) return;
		editing = null;
		const value = draft.trim();
		if (value === '') return;
		if (group === null || currency === null) return;
		const existing = row.cells[day];
		if (
			!/^\d+(\.\d+)?$/.test(value) ||
			!BigDecimal.isPositive(BigDecimal.fromStringUnsafe(value))
		) {
			error = ctx.t('component.price_floor_positive');
			return;
		}
		if (
			existing &&
			BigDecimal.equals(
				BigDecimal.fromStringUnsafe(existing.floor_price),
				BigDecimal.fromStringUnsafe(value)
			)
		)
			return;
		const price = value;
		error = null;
		writing = key;
		try {
			const outcome = existing
				? await run(
						ctx.act({
							'pricing_floors.update': [
								{
									target: { id: existing.id, revision: existing.revision },
									set: { floor_price: price }
								}
							]
						})
					)
				: await run(
						ctx.act({
							'pricing_floors.create': [
								{
									product: row.product,
									group_code: group,
									currency,
									effective_on: day,
									unit: row.latest.unit,
									floor_price: price,
									tax_inclusive: row.latest.tax_inclusive,
									tax_rate: row.latest.tax_rate,
									minimum_quantity: row.minimum_quantity
								}
							]
						})
					);
			if (outcome.kind === 'pending_approval') error = ctx.t('component.awaiting_approval');
			else if (outcome.kind !== 'committed') error = ctx.t('component.seal_uncertain');
		} catch (failure) {
			error =
				typeof failure === 'object' &&
				failure !== null &&
				'_tag' in failure &&
				failure._tag === 'ActRefused' &&
				'message' in failure &&
				typeof failure.message === 'string'
					? translated(ctx, failure.message)
					: ctx.t('component.seal_uncertain');
		} finally {
			writing = null;
		}
	}
	function create() {
		openCreate('pricing_floors', {
			...(group === null ? {} : { group_code: group }),
			...(currency === null ? {} : { currency }),
			effective_on: `${month}-01`
		});
	}
	function focusInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
</script>

{#snippet scope()}
	<div class="w-44">
		<Combobox
			options={groups}
			value={group}
			on_change={(value) => (chosenGroup = value)}
			placeholder={ctx.t('models.pricing_floors.fields.group_code')}
			aria-label={ctx.t('models.pricing_floors.fields.group_code')}
		/>
	</div>
	<div class="w-18">
		<Combobox
			options={currencies.map((value) => ({ value, label: value }))}
			value={currency}
			on_change={(value) => (chosenCurrency = value)}
			placeholder={ctx.t('models.pricing_floors.fields.currency')}
			aria-label={ctx.t('models.pricing_floors.fields.currency')}
		/>
	</div>
{/snippet}

{#snippet bookScope()}
	{@render scope()}
	<label class="sr-only" for="price-book-month">{ctx.t('component.price_book_month')}</label>
	<div class="w-36">
		<TimeInput
			{ctx}
			id="price-book-month"
			of="date"
			precision="month"
			value={`${month}-01`}
			on_change={(date: string | null) => {
				if (date !== null) chosenMonth = date.slice(0, 7);
			}}
		/>
	</div>
{/snippet}

{#snippet bookState()}
	{#if catalog.error || book?.error}
		<p role="alert" class="text-sm text-destructive">
			{catalog.error?.message ?? book?.error?.message}
		</p>
	{:else if catalog.loading || book?.loading}
		<p role="status" class="text-sm text-muted-foreground">
			{ctx.t('component.price_book_loading')}
		</p>
	{:else}
		<p class="p-10 text-center text-sm text-muted-foreground">
			{ctx.t('component.price_book_empty')}
		</p>
	{/if}
{/snippet}

{#snippet priceBook()}
	<CustomView
		{ctx}
		model="pricing_floors"
		key="monthly_price_book"
		of={rows}
		fields={[
			{ field: 'name', label: ctx.t('models.pricing_floors.fields.product') },
			{ field: 'code', label: ctx.t('models.products.fields.external_code') }
		]}
		empty={rows.length === 0 ? bookState : false}
		toolbar={{
			title: false,
			description: ctx.t('component.price_book_help'),
			controls: bookScope,
			new: ctx.catalog?.pricing_floors?.create ? create : false
		}}
	>
		{#snippet children(shown)}
			<Stack gap="sm" size="fill">
				{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
				<Scroll name="price-book" axis="both" size="fill" class="rounded-md border border-border">
					<table class="w-max min-w-full border-separate border-spacing-0 text-sm">
						<thead>
							<tr>
								<th
									class="bg-card sticky top-0 left-0 z-30 min-w-56 border-b border-border px-3 py-2 text-left font-medium"
								>
									{ctx.t('models.pricing_floors.fields.product')}
								</th>
								{#each ['unit', 'minimum_quantity'] as const as field (field)}
									<th
										class="bg-card sticky top-0 z-20 border-b border-border px-2 py-2 text-left font-medium whitespace-nowrap"
									>
										{ctx.t(`models.pricing_floors.fields.${field}`)}
									</th>
								{/each}
								{#each days as day (day)}
									<th
										class={[
											'bg-card sticky top-0 z-20 w-24 border-b border-border px-1.5 py-1 text-right font-medium whitespace-nowrap',
											day === today && 'text-foreground'
										]}
									>
										<span class="block text-[10px] font-normal text-muted-foreground"
											>{new Intl.DateTimeFormat(ctx.locale, {
												weekday: 'narrow',
												timeZone: 'UTC'
											}).format(new Date(day))}</span
										>
										{Number(day.slice(-2))}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each shown as row (row.key)}
								<tr>
									<td
										class="bg-card sticky left-0 z-10 min-w-56 border-b border-border px-3 py-1.5"
									>
										<span class="block truncate font-medium">{row.name}</span>
										<span class="text-meta block truncate text-muted-foreground"
											>{row.code}{row.band ? ` · ${row.band}` : ''}</span
										>
									</td>
									<td class="border-b border-border px-2 py-1.5 text-muted-foreground"
										>{row.unit}</td
									>
									<td class="border-b border-border px-2 py-1.5 text-muted-foreground tabular-nums"
										>{row.minimum_quantity}</td
									>
									{#each days as day (day)}
										{@const key = keyOf(row, day)}
										{@const cell = row.cells[day]}
										<td
											class={[
												'border-b border-border p-0 text-right',
												day === today && 'bg-muted/30'
											]}
										>
											{#if editing === key}
												<input
													class="h-8 w-24 rounded-none border-0 bg-transparent px-1.5 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
													bind:value={draft}
													onkeydown={(event) => {
														if (event.key === 'Enter') {
															event.preventDefault();
															void commit(row, day);
														} else if (event.key === 'Escape') {
															event.preventDefault();
															cancel();
														}
													}}
													onblur={() => void commit(row, day)}
													use:focusInput
													aria-label={`${row.name} ${day}`}
												/>
											{:else}
												<button
													type="button"
													class="group/cell hover:bg-muted flex h-8 w-full items-center justify-end px-1.5 tabular-nums"
													aria-label={`${row.name} ${day}`}
													disabled={writing !== null}
													onclick={() => start(row, day)}
												>
													{#if cell}
														{BigDecimal.format(BigDecimal.fromStringUnsafe(cell.floor_price))}
													{:else}
														<span
															class="text-muted-foreground opacity-0 group-hover/cell:opacity-100"
															>+</span
														>
													{/if}
												</button>
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</Scroll>
			</Stack>
		{/snippet}
	</CustomView>
{/snippet}

{#snippet history()}
	{#if catalog.current}
		<Table
			{ctx}
			of="pricing_floors"
			where={{
				...(group === null ? {} : { group_code: { eq: group } }),
				...(currency === null ? {} : { currency: { eq: currency } })
			}}
			toolbar={{ controls: scope }}
			columns={[
				'product',
				'group_code',
				'effective_on',
				'currency',
				'floor_price',
				'unit',
				'minimum_quantity'
			]}
		/>
	{:else}
		{@render bookState()}
	{/if}
{/snippet}

{#snippet commissionRules()}
	<Table
		{ctx}
		of="commission_rules"
		columns={['effective_on', 'currency', 'basis_unit', 'fixed_rate', 'spread_pct', 'active']}
		toolbar={{ title: false, description: ctx.t('component.commission_rules_hint') }}
	/>
{/snippet}

<AppShell
	description={ctx.t('app.trade_configuration.description')}
	icon="lucide:chart-no-axes-combined"
	title={ctx.t('section.pricing')}
	variant="full"
>
	<Tabs
		class="[&_[data-view-controls]]:contents"
		tabs={[
			{
				name: 'book',
				title: ctx.t('component.price_book'),
				icon: 'lucide:table-2',
				body: priceBook
			},
			{
				name: 'history',
				title: ctx.t('component.pricing_history'),
				icon: 'lucide:list',
				body: history
			},
			{
				name: 'commission',
				title: ctx.t('models.commission_rules.label'),
				icon: 'lucide:percent',
				body: commissionRules
			}
		]}
	/>
</AppShell>
