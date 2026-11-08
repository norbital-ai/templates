<script lang="ts">
	import { bolt, run } from '$bolt';
	import type { CurrencyCode } from '@norbital-ai/bolt';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { PlainDate } from '@norbital-ai/std/date';
	import {
		Button,
		Combobox,
		Icon,
		Input,
		Table,
		Tabs,
		TimeInput,
		useKinds,
		useBolt
	} from '@norbital-ai/ui';	import { AppShell, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { openCreate } from '../../lib/ui/create-values.js';
	import {
		monthDays,
		priceBookMonths,
		priceBookRead,
		priceBookRows,
		priceText,
		type PriceRow
	} from '../../lib/price-book.js';

	const kinds = useKinds();
	const translate = useBolt().t;
	const clock = bolt.clock('day');
	const today = clock.today;
	const currentMonth = today.slice(0, 7);
	const catalog = bolt.query({
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
		const counts = new Map<string, number>();
		for (const row of catalog.current?.pricing_floors.rows ?? [])
			counts.set(row.group_code, (counts.get(row.group_code) ?? 0) + 1);
		return [...counts.keys()].sort().map((code) => ({
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
	let search = $state('');
	const group = $derived(chosenGroup ?? defaultPair?.group ?? null);
	const currencies = $derived([
		...new Set(
			(catalog.current?.pricing_floors.rows ?? [])
				.filter((row) => row.group_code === group)
				.map((row) => row.currency)
		)
	].sort((a, b) => a.localeCompare(b)));
	const currency = $derived(
		chosenCurrency !== null && currencies.includes(chosenCurrency)
			? chosenCurrency
			: (currencies.find((value) => value === 'CNY') ?? currencies[0] ?? null)
	);
	const book = $derived(
		group !== null && currency !== null ? bolt.query(priceBookRead(group, currency)) : null
	);
	const months = $derived(book?.current ? priceBookMonths(book.current) : []);
	const month = $derived(
		chosenMonth ?? (months.includes(currentMonth) ? currentMonth : (months[0] ?? currentMonth))
	);
	const days = $derived(monthDays(month));
	const rows = $derived(
		book?.current ? priceBookRows(book.current, month, search) : ([] as readonly PriceRow[])
	);
	const weekday = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const weekdayOf = (day: string) => weekday[new Date(`${day}T00:00:00Z`).getUTCDay()];

	let editing = $state<string | null>(null);
	let draft = $state('');
	let writing = $state<string | null>(null);
	let error = $state<string | null>(null);
	const keyOf = (row: PriceRow, day: string) => `${row.key}|${day}`;
	function start(row: PriceRow, day: string) {
		if (writing !== null) return;
		error = null;
		editing = keyOf(row, day);
		draft = row.cells.has(day) ? priceText(row.cells.get(day)!.floor_price) : '';
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
		const existing = row.cells.get(day);
		if (existing && Decimal.of(existing.floor_price).eq(value)) return;
		let price: Decimal;
		try {
			price = Decimal.of(value);
		} catch {
			error = bolt.t('component.price_floor_positive');
			return;
		}
		if (!price.gt(0)) {
			error = bolt.t('component.price_floor_positive');
			return;
		}
		error = null;
		writing = key;
		try {
			const outcome = await run(
				existing
					? bolt.act(
							'pricing_floors.update',
							[{ target: existing.id, set: { floor_price: price } }],
							{ observed: { [existing.id]: existing.revision } }
						)
					: bolt.act('pricing_floors.create', [
							{
								product: row.product,
								group_code: group,
								currency,
								effective_on: PlainDate(day),
								unit: row.latest.unit,
								floor_price: price,
								tax_inclusive: row.latest.tax_inclusive,
								tax_rate: Decimal.of(row.latest.tax_rate),
								minimum_quantity: Decimal.of(row.minimum_quantity)
							}
						])
			);
			if (outcome.kind === 'pendingApproval') error = bolt.t('component.awaiting_approval');
			else if (outcome.kind !== 'committed') error = bolt.t('component.seal_uncertain');
		} catch (failure) {
			error =
				typeof failure === 'object' &&
				failure !== null &&
				'_tag' in failure &&
				failure._tag === 'ActRefused' &&
				'message' in failure &&
				typeof failure.message === 'string'
					? translate(failure.message)
					: bolt.t('component.seal_uncertain');
		} finally {
			writing = null;
		}
	}
	function create() {
		if (group === null || currency === null) return;
		openCreate('pricing_floors', {
			group_code: group,
			currency,
			effective_on: PlainDate(`${month}-01`)
		});
	}
	function focusInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
</script>

{#snippet controls()}
	<div class="flex min-w-0 flex-wrap items-center gap-2">
		<div class="w-48">
			<Combobox
				options={groups}
				value={group}
				onChange={(value) => (chosenGroup = value)}
				placeholder={bolt.t('models.pricing_floors.fields.group_code')}
				aria-label={bolt.t('models.pricing_floors.fields.group_code')}
			/>
		</div>
		<div class="w-28">
			<Combobox
				options={currencies.map((value) => ({ value, label: value }))}
				value={currency}
				onChange={(value) => (chosenCurrency = value)}
				placeholder={bolt.t('models.pricing_floors.fields.currency')}
				aria-label={bolt.t('models.pricing_floors.fields.currency')}
			/>
		</div>
		<label class="sr-only" for="price-book-month">{bolt.t('component.price_book_month')}</label>
		<div class="w-40">
			<TimeInput
				id="price-book-month"
				of="date"
				precision="month"
				value={`${month}-01`}
				onChange={(date: string | null) => {
					if (date !== null) chosenMonth = date.slice(0, 7);
				}}
			/>
		</div>
		<div class="w-56">
			<Input
				type="search"
				bind:value={search}
				placeholder={bolt.t('component.price_book_search')}
				aria-label={bolt.t('component.price_book_search')}
			/>
		</div>
		{#if kinds.catalog?.pricing_floors?.create}
			<Button variant="outline" onclick={create}>
				<Icon name="lucide:plus" class="size-4" />
				{bolt.t('component.price_book_new')}
			</Button>
		{/if}
	</div>
	<p class="text-sm text-muted-foreground">{bolt.t('component.price_book_help')}</p>
{/snippet}

{#snippet priceBook()}
	<Stack gap="sm" size="fill" class="h-full min-h-0">
		{@render controls()}
		{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		{#if book === null}
			<p class="p-10 text-center text-sm text-muted-foreground">
				{bolt.t('component.price_book_empty')}
			</p>
		{:else if book.error}
			<p role="alert" class="text-sm text-destructive">{book.error.message}</p>
		{:else if book?.current === undefined}
			<p class="text-sm text-muted-foreground">{bolt.t('component.price_book_loading')}</p>
		{:else}
			<Scroll name="price-book" axis="both" size="fill" class="rounded-md border border-border">
				{#if rows.length === 0}
					<p class="p-10 text-center text-sm text-muted-foreground">
						{bolt.t('component.price_book_empty')}
					</p>
				{:else}
					<table class="w-max min-w-full border-separate border-spacing-0 text-sm">
						<thead>
							<tr>
								<th
									class="bg-card sticky top-0 left-0 z-30 min-w-56 border-b border-border px-3 py-2 text-left font-medium"
								>
									{bolt.t('models.pricing_floors.fields.product')}
								</th>
								{#each ['unit', 'minimum_quantity'] as const as field (field)}
									<th
										class="bg-card sticky top-0 z-20 border-b border-border px-2 py-2 text-left font-medium whitespace-nowrap"
									>
										{bolt.t(`models.pricing_floors.fields.${field}`)}
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
											>{weekdayOf(day)}</span
										>
										{Number(day.slice(-2))}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each rows as row (row.key)}
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
										{@const cell = row.cells.get(day)}
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
														{priceText(cell.floor_price)}
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
				{/if}
			</Scroll>
		{/if}
	</Stack>
{/snippet}

{#snippet history()}
	{#if group !== null && currency !== null}
		<Table
			of="pricing_floors"
			where={{ group_code: { eq: group }, currency: { eq: currency } }}
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
	{/if}
{/snippet}

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.pricing_floors.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'book',
				title: bolt.t('component.price_book'),
				icon: 'lucide:table-2',
				body: priceBook
			},
			{
				name: 'history',
				title: bolt.t('component.pricing_history'),
				icon: 'lucide:list',
				body: history
			}
		]}
	/>
</AppShell>
