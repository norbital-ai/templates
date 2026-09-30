import { collection } from '@norbital-ai/bolt';
import * as Predicate from 'effect/Predicate';
import { dateKey, isCalendarDate } from '../../../lib/iso-day.js';
import { readRange } from '../../../lib/payroll/run/effective.js';

const c = collection('benefit_case_cutoffs', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'benefit_case_plan_id',
				'cutoff_reference',
				'payroll_period',
				'salary_window',
				'leave_slice',
				'pay_on',
				'premium_basis',
				'premium_shares',
				'premium_reference',
				'premium_file'
			]
		}
	}
});
export default c;

/** Source rows can be appended, but their complete partition is checked again before payroll. */
c.transform(async (inputs, ctx) => {
	const { db } = ctx;
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const planIds = [
		...new Set(inputs.map((row) => row.benefit_case_plan_id).filter((id) => id != null))
	];
	const plans = planIds.length
		? (await db.read('benefit_case_plans', { where: { id: { in: planIds } }, all: true })).rows
		: [];
	const planById = new Map(plans.map((row) => [row.id, row]));
	const existing = planIds.length
		? (
				await db.read('benefit_case_cutoffs', {
					where: { benefit_case_plan_id: { in: planIds } },
					all: true
				})
			).rows
		: [];
	// An open-ended stored slice cannot overlap anything, so it carries no end.
	const spans = existing.flatMap((row) => {
		const range = readRange(row.leave_slice);
		return range == null
			? []
			: [{ planId: row.benefit_case_plan_id, start: range.start, end: range.end ?? '' }];
	});
	for (const input of inputs) {
		if (!planById.has(input.benefit_case_plan_id!))
			refuse('A benefit cutoff needs an existing frozen pay plan.');
		if (!(input.cutoff_reference ?? '').trim() || !(input.payroll_period ?? '').trim())
			refuse('A benefit cutoff needs its stable reference and payroll period.');
		// An open-ended window is not a cutoff: both ends are read as plain keys first.
		const salary = readRange(input.salary_window);
		const leave = readRange(input.leave_slice);
		const salaryStart = salary == null ? '' : dateKey(salary.start);
		const salaryEnd = salary?.end == null ? '' : dateKey(salary.end);
		const leaveStart = leave == null ? '' : dateKey(leave.start);
		const leaveEnd = leave?.end == null ? '' : dateKey(leave.end);
		const payOn = dateKey(input.pay_on);
		if (
			!isCalendarDate(salaryStart) ||
			!isCalendarDate(salaryEnd) ||
			!isCalendarDate(leaveStart) ||
			!isCalendarDate(leaveEnd) ||
			!isCalendarDate(payOn) ||
			salaryStart > salaryEnd ||
			leaveStart > leaveEnd ||
			leaveStart < salaryStart ||
			leaveEnd > salaryEnd
		)
			refuse(
				'A benefit cutoff needs real, ordered leave days within its salary window and a payment day.'
			);
		if (
			spans.some(
				(row) =>
					row.planId === input.benefit_case_plan_id &&
					row.start <= leaveEnd &&
					row.end >= leaveStart
			)
		)
			refuse('Benefit cutoff leave days cannot overlap within a case plan.');
		spans.push({ planId: input.benefit_case_plan_id!, start: leaveStart, end: leaveEnd });
		// The case type's schemes are matched when the plan prices the cutoffs; each share is a sum here.
		const shares = Object.values(input.premium_shares ?? {});
		if (
			shares.length === 0 ||
			shares.some(
				(amount) =>
					!Predicate.isNumber(amount) ||
					!Number.isFinite(amount) ||
					amount < 0 ||
					Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
			)
		)
			refuse('Benefit employee premium shares need a nonnegative amount to the cent per scheme.');
		if (!(input.premium_reference ?? '').trim() || input.premium_file == null)
			refuse('Benefit premium shares need their dated source document.');
	}
	return inputs;
});
