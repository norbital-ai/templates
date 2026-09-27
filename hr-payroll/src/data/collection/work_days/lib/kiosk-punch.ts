import { everyField } from '../../../../lib/every-field.js';
import type { ActionCtx, Id } from '@norbital-ai/bolt';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { coversDate } from '../../../../lib/payroll/run/effective.js';
import { entityDay } from '../../../../lib/kiosk/entity-day.js';
import {
	KIOSK_PUNCH_COOLDOWN_MS,
	nextPunch,
	type PunchInterval
} from '../../../../lib/kiosk/punch.js';
import { patternAnchor, patternRosterCodeId } from '../../../../lib/scheduling/work-pattern.js';
import { rosterCodeKind } from '../../../../lib/scheduling/roster-code.js';
import type { RosterCodeVariant } from '../../../../lib/datatypes/roster_code_variant.js';
import type { WorkPattern } from '../../../../lib/datatypes/work_pattern.js';

type Ctx = Pick<ActionCtx<'work_days'>, 'read' | 'get' | 'act' | 'refuse' | 'now' | 'todayIn'>;
type Punch = { readonly employment_id: Id<'employments'>; readonly kind: 'FACE' | 'MANUAL' };

/**
 * One kiosk punch on today's person-day (today on the employing entity's clock). The first punch of the day is the
 * arrival and every later one moves the departure; a punch inside the cooldown is a blocked outcome, not a refusal.
 *
 * A FACE punch needs the day's plan: the explicit roster code on the row wins, and otherwise the terms' shift pattern
 * projects the day's code, exactly as the `work_days` transform resolves it. Nothing is stamped onto the row — writing
 * the projected code would freeze it. Not scheduled, and a REST or OFF day, are blocked outcomes too, because nothing
 * went wrong: the person is simply not rostered. MANUAL is untouched: a supervisor keys a call-back day by hand.
 */
export async function kioskPunch({ employment_id, kind }: Punch, ctx: Ctx) {
	const now = String(ctx.now);
	const contract = await ctx.get('employments', employment_id, {
		select: everyField('employments')
	});
	if (contract == null) ctx.refuse('Employment does not exist.');
	const today = await entityDay(ctx, contract.company_id);
	if (!coversDate(contract.effective_range, today))
		ctx.refuse('This employment is not active today.');
	const employee = await ctx.get('employees', contract.employee_id, {
		select: everyField('employees')
	});
	if (employee == null) ctx.refuse('Employee does not exist.');
	if (kind === 'FACE' && employee.face_enrollment_status !== 'APPROVED')
		ctx.refuse('Face attendance requires an approved enrollment.');
	const stored = (
		await ctx.read('work_days', {
			select: everyField('work_days'),
			where: {
				employment_id: { eq: employment_id },
				work_date: { eq: today as `${number}-${number}-${number}` }
			},
			limit: 1
		})
	).rows[0];

	if (kind === 'FACE') {
		let codeId = stored?.shift_definition_id == null ? null : String(stored.shift_definition_id);
		if (codeId == null) {
			// Terms that name no pattern are rostered as assigned: only an explicit roster entry puts the person on.
			const terms = await ctx.read('employment_terms', {
				select: everyField('employment_terms'),
				where: { employment_id: { eq: employment_id }, approval_id: { isNull: true } },
				all: true
			});
			const term = terms.rows.find((candidate) => coversDate(candidate.effective_range, today));
			const pattern =
				term?.shift_pattern_id == null
					? null
					: await ctx.get('shift_patterns', term.shift_pattern_id, {
							select: everyField('shift_patterns')
						});
			// A pattern the projection cannot measure is "no base": the plain "not scheduled" outcome, never an error.
			try {
				codeId =
					pattern == null
						? null
						: patternRosterCodeId(pattern.pattern as WorkPattern, today, patternAnchor(pattern));
			} catch {
				codeId = null;
			}
		}
		const code =
			codeId == null
				? null
				: await ctx.get('shift_definitions', codeId as Id<'shift_definitions'>, {
						select: everyField('shift_definitions')
					});
		if (code == null) return { status: 'blocked', kind, reason: 'not-scheduled' };
		if (rosterCodeKind(code.variant) !== 'WORK')
			return { status: 'blocked', kind, reason: 'not-a-work-day', plannedCode: code.code };
	}

	const intervals = (stored?.worked_intervals ?? null) as readonly PunchInterval[] | null;
	const outcome = nextPunch(
		intervals,
		now,
		employee.face_last_match_at == null ? null : String(employee.face_last_match_at)
	);
	if (outcome.kind === 'blocked')
		return { status: 'blocked', reason: outcome.reason, retryAfterMs: outcome.retryAfterMs, kind };
	const worked_intervals = outcome.intervals.map((interval) => ({
		start: Instant(interval.start),
		end: interval.end == null ? null : Instant(interval.end)
	}));
	if (stored == null)
		await ctx.act('work_days.create', {
			employment_id,
			work_date: PlainDate(today),
			worked_intervals
		});
	else await ctx.act('work_days.update', { target: stored.id, set: { worked_intervals } });
	if (kind === 'FACE')
		await ctx.act('employees.update', {
			target: employee.id,
			set: {
				face_last_match_at: Instant(now),
				face_match_count: employee.face_match_count + 1
			}
		});
	return {
		status: outcome.kind,
		kind,
		intervalIndex: outcome.index,
		time: now,
		cooldownMs: KIOSK_PUNCH_COOLDOWN_MS
	};
}
