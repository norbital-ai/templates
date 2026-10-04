import { parseDateTime, toZoned } from '@internationalized/date';
import { calendarDateInTimeZone } from '../../../lib/payroll_engine/foundation/time.js';
import * as Predicate from 'effect/Predicate';

export type AttendanceInterval = { start: string | Date; end: string | Date | null };
type Attendance = { intervals: readonly AttendanceInterval[] | null; breakMinutes: number | null };
const instant = (value: string | Date) => value instanceof Date ? value.getTime() : Date.parse(value);
export function attendanceChanged(before: Attendance, after: Attendance) {
 return before.breakMinutes !== after.breakMinutes || (before.intervals == null) !== (after.intervals == null) ||
  before.intervals?.length !== after.intervals?.length || (before.intervals ?? []).some((row, i) => {
   const next = after.intervals?.[i];
   return next == null || instant(row.start) !== instant(next.start) || (row.end == null) !== (next.end == null) || (row.end != null && next.end != null && instant(row.end) !== instant(next.end));
  });
}
export const daySaveIntent = (assignment: boolean, attendance: boolean) => assignment ? attendance ? 'changes' : 'assignment' : attendance ? 'attendance' : 'none';
export function daySaveLabelKey(role: string, intent: string) { return role === 'employee' ? 'roster.save_punch' : `roster.save_${intent}`; }

