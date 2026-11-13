<script lang="ts">
	import { translated } from '../../../lib/ui/message.js';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { attach, fork } from '@norbital-ai/ui/effect';
	import { BigDecimal, Effect, Result, Schema, Scope } from 'effect';
	import { observe_once } from '@norbital-ai/ui/effect';
	import { deliveredByLine, orderDeliveries } from '../../../lib/order-delivery.js';
	import { reportPages } from '../../../lib/reports.js';
	import { dec, div, round, text, type DecimalLike } from '../../../lib/values.js';
	import {
		agreements,
		awaitingKingdee,
		currentAgreement,
		resolvableKingdee,
		kingdeeAgreement,
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
		Button,
		Show,
		Picker,
		FileInput,
		Combobox,
		Badge,
		Popover,
		Progress,
		EmptyState,
		Tooltip,
		Icon,
		RunStatus,
		TimeRangeInput,
		use_record_controller,
		enum_text,
		type FieldEditor,
		type FormState,
		type RecordView,
		type RowOf,
		open_record
	} from '@norbital-ai/ui';
	import { Stack, Grid, Cluster } from '@norbital-ai/ui/layout';
	import { kingdeeConnectionStatus } from '../../../integration/kingdee/connection-status.js';
	import OrderDocumentDialog from './order-document-dialog.svelte';
	import PrintDetails from '../../../lib/ui/print-details.svelte';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { createValues, openCreate } from '../../../lib/ui/create-values.js';
	const moneyKind = { kind: 'money', currency: 'currency' } as const;
	function displayDecimal(value: DecimalLike) {
		const exact = text(value);
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
		view,
		ctx
	}: {
		view: RecordView<'orders'>;
		ctx: PageContext;
	} = $props();
	// a narrower output (logistics) carries no commercial terms
	const commercial = $derived(ctx.catalog?.orders?.output === undefined);
	const statusText = (status: string) =>
		enum_text(status, {
			t: (key) => translated(ctx, key),
			model: 'ext_sales_orders',
			field: 'status'
		});
	const recordController = use_record_controller();
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
			? ctx.query({
					orders: {
						where: { id: { eq: id } },
						fields: ['ledger'],
						limit: 1,
						ledger: { fields: ['active', 'status'] }
					}
				})
			: null
	);
	const ledger = $derived(ledgerRead?.current?.orders.rows[0]?.ledger);
	const sourceState = $derived(ledger ? kingdeeConnectionStatus(ledger) : null);
	const draftSetup = $derived(view.mode !== 'create' && Boolean(view.record.draft_setup));
	// credit freshness is judged against the minute, so the check re-answers as the minute turns
	const clock = ctx.clock('minute');
	const checkRead = $derived(
		id && view.mode !== 'create' && view.record.status === 'draft' && !draftSetup && commercial
			? ctx.query(confirmationRead(id))
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
	const quoteFloors = $derived(
		new Map(
			check && Result.isSuccess(check) ? check.success.floors.map((line) => [line.id, line]) : []
		)
	);
	const purchaseCostRead = $derived(
		quote?.direction === 'sales' && quote.ledger && ctx.catalog?.source_lot_costs
			? ctx.query(purchaseLotCostRead(quote.ledger))
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
	const sourceChoice = $derived(resolvableKingdee(versions));
	const canResolve = $derived(
		ctx.actor?.kind === 'member' &&
			(ctx.actor.admin || ctx.actor.teams.includes('commercial_managers')) &&
			sourceChoice &&
			sourceChoice.seal_hash !== currentContract?.seal_hash &&
			sourceChoice.seal_hash !== currentContract?.basis_seal
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
	const filedRequest = $derived(
		id && selectedContract && commercial && ctx.catalog?.order_files
			? ({
					where: { order: { eq: id }, seal_hash: { eq: selectedContract.seal_hash } },
					fields: ['file'],
					order_by: { created_at: 'desc' },
					limit: 100
				} as const)
			: null
	);
	const filedRead = $derived(filedRequest ? ctx.query({ order_files: filedRequest }) : null);
	const filedPage = $derived(filedRead?.current?.order_files);
	const remainingFiles = observe_once(() => {
		const request = filedRequest;
		const first = filedPage;
		return request && first?.next
			? reportPages(first, (after) =>
					ctx
						.query({ order_files: { ...request, after } })
						.pipe(Effect.map((answer) => answer.order_files))
				).pipe(Effect.map((rows) => ({ request, rows })))
			: null;
	});
	const documentKind = { kind: 'file', many: true, accept: ['*/*'], max: '20MiB' } as const;
	const sealedDocuments = $derived.by(() => {
		const remaining = remainingFiles.current;
		const rows =
			remaining && remaining.request === filedRequest ? remaining.rows : (filedPage?.rows ?? []);
		return retainedContractDocuments(
			[
				ctx.catalog?.orders?.fields?.supporting_documents
					? selectedContract?.supporting_documents
					: undefined
			],
			rows.map((row) => row.file)
		);
	});
	const deliveryRequest = $derived(
		id &&
			selectedContract &&
			selectedContract.lifecycle !== 'pending' &&
			commercial &&
			ctx.catalog?.transactions &&
			ctx.catalog.transactions.output === undefined
			? orderDeliveries(id)
			: null
	);
	const deliveryRead = $derived(deliveryRequest ? ctx.query(deliveryRequest) : null);
	const deliveryPage = $derived(deliveryRead?.current?.transactions);
	const remainingDeliveries = observe_once(() => {
		const request = deliveryRequest;
		const first = deliveryPage;
		return request && first?.next
			? reportPages(first, (after) =>
					ctx
						.query({
							transactions: { ...request.transactions, after }
						})
						.pipe(Effect.map((answer) => answer.transactions))
				)
			: null;
	});
	const deliveryTotals = $derived.by(() => {
		const rows = deliveryPage?.next === null ? deliveryPage.rows : remainingDeliveries.current;
		return selectedContract && rows
			? deliveredByLine(
					selectedContract,
					selectedContract.seal_hash === currentContract?.seal_hash ? versions : [selectedContract],
					rows
				)
			: undefined;
	});
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
				? ctx.query({ ext_purchase_orders: { where, fields } })
				: ctx.query({ ext_purchase_orders: { output: 'logistics', where, fields } });
		return commercial
			? ctx.query({ ext_sales_orders: { where, fields } })
			: ctx.query({ ext_sales_orders: { output: 'logistics', where, fields } });
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
			recordController?.current?.capabilities?.update.reasons.includes('under_approval') ||
			pending
		)
	);
	const selectedEvents = $derived(
		(selectedContract?.events ?? []).map((event) => ({
			...event,
			status:
				event.status === 'closed'
					? ctx.t('component.kingdee_status_closed')
					: event.status === 'superseded'
						? ctx.t('component.contract_superseded')
						: event.status === 'changedUnversioned' || event.status === 'sourceConflict'
							? ctx.t('component.kingdee_status_changedUnversioned')
							: statusText(event.status),
			kind: translated(ctx, `component.kingdee_event_${event.kind}`)
		}))
	);
	const liveSource = $derived(kingdeeAgreement(versions));
	const needsReconciliation = $derived(
		selectedContract?.events?.some((event) => event.kind === 'unversionedChange') ||
			(selectedContract?.seal_hash === currentContract?.seal_hash &&
				liveSource?.origin === 'kingdee' &&
				liveSource.seal_hash !== selectedContract?.seal_hash &&
				liveSource.seal_hash !== selectedContract?.basis_seal)
	);
	// a confirmation an approval holds is provisional: its seal is not yet the agreed contract
	const provisional = (version: ContractVersion) =>
		view.mode !== 'create' &&
		view.record.$approval !== undefined &&
		version.seal_hash === view.record.seal_hash;
	function contractLabel(version: ContractVersion) {
		return ctx.t(
			provisional(version)
				? 'component.contract_provisional'
				: version.seal_hash === currentContract?.seal_hash
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
			label: ctx.t(
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
		if (
			!id ||
			view.mode === 'create' ||
			!check ||
			Result.isFailure(check) ||
			pending ||
			archived ||
			draftSetup
		)
			return;
		const revision = view.record.revision;
		const check_hash = yield* confirmationHash(check.success);
		const target = id;
		const awaiting = ctx.t('component.awaiting_approval');
		const uncertain = ctx.t('component.seal_uncertain');
		pending = true;
		const result = yield* ctx.act({
			'orders.update': [
				{ target: { id: target, revision }, set: { status: 'confirmed', check_hash } }
			]
		});
		const controller = recordController?.current;
		if (
			result.kind === 'committed' &&
			controller?.spec.target.of === 'model' &&
			controller.spec.target.model === 'orders' &&
			controller.spec.target.id === target
		)
			controller.view();
		feedback =
			result.kind === 'committed' ? '' : result.kind === 'pending_approval' ? awaiting : uncertain;
	});
	function confirm() {
		const owner = actionScope;
		if (owner === undefined) return;
		const uncertain = ctx.t('component.seal_uncertain');
		fork(
			Effect.forkIn(
				confirmOrder().pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback =
								failure._tag === 'ActRefused'
									? translated(ctx, failure.message)
									: failure._tag === 'ActConflict'
										? ctx.t('component.order_changed')
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
		change: 'archive' | 'unarchive' | 'revise' | 'adopt' | 'rebase'
	) {
		if (!id || view.mode === 'create' || pending) return;
		pending = true;
		feedback = '';
		if (change === 'revise' || change === 'adopt' || change === 'rebase') {
			const resolving = change !== 'revise';
			if (resolving && (!canResolve || !sourceChoice)) return;
			const started = ctx.run('orders_revise', {
				orders: [id],
				revision: view.record.revision,
				...(resolving && sourceChoice
					? {
							source: sourceChoice.seal_hash,
							resolution: change === 'adopt' ? ('adopt' as const) : ('revise' as const)
						}
					: {})
			});
			revisionRun = started.id;
			const outcome = yield* started;
			if (outcome.kind === 'pending_approval') feedback = ctx.t('component.awaiting_approval');
			else if (outcome.kind === 'committed')
				selectedVersion =
					change === 'adopt' && sourceChoice ? String(sourceChoice.version) : 'draft';
			else if (outcome.kind === 'refused') feedback = translated(ctx, outcome.message);
			else feedback = ctx.t('component.seal_uncertain');
			return;
		}
		const result = yield* ctx.act({
			'orders.update': [
				{
					target: { id, revision: view.record.revision },
					set: { archived: change === 'archive' }
				}
			]
		});
		if (result.kind === 'pending_approval') feedback = ctx.t('component.awaiting_approval');
		else if (result.kind !== 'committed') feedback = ctx.t('component.seal_uncertain');
	});
	function change(change: 'archive' | 'unarchive' | 'revise' | 'adopt' | 'rebase') {
		const owner = actionScope;
		if (owner === undefined) return;
		fork(
			Effect.forkIn(
				changeOrder(change).pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback =
								failure._tag === 'ActRefused'
									? translated(ctx, failure.message)
									: failure._tag === 'ActConflict'
										? ctx.t('component.order_changed')
										: ctx.t('component.seal_uncertain');
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
		{ctx}
		of="date"
		precision="day"
		id={field.id}
		value={{ from: form.get('valid_from'), to: form.get('valid_until') }}
		on_change={(range) => {
			if (Schema.is(DateBounds)(range)) {
				form.set('valid_from', range.from ?? null);
				form.set('valid_until', range.to ?? null);
			}
		}}
	/>
{/snippet}
{#snippet party(form: FormState, field: FieldEditor)}
	<Picker
		{ctx}
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
		on_change={field.on_change}
	/>
{/snippet}
{#snippet printDetails(form: FormState, field: FieldEditor)}
	<PrintDetails
		{ctx}
		layout={form.id<'document_templates'>('document_template')}
		scope="order"
		value={field.value}
		on_change={field.on_change}
		id={field.id}
		disabled={field.disabled}
	/>
{/snippet}

{#snippet printDetailsView(form: FormState)}
	<PrintDetails
		{ctx}
		layout={form.id<'document_templates'>('document_template')}
		scope="order"
		value={form.get('print_values')}
	/>
{/snippet}

{#snippet documents(form: FormState, field: FieldEditor)}
	{#if field.kind.kind === 'file'}
		<FileInput
			{ctx}
			kind={field.kind}
			value={draftDocuments(form)}
			name="supporting_documents"
			id={field.id}
			disabled={field.disabled}
			invalid={Boolean(field.error)}
			on_change={(next) => {
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
	{@const kind = ctx.catalog?.orders?.fields?.supporting_documents}
	{#if kind}<Show {ctx} readonly {kind} value={draftDocuments(form)} />{/if}
{/snippet}
{#snippet confirmationNotices(form: FormState)}
	{#if checkRead && draftContract}
		{#if check && Result.isSuccess(check)}
			{#if !purchaseCosts && check.success.below_inventory_cost.length}<p class="text-sm">
					{ctx.t('component.below_inventory_cost')}: {check.success.below_inventory_cost.join(', ')}
				</p>{/if}
			{#if purchaseCosts && !form.dirty}
				{#if !quote?.warehouse}
					<p class="text-sm text-muted-foreground">{ctx.t('stock.fifo.choose_warehouse')}</p>
				{:else if fifoCosts.length}
					<details class="rounded-md border border-input px-3 py-2 text-sm">
						<summary class="cursor-pointer font-medium">{ctx.t('stock.fifo.title')}</summary>
						<p class="mt-2 text-muted-foreground">{ctx.t('stock.fifo.scope')}</p>
						<ul class="mt-2 space-y-2">
							{#each fifoCosts as row (row.key)}
								<li>
									<span class="font-medium">{row.product}</span> · {text(row.quantity)}
									{row.unit}
									{#if row.estimate}
										· {purchaseCosts.currency}
										{text(round(row.estimate.unit_cost, 4))} / {row.unit}
										{#if row.below}
											· {ctx.t('stock.fifo.below_quote')}{/if}
										<div class="text-muted-foreground">
											{row.estimate.lots
												.map((lot) => `${lot.lot_number} × ${text(lot.quantity)}`)
												.join(' · ')}
										</div>
									{:else}
										· {ctx.t('component.inventory_cost_unavailable')}{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			{/if}
		{/if}
	{/if}
{/snippet}
{#snippet sealButton(form: FormState)}
	{#if checkRead && draftContract}
		{@const blocked = archived
			? ctx.t('component.order_archived')
			: form.dirty
				? ctx.t(purchase ? 'component.commitment_save_first' : 'component.seal_explanation')
				: check && Result.isFailure(check)
					? ctx.t(check.failure)
					: !check
						? (checkRead.error?.message ?? ctx.t('component.check_loading'))
						: null}
		<Button
			disabled={pending || form.pending || Boolean(blocked)}
			aria-describedby={blocked ? 'seal-blocked' : undefined}
			onclick={confirm}
			>{ctx.t(purchase ? 'component.record_commitment' : 'component.confirm_seal')}</Button
		>
		{#if blocked}<span id="seal-blocked" class="text-xs text-muted-foreground">{blocked}</span>{/if}
	{/if}
{/snippet}
{#snippet agreement()}
	{#if versions.length && selectedContract}
		{@const seal = selectedContract.seal_hash}
		{@const canFile =
			view.mode === 'edit' &&
			filedRequest &&
			ctx.catalog?.order_files?.create &&
			!archived &&
			selectedContract.lifecycle !== 'pending' &&
			!provisional(selectedContract) &&
			!recordController?.historical}
		<Stack gap="md">
			<Grid as="dl" gap="md" minimum="compact">
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.party')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.party_name}</dd>
				</div>
				{@const warehouseKind = ctx.catalog?.orders?.fields?.warehouse}
				{#if warehouseKind}<div>
						<dt class="text-xs font-medium text-muted-foreground">
							{ctx.t('models.orders.fields.warehouse')}
						</dt>
						<dd class="text-sm">
							<Show
								{ctx}
								readonly
								kind={warehouseKind}
								value={selectedContract.snapshot.warehouse || null}
								relation={{ targets: ['warehouses'] }}
							/>
						</dd>
					</div>{/if}
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.currency')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.currency}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.ordered_on')}
					</dt>
					<dd class="text-sm">
						<Show {ctx} kind={{ kind: 'date' }} value={selectedContract.ordered_on} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.tax_inclusive')}
					</dt>
					<dd class="text-sm">
						<Show {ctx} kind={{ kind: 'bool' }} value={selectedContract.snapshot.tax_inclusive} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t(
							selectedContract.origin === 'kingdee'
								? 'component.contract_imported_at'
								: 'models.orders.fields.sealed_at'
						)}
					</dt>
					<dd class="text-sm">
						<Show {ctx} kind={{ kind: 'instant' }} value={selectedContract.approved_at} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.payment_terms')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.payment_terms}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.delivery_terms')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.delivery_terms || '—'}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{ctx.t('models.orders.fields.valid_from')}
					</dt>
					<dd class="text-sm">
						<Show
							{ctx}
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
				{#if sealedDocuments.length || canFile || filedRead?.error || remainingFiles.error}
					<div class="min-w-0">
						<dt class="text-xs font-medium text-muted-foreground">
							{ctx.t('models.orders.fields.supporting_documents')}
						</dt>
						<dd class="text-sm">
							<Cluster gap="xs">
								{#if sealedDocuments.length}<Show
										{ctx}
										readonly
										kind={documentKind}
										value={sealedDocuments}
									/>{/if}
								{#if canFile && id}
									<Button
										variant="ghost"
										size="icon"
										aria-label={ctx.t('component.file_order_document')}
										title={ctx.t('component.file_order_document')}
										onclick={() => openCreate('order_files', { order: id, seal_hash: seal })}
									>
										<Icon name="lucide:plus" class="size-4" />
									</Button>
								{/if}
								{#if filedRead?.error || remainingFiles.error}
									<span role="status" class="text-sm text-muted-foreground"
										>{ctx.t('component.order_documents_unavailable')}</span
									>
								{/if}
							</Cluster>
						</dd>
					</div>
				{/if}
			</Grid>
			{@const currency = { currency: selectedContract.snapshot.currency }}
			<div class="@container rounded-md border border-border">
				<table class="w-full table-fixed text-sm @2xl:table-auto">
					<thead class="bg-muted/50 text-left text-muted-foreground">
						<tr>
							<th class="w-2/5 px-3 py-2 font-medium @2xl:w-auto"
								>{ctx.t('models.order_lines.fields.product')}</th
							>
							{#each ['quantity', 'unit_price', 'discount_pct', 'tax_rate', 'total'] as const as name (name)}<th
									class={[
										'px-3 py-2 text-right font-medium',
										name !== 'quantity' && name !== 'total' && 'hidden @2xl:table-cell'
									]}>{ctx.t(`models.order_lines.fields.${name}`)}</th
								>{/each}
						</tr>
					</thead>
					<tbody>
						{#each selectedContract.snapshot.lines as line (line.id)}
							{@const delivered = deliveryTotals?.get(line.id)}
							<tr class="border-t border-border align-top">
								<td class="px-3 py-2"
									>{line.product_name}
									<span class="block text-xs text-muted-foreground">{line.product_code}</span>
									<dl class="mt-1 text-xs text-muted-foreground @2xl:hidden">
										<div>
											<dt class="inline">{ctx.t('models.order_lines.fields.unit_price')}</dt>
											<dd class="inline">
												<Show
													{ctx}
													kind={{ ...moneyKind, scale: 4 }}
													value={line.unit_price}
													row={currency}
												/>
											</dd>
										</div>
										{#if BigDecimal.isPositive(dec(line.discount_pct))}
											<div>
												<dt class="inline">{ctx.t('models.order_lines.fields.discount_pct')}</dt>
												<dd class="inline">{displayDecimal(line.discount_pct)}%</dd>
											</div>
										{/if}
										<div>
											<dt class="inline">{ctx.t('models.order_lines.fields.tax_rate')}</dt>
											<dd class="inline">{displayDecimal(line.tax_rate)}%</dd>
										</div>
									</dl></td
								>
								<td class="px-3 py-2 text-right tabular-nums">
									{displayDecimal(line.quantity)}
									{line.unit}
									{#if delivered && BigDecimal.isPositive(dec(line.quantity))}
										{@const label = ctx.t('component.line_delivery_progress', {
											quantity: displayDecimal(delivered),
											unit: line.unit
										})}
										<Progress
											class="mt-1 h-1"
											value={Math.max(
												0,
												Math.min(
													100,
													BigDecimal.toNumberUnsafe(
														div(BigDecimal.multiply(delivered, dec(100)), line.quantity, 2)
													)
												)
											)}
											aria-label={label}
										/>
										<span class="mt-1 block text-xs text-muted-foreground">{label}</span>
									{/if}
								</td>
								<td class="hidden px-3 py-2 text-right @2xl:table-cell"
									><Show
										{ctx}
										kind={{ ...moneyKind, scale: 4 }}
										value={line.unit_price}
										row={currency}
									/></td
								>
								<td class="hidden px-3 py-2 text-right tabular-nums @2xl:table-cell"
									>{displayDecimal(line.discount_pct)}%</td
								>
								<td class="hidden px-3 py-2 text-right tabular-nums @2xl:table-cell"
									>{displayDecimal(line.tax_rate)}%</td
								>
								<td class="px-3 py-2 text-right"
									><Show {ctx} kind={moneyKind} value={line.total} row={currency} /></td
								>
							</tr>
						{/each}
					</tbody>
					<!-- the agreed totals under the lines -->
					<tfoot class="border-t border-border">
						{#each ['net', 'tax', 'total'] as const as name (name)}<tr
								class={name === 'total' ? 'font-medium' : 'text-muted-foreground'}
							>
								<td colspan="2" class="px-3 py-1.5 text-right @2xl:hidden"
									>{ctx.t(`models.orders.fields.${name}`)}</td
								>
								<td colspan="5" class="hidden px-3 py-1.5 text-right @2xl:table-cell"
									>{ctx.t(`models.orders.fields.${name}`)}</td
								>
								<td class="px-3 py-1.5 text-right"
									><Show
										{ctx}
										kind={moneyKind}
										value={selectedContract.snapshot[name]}
										row={currency}
									/></td
								>
							</tr>{/each}
					</tfoot>
				</table>
			</div>
		</Stack>
	{:else if view.mode !== 'create' && view.record.status === 'draft'}
		<EmptyState
			variant="inset"
			title={ctx.t(purchase ? 'component.commitment_draft' : 'component.unfinalized_quotation')}
		/>
	{:else}<EmptyState variant="inset" title={ctx.t('errors.agreement_access')} />{/if}
{/snippet}
{#snippet lineUnitPrice({
	row,
	value
}: {
	row: RowOf<'order_lines'>;
	value: RowOf<'order_lines'>['unit_price'] | undefined;
})}
	{@const floor = draftContract ? quoteFloors.get(row.id) : undefined}
	{#if floor?.net != null && quote && value != null}
		{@const status = ctx.t(floor.below ? 'errors.floor_below' : 'component.quote_floor_met')}
		{@const minimum = `${quote.currency} ${displayDecimal(floor.net)}/${floor.unit}`}
		{@const hint = `${status} ${ctx.t('component.quote_floor_minimum')}: ${minimum} · ${floor.effective_on}`}
		<Tooltip text={hint}>
			{#snippet trigger({ props })}
				<button
					{...props}
					type="button"
					aria-label={`${quote.currency} ${displayDecimal(value)}. ${hint}`}
					class="inline-flex items-center gap-1 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
					class:text-destructive={floor.below}
					class:text-success={!floor.below}
				>
					<Show {ctx} kind={moneyKind} {value} {row} />
					<Icon name={floor.below ? 'lucide:arrow-down' : 'lucide:check'} class="size-3 shrink-0" />
				</button>
			{/snippet}
		</Tooltip>
	{:else}
		<Show {ctx} kind={moneyKind} {value} {row} />
	{/if}
{/snippet}
{#snippet lines()}{#if id}<Table
			{ctx}
			of="order_lines"
			where={{ order: { eq: id } }}
			columns={[
				'product_name',
				'quantity',
				'unit',
				{ field: 'unit_price', cell: lineUnitPrice },
				'discount_pct',
				'tax_rate',
				'total'
			]}
			toolbar={{
				new:
					ctx.catalog?.order_lines?.create &&
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
					{ctx}
					of="transactions"
					where={{
						order: { eq: id },
						seal_hash: { eq: selectedContract.seal_hash },
						kind: { in: ['delivery', 'invoice'] }
					}}
					columns={['reference', 'kind', 'status', 'source_updated_at']}
					toolbar={{ new: false, controls: versionPicker }}
				/>
			{:else}<EmptyState variant="inset" title={ctx.t('component.contract_no_transactions')} />{/if}
		</Stack>{/if}{/snippet}
{#snippet activity()}{#if id}
		<Stack gap="md">
			<Table
				{ctx}
				of="activities"
				where={{ order: { eq: id } }}
				columns={['title', 'kind', 'owner', 'due_on', 'done']}
				toolbar={{
					new:
						ctx.catalog?.activities?.create && !archived
							? () => openCreate('activities', { order: id })
							: false
				}}
			/>
		</Stack>{/if}{/snippet}
{#snippet versionPicker()}{#if versions.length}<label class="w-36 md:w-44">
			<span class="sr-only"
				>{ctx.t(
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
									label: `${ctx.t('component.contract_draft')} · ${String(view.record.contract_version).padStart(3, '0')}`
								}
							]
						: []),
					...versions.map((v) => ({
						value: String(v.version),
						label: `${ctx.t(purchase ? 'component.commitment' : 'section.seal')} ${String(v.version).padStart(3, '0')}`,
						description: contractLabel(v)
					}))
				]}
				value={draftContract ? 'draft' : String(selectedContract?.version)}
				on_change={(v) => {
					selectedVersion = v;
				}}
			/>
		</label>{/if}{/snippet}
{#snippet sourceConfirmation()}
	{#if selectedContract && !purchase && sourceState && sourceState !== 'connected'}
		<Badge variant="outline">{ctx.t(`component.kingdee_${sourceState}`)}</Badge>
	{:else if selectedContract && !purchase && (selectedContract.kingdee || awaitingKingdee(selectedContract, versions) || needsReconciliation)}
		{@const status = selectedContract.kingdee?.closed ? 'closed' : selectedContract.kingdee?.status}
		{@const presentation = confirmationPresentation(status)}
		<Tooltip
			text={status
				? `Kingdee · ${ctx.t('component.kingdee_version')} ${selectedContract.kingdee?.source_version} · ${presentation.label}`
				: (confirmationRows?.error?.message ??
					(pushFailed && view.mode !== 'create'
						? view.record.$sync?.kingdee?.message
						: undefined) ??
					ctx.t('component.kingdee_waiting'))}
		>
			{#snippet trigger({ props })}<Badge {...props} tabindex={0} variant={presentation.variant}
					>{presentation.label}</Badge
				>{/snippet}
		</Tooltip>
	{/if}
{/snippet}
{#snippet kingdeeConfirmation(source: NonNullable<ContractVersion['kingdee']>)}
	{@const status = source.closed ? 'closed' : source.status}
	{@const presentation = confirmationPresentation(status)}
	{@const disconnected = sourceState && sourceState !== 'connected' ? sourceState : null}
	<Popover.Root>
		<Popover.Trigger
			class="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
		>
			<Badge variant={disconnected ? 'outline' : presentation.variant}>
				{disconnected ? ctx.t(`component.kingdee_${disconnected}`) : presentation.label}
			</Badge>
		</Popover.Trigger>
		<Popover.Content
			align="start"
			class="w-96 max-w-[calc(100vw-2rem)] p-3"
			aria-label={ctx.t('component.kingdee_tracking')}
		>
			<Stack gap="sm">
				<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
					<div>
						<dt class="text-muted-foreground">{ctx.t('models.ext_sales_orders.fields.status')}</dt>
						<dd>
							{status === 'closed'
								? ctx.t('component.kingdee_status_closed')
								: status
									? statusText(status)
									: ctx.t('component.not_set')}
						</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">{ctx.t('component.kingdee_version')}</dt>
						<dd>{source.source_version}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">{ctx.t('component.kingdee_observed_at')}</dt>
						<dd><Show {ctx} kind={{ kind: 'instant' }} value={source.observed_at} /></dd>
					</div>
					{#if source.source_changed_at}
						<div>
							<dt class="text-muted-foreground">{ctx.t('component.kingdee_changed_at')}</dt>
							<dd>{source.source_changed_at}</dd>
						</div>
					{/if}
					{#if source.source_changed_by}
						<div>
							<dt class="text-muted-foreground">{ctx.t('component.kingdee_changed_by')}</dt>
							<dd>{source.source_changed_by}</dd>
						</div>
					{/if}
				</dl>
				{#if selectedEvents.length}
					<ul class="max-h-40 divide-y divide-border overflow-y-auto border-t border-border">
						{#each selectedEvents.toReversed() as event (event.key)}
							<li class="py-2 text-sm">
								<div>{event.kind} · {event.status}</div>
								<div class="text-muted-foreground">
									<Show {ctx} kind={{ kind: 'instant' }} value={event.at} />
									{#if event.source_version}
										· {event.source_version}{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#each confirmationRows?.current?.rows ?? [] as receipt (receipt.id)}
					<Popover.Close
						class="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
						onclick={() => open_record('ext_sales_orders', receipt.id)}
					>
						<Icon name="lucide:arrow-up-right" class="size-4" />
						{receipt.reference}
					</Popover.Close>
				{/each}
			</Stack>
		</Popover.Content>
	</Popover.Root>
{/snippet}
{#snippet confirmationLink()}{#if id && view.mode !== 'create' && selectedContract}
		{#if !purchase && selectedContract.kingdee}
			{@render kingdeeConfirmation(selectedContract.kingdee)}
		{:else if !purchase && sourceState && sourceState !== 'connected'}
			{@render sourceConfirmation()}
		{:else if confirmationRows?.current}
			{#each confirmationRows.current.rows as receipt (receipt.id)}
				{@const status = selectedContract.kingdee?.closed
					? 'closed'
					: (selectedContract.kingdee?.status ?? receipt.status)}
				{@const presentation = confirmationPresentation(status)}
				{@const receiptInfo = `Kingdee · ${receipt.reference}${selectedContract.kingdee ? ` · ${ctx.t('component.kingdee_version')} ${selectedContract.kingdee.source_version}` : ''} · ${presentation.label}`}
				<Tooltip text={receiptInfo}>
					{#snippet trigger({ props })}
						<button
							{...props}
							type="button"
							aria-label={receiptInfo}
							class="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => open_record(confirmationModel, receipt.id)}
						>
							<Badge variant={presentation.variant}>{presentation.label}</Badge>
						</button>
					{/snippet}
				</Tooltip>
			{:else}{@render sourceConfirmation()}{/each}
		{:else if !purchase}{@render sourceConfirmation()}{/if}
	{/if}{/snippet}
{#snippet contractActions(form: FormState | undefined)}
	{@const lockedLabel = selectedContract
		? ctx.t(purchase ? 'component.commitment_recorded' : 'component.sealed')
		: null}
	<Cluster gap="sm" class="max-w-full">
		{@render versionPicker()}
		{#if id && commercial && !recordController?.historical && (selectedContract || (draftContract && !draftSetup))}
			<Button
				type="button"
				variant="outline"
				onclick={() => (documentRequest = { version: selectedContract?.version ?? null })}
				>{ctx.t('component.preview_document')}</Button
			>
		{/if}
		{#if view.mode !== 'create' && !archived && !recordController?.historical && ctx.automations?.orders_revise && (draftSetup || (view.record.status === 'confirmed' && selectedContract && selectedContract.seal_hash === currentContract?.seal_hash))}
			<Button variant="outline" {disabled} onclick={() => change('revise')}
				>{ctx.t(
					draftSetup
						? 'component.resume_contract_setup'
						: purchase
							? 'component.revise_commitment'
							: 'component.new_contract'
				)}</Button
			>
		{/if}
		{#if view.mode === 'view' && !archived && !recordController?.historical && view.record.status === 'confirmed' && canResolve}
			<Button variant="outline" {disabled} onclick={() => change('adopt')}
				>{ctx.t('component.adopt_kingdee')}</Button
			>
			<Button variant="outline" {disabled} onclick={() => change('rebase')}
				>{ctx.t('component.revise_kingdee')}</Button
			>
		{/if}
		{#if form}{@render sealButton(form)}{/if}
		{#if lockedLabel}
			<Tooltip
				text={selectedContract?.origin === 'kingdee'
					? `${ctx.t('component.contract_imported')}. ${lockedLabel}`
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
				variant={selectedContract.lifecycle === 'pending' || provisional(selectedContract)
					? 'warning'
					: selectedContract.seal_hash === currentContract?.seal_hash
						? 'success'
						: 'outline'}
			>
				{contractLabel(selectedContract)}
			</Badge>
			{#if selectedContract.lifecycle !== 'pending' && !provisional(selectedContract)}{@render confirmationLink()}{/if}
		{/if}
	</Cluster>
{/snippet}
{#snippet contractBody(form: FormState)}<Stack gap="md">
		{#if feedback}<p
				role={feedback === ctx.t('component.awaiting_approval') ? 'status' : 'alert'}
				class={[
					'rounded-md border px-3 py-2 text-sm font-medium',
					feedback === ctx.t('component.awaiting_approval')
						? 'border-info/50 bg-info/10 text-info'
						: 'border-destructive/50 bg-destructive/10 text-destructive'
				]}
			>
				{feedback}
			</p>{/if}
		{#if selectedContract}{@render contractControls()}{/if}
		{@render confirmationNotices(form)}
		{#if purchase && (draftContract || view.mode === 'create')}
			<p class="text-sm text-muted-foreground">{ctx.t('component.commitment_help')}</p>
		{/if}
		{#if revisionRun}<RunStatus {ctx} automation="orders_revise" run={revisionRun} />{/if}
		{#if draftContract || view.mode === 'create'}{@render lines()}{:else}{@render agreement()}{/if}
	</Stack>{/snippet}
{#snippet orderState()}
	{#if view.mode !== 'create'}
		<Combobox
			options={[
				{ value: 'active', label: ctx.t('component.order_active') },
				{ value: 'archived', label: ctx.t('component.order_archived') }
			]}
			variant="ghost"
			value={archived ? 'archived' : 'active'}
			aria-label={ctx.t('models.orders.fields.archived')}
			{disabled}
			readonly={!ctx.catalog?.orders?.update}
			on_change={(value) => {
				if (value && (value === 'archived') !== archived)
					change(value === 'archived' ? 'archive' : 'unarchive');
			}}
		/>
	{/if}
{/snippet}
<span hidden {@attach actionLifetime}></span>
<RecordForm
	{ctx}
	editable_presets={['document_template']}
	trailing={orderState}
	readonly={archived || draftSetup}
	readonly_reason={ctx.t(archived ? 'component.order_archived' : 'errors.contract_setup')}
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
			fields: ['title', 'party', 'owner', 'notes']
		},
		{
			name: 'contract',
			icon: 'lucide:file-signature',
			title: ctx.t(purchase ? 'component.purchase_commitment' : 'section.seal'),
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
							'supporting_documents',
							'print_values'
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
			wide: ['print_values']
		}
	]}
	tabs={id
		? [
				{ name: 'activities', title: ctx.t('models.activities.label'), body: activity },
				{ name: 'transactions', title: ctx.t('section.transactions'), body: fulfillment }
			]
		: []}
/>

{#if id && documentRequest}
	<OrderDocumentDialog
		{ctx}
		order={id}
		version={documentRequest.version}
		on_close={() => (documentRequest = null)}
	/>
{/if}
