<script lang="ts">
	/**
	 * One settled thing a payslip did about one input, read only.
	 *
	 * Nothing writes here by hand — the payroll engine writes every adjustment when the run is built
	 * — so this panel explains a figure rather than offering to change one.
	 *
	 * `input` is the one discriminated reference handle over the four captured-input junctions. The
	 * junction is what the run captured; the link this screen opens is the business source behind it
	 * (work day, component entry, leave request, or loan repayment), falling back to the junction
	 * only when that source id is not yet on the live row.
	 */
	import { Button } from '@norbital-ai/ui/button';
	import {
		createCollectionRouteKey,
		getCollectionNavigationContext
	} from '@norbital-ai/ui/collection-navigation';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Result, Schema } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import type { RepresentationProps } from './$types.js';

	let { record }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const navigation = getCollectionNavigationContext();

	const adjustmentInputSchema = Schema.Union([
		Schema.Struct({ kind: Schema.Literal('WORK_DAY_INPUT'), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal('COMPONENT_ENTRY_INPUT'), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal('LEAVE_REQUEST_INPUT'), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal('LOAN_REPAYMENT_INPUT'), id: Schema.String })
	]);
	type AdjustmentInput = Schema.Schema.Type<typeof adjustmentInputSchema>;
	const decodeAdjustmentInput = Schema.decodeUnknownResult(adjustmentInputSchema);

	type SourceTarget = { readonly collectionName: string; readonly recordId: string };

	const input = $derived.by((): AdjustmentInput | null => {
		if (record == null) return null;
		const parsed = decodeAdjustmentInput(record.input);
		return Result.isSuccess(parsed) ? parsed.success : null;
	});

	const junctionQuery = $derived.by(() => {
		if (input == null) return null;
		switch (input.kind) {
			case 'WORK_DAY_INPUT':
				return client.db.payslip_work_day_inputs.findFirst({
					where: { id: { eq: input.id } },
					columns: { id: true, work_day_id: true }
				});
			case 'COMPONENT_ENTRY_INPUT':
				return client.db.payslip_component_entry_inputs.findFirst({
					where: { id: { eq: input.id } },
					columns: { id: true, component_entry_id: true }
				});
			case 'LEAVE_REQUEST_INPUT':
				return client.db.payslip_leave_request_inputs.findFirst({
					where: { id: { eq: input.id } },
					columns: { id: true, leave_request_id: true }
				});
			case 'LOAN_REPAYMENT_INPUT':
				return client.db.payslip_loan_repayment_inputs.findFirst({
					where: { id: { eq: input.id } },
					columns: { id: true, loan_repayment_id: true }
				});
			default: {
				const _never: never = input;
				return _never;
			}
		}
	});

	function fieldId(row: unknown, field: string): string | null {
		if (row == null || typeof row !== 'object') return null;
		const value = Reflect.get(row, field);
		return typeof value === 'string' && value !== '' ? value : null;
	}

	function sourceTargetFor(
		kind: AdjustmentInput['kind'],
		junctionId: string,
		row: unknown
	): SourceTarget {
		switch (kind) {
			case 'WORK_DAY_INPUT': {
				const sourceId = fieldId(row, 'work_day_id');
				return sourceId
					? { collectionName: 'work_days', recordId: sourceId }
					: { collectionName: 'payslip_work_day_inputs', recordId: junctionId };
			}
			case 'COMPONENT_ENTRY_INPUT': {
				const sourceId = fieldId(row, 'component_entry_id');
				return sourceId
					? { collectionName: 'component_entries', recordId: sourceId }
					: { collectionName: 'payslip_component_entry_inputs', recordId: junctionId };
			}
			case 'LEAVE_REQUEST_INPUT': {
				const sourceId = fieldId(row, 'leave_request_id');
				return sourceId
					? { collectionName: 'leave_requests', recordId: sourceId }
					: { collectionName: 'payslip_leave_request_inputs', recordId: junctionId };
			}
			case 'LOAN_REPAYMENT_INPUT': {
				const sourceId = fieldId(row, 'loan_repayment_id');
				return sourceId
					? { collectionName: 'loan_repayments', recordId: sourceId }
					: { collectionName: 'payslip_loan_repayment_inputs', recordId: junctionId };
			}
			default: {
				const _never: never = kind;
				return _never;
			}
		}
	}

	const source = $derived.by((): SourceTarget | null =>
		input == null ? null : sourceTargetFor(input.kind, input.id, junctionQuery?.current)
	);

	function navigationTarget(target: SourceTarget) {
		return {
			collectionName: target.collectionName,
			recordId: target.recordId,
			routeKey: createCollectionRouteKey({ view: target.collectionName })
		};
	}

	const sourceHref = $derived(
		source == null || navigation == null ? undefined : navigation.href(navigationTarget(source))
	);

	function inputKind(kind: AdjustmentInput['kind']): string {
		switch (kind) {
			case 'COMPONENT_ENTRY_INPUT':
				return t('component.entry_kind');
			case 'WORK_DAY_INPUT':
				return t('component.attendance');
			case 'LEAVE_REQUEST_INPUT':
				return t('component.leave');
			case 'LOAN_REPAYMENT_INPUT':
				return t('app.loans.agreements');
			default: {
				const _never: never = kind;
				return _never;
			}
		}
	}

	function hasValue(value: unknown): boolean {
		return value != null && value !== '';
	}

	function openSource(event: MouseEvent): void {
		if (source == null || navigation == null) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		event.preventDefault();
		navigation.open(navigationTarget(source));
	}
