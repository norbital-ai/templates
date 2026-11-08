<script lang="ts">
	import { attach, fork, bolt } from '$bolt';
	import { Effect, Result, Schema, Scope } from 'effect';
	import { Decimal } from '@norbital-ai/std/decimal';
	import {
		agreements,
		awaitingKingdee,
		currentAgreement,
		type ContractVersion
	} from '../../../lib/agreements.js';
	import {
		confirmationCheck,
		confirmationHash,
		confirmationRead,
		quotationFifoCosts
	} from '../../../lib/confirmation.js';
	import { purchaseLotCostRead } from '../../../lib/lot-cost.js';
	import {
		selectedContractDocuments,
		retainedContractDocuments
	} from '../../../lib/contract-files.js';
	import {
		Table,
		Section,
		Button,
		Show,
		Picker,
		FileInput,
		Combobox,
		Badge,
		Popover,
		EmptyState,
		Tooltip,
		Icon,
		RunStatus,
		TimeRangeInput,
		useKinds,
		useBolt,
		useRecordController,
		enumText,
		type FieldEditor,
		type FormState,
		type RecordView,
		openRecord
	} from '@norbital-ai/ui';
	import { Stack, Grid, Cluster, Scroll } from '@norbital-ai/ui/layout';
	import { kingdeeConnectionStatus } from '../../../integration/kingdee/connection-status.js';
	import OrderDocumentDialog from './order-document-dialog.svelte';
	import PrintDetails from '../../../lib/ui/print-details.svelte';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { createValues, openCreate } from '../../../lib/ui/create-values.js';
	const moneyKind = { kind: 'money', currency: 'currency' } as const;
	function displayDecimal(value: string) {
		const exact = Decimal.of(value).toString();
		return exact.includes('.') ? exact.replace(/0+$/, '').replace(/\.$/, '') : exact;
	}

	const DocumentRefs = Schema.Array(
		Schema.Struct({ id: Schema.String, name: Schema.String, mime: Schema.String })
	);
	const DocumentIds = Schema.Array(Schema.String);
	function draftDocuments(form: FormState) {
		const registry = form.get('supporting_documents');
		const selected = form.get('draft_document_ids');
		return selectedContractDocuments(
			Schema.is(DocumentRefs)(registry) ? registry : [],
			selected == null ? null : Schema.is(DocumentIds)(selected) ? selected : []
		);
	}

	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	let {
		view
	}: {
		view: RecordView<'orders'>;
	} = $props();
	const kinds = useKinds();
	// a narrower output (logistics) carries no commercial terms
	const commercial = $derived(kinds.catalog?.orders?.output === undefined);
	const translate = useBolt().t;
	const statusText = (status: string) =>
		enumText(status, { t: translate, model: 'ext_sales_orders', field: 'status' });
	const recordController = useRecordController();
	let pending = $state(false);
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const preset = createValues();
	const purchase = $derived(
		view.mode === 'create'
			? (view.values && 'direction' in view.values
					? view.values.direction
					: 'direction' in preset
						? preset.direction
						: undefined) === 'purchasing'
			: view.record.direction === 'purchasing'
	);
	const ledgerRead = $derived(
		id && commercial && !purchase
			? bolt.query({
					orders: { where: { id: { eq: id } }, fields: ['ledger'], limit: 1 },
					'orders.ledger': { fields: ['active', 'status'] }
				})
			: null
	);
	const ledger = $derived(ledgerRead?.current?.orders.rows[0]?.ledger);
	const sourceState = $derived(ledger ? kingdeeConnectionStatus(ledger) : null);
	const draftSetup = $derived(view.mode !== 'create' && Boolean(view.record.draft_setup));
	// credit freshness is judged against the minute, so the check re-answers as the minute turns
	const clock = bolt.clock('minute');
	const checkRead = $derived(
		id && view.mode !== 'create' && view.record.status === 'draft' && !draftSetup && commercial
			? bolt.query(confirmationRead(id))
			: null
	);
	const check = $derived(
		checkRead?.current && view.mode !== 'create'
			? confirmationCheck(checkRead.current, {
					revision: view.record.revision,
					as_of: clock.now
				})
			: null
	);
	const quote = $derived(checkRead?.current?.orders.rows[0]);
	const purchaseCostRead = $derived(
		quote?.direction === 'sales' && quote.ledger && kinds.catalog?.source_lot_costs
			? bolt.query(purchaseLotCostRead(quote.ledger))
			: null
	);
	const purchaseCosts = $derived(purchaseCostRead?.current?.source_lot_costs.rows[0]);
	const fifoCosts = $derived(
		checkRead?.current && purchaseCosts
			? quotationFifoCosts(checkRead.current, purchaseCosts, clock.now)
			: []
	);
	const versions = $derived(view.mode !== 'create' ? agreements(view.record) : []);
	const currentContract = $derived(
		view.mode !== 'create' ? currentAgreement(view.record) : undefined
	);
	const archived = $derived(view.mode !== 'create' && view.record.archived);
	let documentRequest = $state<{ version: number | null } | null>(null);
	let selectedVersion = $state<string | null>(null);
	const draftContract = $derived(
		view.mode !== 'create' &&
			view.record.status === 'draft' &&
			(selectedVersion === null || selectedVersion === 'draft')
	);
	const selectedContract = $derived(
		draftContract
			? undefined
			: (versions.find((v) => String(v.version) === selectedVersion) ?? currentContract)
	);
	const confirmationModel = $derived(
		view.mode !== 'create' && view.record.direction === 'purchasing'
			? 'ext_purchase_orders'
			: 'ext_sales_orders'
	);
	const confirmationWhere = $derived({
		...(id ? { order: { eq: id } } : {}),
		...((selectedContract ?? versions.at(-1))
			? { agreement_hash: { eq: (selectedContract ?? versions.at(-1))!.seal_hash } }
			: {})
	});
	// the logistics output names its receipts' reference and status too
	const receiptRead = $derived.by(() => {
		if (!id) return null;
		const where = confirmationWhere;
		const fields = ['reference', 'status'] as const;
		if (confirmationModel === 'ext_purchase_orders')
			return commercial
				? bolt.query({ ext_purchase_orders: { where, fields } })
				: bolt.query({ ext_purchase_orders: { output: 'logistics', where, fields } });
		return commercial
			? bolt.query({ ext_sales_orders: { where, fields } })
			: bolt.query({ ext_sales_orders: { output: 'logistics', where, fields } });
	});
	const confirmationRows = $derived(
		receiptRead && {
			error: receiptRead.error,
			current: receiptRead.current
				? 'ext_purchase_orders' in receiptRead.current
					? receiptRead.current.ext_purchase_orders
					: receiptRead.current.ext_sales_orders
				: undefined
		}
	);
	const pushFailed = $derived(
		selectedContract?.seal_hash === currentContract?.seal_hash &&
			view.mode !== 'create' &&
			view.record.status !== 'draft' &&
			view.record.$sync?.kingdee?.status === 'failed'
	);
	const disabled = $derived(
		Boolean(
			recordController?.historical ||
			recordController?.current?.dirty ||
			recordController?.current?.capabilities?.update.reasons.includes('underApproval') ||
			pending
		)
	);
	const selectedEvents = $derived(
		(selectedContract?.events ?? []).map((event) => ({
			...event,
			status:
				event.status === 'closed'
					? translate('component.kingdee_status_closed')
					: event.status === 'superseded'
						? translate('component.contract_superseded')
						: event.status === 'changedUnversioned' || event.status === 'sourceConflict'
							? translate('component.kingdee_status_changedUnversioned')
							: statusText(event.status),
			kind: translate(`component.kingdee_event_${event.kind}`)
		}))
	);
	const needsReconciliation = $derived(
		selectedContract?.events?.at(-1)?.kind === 'unversionedChange' ||
			selectedContract?.events?.at(-1)?.kind === 'sourceConflict'
	);
	function contractLabel(version: ContractVersion) {
		return bolt.t(
			version.seal_hash === currentContract?.seal_hash
				? 'component.contract_current'
				: version.lifecycle === 'pending'
					? 'component.contract_pending'
					: version.origin === 'kingdee' && version.kingdee && !version.kingdee.archived
						? 'component.kingdee_version'
						: 'component.contract_superseded'
		);
	}
	function confirmationPresentation(
		status: 'draft' | 'issued' | 'void' | 'closed' | null | undefined
	) {
		return {
			label: bolt.t(
				needsReconciliation
					? 'component.kingdee_status_changedUnversioned'
					: status === 'closed'
						? 'component.kingdee_status_closed'
						: status === 'issued'
							? 'component.confirmation_confirmed'
							: status === 'void'
								? `models.${confirmationModel}.fields.status.void`
								: status === 'draft'
									? 'component.contract_pending'
									: pushFailed || confirmationRows?.error
										? 'component.confirmation_error'
										: 'component.contract_pending'
			),
			variant: needsReconciliation
				? ('warning' as const)
				: status === 'closed'
					? ('outline' as const)
					: status === 'issued'
						? ('success' as const)
						: status === 'void' || (!status && (pushFailed || confirmationRows?.error))
							? ('destructive' as const)
							: ('warning' as const)
		};
	}
	let feedback = $state('');
	let revisionRun = $state<string | null>(null);
	let actionScope = $state.raw<Scope.Scope | undefined>(undefined);
	const actionLifetime = attach(() =>
		Effect.gen(function* () {
			actionScope = yield* Scope.Scope;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					actionScope = undefined;
				})
			);
			yield* Effect.never;
		})
	);
	const confirmOrder = Effect.fn('Trading.confirmOrder')(function* () {
		if (!id || !check || Result.isFailure(check) || pending || archived || draftSetup) return;
		const check_hash = yield* confirmationHash(check.success);
		const target = id;
		const awaiting = bolt.t('component.awaiting_approval');
		const uncertain = bolt.t('component.seal_uncertain');
		pending = true;
		const result = yield* bolt.act('orders.update', [
			{ target, set: { status: 'confirmed', check_hash } }
		]);
		const controller = recordController?.current;
		if (
			result.kind === 'committed' &&
			controller?.spec.target.of === 'model' &&
			controller.spec.target.model === 'orders' &&
			controller.spec.target.id === target
		)
			controller.view();
		feedback =
			result.kind === 'committed' ? '' : result.kind === 'pendingApproval' ? awaiting : uncertain;
	});
	function confirm() {
		const owner = actionScope;
		if (owner === undefined) return;
		const uncertain = bolt.t('component.seal_uncertain');
		fork(
			Effect.forkIn(
				confirmOrder().pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback =
								failure._tag === 'ActRefused'
									? translate(failure.message)
									: failure._tag === 'ActConflict'
										? bolt.t('component.order_changed')
										: uncertain;
						})
					),
					Effect.ensuring(
						Effect.sync(() => {
							pending = false;
						})
					)
				),
				owner
			)
		);
	}
	const changeOrder = Effect.fn('Trading.changeOrder')(function* (
		change: 'archive' | 'unarchive' | 'revise'
	) {
		if (!id || view.mode === 'create' || pending) return;
		pending = true;
		feedback = '';
		if (change === 'revise') {
			const started = bolt.start('orders_revise', { target: id, revision: view.record.revision });
			revisionRun = started.id;
			const outcome = yield* started;
			if (outcome.kind === 'pendingApproval') feedback = bolt.t('component.awaiting_approval');
			else if (outcome.kind === 'committed') selectedVersion = 'draft';
			else if (outcome.kind === 'refused') feedback = translate(outcome.message);
			else feedback = bolt.t('component.seal_uncertain');
			return;
		}
		const result = yield* bolt.act(
			'orders.update',
			[{ target: id, set: { archived: change === 'archive' } }],
			{ observed: { [id]: view.record.revision } }
		);
		if (result.kind === 'pendingApproval') feedback = bolt.t('component.awaiting_approval');
		else if (result.kind !== 'committed') feedback = bolt.t('component.seal_uncertain');
	});
	function change(change: 'archive' | 'unarchive' | 'revise') {
		const owner = actionScope;
		if (owner === undefined) return;
		fork(
			Effect.forkIn(
				changeOrder(change).pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback =
								failure._tag === 'ActRefused'
									? translate(failure.message)
									: failure._tag === 'ActConflict'
										? bolt.t('component.order_changed')
										: bolt.t('component.seal_uncertain');
						})
					),
					Effect.ensuring(
						Effect.sync(() => {
							pending = false;
						})
					)
				),
				owner
			)
		);
	}
