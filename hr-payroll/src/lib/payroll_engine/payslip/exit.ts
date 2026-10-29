import { Effect } from 'effect';
import { addDays, datePeriod, days, intersect } from '@norbital-ai/std/date';
import { fieldValue, PAYROLL_DEFAULTS } from '../foundation.js';
import {
	num,
	type PayslipLine,
	type CatalogRow,
	type PayslipRow,
	type SlipContext
} from './context.js';
const EXIT_FAMILY = 'EXIT';
const CORRECTION_FAMILY = 'CORRECTION';
export const exitCorrections = Effect.fnUntraced(function* (
	options: SlipContext,
	adjustments: PayslipLine[],
	post: (row: CatalogRow, amount: number) => number,
	salaried: boolean
) {
	const { contract, employee } = options.subject,
		{ window, money } = options.payroll;
	const who = employee?.name ?? contract.id;
	const payroll = yield* Effect.fromResult(
		fieldValue(options.jurisdiction.version.payroll, 'jurisdiction_settings.payroll')
	);
	let made = 0;
	const flip = (row: CatalogRow, amount: number): CatalogRow =>
		amount >= 0 ? row : { ...row, direction: row.direction === 'SUBTRACT' ? 'ADD' : 'SUBTRACT' };
	const add = Effect.fnUntraced(function* (
		row: CatalogRow,
		amount: number,
		line: Pick<PayslipLine, 'family' | 'source_id' | 'component_code' | 'label'>,
		/** The paid period ends the day before this window: the first run that can see the change. */
		fresh: boolean
	) {
		// a leaver's slip pays nothing to recover from: the version's `exit_overpayment` deducts the overpayment there
		// anyway, or flags it on the first run after it
		if (
			amount < 0 &&
			!salaried &&
			(payroll?.exit_overpayment ?? PAYROLL_DEFAULTS.exit_overpayment) === 'note'
		) {
			if (fresh)
				options.payroll.notes.push(
					`${who}: ${line.label ?? line.component_code} overpaid ${money(-amount)} after the exit moved; recover it outside payroll.`
				);
			return;
		}
		const posted = post(flip(row, amount), Math.abs(amount));
		made++;
		adjustments.push({
			...line,
			bucket: posted >= 0 && row.destination === 'PAY' ? 'EARNING' : 'DEDUCTION',
			destination: row.destination === 'PAY' ? 'PAY' : 'NET',
			amount: posted
		});
	});
	const lines = options.history.payslips.flatMap((slip) =>
		(slip.adjustments ?? []).map((line) => ({ slip, line }))
	);
	const sourced = new Set(lines.map(({ line }) => String(line.source_id ?? '')));
	const exitDay = contract.effective_range?.to ?? null;
	const departed = contract.exit_ground != null && contract.exit_ground !== '' && exitDay != null;
	const key = departed ? `${exitDay}/${contract.exit_ground}` : '';
	// what paid slips paid for an exit no longer standing, taken back once
	for (const { slip, line } of lines) {
		const source = String(line.source_id ?? '');
		if (slip.status !== 'PAID' || line.family !== EXIT_FAMILY || source.endsWith(':reversal'))
			continue;
		if (source.endsWith(`:${key}`) && key !== '') continue;
		if (sourced.has(`${source}:reversal`)) continue;
		const code = String(line.component_code ?? '');
		const row = [...options.jurisdiction.classes.values()].find((held) => held.code === code) ?? {
			id: code,
			code,
			destination: line.destination === 'PAY' ? 'PAY' : 'NET',
			counts_toward: []
		};
		const paidIn = options.history.runWindows.get(String(slip.payroll_run_id ?? ''));
		yield* add(
			row,
			-line.amount,
			{
				family: EXIT_FAMILY,
				source_id: `${source}:reversal`,
				component_code: code,
				label: `${line.label ?? code} (exit withdrawn)`
			},
			paidIn != null && addDays(paidIn.to, 1) === window.salary_from
		);
	}
	// paid periods repriced over the days they now cover. A switched month settles month to date: its own earlier
	// slips are settled by this run's lines, and a slip a later month-to-date slip of its month superseded is
	// repriced through that one, over the month from the 1st.
	const settledBy = (slip: PayslipRow) => {
		const from = String(slip.salary_from ?? '').slice(0, 10);
		return options.history.payslips.some(
			(other) =>
				other !== slip &&
				String(other.salary_from ?? '').slice(0, 7) === from.slice(0, 7) &&
				String(other.salary_from ?? '').slice(0, 10) > from &&
				(other.proration ?? []).some((held) => held.window_from != null)
		);
	};
	for (const slip of options.history.payslips) {
		const run = options.history.runWindows.get(String(slip.payroll_run_id ?? ''));
		if (slip.status !== 'PAID' || run == null || run.to >= window.salary_from) continue;
		if (options.payroll.switched && run.from.slice(0, 7) === window.salary_from.slice(0, 7))
			continue;
		if (settledBy(slip)) continue;
		for (const held of slip.proration ?? []) {
			const opens = held.window_from ?? run.from;
			const covered = intersect(
				datePeriod(opens, run.to),
				datePeriod(contract.effective_range?.from ?? opens, contract.effective_range?.to ?? null)
			);
			const now = covered == null ? 0 : days(covered);
			const code = String(held.component_code ?? '');
			const paid = held.prorated_amount;
			const full = held.contract_amount;
			const was = num(held.days);
			const target =
				now === was
					? paid
					: now === 0
						? 0
						: now === days(datePeriod(opens, run.to))
							? full
							: paid + (full * (now - was)) / Math.max(1, num(held.denominator, 1));
			const source = `${String(slip.id)}:${code}`;
			const done = lines
				.filter(({ line }) => line.family === CORRECTION_FAMILY && line.source_id === source)
				.reduce((total, { line }) => total + line.amount, 0);
			const owed = money(target - paid - done);
			if (owed === 0) continue;
			const row = [
				...options.jurisdiction.workRows,
				...options.jurisdiction.suspensionPay,
				...options.jurisdiction.leavePay
			].find((candidate) => (candidate.component_code ?? candidate.code) === code) ?? {
				id: code,
				code,
				destination: 'PAY',
				counts_toward: []
			};
			yield* add(
				row,
				owed,
				{
					family: CORRECTION_FAMILY,
					source_id: source,
					component_code: code,
					label: `${row.name ?? code} ${opens}–${run.to} (exit moved)`
				},
				addDays(run.to, 1) === window.salary_from
			);
		}
	}
	return made;
});
