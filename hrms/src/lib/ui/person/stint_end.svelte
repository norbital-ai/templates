<script lang="ts">
	/**
	 * Terminate: a stint's last day and its exit answers, with what final pay recovers of the person's loans, in one
	 * write.
	 */
	import type { PlainDate } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Editor, Label, notify_outcome, Sheet, toast, type Kind } from '@norbital-ai/ui';
	import { run } from '@norbital-ai/ui/effect';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { companyOn } from '../../company.js';
	import { inForce } from '../../dated.js';
	import { accountsOf, latestLeft } from '../../ledger/core.js';
	import { termsChange } from '../../person.js';
	import {
		isJsonObject,
		jsonObject,
		numberOf,
		type Json
	} from '../../payroll_engine/foundation.js';
	import { loanRecovery, monthlyEquivalent } from '../../payroll_engine/loan_schedule.js';
	import { pageLaws } from '../law.svelte.js';
	import type { PersonRead, StintRow } from './person_read.svelte.js';
	import { outstandingOf, recoverLoans } from './stint_loans.js';

	let {
		ctx,
		stint,
		read,
		onclose
	}: { ctx: PageContext; stint: StintRow; read: PersonRead; onclose: () => void } = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const today = ctx.clock('day').today;
	const EXIT_GROUNDS = [
		'RETRENCHMENT',
		'RETIREMENT',
		'RESIGNATION',
		'DISMISSAL',
		'MISCONDUCT_DISMISSAL',
		'END_OF_CONTRACT',
		'MUTUAL',
		'DEATH',
		'UNILATERAL',
		'BREACH_BY_EMPLOYER'
	] as const;
	const EXIT_GROUND: Kind = { kind: 'enum', values: [...EXIT_GROUNDS], optional: true };

	let lastDay = $state<PlainDate | null>(today);
	let finalPayDueOn = $state<PlainDate | null>(null);
	let exitGround = $state<(typeof EXIT_GROUNDS)[number] | null>(stint.exit_ground ?? null);
	let encashLeave = $state(stint.encash_leave !== false);
	let expectedPayEdit = $state<number | null>(null);
	let note = $state('');
	let saving = $state(false);
	let failure = $state<string | null>(null);

	const code = $derived(read.company(stint.entity_id)?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	const law = $derived(laws.on(code, String(stint.effective_range.from)));
	const held = ctx.query({
		employee_balance: {
			where: { employee_id: { eq: stint.employee_id } },
			fields: ['account'],
			limit: 1
		},
		loan_catalog_entry: {
			where: { employment_id: { eq: stint.id } },
			fields: ['id', 'quantity'],
			limit: 10000
		},
		loan_catalog_entry_repayment: {
			where: { employment_id: { eq: stint.id } },
			fields: ['loan_id', 'amount', 'payroll_run_id'],
			limit: 10000
		},
		payslip: {
			where: { employment_id: { eq: stint.id } },
			fields: ['net_pay', 'period'],
			limit: 10000
		},
		entity_change: { where: { entity_id: { eq: stint.entity_id } }, limit: 1000 }
	});
	const lastDayInvalid = $derived(lastDay === null || lastDay < stint.effective_range.from);
	const leaveDays = $derived(
		latestLeft(accountsOf(held.current?.employee_balance.rows[0]?.account), 'leave', 'ANNUAL_LEAVE')
	);
	const outstandingLoans = $derived(
		outstandingOf(
			held.current?.loan_catalog_entry.rows ?? [],
			held.current?.loan_catalog_entry_repayment.rows ?? []
		)
	);
	const latestPayslip = $derived(
		(held.current?.payslip.rows ?? []).toSorted((left, right) =>
			String(right.period ?? '').localeCompare(String(left.period ?? ''))
		)[0]
	);
	const rateEquivalent = $derived.by(() => {
		const agreed = inForce(
			stint.terms.map(jsonObject).map(termsChange),
			String(lastDay ?? today)
		).state;
		return monthlyEquivalent({
			rate: isJsonObject(agreed.rate) ? agreed.rate : null,
			normal_days_per_week: numberOf(agreed.normal_days_per_week),
			normal_hours_per_week: numberOf(agreed.normal_hours_per_week)
		});
	});
	const expectedPay = $derived(
		expectedPayEdit ??
			(latestPayslip === undefined ? rateEquivalent : Number(latestPayslip.net_pay ?? 0))
	);
	const recoveryBasis = $derived(
		expectedPayEdit !== null
			? t('contract.recovery_basis_manual')
			: latestPayslip !== undefined
				? t('contract.recovery_basis_payslip', { period: String(latestPayslip.period ?? '') })
				: rateEquivalent !== null
					? t('contract.recovery_basis_rate')
					: t('contract.recovery_basis_none')
	);
	const floorPercent = $derived(
		Number(
			companyOn((held.current?.entity_change.rows ?? []).map(jsonObject), lastDay ?? today)[
				'final_pay_loan_floor_percent'
			]
		)
	);
	const decimals = $derived(
		new Intl.NumberFormat('en', {
			style: 'currency',
			currency: String(law?.settings.currency ?? 'USD')
		}).resolvedOptions().maximumFractionDigits ?? 2
	);
	const recovery = $derived(
		expectedPay === null
			? null
			: loanRecovery({
					loans: outstandingLoans.map((item) => ({
						id: String(item.row.id),
						outstanding: item.amount
					})),
					expectedPay,
					floorPercent,
					decimals
				})
	);
	const valid = $derived(
		note.trim() !== '' && !lastDayInvalid && (outstandingLoans.length === 0 || recovery !== null)
	);

	async function commit() {
		const day = lastDay;
		if (!valid || saving || day === null) return;
		saving = true;
		failure = null;
		try {
			const acts: Record<string, Json> = {
				...(await recoverLoans(
					ctx,
					{
						id: stint.id,
						entity_id: stint.entity_id,
						employee_id: stint.employee_id,
						employee_number: stint.employee_number
					},
					day,
					{ expectedPay, floorPercent, decimals },
					(remaining) =>
						t('contract.loan_recovery_task', { number: stint.employee_number, amount: remaining })
				)),
				'employment.update': [
					{
						target: { id: stint.id, revision: stint.revision },
						set: {
							effective_range: { from: stint.effective_range.from, to: day },
							reason: note.trim(),
							...(finalPayDueOn === null ? {} : { final_pay_due_on: finalPayDueOn }),
							...(exitGround === null ? {} : { exit_ground: exitGround }),
							encash_leave: encashLeave
						}
					}
				]
			};
			const outcome = await run(ctx.act(acts));
			notify_outcome(ctx, outcome);
			if (outcome.kind === 'committed') onclose();
		} catch (error) {
			failure = error instanceof Error ? error.message : t('component.error');
			toast.error(failure);
		} finally {
			saving = false;
		}
	}
</script>

<Sheet
	open
	on_open_change={(open) => !open && !saving && onclose()}
	title={t('contract.terminate')}
>
	<Stack gap="md">
		{#if failure !== null}<p class="text-sm text-destructive">{failure}</p>{/if}
		<p class="text-sm text-muted-foreground">{t('contract.termination_help')}</p>
		<Stack gap="xs">
			<Label for="stint-last-day">{t('contract.last_working_day')}</Label>
			<Editor
				{ctx}
				id="stint-last-day"
				name="last_day"
				kind={{ kind: 'date' }}
				value={lastDay}
				disabled={saving}
				on_change={(next) => (lastDay = next == null ? null : String(next))}
			/>
			{#if lastDayInvalid}
				<p class="text-xs text-destructive">{t('contract.last_day_invalid')}</p>
			{/if}
		</Stack>
		{#if outstandingLoans.length > 0}
			<Stack gap="sm">
				<h3 class="font-medium">{t('contract.loan_recovery')}</h3>
				{#each outstandingLoans as item (item.row.id)}
					<p class="text-sm">
						{t('contract.loan_outstanding', {
							amount: item.amount,
							final: recovery?.allocations.find((row) => row.id === String(item.row.id))?.final ?? 0
						})}
					</p>
				{/each}
				<Stack gap="xs">
					<Label for="stint-expected-pay">{t('contract.expected_final_pay')}</Label>
					<Editor
						{ctx}
						id="stint-expected-pay"
						name="expected_final_pay"
						kind={{ kind: 'number', min: 0 }}
						value={expectedPay}
						disabled={saving}
						on_change={(next) => (expectedPayEdit = typeof next === 'number' ? next : null)}
					/>
					<span class="text-xs text-muted-foreground">{recoveryBasis}</span>
				</Stack>
				{#if recovery !== null}
					<p class="text-sm text-muted-foreground">
						{t('contract.recovery_summary', {
							outstanding: outstandingLoans.reduce((sum, item) => sum + item.amount, 0),
							floor: floorPercent,
							maximum: recovery.maximum,
							proposed: recovery.proposed,
							remaining: recovery.remaining
						})}
					</p>
					{#if recovery.remaining > 0}
						<p class="text-sm text-amber-700 dark:text-amber-300">
							{t('contract.recovery_notice', { remaining: recovery.remaining })}
						</p>
					{/if}
				{/if}
			</Stack>
		{/if}
		<Stack gap="xs">
			<Label for="stint-exit-ground">{t('contract.exit_ground')}</Label>
			<Editor
				{ctx}
				id="stint-exit-ground"
				name="exit_ground"
				kind={EXIT_GROUND}
				value={exitGround}
				disabled={saving}
				on_change={(next) => (exitGround = EXIT_GROUNDS.find((ground) => ground === next) ?? null)}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="stint-encash-leave">{t('contract.encash_leave')}</Label>
			<Editor
				{ctx}
				id="stint-encash-leave"
				name="encash_leave"
				kind={{ kind: 'bool' }}
				value={encashLeave}
				disabled={saving}
				on_change={(next) => (encashLeave = next === true)}
			/>
			<span class="text-xs text-muted-foreground"
				>{encashLeave
					? t('contract.leave_encash_preview', { days: leaveDays })
					: t('contract.leave_not_encashed')}</span
			>
		</Stack>
		<Stack gap="xs">
			<Label for="stint-final-pay-due">{t('contract.final_pay_due')}</Label>
			<Editor
				{ctx}
				id="stint-final-pay-due"
				name="final_pay_due_on"
				kind={{ kind: 'date' }}
				value={finalPayDueOn}
				disabled={saving}
				on_change={(next) => (finalPayDueOn = next == null ? null : String(next))}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="stint-reason">{t('contract.reason')}</Label>
			<Editor
				{ctx}
				id="stint-reason"
				name="reason"
				kind={{ kind: 'text' }}
				value={note}
				disabled={saving}
				on_change={(next) => (note = next == null ? '' : String(next))}
			/>
		</Stack>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={onclose}>{t('component.cancel')}</Button>
			<Button disabled={saving || !valid} onclick={commit}>{t('contract.terminate')}</Button>
		</Cluster>
	</Stack>
</Sheet>
