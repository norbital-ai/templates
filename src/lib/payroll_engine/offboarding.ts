/**
 * L-TPL-hr-payroll-034: end a contract. Last day is inclusive; `behaviour_taps` then applies
 * `encash-leave-on-exit` from the written `exit_ground` and `exit_facts` (L-TPL-hr-payroll-076). The ground is one the
 * version governing the last day lists (`rule_set` PAYROLL `exit_grounds`, `rules.kinds[] = { code, name }`); the
 * facts are the keys its `employee_input_schema.properties.exit_facts` declares. Nothing is defaulted.
 */
import type { DatePeriod } from '@norbital-ai/std/date';
import { PlainDate } from '@norbital-ai/std/date';
import type { JsonObject } from './foundation.js';

export function lastDayRefusal(
	hireFrom: string,
	lastDay: string | null | undefined
): string | null {
	if (lastDay == null || lastDay === '')
		return `Choose a last day of work on or after the hire date (${hireFrom}).`;
	if (lastDay < hireFrom)
		return `Choose a last day of work on or after the hire date (${hireFrom}).`;
	return null;
}

/**
 * Null when the range update is admitted; otherwise the refusal. A planned end (a fixed term) is no departure: the last
 * day moves freely, so a fixed-term contract exits early. A departure (an exit ground with the last day) is moved or
 * undone the same way — its effects are re-evaluated on the write (`retract-exit-effects`). Only a closed range's start
 * is fixed: a rehire is a new contract.
 */
export function refuseClosedUpdate(
	before: { readonly effective_range: { readonly from: string; readonly to: string | null } },
	set: { readonly effective_range?: { readonly from: string; readonly to: string | null } | null }
): string | null {
	const was = before.effective_range;
	if (set.effective_range === undefined) return null;
	if (set.effective_range == null) return 'A contract keeps its effective period.';
	if (was.to != null && set.effective_range.from !== was.from)
		return 'A closed contract keeps its start; rehire on a new contract.';
	if (set.effective_range.to == null || set.effective_range.to === was.to) return null;
	return lastDayRefusal(set.effective_range.from, set.effective_range.to);
}

/** A departure is an exit ground with its last day: a ground without one refuses. */
export const exitGroundRefusal = (input: {
	readonly ground: string | null | undefined;
	readonly to: string | null | undefined;
}): string | null =>
	input.ground != null && input.ground !== '' && input.to == null
		? 'An exit ground is written with the last day of work.'
		: null;

export type ClosedContractSet = {
	readonly effective_range: DatePeriod;
	readonly exit_ground: string;
	readonly exit_facts: JsonObject;
	/** The planned end a fixed-term contract had, kept so undoing the exit reopens to it. */
	readonly signed_contract_end?: PlainDate;
};

/** Writes after `lastDayRefusal` is null, or the refusal when no ground is chosen. */
export function closeContractWrites(input: {
	readonly from: string;
	readonly lastDay: string;
	readonly ground: string | null;
	readonly facts: JsonObject;
	/** The contract's planned end (a fixed term), when it has one and records none yet. */
	readonly plannedEnd?: string | null;
}): ClosedContractSet | string {
	const ground = input.ground?.trim() ?? '';
	if (ground === '') return 'Choose the exit ground.';
	return {
		effective_range: { from: PlainDate(input.from), to: PlainDate(input.lastDay) },
		exit_ground: ground,
		exit_facts: input.facts,
		...(input.plannedEnd == null ? {} : { signed_contract_end: PlainDate(input.plannedEnd) })
	};
}

/** Undoing an exit (a withdrawn resignation): the contract reopens to its planned end, else open-ended. */
export const undoExitWrites = (input: {
	readonly from: string;
	readonly plannedEnd: string | null;
}): {
	readonly effective_range: DatePeriod;
	readonly exit_ground: null;
	readonly exit_facts: null;
} => ({
	effective_range: {
		from: PlainDate(input.from),
		to: input.plannedEnd == null ? null : PlainDate(input.plannedEnd)
	},
	exit_ground: null,
	exit_facts: null
});
