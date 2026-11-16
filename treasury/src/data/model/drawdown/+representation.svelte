<script lang="ts">
	/**
	 * One line: its fields (the generated form), then its figures (interest to maturity and accrued to today, charges
	 * actual and estimated, the warnings, and for an earmark the room on every bank line), and the purchase orders it
	 * pays. The footer starts what happens to a line next, each in its own sheet with one Save: allocate an earmark,
	 * record the drawdown advice, settle, pay cash or convert a bill, or cancel an earmark.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Button,
		Form,
		RecordShell,
		Sheet,
		Table,
		format,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { accruedDays, decimal, interest, sum, text } from '../../../lib/calculations.js';
	import { CONVERTIBLE } from '../../../lib/products.js';
	import {
		FACILITY_FIELDS,
		LINE_FIELDS,
		estimateCharges,
		headroom,
		lineWarnings,
		lineFigures,
		subLimitUsage,
		type Stage
	} from '../../../lib/treasury.js';
	let { view, ctx }: { view: RecordView<'drawdown'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const sections: readonly RecordSection[] = [
		{
			name: 'financing',
			icon: 'lucide:hand-coins',
			title: t('app.sections.financing'),
			fields: ['facility', 'supplier', 'product', 'status', 'currency', 'amount', 'fx_rate_to_usd']
		},
		{
			name: 'references',
			icon: 'lucide:hash',
			title: t('app.sections.references'),
			fields: ['bank_reference', 'lc_number', 'bill_number', 'purpose', 'requested_by']
		},
		{
			name: 'dates',
			icon: 'lucide:calendar-days',
			title: t('app.sections.dates'),
			fields: [
				'application_date',
				'released_date',
				'start_date',
				'due_date',
				'lc_expiry_date',
				'expected_draw_date',
				'earliest_invoice_date'
			]
		},
		{
			name: 'pricing',
			icon: 'lucide:percent',
			title: t('app.sections.pricing'),
			fields: [
				'interest_rate_pct',
				'rate_source',
				'charge_rate_pct',
				'day_count_basis',
				'terms_days'
			]
		},
		{
			name: 'settlement',
			icon: 'lucide:badge-check',
			title: t('app.sections.settlement'),
			fields: [
				'settlement_date',
				'settled_principal',
				'settled_interest',
				'settled_by',
				'converted_from'
			]
		},
		{
			name: 'evidence',
			icon: 'lucide:paperclip',
			title: t('app.sections.evidence'),
			fields: ['charges', 'documents'],
			default_open: false
		},
		{
			name: 'notes',
			icon: 'lucide:notebook-pen',
			title: t('app.sections.notes'),
			fields: ['notes', 'discrepancy_note', 'is_archived'],
			default_open: false
		}
	];

	const day = ctx.clock('day');
	const record = $derived(view.mode === 'create' ? null : view.record);
	const open = $derived(
		record !== null &&
			(record.status === 'earmarked' || record.status === 'applied' || record.status === 'active')
	);
	const bill = $derived(
		record !== null &&
			(record.status === 'applied' || record.status === 'active') &&
			CONVERTIBLE[record.product] !== undefined
	);

	const context = $derived.by(() => {
		const line = record;
		if (line === null) return null;
		return ctx.query({
			facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code', 'offered_products'] } },
			drawdown: {
				where: { status: { in: ['earmarked', 'applied', 'active'] } },
				fields: [...LINE_FIELDS, 'supplier']
			},
			facility_fee: {
				fields: [
					'facility',
					'fee_type',
					'product',
					'stage',
					'method',
					'currency',
					'rate_pct',
					'amount',
					'minimum_amount',
					'minimum_currency',
					'include_in_estimates'
				]
			},
			fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] },
			supplier_bank: { fields: ['supplier'], bank: { fields: ['code'] } },
			sub_limit: { fields: ['facility', 'name', 'product', 'supplier', 'limit'] },
			drawdown_charge: {
				where: { drawdown: { eq: line.id } },
				fields: ['charge_type', 'stage', 'currency', 'amount', 'description']
			},
			po_financing: {
				where: { drawdown: { eq: line.id } },
				fields: ['purchase_order'],
				purchase_order: {
					fields: ['po_number', 'po_date', 'currency'],
					lines: { fields: ['amount'] }
				}
			}
		});
	});
	const data = $derived(context?.current);
	const facility = $derived(data?.facility.rows.find((f) => f.id === record?.facility) ?? null);
	const rounding = $derived(facility?.interest_rounding ?? 'nearest_cent');
	const calculated = $derived(record === null ? null : lineFigures(record, facility));
	const accrued = $derived(
		record === null
			? null
			: interest(
					record.amount,
					record.interest_rate_pct,
					accruedDays(record.start_date, record.due_date, day.today),
					record.day_count_basis,
					rounding
				)
	);
	const actualStages = $derived<Stage[]>([
		...new Set((data?.drawdown_charge.rows ?? []).map((c) => c.stage))
	]);
	const estimates = $derived(
		record === null || data === undefined
			? []
			: estimateCharges(
					record,
					data.facility_fee.rows,
					actualStages,
					data.fx_rate.rows,
					record.start_date ?? day.today
				)
	);
	const charges = $derived([
		...(data?.drawdown_charge.rows ?? []).map((c) => ({ ...c, basis: t('app.line.actual') })),
		...estimates.map((c) => ({
			...c,
			currency: 'USD',
			description: null,
			basis: t('app.line.estimate')
		}))
	]);
	const warnings = $derived(
		record === null || data === undefined
			? []
			: lineWarnings(record, {
					facility,
					offered:
						facility === null
							? []
							: (data.facility.rows.find((f) => f.id === facility.id)?.bank?.offered_products ??
								[]),
					lines: data.drawdown.rows,
					eligible_banks:
						record.supplier === null
							? null
							: data.supplier_bank.rows
									.filter((s) => s.supplier === record.supplier)
									.map((s) => s.bank?.code ?? ''),
					sub_limits: subLimitUsage(record, data.sub_limit.rows, data.drawdown.rows),
					today: day.today
				})
	);
	const room = $derived(
		record?.status === 'earmarked' && data !== undefined
			? headroom(data.facility.rows, data.drawdown.rows, record.id)
			: []
	);
	const money = (value: string | null) =>
		value === null
			? '—'
			: format({ kind: 'money' }, value, {
					locale: ctx.locale,
					currency: record?.currency ?? 'USD'
				});

	const adviceStart = $derived(record?.start_date ?? record?.expected_draw_date ?? null);
	const converts = $derived(record === null ? undefined : CONVERTIBLE[record.product]?.[0]);
	let sheet = $state<null | 'allocate' | 'advice' | 'settle' | 'close' | 'cancel'>(null);
	const done = (outcome: { kind: string }) => {
		if (outcome.kind === 'committed') sheet = null;
	};
</script>

{#snippet figures()}
	<Stack gap="md">
		{#each warnings as w (w.key)}
			<Alert.Root variant="warning"
				><Alert.Description>{t(w.key, w.values)}</Alert.Description></Alert.Root
			>
		{/each}
		{#if estimates.some((e) => e.amount === null)}
			<Alert.Root variant="warning"
				><Alert.Description>{t('app.charges.missing_fx')}</Alert.Description></Alert.Root
			>
		{/if}
		<Grid minimum="compact">
			{#each [[t('app.line.tenor'), calculated?.tenor_days == null ? '—' : t( 'app.line.days', { days: calculated.tenor_days } )], [t('app.line.interest_to_maturity'), money(calculated?.interest_to_maturity ?? null)], [t('app.line.accrued_today'), money(accrued)], [t('app.line.latest_due'), calculated?.latest_due_date == null ? '—' : format( { kind: 'date' }, calculated.latest_due_date, { locale: ctx.locale } )]] as const as [title, value] (title)}
				<div class="rounded-xl border border-border bg-card p-4">
					<p class="text-meta">{title}</p>
					<p class="mt-1 text-lg font-semibold tabular-nums">{value}</p>
				</div>
			{/each}
		</Grid>
		<Table
			{ctx}
			of={charges}
			controlled
			embedded
			columns={[
				{ field: 'stage', label: t('app.line.stage') },
				{ field: 'charge_type', label: t('app.line.charge') },
				{ field: 'currency', label: t('app.line.currency') },
				{ field: 'amount', label: t('app.line.amount'), kind: { kind: 'decimal', scale: 2 } },
				{ field: 'basis', label: t('app.line.basis') }
			]}
		/>
		{#if room.length > 0}
			<Table
				{ctx}
				of={room}
				controlled
				embedded
				columns={[
					{ field: 'bank', label: t('app.line.bank') },
					{ field: 'name', label: t('app.line.facility') },
					{ field: 'limit', label: t('app.line.limit'), kind: { kind: 'decimal', scale: 2 } },
					{ field: 'used', label: t('app.line.used'), kind: { kind: 'decimal', scale: 2 } },
					{
						field: 'earmarked',
						label: t('app.line.earmarked'),
						kind: { kind: 'decimal', scale: 2 }
					},
					{
						field: 'available',
						label: t('app.line.available'),
						kind: { kind: 'decimal', scale: 2 }
					}
				]}
			/>
		{/if}
	</Stack>
{/snippet}

{#snippet orders()}
	<Table
		{ctx}
		of={(data?.po_financing.rows ?? []).map((l) => ({
			po_number: l.purchase_order?.po_number ?? '—',
			po_date: l.purchase_order?.po_date ?? null,
			currency: l.purchase_order?.currency ?? null,
			amount:
				l.purchase_order === null
					? null
					: text(sum(l.purchase_order.lines.map((line) => decimal(line.amount))))
		}))}
		controlled
		embedded
		columns={[
			{ field: 'po_number', label: t('app.line.po') },
			{ field: 'po_date', label: t('app.line.po_date'), kind: { kind: 'date' } },
			{ field: 'currency', label: t('app.line.currency') },
			{ field: 'amount', label: t('app.line.amount'), kind: { kind: 'decimal', scale: 2 } }
		]}
	/>
{/snippet}

{#snippet next()}
	{#if record?.status === 'earmarked'}
		<Button variant="outline" onclick={() => (sheet = 'allocate')}>{t('app.line.allocate')}</Button>
		<Button variant="outline" onclick={() => (sheet = 'cancel')}>{t('app.line.cancel')}</Button>
	{/if}
	{#if open}
		<Button variant="outline" onclick={() => (sheet = 'advice')}
			>{t('app.line.record_advice')}</Button
		>
	{/if}
	{#if record?.status === 'applied' || record?.status === 'active'}
		<Button variant="outline" onclick={() => (sheet = 'settle')}>{t('app.line.settle')}</Button>
	{/if}
	{#if bill}
		<Button variant="outline" onclick={() => (sheet = 'close')}>{t('app.line.close_bill')}</Button>
	{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="drawdown"
		{sections}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
	/>
{:else}
	<RecordShell
		{ctx}
		of="drawdown"
		{sections}
		id={record.id}
		subtitle={['supplier', 'due_date']}
		footer_actions={next}
		tabs={[
			{
				name: 'figures',
				title: t('app.line.figures'),
				icon: 'lucide:calculator',
				body: figures
			},
			{ name: 'orders', title: t('app.line.orders'), icon: 'lucide:file-text', body: orders }
		]}
	/>
	<Sheet
		open={sheet === 'allocate'}
		on_open_change={(o) => !o && (sheet = null)}
		title={t('app.line.allocate')}
	>
		<Form
			{ctx}
			of={{ automation: 'drawdown_allocate' }}
			values={{
				earmark: [record.id],
				product: record.product,
				...(record.interest_rate_pct === null
					? {}
					: { interest_rate_pct: record.interest_rate_pct })
			}}
			fields={['facility', 'product', 'interest_rate_pct', 'charge_rate_pct']}
			submit={t('app.line.allocate')}
			on_outcome={done}
		/>
	</Sheet>
	<Sheet
		open={sheet === 'advice'}
		on_open_change={(o) => !o && (sheet = null)}
		title={t('app.line.record_advice')}
	>
		<Form
			{ctx}
			of={{ automation: 'drawdown_record_advice' }}
			values={{
				line: [record.id],
				...(record.bank_reference === null ? {} : { bank_reference: record.bank_reference }),
				...(adviceStart === null ? {} : { start_date: adviceStart }),
				...(record.due_date === null ? {} : { due_date: record.due_date }),
				...(record.interest_rate_pct === null
					? {}
					: { interest_rate_pct: record.interest_rate_pct })
			}}
			fields={[
				'bank_reference',
				'start_date',
				'due_date',
				'released_date',
				'interest_rate_pct',
				'charges',
				'document'
			]}
			submit={t('app.line.record_advice')}
			on_outcome={done}
		/>
	</Sheet>
	<Sheet
		open={sheet === 'settle'}
		on_open_change={(o) => !o && (sheet = null)}
		title={t('app.line.settle')}
	>
		<Form
			{ctx}
			of={{ automation: 'drawdown_settle' }}
			values={{
				line: [record.id],
				principal: record.amount,
				...(record.due_date === null ? {} : { settlement_date: record.due_date }),
				...(calculated?.interest_to_maturity == null
					? {}
					: { interest: calculated.interest_to_maturity })
			}}
			fields={[
				'settlement_date',
				'principal',
				'interest',
				'interest_rate_pct',
				'charges',
				'document'
			]}
			submit={t('app.line.settle')}
			on_outcome={done}
		/>
	</Sheet>
	<Sheet
		open={sheet === 'close'}
		on_open_change={(o) => !o && (sheet = null)}
		title={t('app.line.close_bill')}
	>
		<Form
			{ctx}
			of={{ automation: 'drawdown_close_bill' }}
			values={{
				bill: [record.id],
				how: 'convert',
				...(record.due_date === null ? {} : { date: record.due_date }),
				...(converts === undefined ? {} : { new_product: converts })
			}}
			fields={[
				'how',
				'date',
				'new_product',
				'new_reference',
				'due_date',
				'interest_rate_pct',
				'new_amount',
				'charges'
			]}
			submit={t('app.line.close_bill')}
			on_outcome={done}
		/>
	</Sheet>
	<Sheet
		open={sheet === 'cancel'}
		on_open_change={(o) => !o && (sheet = null)}
		title={t('app.line.cancel')}
	>
		<Form
			{ctx}
			of={{ automation: 'drawdown_cancel' }}
			values={{ earmark: [record.id] }}
			fields={[]}
			submit={t('app.line.cancel')}
			on_outcome={done}
		/>
	</Sheet>
{/if}
