<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import type { CurrencyCode } from '@norbital-ai/bolt';
	import { BigDecimal, DateTime, Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import {
		Combobox,
		CustomView,
		Label,
		Table,
		TableSkeleton,
		Tabs,
		TimeInput,
		use_act
	} from '@norbital-ai/ui';
	import { create_inline_edit } from '@norbital-ai/ui/behaviors';
	import { AppShell, Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { openCreate } from '../../lib/ui/create-values.js';
	import {
		buildFloorMatrixXlsx,
		FloorMatrixError,
		parseFloorMatrixXlsx
	} from '../../lib/floor-matrix-xlsx.js';
	import {
		buildFloorMatrixExportRows,
		monthDays,
		planFloorMatrixImport,
		priceBookCatalogRead,
		priceBookDefaultsRead,
		priceBookExportMonthRead,
		priceBookExportPriorRead,
		priceBookImportFloorsRead,
		priceBookImportProductsRead,
		priceBookMonths,
		priceBookRead,
		priceBookRows,
		warehouseRegionLabels,
		type FloorMatrixImportIssue,
		type PriceRow
	} from '../../lib/price-book.js';
	import { downloadWorkbook } from '../../lib/xlsx.js';

	const settings = ctx.query({
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	});
	const rules = $derived(settings.current?.commercial_settings.rows[0]);
	const setFloorRule = (floor_rule: 'warn' | 'approve' | 'refuse') =>
		rules &&
		save.run(
			ctx.act({
				'commercial_settings.update': [
					{ target: { id: rules.id, revision: rules.revision }, set: { floor_rule } }
				]
			})
		);
	const clock = ctx.clock('day');
	const today = clock.today;
	const currentMonth = today.slice(0, 7);
	const catalog = ctx.query(priceBookCatalogRead);
	const groups = $derived.by(() => {
		const warehouses = catalog.current?.warehouses.rows ?? [];
		const regionLabels = warehouseRegionLabels(warehouses);
		const names = new Map<string, string[]>();
		for (const warehouse of warehouses) {
			if (!warehouse.group_code) continue;
			const list = names.get(warehouse.group_code) ?? [];
			list.push(warehouse.name);
			names.set(warehouse.group_code, list);
		}
		const codes = new Set(names.keys());
		for (const row of catalog.current?.pricing_floors.rows ?? []) codes.add(row.key.group_code);
		return [...codes].sort().map((code) => {
			const groupLabel = regionLabels.get(code);
			const list = names.get(code);
			return {
				value: code,
				label:
					groupLabel && groupLabel !== code
						? `${groupLabel} (${code})`
						: list
							? `${code} · ${list.join(', ')}`
							: code
			};
		});
	});
	/** The group and currency that already hold the most prices, so the book opens on a real pair. */
	const defaultPair = $derived.by(() => {
		const counts = new Map<string, { group: string; currency: CurrencyCode; count: number }>();
		for (const bucket of catalog.current?.pricing_floors.rows ?? []) {
			const row = bucket.key;
			const key = JSON.stringify([row.group_code, row.currency]);
			const found = counts.get(key);
			if (found) found.count += bucket.count;
			else counts.set(key, { group: row.group_code, currency: row.currency, count: bucket.count });
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
					.filter((row) => row.key.group_code === group)
					.map((row) => row.key.currency)
			)
		].sort((a, b) => a.localeCompare(b))
	);
	const currency = $derived(
		chosenCurrency !== null && currencies.includes(chosenCurrency)
			? chosenCurrency
			: (currencies.find((value) => value === 'CNY') ?? currencies[0] ?? null)
	);
	const activeCurrency = $derived<CurrencyCode>(currency ?? 'CNY');
	const months = $derived(catalog.current ? priceBookMonths(catalog.current, group, currency) : []);
	const month = $derived(
		chosenMonth ?? (months.includes(currentMonth) ? currentMonth : (months[0] ?? currentMonth))
	);
	const book = $derived(
		group !== null && currency !== null ? ctx.query(priceBookRead(group, currency, month)) : null
	);
	const days = $derived(monthDays(month));
	const rows = $derived(book?.current ? priceBookRows(book.current, month) : []);

	const save = use_act(ctx);
	let readingDefaults = $state(false);
	let uploading = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	const keyOf = (row: PriceRow, day: string) => `${row.key}|${day}`;
	const rowByKey = $derived(new Map(rows.map((row) => [row.key, row])));
	function parseCellId(id: string): { readonly row: PriceRow; readonly day: string } | null {
		const sep = id.lastIndexOf('|');
		if (sep < 0) return null;
		const row = rowByKey.get(id.slice(0, sep));
		const day = id.slice(sep + 1);
		return row !== undefined ? { row, day } : null;
	}
	function commitPrice(row: PriceRow, day: string, raw: string) {
		const value = raw.trim();
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
		error = null;
		notice = null;
		const scope = { group, currency };
		// The day's floor is one keyed upsert; only a blank cell needs the latest row's metadata.
		const write = (defaults: Pick<PriceRow['latest'], 'unit' | 'tax_inclusive' | 'tax_rate'>) =>
			save.run(
				ctx.act({
					'pricing_floors.import': {
						rows: [
							{
								product: row.product,
								group_code: scope.group,
								currency: scope.currency,
								effective_on: day,
								unit: defaults.unit,
								floor_price: value,
								tax_inclusive: defaults.tax_inclusive,
								tax_rate: defaults.tax_rate
							}
						],
						on_conflict: 'update'
					}
				})
			);
		if (existing) write(existing);
		else {
			readingDefaults = true;
			fork(
				ctx.query(priceBookDefaultsRead(scope.group, scope.currency, row.product)).pipe(
					Effect.tap((answer) =>
						Effect.sync(() => write(answer.pricing_floors.rows[0] ?? row.latest))
					),
					Effect.ensuring(
						Effect.sync(() => {
							readingDefaults = false;
						})
					)
				),
				(cause) => {
					error = cause.message;
				}
			);
		}
	}
	const cellEdit = create_inline_edit({
		disabled: () => save.pending || readingDefaults || uploading,
		value: (id) => {
			const parsed = parseCellId(id);
			const cell = parsed?.row.cells[parsed.day];
			return cell ? BigDecimal.format(BigDecimal.fromStringUnsafe(cell.floor_price)) : '';
		},
		commit: (id, text) => {
			const parsed = parseCellId(id);
			if (parsed !== null) commitPrice(parsed.row, parsed.day, text);
		},
		on_tab: (id, direction) => {
			const parsed = parseCellId(id);
			if (parsed === null) return;
			const nextDay = days[days.indexOf(parsed.day) + direction];
			if (nextDay !== undefined) cellEdit.begin(keyOf(parsed.row, nextDay), 'imperative');
		}
	});
	function create() {
		openCreate('pricing_floors', {
			...(group === null ? {} : { group_code: group }),
			...(currency === null ? {} : { currency }),
			effective_on: `${month}-01`
		});
	}
	const downloadMatrix = (): Effect.Effect<void, Error> =>
		Effect.gen(function* () {
			const targetCurrency = activeCurrency;
			const targetMonth = month;
			const targetDays = monthDays(targetMonth);
			const monthAnswer = yield* ctx.query(priceBookExportMonthRead(targetCurrency, targetMonth));
			const priorAnswer = yield* ctx.query(priceBookExportPriorRead(targetCurrency, targetMonth));
			const exportRows = buildFloorMatrixExportRows({
				month: targetMonth,
				warehouses: catalog.current?.warehouses.rows ?? [],
				products: monthAnswer.products.rows,
				monthFloors: monthAnswer.pricing_floors.rows,
				priorFloors: priorAnswer.pricing_floors.rows
			});
			const stamp = DateTime.formatIso(yield* DateTime.now);
			const bytes = buildFloorMatrixXlsx(targetDays, exportRows, { stamp });
			downloadWorkbook(`price-book-${targetCurrency}-${targetMonth}.xlsx`, bytes);
		}).pipe(
			Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))
		);

	const describeIssue = (issue: FloorMatrixImportIssue): string => {
		const detail = issue.raw ? ` (${issue.raw})` : '';
		const reason = ctx.t(`component.price_book_issue.${issue.reason}`);
		return `#${issue.rowNo} ${issue.column}: ${reason}${detail}`;
	};

	function handleMatrixFile(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		error = null;
		notice = null;
		uploading = true;
		const targetCurrency = activeCurrency;
		const targetMonth = month;
		const warehouses = catalog.current?.warehouses.rows ?? [];
		const knownGroups = groups.map((g) => g.value);
		fork(
			Effect.gen(function* () {
				const buffer = yield* Effect.tryPromise({
					try: () => file.arrayBuffer(),
					catch: () =>
						new FloorMatrixError({
							code: 'unreadable',
							message: ctx.t('component.price_book_issue.unreadable')
						})
				});
				const parsed = yield* parseFloorMatrixXlsx(new Uint8Array(buffer), targetMonth);
				const codes = [...new Set(parsed.cells.map((cell) => cell.code).filter(Boolean))];
				const productsAnswer =
					codes.length > 0 ? yield* ctx.query(priceBookImportProductsRead(codes)) : null;
				const products = productsAnswer?.products.rows ?? [];
				const productIds = products.map((product) => product.id);
				const existingAnswer =
					productIds.length > 0
						? yield* ctx.query(priceBookImportFloorsRead(targetCurrency, productIds))
						: null;
				const plan = planFloorMatrixImport({
					parsed,
					currency: targetCurrency,
					warehouses,
					knownGroups,
					products,
					existing: existingAnswer?.pricing_floors.rows ?? []
				});
				if (plan.issues.length > 0) {
					const stale = plan.issues.some((issue) => issue.reason === 'stale');
					const preview = plan.issues.slice(0, 5).map(describeIssue).join('; ');
					const extra = plan.issues.length > 5 ? ` (+${plan.issues.length - 5})` : '';
					error = stale
						? `${ctx.t('errors.price_book_stale')} (${preview}${extra})`
						: `${ctx.t('component.price_book_upload_errors', { count: String(plan.issues.length) })} ${preview}${extra}`;
					return;
				}
				if (plan.rows.length === 0) {
					notice = ctx.t('component.price_book_no_changes');
					return;
				}
				const saved = ctx.t('component.price_book_uploaded', {
					count: String(plan.rows.length)
				});
				save.run(
					ctx.act({
						'pricing_floors.import': {
							rows: plan.rows,
							on_conflict: 'update'
						}
					}),
					{
						saved,
						then: () => {
							notice = saved;
						}
					}
				);
			}).pipe(
				Effect.catch((cause) =>
					Effect.sync(() => {
						error =
							cause instanceof FloorMatrixError
								? ctx.t(`component.price_book_issue.${cause.code}`)
								: cause instanceof Error
									? cause.message
									: String(cause);
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						uploading = false;
					})
				)
			)
		);
	}
