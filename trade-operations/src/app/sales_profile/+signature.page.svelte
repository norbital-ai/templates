<script lang="ts">
	import { bolt, run } from '$bolt';
	import {
		Badge,
		Button,
		Field,
		Form,
		Icon,
		Section,
		Show,
		Table,
		type ShowProps,
		openRecord
	} from '@norbital-ai/ui';
	import { AppShell, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Decimal } from '@norbital-ai/std/decimal';
	import * as Base64 from 'effect/encoding/Base64';
	import {
		latestSignatureRead,
		SIGNATURE_BYTES,
		signatureUri
	} from '../../lib/salesperson-signatures.js';

	const day = bolt.clock('day');
	const member = bolt.actor?.kind === 'member' ? bolt.actor.id : null;
	const query = member === null ? null : bolt.query(latestSignatureRead(member));
	const profile =
		member === null
			? null
			: bolt.query({
					orders: {
						where: {
							owner: { eq: member },
							direction: { eq: 'sales' },
							archived: { eq: false }
						},
						fields: [
							'id',
							'number',
							'title',
							'party_name',
							'status',
							'ordered_on',
							'delivery_date',
							'agreed_total',
							'currency'
						],
						orderBy: [{ ordered_on: 'desc' }],
						limit: 500
					},
					activities: {
						where: { done: { eq: false } },
						fields: ['id', 'order', 'title', 'kind', 'due_on', 'notes'],
						orderBy: [{ due_on: 'asc' }],
						limit: 200
					},
					transactions: {
						fields: ['order', 'kind', 'status'],
						limit: 1000
					},
					commission_statements: {
						where: { owner: { eq: member } },
						fields: ['id', 'number', 'period', 'currency', 'amount', 'acknowledged_at'],
						orderBy: [{ period: 'desc' }, { number: 'desc' }],
						limit: 200
					}
				});
	const latest = $derived(query?.current?.salesperson_signatures.rows[0]);
	const current = $derived(latest?.signature ? signatureUri(latest.signature.png) : null);
	const orderCount = $derived(profile?.current?.orders.rows.length ?? 0);
	const latestStatement = $derived(profile?.current?.commission_statements.rows[0]);
	const orderBy = $derived(
		new Map((profile?.current?.orders.rows ?? []).map((order) => [order.id, order]))
	);
	const orderTotals = $derived.by(() => {
		const totals = new Map<string, Decimal>();
		for (const order of profile?.current?.orders.rows ?? []) {
			if (order.status !== 'confirmed' || order.agreed_total == null) continue;
			totals.set(
				order.currency,
				(totals.get(order.currency) ?? Decimal.of(0)).plus(order.agreed_total)
			);
		}
		return [...totals].map(([currency, amount]) => ({ currency, amount }));
	});
	const commissionTotals = $derived.by(() => {
		const totals = new Map<string, Decimal>();
		for (const statement of profile?.current?.commission_statements.rows ?? [])
			totals.set(
				statement.currency,
				(totals.get(statement.currency) ?? Decimal.of(0)).plus(statement.amount)
			);
		return [...totals].map(([currency, amount]) => ({ currency, amount }));
	});
	const followUps = $derived.by(() =>
		(profile?.current?.activities.rows ?? []).map((activity) => {
			const order = orderBy.get(activity.order);
			return {
				...activity,
				order_number: order?.number ?? '',
				party_name: order?.party_name ?? '',
				overdue: activity.due_on < day.today,
				order_id: activity.order
			};
		})
	);
	const delivered = $derived(
		new Set(
			(profile?.current?.transactions.rows ?? [])
				.filter((transaction) => transaction.kind === 'delivery' && transaction.status === 'issued')
				.map((transaction) => transaction.order)
		)
	);
	const invoiced = $derived(
		new Set(
			(profile?.current?.transactions.rows ?? [])
				.filter((transaction) => transaction.kind === 'invoice' && transaction.status === 'issued')
				.map((transaction) => transaction.order)
		)
	);
	const openOrders = $derived.by(() =>
		(profile?.current?.orders.rows ?? []).map((order) => {
			const action =
				order.status === 'draft'
					? bolt.t('component.sales_action_draft')
					: order.delivery_date && order.delivery_date < day.today
						? bolt.t('component.sales_action_overdue')
						: !delivered.has(order.id)
							? bolt.t('component.sales_action_no_delivery')
							: !invoiced.has(order.id)
								? bolt.t('component.sales_action_no_invoice')
								: null;
			return {
				...order,
				next_action: action ?? bolt.t('component.sales_in_progress'),
				attention: action !== null
			};
		})
	);
	const attentionOrders = $derived(openOrders.filter((order) => order.attention));
	let invalidFile = $state(false);
	let fileName = $state<string | null>(null);
	let clearing = $state(false);
	let clearFailed = $state(false);

	async function selectSignature(
		input: HTMLInputElement,
		update: (value: { png: string } | null) => void
	) {
		invalidFile = false;
		fileName = null;
		update(null);
		const file = input.files?.[0];
		if (!file) return;
		try {
			if (file.size > SIGNATURE_BYTES) throw new Error('Signature exceeds upload limit.');
			const encoded = Base64.encode(new Uint8Array(await file.arrayBuffer()));
			if (!signatureUri(encoded)) throw new Error('Signature PNG is invalid.');
			(await createImageBitmap(file)).close();
			if (input.files?.[0] === file) {
				fileName = file.name;
				update({ png: encoded });
			}
		} catch {
			if (input.files?.[0] === file) invalidFile = true;
		}
	}

	async function clearSignature() {
		clearing = true;
		clearFailed = false;
		try {
			await run(bolt.act('salesperson_signatures.create', [{}]));
		} catch {
			clearFailed = true;
		} finally {
			clearing = false;
		}
	}