</script>

{#if record}
	<Stack gap="md">
		<Grid as="dl" gap="sm" minimum="compact">
			<Stack gap="xs">
				<dt class="text-meta">{t('component.component')}</dt>
				<dd class="font-medium">{record.label}</dd>
			</Stack>
			<Stack gap="xs">
				<dt class="text-meta">{t('component.amount')}</dt>
				<dd class="font-semibold tabular-nums">{formatNumeric(record.amount)}</dd>
			</Stack>
			<Stack gap="xs">
				<dt class="text-meta">{t('component.bucket')}</dt>
				<dd class="font-medium">{record.bucket}</dd>
			</Stack>
			{#if hasValue(record.quantity)}
				<Stack gap="xs">
					<dt class="text-meta">{t('component.quantity')}</dt>
					<dd class="tabular-nums">{formatNumeric(record.quantity)}</dd>
				</Stack>
			{/if}
			{#if hasValue(record.rate)}
				<Stack gap="xs">
					<dt class="text-meta">{t('component.rate')}</dt>
					<dd class="tabular-nums">{formatNumeric(record.rate)}</dd>
				</Stack>
			{/if}
			{#if hasValue(record.statutory_rule_key)}
				<Stack gap="xs">
					<dt class="text-meta">{t('component.statutory_rule_key')}</dt>
					<dd class="font-medium">{record.statutory_rule_key}</dd>
				</Stack>
			{/if}
			<Stack gap="xs">
				<dt class="text-meta">{t('component.input_type')}</dt>
				<dd>
					<Inline gap="xs" align="center">
						<span>{input == null ? '—' : inputKind(input.kind)}</span>
						{#if source && navigation}
							<Button
								variant="link"
								href={sourceHref}
								aria-label={t('component.open_source')}
								onclick={openSource}
							>
								<IconWrapper name="lucide:arrow-up-right" class="size-3.5" />
							</Button>
						{/if}
					</Inline>
				</dd>
			</Stack>
		</Grid>
	</Stack>
{:else}
	<p class="text-sm text-muted-foreground">
		A payslip adjustment is written by the payroll engine, never by hand: build the payroll run and
		it writes one row per input it took into account.
	</p>
{/if}