/** A stated break remains only to the extent a closed observed clock has not already shown it. */
export function attendanceBreakMinutes(intervals:readonly AttendanceInterval[]|null,grant:number){
 if(intervals==null||intervals.length===0||intervals.some(row=>row.end==null))return 0;
 const span=instant(intervals.at(-1)!.end!)-instant(intervals[0]!.start);
 const worked=intervals.reduce((total,row)=>total+instant(row.end!)-instant(row.start),0);
 return Math.max(0,grant-(span-worked)/60_000);
}
/** Clock presentation only. Admission, pay and working-time limits remain in accepted WORK programmes. */
export function assessAttendanceDraft(intervals: readonly AttendanceInterval[], grant: number | null) {
 let closedMinutes = 0, hasOpenInterval = false, problem: string | null = intervals.length === 0 ? 'NO_INTERVALS' : null;
 for (let i = 0; i < intervals.length && problem == null; i++) {
  const row = intervals[i]!, start = instant(row.start), end = row.end == null ? null : instant(row.end);
  if (!Number.isFinite(start) || (end != null && !Number.isFinite(end))) { problem = 'INVALID_INSTANT'; break; }
  if (end == null && i !== intervals.length - 1) { problem = 'OPEN_NOT_LAST'; break; }
  if (end != null && end <= start) { problem = 'ENDS_BEFORE_IT_STARTS'; break; }
  const prior = intervals[i - 1];
  if (prior?.end != null) {
   if (start < instant(prior.end)) { problem = 'OUT_OF_ORDER'; break; }
  }
  if (end == null) hasOpenInterval = true;
  else closedMinutes += (end - start) / 60_000;
 }
 const breakMinutes = problem==null ? attendanceBreakMinutes(intervals,grant??0) : 0;
 return { closedMinutes, breakMinutes, hasOpenInterval, workedMinutes: hasOpenInterval ? null : Math.max(0, closedMinutes - breakMinutes), problem };
}
export function clockToDayMinutes(clock: string, offset: number) {
 if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock) || !Number.isInteger(offset)) return null;
 const [hour, minute] = clock.split(':').map(Number);
 return hour! * 60 + minute! + offset * 1440;
}
export const dayMinutesOffsetDays = (minutes: number) => Math.floor(minutes / 1440);
export function dayMinutesToClock(minutes: number) {
 const local = ((minutes % 1440) + 1440) % 1440;
 return `${Math.floor(local / 60).toString().padStart(2, '0')}:${Math.floor(local % 60).toString().padStart(2, '0')}`;
}
export function instantFromDayStart(date: string, minutes: number, zone: string) {
 const target = new Date(`${date}T00:00:00Z`); target.setUTCDate(target.getUTCDate() + dayMinutesOffsetDays(minutes));
 return toZoned(parseDateTime(`${target.toISOString().slice(0, 10)}T${dayMinutesToClock(minutes)}`), zone, 'reject').toDate().toISOString();
}
export function minutesFromDayStart(value: string | Date, date: string, zone: string) {
 return (instant(value) - instant(instantFromDayStart(date, 0, zone))) / 60_000;
}
type Plan = { shiftStart?: string | null; shiftEnd?: string | null; shiftBreakMinutes?: number | null; approvedOvertimeHours?: number | null; workedMinutes?: number | null };
export function scheduledMinutes(plan: Plan) {
 if (plan.shiftStart == null || plan.shiftEnd == null) return null;
 const start = clockToDayMinutes(plan.shiftStart, 0), end = clockToDayMinutes(plan.shiftEnd, 0);
 if (start == null || end == null) return null;
 return (end > start ? end - start : end - start + 1440) - (plan.shiftBreakMinutes ?? 0);
}
export function beyondPlanMinutes(plan: Plan) {
 const scheduled = scheduledMinutes(plan);
 return scheduled == null || plan.workedMinutes == null ? null : plan.workedMinutes - scheduled - (plan.approvedOvertimeHours ?? 0) * 60;
}
type Lock = { kind: string; period?: string; date?: string };
type LockedDay = { date: string; lock: Lock };
export function lockRung(day: LockedDay, claim: { period: string } | null) {
 return day.lock.kind === 'SETTLED' ? 'PAID' : claim != null ? 'CONSUMED' : day.lock.kind === 'IN_WINDOW' ? 'IN_DRAFT_RUN' : 'OPEN';
}
export const lockRungFreezes = (rung: string) => rung === 'CONSUMED' || rung === 'PAID';
export function lockRungSourceLock(day: LockedDay, claim: { period: string } | null) {
 return claim != null ? { kind: 'SETTLED', period: claim.period } : day.lock.kind === 'SETTLED' ? { kind: 'PAID_DAY', period: day.lock.period, date: day.date } : null;
}
type WorkDay = { id: string; employment_id: string; work_date: string | Date; shift_definition_id?: string | null; worked_intervals?: readonly AttendanceInterval[] | null; approved_overtime_hours?: number | null };
type Shift = { code: string; variant: { kind: string; start_time?: string; end_time?: string; break_minutes?: number; paid_minutes?: number } };
export function indexWorkDaysByPersonDay(rows: readonly WorkDay[], zone = 'Asia/Kuala_Lumpur') {
 const result = new Map<string, WorkDay>();
 for (const row of rows) {
  const date = Predicate.isString(row.work_date) && /^\d{4}-\d{2}-\d{2}$/.test(row.work_date) ? row.work_date : calendarDateInTimeZone(row.work_date instanceof Date ? row.work_date : new Date(row.work_date), zone);
  const key = `${row.employment_id}:${date}`;
  if (result.has(key)) throw new Error(`Duplicate approved attendance for ${key}.`);
  result.set(key, row);
 }
 return result;
}
export type AttendanceCell = { employmentId: string; date: string; workDayId: string | null; designation: string | null; shiftCode: string | null; shiftStart: string | null; shiftEnd: string | null; shiftBreakMinutes: number | null; approvedOvertimeHours: number | null; attendanceState: 'OPEN' | 'CLOSED' | null; breakMinutes: number | null; workedMinutes: number | null; clockedIn: boolean; status: string; lock: Lock; intervals: readonly AttendanceInterval[] | null };
/** Paints accepted native person-day geometry. It never projects a contract or creates an absence. */
export function buildRosterMonth(options: { month: string; employee_profiles: readonly { id: string; effective_range: { start?: string; end?: string | null; from?: string; to?: string | null } }[]; workDays: readonly WorkDay[]; rosterCodesById: ReadonlyMap<string, Shift>; cutoff: { start: string; end: string } | null; locks: ReadonlyMap<string, Lock>; timezone?: string; [key: string]: unknown }) {
 if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(options.month)) throw new Error('An actual calendar month is required.');
 const indexed = indexWorkDaysByPersonDay(options.workDays, options.timezone), result = new Map<string, AttendanceCell>();
 const last = new Date(`${options.month}-01T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
 for (const profile of options.employee_profiles) for (let i = 1; i <= last.getUTCDate(); i++) {
  const date = `${options.month}-${String(i).padStart(2, '0')}`, range = profile.effective_range;
  if (date < (range.from ?? range.start ?? '') || date > (range.to ?? range.end ?? '9999-12-31')) continue;
  const key = `${profile.id}:${date}`, row = indexed.get(key), shift = row?.shift_definition_id == null ? null : options.rosterCodesById.get(row.shift_definition_id);
  const intervals = row?.worked_intervals ?? null, assessment = intervals == null ? null : assessAttendanceDraft(intervals, shift?.variant.break_minutes ?? null);
  const open = intervals?.some(interval => interval.end == null) ?? false;
  result.set(key, { employmentId: profile.id, date, workDayId: row?.id ?? null, designation: shift?.variant.kind ?? null, shiftCode: shift?.code ?? null, shiftStart: shift?.variant.start_time ?? null, shiftEnd: shift?.variant.end_time ?? null, shiftBreakMinutes: shift?.variant.break_minutes ?? null, approvedOvertimeHours: row?.approved_overtime_hours ?? null, attendanceState: intervals == null ? null : open ? 'OPEN' : 'CLOSED', breakMinutes: assessment?.breakMinutes ?? null, workedMinutes: assessment?.workedMinutes ?? null, clockedIn: (intervals?.length ?? 0) > 0, status: intervals?.length === 0 && options.cutoff != null && date >= options.cutoff.start && date <= options.cutoff.end ? 'ABSENT' : intervals == null ? 'PLANNED' : 'RECORDED', lock: options.locks.get(key) ?? { kind: 'NONE' }, intervals });
 }
 return result;
}

/** The controller eye filter uses native observed clock state, independent of absence/pay status. */
export function unresolvedClockOutEmploymentIds(cells: readonly { employmentId: string; attendanceState: string | null }[]) {
 return new Set(cells.filter(cell => cell.attendanceState === 'OPEN').map(cell => cell.employmentId));
}

type CapturedLayer = {code: unknown; kind: unknown; patternCode?: unknown};
export function resolveCellLayers(day: AttendanceCell & {base:CapturedLayer|null;override:CapturedLayer|null;effective:string;timezone:string}) {
 const clock = (value:string|Date) => new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:day.timezone}).format(new Date(value));
 const rows=day.intervals;
 const actual=rows==null?{kind:'NONE'}:rows.length===0?{kind:day.status==='ABSENT'?'AWOL':'EMPTY'}:rows.some(row=>row.end==null)?{kind:'OPEN',first:clock(rows[0]!.start)}:{kind:'CLOCKED',first:clock(rows[0]!.start),last:clock(rows.at(-1)!.end!),workedMinutes:day.workedMinutes};
 return {base:day.base,override:day.override,actual,effective:day.effective};
}

export type PresentedAttendanceCell = AttendanceCell & {base:CapturedLayer|null;override:CapturedLayer|null;effective:string;timezone:string;incentiveHours?:number|null;holidayName?:string|null;holidayFrom?:string|null;withinCutoff?:boolean;writable?:boolean;plannedOT?:boolean};
export function plannedExtraLabel(day:{approvedOvertimeHours?:number|null;incentiveHours?:number|null}|undefined){
 const hours=(value:number)=>`${Math.round(value*2)/2}h`;
 return [day?.approvedOvertimeHours?`+${hours(day.approvedOvertimeHours)} OT`:null,day?.incentiveHours?`+${hours(day.incentiveHours)} inc`:null].filter(Boolean).join(' · ')||null;
}
export function slotState(day:PresentedAttendanceCell|undefined){return day==null?'EMPTY':day.plannedOT?'EXTRA_WORK':day.designation==='REST'?'REST':day.designation==='OFF'?'OFF':day.effective==='NONE'?'UNROSTERED':'WORK';}
export function slotFill(day:PresentedAttendanceCell|undefined){
 if(day==null)return {kind:'NONE'};
 const actual=resolveCellLayers(day).actual;
 if(actual.kind==='NONE'||actual.kind==='EMPTY')return {kind:'NONE'};
 if(actual.kind==='OPEN')return {kind:'OPEN',since:actual.first};
 if(actual.kind==='AWOL')return {kind:'AWOL'};
 const worked=day.workedMinutes??0,shift=scheduledMinutes(day),planned=shift==null?null:shift+((day.approvedOvertimeHours??0)+(day.incentiveHours??0))*60;
 const shortMinutes=Math.max(0,(planned??0)-worked);
 return {kind:'CLOCKED',ratio:planned==null||planned<=0?1:Math.min(1,worked/planned),shortMinutes,short:Math.round(shortMinutes/30)>0,workedMinutes:worked,plannedMinutes:planned,first:actual.first,last:actual.last};
}
type AttendanceTranslator=(key:string,parameters?:Record<string,unknown>)=>string;
export function describePlanLayer(day:PresentedAttendanceCell,t:AttendanceTranslator){
 const window=day.shiftStart==null||day.shiftEnd==null?null:t('roster.shift_window',{start:day.shiftStart,end:day.shiftEnd,break:(day.shiftBreakMinutes??0)/60});
 const origin=day.override!=null?day.base==null?t('roster.layer_override'):t('roster.layer_override_over_base',{origin:t('roster.layer_override'),base:day.base.code}):day.base==null?t('roster.unrostered'):day.base.patternCode==null?t('roster.layer_base'):t('roster.layer_base_from',{pattern:day.base.patternCode});
 return [origin,day.shiftCode==null?null:t('roster.shift_code',{code:day.shiftCode}),window].filter(value=>value!=null).join(' · ');
}
export function describeClockLayer(day:PresentedAttendanceCell,t:AttendanceTranslator){
 const actual=resolveCellLayers(day).actual;
 if(actual.kind==='CLOCKED')return t('roster.layer_clocked_window',{first:actual.first,last:actual.last,hours:((day.workedMinutes??0)/60).toFixed(2)});
 if(actual.kind==='OPEN')return t('roster.layer_clocked_open',{first:actual.first});
 if(actual.kind==='AWOL')return t('roster.layer_awol');
 if(actual.kind==='EMPTY')return t('roster.layer_empty');
 return t(day.withinCutoff?'roster.no_attendance_in_pay_period':'roster.layer_none');
}
export function describeDay(day:PresentedAttendanceCell|undefined,heading:string,t:AttendanceTranslator){
 if(day==null)return heading;
 return [heading,describePlanLayer(day,t),day.holidayName==null?null:day.holidayName+(day.holidayFrom==null?'':` (${t('roster.holiday_carried_from',{date:day.holidayFrom})})`),day.plannedOT?t('roster.planned_ot'):null,(day.approvedOvertimeHours??0)>0?t('roster.planned_overtime_hours',{hours:`${Math.round(day.approvedOvertimeHours!*2)/2}h`}):null,(day.incentiveHours??0)>0?t('roster.planned_incentive_hours',{hours:`${Math.round(day.incentiveHours!*2)/2}h`}):null,describeClockLayer(day,t)].filter(value=>value!=null).join(' — ');
}
/** Personal correction is available only for an actual writable, unrecorded roster row. */
export function employeeMissingPunchReportable(day:PresentedAttendanceCell,today:string,pending:ReadonlySet<string>,claims:ReadonlySet<string>){return day.writable!==false&&day.workDayId!=null&&day.date<=today&&day.intervals==null&&day.designation==='WORK'&&day.lock.kind==='NONE'&&!pending.has(day.workDayId)&&!claims.has(day.workDayId);}