</script>

{#snippet dueCell({ value }: { value: ShowProps['value'] })}
	<Show kind={{ kind: 'date' }} {value} />
{/snippet}
{#snippet statusCell({ row }: { row: { status: string } })}
	<Badge variant={row.status === 'confirmed' ? 'success' : 'outline'}>{row.status}</Badge>
{/snippet}
{#snippet attentionCell({ row }: { row: { next_action: string; attention: boolean } })}
	<span class={row.attention ? 'text-amber-600' : 'text-muted-foreground'}>{row.next_action}</span>
{/snippet}
{#snippet overdueCell({ row }: { row: { overdue: boolean } })}
	{#if row.overdue}<Badge variant="warning">{bolt.t('component.sales_overdue')}</Badge>{/if}
{/snippet}

<AppShell
	icon="lucide:signature"
	title={bolt.t('app.sales_profile.title')}
	description={bolt.t('app.sales_profile.description')}
	variant="full"
>
	<Scroll name="sales-profile" size="fill" inset>
		<Stack gap="lg">
			{#if profile?.error}
				<p role="alert">{profile.error.message}</p>
			{:else if profile?.current === undefined}
				<p role="status">{bolt.t('component.settings_loading')}</p>
			{:else}
				<Section
					name="performance"
					icon="lucide:chart-column"
					title={bolt.t('component.sales_performance')}
					collapsible={false}
				>
					<Grid minimum="compact" gap="md">
						<div class="border-border rounded-lg border p-4">
							<p class="text-muted-foreground text-xs font-medium">
								{bolt.t('component.sales_confirmed_orders')}
							</p>
							<p class="mt-1 text-2xl font-semibold">{orderCount}</p>
						</div>
						{#each orderTotals as total (total.currency)}
							<div class="border-border rounded-lg border p-4">
								<p class="text-muted-foreground text-xs font-medium">
									{bolt.t('component.sales_agreed_value')} · {total.currency}
								</p>
								<p class="mt-1 text-2xl font-semibold">
									<Show
										kind={{ kind: 'money', currency: 'currency' }}
										value={total.amount}
										row={total}
									/>
								</p>
							</div>
						{/each}
						{#each commissionTotals as total (total.currency)}
							<div class="border-border rounded-lg border p-4">
								<p class="text-muted-foreground text-xs font-medium">
									{bolt.t('component.sales_commission_total')} · {total.currency}
								</p>
								<p class="mt-1 text-2xl font-semibold">
									<Show
										kind={{ kind: 'money', currency: 'currency' }}
										value={total.amount}
										row={total}
									/>
								</p>
							</div>
						{/each}
					</Grid>
					{#if orderCount === 0 && commissionTotals.length === 0}
						<p class="text-muted-foreground text-sm">{bolt.t('component.sales_no_performance')}</p>
					{/if}
					{#if latestStatement}
						<div
							class="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4"
						>
							<div>
								<p class="text-muted-foreground text-xs font-medium">
									{bolt.t('component.sales_latest_statement')}
								</p>
								<p class="mt-1 text-sm">
									{latestStatement.number} · {latestStatement.period.slice(0, 7)}
								</p>
							</div>
							<p class="text-lg font-semibold">
								<Show
									kind={{ kind: 'money', currency: 'currency' }}
									value={latestStatement.amount}
									row={latestStatement}
								/>
							</p>
						</div>
					{/if}
				</Section>

				<Section
					name="follow-ups"
					icon="lucide:list-checks"
					title={bolt.t('component.sales_follow_ups')}
					collapsible={false}
				>
					{#if followUps.length}
						<Table
							of={followUps}
							key="profile-follow-ups"
							columns={[
								{ field: 'title', label: bolt.t('models.activities.fields.title') },
								{ field: 'kind', label: bolt.t('models.activities.fields.kind') },
								{
									field: 'due_on',
									label: bolt.t('models.activities.fields.due_on'),
									cell: dueCell
								},
								{ field: 'overdue', label: bolt.t('component.sales_overdue'), cell: overdueCell },
								{ field: 'order_number', label: bolt.t('models.orders.singular') },
								{ field: 'party_name', label: bolt.t('models.orders.fields.party_name') }
							]}
							onOpen={(row) => openRecord('orders', row.order)}
							toolbar={{ new: false, select: false }}
						/>
					{:else}
						<p class="text-muted-foreground text-sm">{bolt.t('component.sales_no_follow_ups')}</p>
					{/if}
					{#if attentionOrders.length}
						<div class="mt-4">
							<h4 class="mb-2 text-sm font-semibold">
								{bolt.t('component.sales_needs_attention')}
							</h4>
							<Table
								of={attentionOrders}
								key="profile-attention"
								columns={[
									{ field: 'number', label: bolt.t('models.orders.singular') },
									{ field: 'title', label: bolt.t('models.orders.fields.title') },
									{ field: 'party_name', label: bolt.t('models.orders.fields.party_name') },
									{
										field: 'next_action',
										label: bolt.t('component.sales_next_action'),
										cell: attentionCell
									}
								]}
								onOpen={(row) => openRecord('orders', row.id)}
								toolbar={{ new: false, select: false }}
							/>
						</div>
					{/if}
				</Section>

				<Section
					name="open-orders"
					icon="lucide:clipboard-list"
					title={bolt.t('component.sales_open_orders')}
					collapsible={false}
				>
					{#if openOrders.length}
						<Table
							of={openOrders}
							key="profile-open-orders"
							columns={[
								{ field: 'number', label: bolt.t('models.orders.singular') },
								{ field: 'title', label: bolt.t('models.orders.fields.title') },
								{ field: 'party_name', label: bolt.t('models.orders.fields.party_name') },
								{ field: 'status', label: bolt.t('models.orders.fields.status'), cell: statusCell },
								{
									field: 'delivery_date',
									label: bolt.t('models.orders.fields.delivery_date'),
									cell: dueCell
								},
								{
									field: 'next_action',
									label: bolt.t('component.sales_next_action'),
									cell: attentionCell
								}
							]}
							onOpen={(row) => openRecord('orders', row.id)}
							toolbar={{ new: false, select: false }}
						/>
					{:else}
						<p class="text-muted-foreground text-sm">{bolt.t('component.sales_no_open_orders')}</p>
					{/if}
				</Section>

				<Section
					name="signature"
					icon="lucide:signature"
					title={bolt.t('component.sales_signature')}
					collapsible={false}
				>
					{#if query?.error}
						<p role="alert">{query.error.message}</p>
					{:else if query?.current === undefined}
						<p role="status">{bolt.t('component.settings_loading')}</p>
					{:else}
						<Stack gap="sm">
							{#if current}
								<div class="border-border w-fit rounded-lg border bg-white p-3">
									<img
										class="max-h-20 max-w-60 object-contain"
										src={current}
										alt={bolt.t('component.sales_signature_current')}
									/>
								</div>
							{:else}
								<p class="text-muted-foreground text-sm">
									{bolt.t('component.sales_no_signature')}
								</p>
							{/if}
							{#key latest?.id}
								<Form
									of="salesperson_signatures"
									mode="create"
									submit={bolt.t('component.sales_save_signature')}
								>
									<Field name="signature">
										{#snippet editor(field)}
											<label
												class="border-input hover:bg-muted inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
												for={field.id}
											>
												<Icon name="lucide:upload" class="size-4" />
												{bolt.t('component.sales_choose_signature')}
											</label>
											<input
												id={field.id}
												type="file"
												accept="image/png"
												class="sr-only"
												disabled={field.disabled}
												onchange={(event) => selectSignature(event.currentTarget, field.onChange)}
											/>
											{#if fileName}<span class="text-muted-foreground text-sm">{fileName}</span
												>{/if}
											{#if invalidFile}<p role="alert">{bolt.t('errors.signature_png')}</p>{/if}
										{/snippet}
									</Field>
								</Form>
							{/key}
							{#if current}
								<div>
									<Button variant="outline" disabled={clearing} onclick={clearSignature}>
										{bolt.t('component.sales_signature_clear')}
									</Button>
								</div>
							{/if}
							{#if clearFailed}<p role="alert">
									{bolt.t('component.sales_signature_clear_failed')}
								</p>{/if}
						</Stack>
					{/if}
				</Section>
			{/if}
		</Stack>
	</Scroll>
</AppShell>