</script>

<input
	bind:this={fileInput}
	type="file"
	accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	class="sr-only"
	onchange={handleMatrixFile}
/>

{#snippet scopeControls(prefix: string)}
	<Inline gap="sm" align="center">
		<Label for={`${prefix}-group`}>{ctx.t('models.pricing_floors.fields.group_code')}</Label>
		<Combobox
			id={`${prefix}-group`}
			options={groups}
			value={group}
			on_change={(value) => (chosenGroup = value)}
			placeholder={ctx.t('models.pricing_floors.fields.group_code')}
		/>
	</Inline>
	<Inline gap="sm" align="center">
		<Label for={`${prefix}-currency`}>{ctx.t('models.pricing_floors.fields.currency')}</Label>
		<Combobox
			id={`${prefix}-currency`}
			options={currencies.map((value) => ({ value, label: value }))}
			value={currency}
			on_change={(value) => (chosenCurrency = value)}
			placeholder={ctx.t('models.pricing_floors.fields.currency')}
		/>
	</Inline>
{/snippet}

{#snippet scope()}
	<Cluster gap="sm" align="center">
		{@render scopeControls('pricing-history')}
	</Cluster>
{/snippet}

{#snippet bookScope()}
	<Cluster gap="sm" align="center">
		{@render scopeControls('price-book')}
		{#if rules}
			<Inline gap="sm" align="center">
				<Label for="price-book-floor-rule"
					>{ctx.t('models.commercial_settings.fields.floor_rule')}</Label
				>
				<Combobox
					id="price-book-floor-rule"
					options={(['warn', 'approve', 'refuse'] as const).map((value) => ({
						value,
						label: ctx.t(`models.commercial_settings.fields.floor_rule.${value}`)
					}))}
					value={rules.floor_rule}
					disabled={save.pending}
					on_change={(value) => {
						if (value) setFloorRule(value);
					}}
				/>
			</Inline>
		{/if}
		<Inline gap="sm" align="center">
			<Label for="price-book-month">{ctx.t('component.price_book_month')}</Label>
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
		</Inline>
	</Cluster>
{/snippet}

{#snippet feedback()}
	{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	{#if notice}<p role="status" class="text-sm text-muted-foreground">{notice}</p>{/if}
{/snippet}

{#snippet bookState()}
	<Stack gap="sm">
		{@render feedback()}
		{#if catalog.error || book?.error}
			<p role="alert" class="text-sm text-destructive">
				{catalog.error?.message ?? book?.error?.message}
			</p>
		{:else if catalog.loading || book?.loading}
			<div aria-busy="true" aria-label={ctx.t('component.price_book_loading')}>
				<TableSkeleton />
			</div>
		{:else}
			<p class="p-10 text-center text-sm text-muted-foreground">
				{ctx.t('component.price_book_empty')}
			</p>
		{/if}
	</Stack>
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
			actions: [
				{
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('component.price_book_download_xlsx'),
					run: () => downloadMatrix()
				},
				...(ctx.catalog?.pricing_floors?.create
					? [
							{
								icon: 'lucide:upload',
								name: ctx.t('component.price_book_upload_xlsx'),
								disabled: () =>
									uploading || save.pending ? ctx.t('component.price_book_uploading') : null,
								run: () => {
									fileInput?.click();
								}
							}
						]
					: [])
			],
			new: ctx.catalog?.pricing_floors?.create ? create : false
		}}
	>
		{#snippet children(shown)}
			<Stack gap="sm" size="fill">
				{@render feedback()}
				<Scroll
					name="price-book"
					axis="both"
					size="fill"
					class="rounded-control border border-border"
				>
					<table class="w-max min-w-full border-separate border-spacing-0 text-sm">
						<thead>
							<tr>
								<th
									class="bg-card sticky top-0 left-0 z-30 min-w-56 border-b border-border px-3 py-2 text-left font-medium"
								>
									{ctx.t('models.pricing_floors.fields.product')}
								</th>
								<th
									class="bg-card sticky top-0 z-20 border-b border-border px-2 py-2 text-left font-medium whitespace-nowrap"
								>
									{ctx.t('models.pricing_floors.fields.unit')}
								</th>
								{#each days as day (day)}
									<th
										class={[
											'bg-card sticky top-0 z-20 w-24 border-b border-border px-1.5 py-1 text-right font-medium whitespace-nowrap',
											day === today && 'text-foreground'
										]}
									>
										<span class="block text-tiny text-muted-foreground"
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
										<span class="text-meta block truncate">{row.code}</span>
									</td>
									<td class="border-b border-border px-2 py-1.5 text-muted-foreground"
										>{row.unit}</td
									>
									{#each days as day (day)}
										{@const key = keyOf(row, day)}
										{@const cell = row.cells[day]}
										<td
											class={[
												'border-b border-border p-0 text-right',
												day === today && 'bg-surface-muted'
											]}
										>
											{#if cellEdit.is_editing(key)}
												<input
													class="h-8 w-24 rounded-none border-0 bg-transparent px-1.5 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
													{@attach cellEdit.input}
													{...cellEdit.input_attrs()}
													aria-label={`${row.name} ${day}`}
												/>
											{:else}
												<button
													type="button"
													class="group/cell hover:bg-muted flex h-8 w-full items-center justify-end px-1.5 tabular-nums"
													aria-label={`${row.name} ${day}`}
													disabled={save.pending || readingDefaults || uploading}
													onclick={() => {
														error = null;
														notice = null;
														cellEdit.begin(key, 'imperative');
													}}
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
			columns={['product', 'group_code', 'effective_on', 'currency', 'floor_price', 'unit']}
		/>
	{:else}
		{@render bookState()}
	{/if}
{/snippet}

<AppShell
	description={ctx.t('settings.pricing.description')}
	icon="lucide:chart-no-axes-combined"
	title={ctx.t('section.pricing')}
	variant="full"
>
	<Tabs
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
			}
		]}
	/>
</AppShell>
