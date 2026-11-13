<script lang="ts">
	/**
	 * HR's manual adjustment of a person's balance: signed days on a leave row's entitlement (hours on a row that counts
	 * in hours), or money on a claim row's limit, of the law in force on the date. One immutable ledger row; the ledger
	 * works out its window.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id, PlainDate } from '@norbital-ai/bolt';
	import { plain_date } from '../../date.js';
	import {
		Button,
		Combobox,
		Editor,
		Sheet,
		Textarea,
		notify_outcome,
		toast
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { versionOn } from '../../payroll_engine/contract_change.js';
	import { decimalText } from '../../payroll_engine/money.js';

	let {
		ctx,
		employeeId,
		balanceId,
		onclose
	}: {
		ctx: PageContext;
		employeeId: Id<'employee_profile'>;
		balanceId: Id<'employee_balance'>;
		onclose: () => void;
	} = $props();
	const t = ctx.t;
	const clock = ctx.clock('day');
	let date = $state<PlainDate>(plain_date(clock.today));
	let chosen = $state<string | null>(null);
	let amount = $state<number | null>(null);
	let note = $state('');
	let saving = $state(false);
	const law = ctx.query({
		employee_contract: {
			where: { employee_id: { eq: employeeId }, status: { eq: 'SEALED' } },
			fields: ['effective_range', 'entity_id'],
			limit: 1000,
			entity_id: { fields: ['settings_code'] }
		},
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['code', 'effective_range'],
			limit: 2000
		}
	});
	/** The law of the contract in force on the date: its rows are the ones a balance can be adjusted on. */
	const version = $derived.by(() => {
		const day = String(date);
		const contract = (law.current?.employee_contract.rows ?? []).find(
			(row) =>
				String(row.effective_range.from) <= day &&
				(row.effective_range.to == null || day <= String(row.effective_range.to))
		);
		return versionOn(
			law.current?.jurisdiction_settings.rows ?? [],
			contract?.entity_id?.settings_code,
			day
		)?.id;
	});
	const rows = $derived(
		version === undefined
			? null
			: ctx.query({
					leave_catalog: {
						where: { settings_id: { eq: version } },
						fields: ['code', 'description', 'lookup'],
						order_by: { code: 'asc' },
						limit: 1000
					},
					claim_catalog: {
						where: { settings_id: { eq: version } },
						fields: ['code', 'description'],
						order_by: { code: 'asc' },
						limit: 1000
					}
				})
	);
	const options = $derived([
		...(rows?.current?.leave_catalog.rows ?? []).map((row) => ({
			value: `leave:${row.code}`,
			label: row.code,
			...(row.description == null ? {} : { description: row.description }),
			group: t('balance.leave')
		})),
		...(rows?.current?.claim_catalog.rows ?? []).map((row) => ({
			value: `claim:${row.code}`,
			label: row.code,
			...(row.description == null ? {} : { description: row.description }),
			group: t('balance.claim')
		}))
	]);
	const account = $derived(chosen?.startsWith('claim:') ? 'claim' : 'leave');
	/** A leave row counts in days, or in hours where its lookup says so. */
	const unit = $derived(
		account === 'claim'
			? 'MONEY'
			: (rows?.current?.leave_catalog.rows ?? []).find((row) => `leave:${row.code}` === chosen)
						?.lookup.unit === 'HOUR'
				? 'HOUR'
				: 'DAY'
	);
	const valid = $derived(
		chosen !== null &&
			options.some((option) => option.value === chosen) &&
			amount !== null &&
			amount !== 0 &&
			(unit !== 'DAY' || Number.isInteger(amount * 2)) &&
			note.trim() !== ''
	);
	function save() {
		if (!valid || chosen === null || amount === null) return;
		saving = true;
		fork(
			ctx
				.act({
					'ledger_entry.create': [
						{
							balance_id: balanceId,
							operation: amount < 0 ? 'DEDUCT' : 'ADD',
							account,
							code: chosen.slice(chosen.indexOf(':') + 1),
							measure: account === 'claim' ? 'limit' : 'entitled',
							amount: decimalText(Math.abs(amount)),
							unit,
							effective_on: date,
							note: note.trim()
						}
					]
				})
				.pipe(
					Effect.tap((outcome) =>
						Effect.sync(() => {
							notify_outcome(ctx, outcome);
							if (outcome.kind === 'committed') {
								toast.success(t('balance.adjusted'));
								onclose();
							}
						})
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (saving = false)))
				)
		);
	}
</script>

<Sheet open title={t('balance.adjust')} on_open_change={(open) => !open && onclose()}>
	<Stack gap="md">
		<p class="text-muted-foreground text-sm">{t('balance.adjust_help')}</p>
		<label class="grid gap-1" for="balance-adjust-date">
			<span class="text-xs font-medium text-muted-foreground">{t('balance.date')}</span>
			<Editor
				{ctx}
				id="balance-adjust-date"
				name="effective_on"
				kind={{ kind: 'date' }}
				value={date}
				disabled={saving}
				on_change={(next) => next != null && (date = plain_date(String(next)))}
			/>
		</label>
		<label class="grid gap-1" for="balance-adjust-row">
			<span class="text-xs font-medium text-muted-foreground">{t('balance.row')}</span>
			<Combobox
				id="balance-adjust-row"
				{options}
				value={chosen}
				disabled={saving}
				loading={rows?.loading ?? law.loading}
				on_change={(next) => (chosen = next)}
			/>
		</label>
		<label class="grid gap-1" for="balance-adjust-amount">
			<span class="text-xs font-medium text-muted-foreground"
				>{unit === 'MONEY'
					? t('balance.money')
					: unit === 'HOUR'
						? t('balance.hours')
						: t('balance.days')}</span
			>
			<Editor
				{ctx}
				id="balance-adjust-amount"
				name="amount"
				kind={{ kind: 'number' }}
				value={amount}
				disabled={saving}
				on_change={(next) => (amount = typeof next === 'number' ? next : null)}
			/>
		</label>
		<label class="grid gap-1" for="balance-adjust-note">
			<span class="text-xs font-medium text-muted-foreground">{t('balance.note')}</span>
			<Textarea id="balance-adjust-note" bind:value={note} disabled={saving} />
		</label>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={onclose}>{t('component.cancel')}</Button>
			<Button disabled={saving || !valid} onclick={save}>{t('balance.adjust')}</Button>
		</Cluster>
	</Stack>
</Sheet>