</script>

{#snippet validity(form: FormState, field: FieldEditor)}
	<TimeRangeInput
		of="date"
		precision="day"
		id={field.id}
		value={{ from: form.get('valid_from'), to: form.get('valid_until') }}
		onChange={(range) => {
			if (Schema.is(DateBounds)(range)) {
				form.set('valid_from', range.from ?? null);
				form.set('valid_until', range.to ?? null);
			}
		}}
	/>
{/snippet}
{#snippet party(form: FormState, field: FieldEditor)}
	<Picker
		of="parties"
		id={field.id}
		value={form.id<'parties'>('party')}
		where={{
			active: { eq: true },
			kind: {
				in:
					form.get('direction') === 'sales'
						? ['customer', 'both']
						: form.get('direction') === 'purchasing'
							? ['supplier', 'both']
							: ['customer', 'supplier', 'both']
			}
		}}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		onChange={field.onChange}
	/>
{/snippet}
{#snippet printDetails(form: FormState, field: FieldEditor)}
	<PrintDetails
		layout={form.id<'document_templates'>('document_template')}
		scope="order"
		value={field.value}
		onChange={field.onChange}
		id={field.id}
		disabled={field.disabled}
	/>
{/snippet}

{#snippet printDetailsView(form: FormState)}
	<PrintDetails
		layout={form.id<'document_templates'>('document_template')}
		scope="order"
		value={form.get('print_values')}
	/>
{/snippet}

{#snippet documents(form: FormState, field: FieldEditor)}
	{#if field.kind.kind === 'file'}
		<FileInput
			kind={field.kind}
			value={draftDocuments(form)}
			name="supporting_documents"
			id={field.id}
			disabled={field.disabled}
			invalid={Boolean(field.error)}
			onChange={(next) => {
				if (!Schema.is(DocumentRefs)(next)) return;
				form.set(
					'supporting_documents',
					retainedContractDocuments(
						versions.map((version) => version.supporting_documents),
						next
					)
				);
				form.set(
					'draft_document_ids',
					next.map((file) => file.id)
				);
			}}
		/>
	{/if}
{/snippet}
{#snippet documentView(form: FormState)}
	{@const kind = kinds.catalog?.orders?.fields?.supporting_documents}
	{#if kind}<Show readonly {kind} value={draftDocuments(form)} />{/if}
{/snippet}
{#snippet confirmationNotices(form: FormState)}
	{#if checkRead && draftContract}
		{#if form.dirty}
			<p class="text-sm text-muted-foreground">
				{bolt.t(purchase ? 'component.commitment_save_first' : 'component.seal_explanation')}
			</p>
		{/if}
		{#if check && Result.isSuccess(check)}
			{#if !purchaseCosts && check.success.below_inventory_cost.length}<p class="text-sm">
					{bolt.t('component.below_inventory_cost')}: {check.success.below_inventory_cost.join(
						', '
					)}
				</p>{/if}
			{#if purchaseCosts && !form.dirty}
				{#if !quote?.warehouse}
					<p class="text-sm text-muted-foreground">{bolt.t('stock.fifo.choose_warehouse')}</p>
				{:else if fifoCosts.length}
					<details class="rounded-md border border-input px-3 py-2 text-sm">
						<summary class="cursor-pointer font-medium">{bolt.t('stock.fifo.title')}</summary>
						<p class="mt-2 text-muted-foreground">{bolt.t('stock.fifo.scope')}</p>
						<ul class="mt-2 space-y-2">
							{#each fifoCosts as row (row.key)}
								<li>
									<span class="font-medium">{row.product}</span> · {row.quantity.toString()}
									{row.unit}
									{#if row.estimate}
										· {purchaseCosts.currency}
										{row.estimate.unit_cost.round(4).toString()} / {row.unit}
										{#if row.below}
											· {bolt.t('stock.fifo.below_quote')}{/if}
										<div class="text-muted-foreground">
											{row.estimate.lots
												.map((lot) => `${lot.lot_number} × ${lot.quantity.toString()}`)
												.join(' · ')}
										</div>
									{:else}
										· {bolt.t('component.inventory_cost_unavailable')}{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			{/if}
		{:else}
			<p>
				{check && Result.isFailure(check)
					? translate(check.failure)
					: (checkRead.error?.message ?? bolt.t('component.check_loading'))}
			</p>
		{/if}
	{/if}
{/snippet}
{#snippet sealButton(form: FormState)}
	{#if checkRead && draftContract}
		<Button
			disabled={pending ||
				archived ||
				draftSetup ||
				form.dirty ||
				form.pending ||
				!check ||
				Result.isFailure(check)}
			onclick={confirm}
			>{bolt.t(purchase ? 'component.record_commitment' : 'component.confirm_seal')}</Button
		>
	{/if}
{/snippet}
{#snippet agreement()}
	{#if versions.length && selectedContract}
		<Stack gap="md">
			<Grid as="dl" gap="md" minimum="compact">
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.party')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.party_name}</dd>
				</div>
				{@const warehouseKind = kinds.catalog?.orders?.fields?.warehouse}
				{#if warehouseKind}<div>
						<dt class="text-xs font-medium text-muted-foreground">
							{bolt.t('models.orders.fields.warehouse')}
						</dt>
						<dd class="text-sm">
							<Show
								readonly
								kind={warehouseKind}
								value={selectedContract.snapshot.warehouse || null}
								relation={{ targets: ['warehouses'] }}
							/>
						</dd>
					</div>{/if}
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.currency')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.currency}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.ordered_on')}
					</dt>
					<dd class="text-sm">
						<Show kind={{ kind: 'date' }} value={selectedContract.ordered_on} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.tax_inclusive')}
					</dt>
					<dd class="text-sm">
						<Show kind={{ kind: 'bool' }} value={selectedContract.snapshot.tax_inclusive} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t(
							selectedContract.origin === 'kingdee'
								? 'component.contract_imported_at'
								: 'models.orders.fields.sealed_at'
						)}
					</dt>
					<dd class="text-sm">
						<Show kind={{ kind: 'instant' }} value={selectedContract.approved_at} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.payment_terms')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.payment_terms}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.delivery_terms')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.delivery_terms || '—'}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.valid_from')}
					</dt>
					<dd class="text-sm">
						<Show
							kind={{ kind: 'period', of: 'date', precision: 'day' }}
							value={selectedContract.snapshot.valid_from || selectedContract.snapshot.valid_until
								? {
										from: selectedContract.snapshot.valid_from ?? null,
										to: selectedContract.snapshot.valid_until ?? null
									}
								: null}
						/>
					</dd>
				</div>
			</Grid>
			{@const documents = kinds.catalog?.orders?.fields?.supporting_documents}
			{#if documents}
				<Stack gap="xs">
					<span class="text-xs font-medium text-muted-foreground"
						>{bolt.t('models.orders.fields.supporting_documents')}</span
					>
					<Show readonly kind={documents} value={selectedContract.supporting_documents ?? []} />
				</Stack>
			{/if}
			{#if id && commercial && kinds.catalog?.order_files}
				{@const seal = selectedContract.seal_hash}
				<Section
					name="filed-documents"
					icon="lucide:paperclip"
					title={bolt.t('models.order_files.label')}
					collapsible={false}
				>
					{#snippet actions()}
						{#if kinds.catalog?.order_files?.create && !archived && selectedContract?.lifecycle !== 'pending' && !recordController?.historical}
							<Button
								variant="outline"
								aria-label={bolt.t('component.file_order_document')}
								onclick={() => openCreate('order_files', { order: id, seal_hash: seal })}
							>
								<Icon name="lucide:file-plus" class="size-4 md:hidden" />
								<span class="hidden md:inline">{bolt.t('component.file_order_document')}</span>
							</Button>
						{/if}
					{/snippet}
					<p class="mb-2 text-sm text-muted-foreground">
						{bolt.t('component.filed_order_documents_help')}
					</p>
					<Table
						of="order_files"
						where={{ order: { eq: id }, seal_hash: { eq: seal } }}
						columns={['title', 'file', 'created_at']}
						orderBy={{ created_at: 'desc' }}
						toolbar={false}
					/>
				</Section>
			{/if}
			{@const currency = { currency: selectedContract.snapshot.currency }}
			<Scroll name="agreement-lines" axis="x" class="rounded-md border border-border">
				<table class="w-max min-w-full text-sm">
					<thead class="bg-muted/50 text-left text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">{bolt.t('models.order_lines.fields.product')}</th>
							{#each ['quantity', 'unit_price', 'discount_pct', 'tax_rate', 'total'] as const as name (name)}<th
									class="px-3 py-2 text-right font-medium whitespace-nowrap"
									>{bolt.t(`models.order_lines.fields.${name}`)}</th
								>{/each}
						</tr>
					</thead>
					<tbody>
						{#each selectedContract.snapshot.lines as line (line.id)}
							<tr class="border-t border-border align-top">
								<td class="px-3 py-2"
									>{line.product_name}
									<span class="block text-xs text-muted-foreground">{line.product_code}</span></td
								>
								<td class="px-3 py-2 text-right whitespace-nowrap tabular-nums"
									>{displayDecimal(line.quantity)} {line.unit}</td
								>
								<td class="px-3 py-2 text-right"
									><Show
										kind={{ ...moneyKind, scale: 4 }}
										value={line.unit_price}
										row={currency}
									/></td
								>
								<td class="px-3 py-2 text-right tabular-nums"
									>{displayDecimal(line.discount_pct)}%</td
								>
								<td class="px-3 py-2 text-right tabular-nums">{displayDecimal(line.tax_rate)}%</td>
								<td class="px-3 py-2 text-right"
									><Show kind={moneyKind} value={line.total} row={currency} /></td
								>
							</tr>
						{/each}
					</tbody>
					<!-- the agreed totals under the lines -->
					<tfoot class="border-t border-border">
						{#each ['net', 'tax', 'total'] as const as name (name)}<tr
								class={name === 'total' ? 'font-medium' : 'text-muted-foreground'}
							>
								<td colspan="5" class="px-3 py-1.5 text-right"
									>{bolt.t(`models.orders.fields.${name}`)}</td
								>
								<td class="px-3 py-1.5 text-right"
									><Show
										kind={moneyKind}
										value={selectedContract.snapshot[name]}
										row={currency}
									/></td
								>
							</tr>{/each}
					</tfoot>
				</table>
			</Scroll>
			{#if selectedContract.kingdee}
				{@const source = selectedContract.kingdee}
				<Section
					icon="lucide:truck"
					name="kingdee-tracking"
					title={bolt.t('component.kingdee_tracking')}
					defaultOpen={false}
				>
					<Grid as="dl" gap="md" minimum="compact">
						<div>
							<dt class="text-xs font-medium text-muted-foreground">
								{bolt.t('models.ext_sales_orders.fields.status')}
							</dt>
							<dd class="text-sm">
								{source.closed
									? bolt.t('component.kingdee_status_closed')
									: source.status
										? statusText(source.status)
										: bolt.t('component.not_set')}
							</dd>
						</div>
						<div>
							<dt class="text-xs font-medium text-muted-foreground">
								{bolt.t('component.kingdee_version')}
							</dt>
							<dd class="text-sm">
								{source.source_version}
							</dd>
						</div>
						<div>
							<dt class="text-xs font-medium text-muted-foreground">
								{bolt.t('component.kingdee_observed_at')}
							</dt>
							<dd class="text-sm">
								<Show kind={{ kind: 'instant' }} value={source.observed_at} />
							</dd>
						</div>
						{#if source.source_changed_at}<div>
								<dt class="text-xs font-medium text-muted-foreground">
									{bolt.t('component.kingdee_changed_at')}
								</dt>
								<dd class="text-sm">
									{source.source_changed_at}
								</dd>
							</div>{/if}
						{#if source.source_changed_by}<div>
								<dt class="text-xs font-medium text-muted-foreground">
									{bolt.t('component.kingdee_changed_by')}
								</dt>
								<dd class="text-sm">{source.source_changed_by}</dd>
							</div>{/if}
					</Grid>
					{#if selectedContract.events?.length}
						<Table
							of={selectedEvents}
							embedded
							columns={[
								{
									field: 'at',
									label: bolt.t('component.kingdee_observed_at'),
									kind: { kind: 'instant' }
								},
								{ field: 'status', label: bolt.t('models.ext_sales_orders.fields.status') },
								{ field: 'source_version', label: bolt.t('component.kingdee_version') },
								{ field: 'kind', label: bolt.t('component.kingdee_event') }
							]}
						/>
					{/if}
				</Section>
			{/if}
		</Stack>
	{:else if view.mode !== 'create' && view.record.status === 'draft'}
		<EmptyState
			variant="inset"
			title={bolt.t(purchase ? 'component.commitment_draft' : 'component.unfinalized_quotation')}
		/>
	{:else}<EmptyState variant="inset" title={bolt.t('errors.agreement_access')} />{/if}
{/snippet}
{#snippet lines()}{#if id}<Table
			of="order_lines"
			where={{ order: { eq: id } }}
			columns={[
				'product_name',
				'quantity',
				'unit',
				'unit_price',
				'discount_pct',
				'tax_rate',
				'total'
			]}
			toolbar={{
				new:
					kinds.catalog?.order_lines?.create &&
					view.mode !== 'create' &&
					view.record.status === 'draft' &&
					!archived &&
					!draftSetup
						? () => openCreate('order_lines', { order: id })
						: false
			}}
		/>{/if}{/snippet}
{#snippet fulfillment()}{#if id}<Stack gap="md">
			{#if selectedContract}
				<Table
					of="transactions"
					where={{
						order: { eq: id },
						seal_hash: { eq: selectedContract.seal_hash },
						kind: { in: ['delivery', 'invoice'] }
					}}
					columns={['reference', 'kind', 'status', 'source_updated_at']}
					toolbar={{ new: false, controls: versionPicker }}
				/>
			{:else}<EmptyState
					variant="inset"
					title={bolt.t('component.contract_no_transactions')}
				/>{/if}
		</Stack>{/if}{/snippet}
{#snippet activity()}{#if id}
		<Stack gap="md">
			<Table
				of="activities"
				where={{ order: { eq: id } }}
				columns={['title', 'kind', 'owner', 'due_on', 'done']}
				toolbar={{
					new:
						kinds.catalog?.activities?.create && !archived
							? () => openCreate('activities', { order: id })
							: false
				}}
			/>
		</Stack>{/if}{/snippet}
{#snippet versionPicker()}{#if versions.length}<label class="w-36 md:w-44">
			<span class="sr-only"
				>{bolt.t(
					purchase ? 'component.commitment_version' : 'models.orders.fields.contract_version'
				)}</span
			>
			<Combobox
				readonly={false}
				options={[
					...(view.mode !== 'create' && view.record.status === 'draft'
						? [
								{
									value: 'draft',
									label: `${bolt.t('component.contract_draft')} · ${String(view.record.contract_version).padStart(3, '0')}`
								}
							]
						: []),
					...versions.map((v) => ({
						value: String(v.version),
						label: `${bolt.t(purchase ? 'component.commitment' : 'section.seal')} ${String(v.version).padStart(3, '0')}`,
						description: contractLabel(v)
					}))
				]}
				value={draftContract ? 'draft' : String(selectedContract?.version)}
				onChange={(v) => {
					selectedVersion = v;
				}}
			/>
		</label>{/if}{/snippet}
{#snippet sourceConfirmation()}
	{#if selectedContract && !purchase && sourceState && sourceState !== 'connected'}
		<Badge variant="outline">{bolt.t(`component.kingdee_${sourceState}`)}</Badge>
	{:else if selectedContract && !purchase && (selectedContract.kingdee || awaitingKingdee(selectedContract, versions) || needsReconciliation)}
		{@const status = selectedContract.kingdee?.closed ? 'closed' : selectedContract.kingdee?.status}
		{@const presentation = confirmationPresentation(status)}
		<Tooltip
			text={status
				? `Kingdee · ${bolt.t('component.kingdee_version')} ${selectedContract.kingdee?.source_version} · ${presentation.label}`
				: (confirmationRows?.error?.message ??
					(pushFailed && view.mode !== 'create'
						? view.record.$sync?.kingdee?.message
						: undefined) ??
					bolt.t('component.kingdee_waiting'))}
		>
			{#snippet trigger({ props })}<Badge {...props} tabindex={0} variant={presentation.variant}
					>{presentation.label}</Badge
				>{/snippet}
		</Tooltip>
	{/if}
{/snippet}
{#snippet confirmationLink()}{#if id && view.mode !== 'create' && selectedContract}
		{#if !purchase && sourceState && sourceState !== 'connected'}
			{@render sourceConfirmation()}
		{:else if confirmationRows?.current}
			{#each confirmationRows.current.rows as receipt (receipt.id)}
				{@const status = selectedContract.kingdee?.closed
					? 'closed'
					: (selectedContract.kingdee?.status ?? receipt.status)}
				{@const presentation = confirmationPresentation(status)}
				{@const receiptInfo = `Kingdee · ${receipt.reference}${selectedContract.kingdee ? ` · ${bolt.t('component.kingdee_version')} ${selectedContract.kingdee.source_version}` : ''} · ${presentation.label}`}
				<Tooltip text={receiptInfo}>
					{#snippet trigger({ props })}
						<button
							{...props}
							type="button"
							aria-label={receiptInfo}
							class="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => openRecord(confirmationModel, receipt.id)}
						>
							<Badge variant={presentation.variant}>{presentation.label}</Badge>
						</button>
					{/snippet}
				</Tooltip>
			{:else}{@render sourceConfirmation()}{/each}
		{:else if !purchase}{@render sourceConfirmation()}{/if}
	{/if}{/snippet}
{#snippet contractActions(form: FormState)}
	{@const lockedLabel = selectedContract
		? bolt.t(purchase ? 'component.commitment_recorded' : 'component.sealed')
		: null}
	<div class="flex items-center gap-1.5 md:hidden">
		{@render versionPicker()}
		{@render sealButton(form)}
		<Popover.Root>
			<Popover.Trigger
				class="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 grid size-9 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
				aria-label={bolt.t('component.more_actions')}
			>
				<Icon name="lucide:ellipsis" class="size-4" />
			</Popover.Trigger>
			<Popover.Content align="end" class="w-56 p-1">
				{#if id && commercial && !recordController?.historical && (selectedContract || (draftContract && !draftSetup))}
					<Popover.Close
						class="hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm"
						onclick={() => (documentRequest = { version: selectedContract?.version ?? null })}
					>
						<Icon name="lucide:file-text" class="size-4" />
						{bolt.t('component.preview_document')}
					</Popover.Close>
				{/if}
				{#if lockedLabel}
					<div class="text-muted-foreground flex items-center gap-2 px-2 py-2 text-sm">
						<Icon name="lucide:lock-keyhole" class="size-4" />
						{lockedLabel}
					</div>
				{/if}
			</Popover.Content>
		</Popover.Root>
	</div>
	<Cluster gap="sm" align="center" class="hidden md:flex">
		{@render versionPicker()}
		{#if id && commercial && !recordController?.historical && (selectedContract || (draftContract && !draftSetup))}
			<Button
				type="button"
				variant="outline"
				onclick={() => (documentRequest = { version: selectedContract?.version ?? null })}
				>{bolt.t('component.preview_document')}</Button
			>
		{/if}
		{@render sealButton(form)}
		{#if lockedLabel}
			<Tooltip
				text={selectedContract?.origin === 'kingdee'
					? `${bolt.t('component.contract_imported')}. ${lockedLabel}`
					: lockedLabel}
			>
				{#snippet trigger({ props })}<span
						{...props}
						role="img"
						tabindex="0"
						aria-label={lockedLabel}
						class="inline-flex size-8 items-center justify-center text-muted-foreground"
						data-contract-lock><Icon name="lucide:lock-keyhole" class="size-4" /></span
					>{/snippet}
			</Tooltip>
		{/if}
	</Cluster>{/snippet}
{#snippet contractControls()}
	<Cluster gap="sm" align="center">
		{#if selectedContract}
			<Badge
				variant={selectedContract.lifecycle === 'pending'
					? 'warning'
					: selectedContract.seal_hash === currentContract?.seal_hash
						? 'success'
						: 'outline'}
			>
				{contractLabel(selectedContract)}
			</Badge>
			{#if selectedContract.lifecycle !== 'pending'}{@render confirmationLink()}{/if}
		{/if}
		{#if view.mode !== 'create' && !archived && kinds.automations?.orders_revise && (draftSetup || view.record.status === 'confirmed')}
			<Button variant="ghost" {disabled} onclick={() => change('revise')}
				>{bolt.t(
					draftSetup
						? 'component.resume_contract_setup'
						: purchase
							? 'component.revise_commitment'
							: 'component.new_contract'
				)}</Button
			>
		{/if}
	</Cluster>
{/snippet}
{#snippet generalDetails()}{#if feedback}<p role="status" class="text-sm">
			{feedback}
		</p>{/if}{/snippet}
{#snippet contractBody(form: FormState)}<Stack gap="md">
		{#if selectedContract || draftSetup}{@render contractControls()}{/if}
		{@render confirmationNotices(form)}
		{#if purchase && (draftContract || view.mode === 'create')}
			<p class="text-sm text-muted-foreground">{bolt.t('component.commitment_help')}</p>
		{/if}
		{#if revisionRun}<RunStatus automation="orders_revise" run={revisionRun} />{/if}
		{#if draftContract || view.mode === 'create'}{@render lines()}{:else}{@render agreement()}{/if}
	</Stack>{/snippet}
{#snippet orderState()}
	{#if view.mode !== 'create'}
		<Combobox
			options={[
				{ value: 'active', label: bolt.t('component.order_active') },
				{ value: 'archived', label: bolt.t('component.order_archived') }
			]}
			variant="ghost"
			value={archived ? 'archived' : 'active'}
			aria-label={bolt.t('models.orders.fields.archived')}
			{disabled}
			readonly={!kinds.catalog?.orders?.update}
			onChange={(value) => {
				if (value && (value === 'archived') !== archived)
					change(value === 'archived' ? 'archive' : 'unarchive');
			}}
		/>
	{/if}
{/snippet}
<span hidden {@attach actionLifetime}></span>
<RecordForm
	editablePresets={['document_template']}
	trailing={orderState}
	readonly={archived || draftSetup}
	readonlyReason={bolt.t(archived ? 'component.order_archived' : 'errors.contract_setup')}
	history={{
		fields: [
			'title',
			'direction',
			'party',
			'owner',
			'warehouse',
			'status',
			'archived',
			'total',
			'ordered_on',
			'document_template',
			'currency',
			'valid_from',
			'valid_until',
			'payment_terms',
			'delivery_terms',
			'shipping_terms',
			'place_of_loading',
			'place_of_delivery',
			'packaging',
			'shipping_mark',
			'time_of_shipment',
			'other_terms',
			'payment_method',
			'buyer_contact',
			'buyer_mobile',
			'delivery_address',
			'delivery_date',
			'logistics_handler',
			'notes',
			'supporting_documents',
			'contract_version'
		],
		sources: id
			? [
					...[
						'activities',
						'order_lines',
						'transactions',
						view.mode !== 'create' && view.record.direction === 'purchasing'
							? 'ext_purchase_orders'
							: 'ext_sales_orders',
						...(view.mode !== 'create' && commercial
							? ['source_payments', 'source_sales_lines', 'order_files']
							: [])
					].map((of) => ({ of, where: { order: { eq: id } } }))
				]
			: []
	}}
	mainTitle={bolt.t('section.general')}
	afterForm={generalDetails}
	editors={{
		party,
		valid_from: validity,
		supporting_documents: documents,
		print_values: printDetails
	}}
	viewers={{ supporting_documents: documentView, print_values: printDetailsView }}
	{view}
	sections={[
		{
			name: 'order',
			readonlyFields: versions.length ? ['party', 'owner'] : [],
			fields: ['title', 'party', 'owner', 'notes'],
			wide: ['notes']
		},
		{
			name: 'contract',
			icon: 'lucide:file-signature',
			title: bolt.t(purchase ? 'component.purchase_commitment' : 'section.seal'),
			actions: contractActions,
			body: contractBody,
			fields:
				draftContract || view.mode === 'create'
					? [
							'warehouse',
							'ordered_on',
							'currency',
							'tax_inclusive',
							'valid_from',
							'payment_terms',
							'delivery_terms',
							'shipping_terms',
							'place_of_loading',
							'place_of_delivery',
							'packaging',
							'shipping_mark',
							'time_of_shipment',
							'other_terms',
							'payment_method',
							'buyer_contact',
							'buyer_mobile',
							'delivery_address',
							'delivery_date',
							'logistics_handler',
							'document_template',
							'print_values',
							'supporting_documents'
						]
					: [],
			readonlyFields:
				view.mode !== 'create'
					? [
							...(archived || draftSetup
								? [
										'warehouse',
										'ordered_on',
										'currency',
										'tax_inclusive',
										'valid_from',
										'payment_terms',
										'delivery_terms',
										'shipping_terms',
										'place_of_loading',
										'place_of_delivery',
										'packaging',
										'shipping_mark',
										'time_of_shipment',
										'other_terms',
										'payment_method',
										'buyer_contact',
										'buyer_mobile',
										'delivery_address',
										'delivery_date',
										'logistics_handler',
										'supporting_documents'
									]
								: []),
							...(versions.length ? ['warehouse', 'ordered_on', 'currency'] : []),
							...(typeof view.record.line_count === 'number' && view.record.line_count > 0
								? ['warehouse', 'ordered_on', 'currency', 'tax_inclusive']
								: [])
						]
					: [],
			wide: [
				'shipping_mark',
				'other_terms',
				'delivery_address',
				'print_values',
				'supporting_documents'
			]
		}
	]}
	tabs={id
		? [
				{ name: 'activities', title: bolt.t('models.activities.label'), body: activity },
				{ name: 'transactions', title: bolt.t('section.transactions'), body: fulfillment }
			]
		: []}
/>

{#if id && documentRequest}
	<OrderDocumentDialog
		order={id}
		version={documentRequest.version}
		onClose={() => (documentRequest = null)}
	/>
{/if}
