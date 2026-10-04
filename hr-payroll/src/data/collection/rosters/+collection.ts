import { collection } from '@norbital-ai/bolt';
import { PlainDate, monthOf } from '@norbital-ai/std/date';
import { plain, decodeNumber } from '../../../lib/payroll_engine/foundation/primitives.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { calendarDay } from '../../../lib/payroll_engine/foundation/time.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { Schema } from 'effect';

const c = collection('rosters', { read: { fields: 'all' }, create: { input: { columns: ['employment_id', 'period'] } }, delete: { transform: true } });
export default c;
c.transform(async (inputs, ctx) => {
 const rows = inputs.map((value, index) => {
  const input = plain(value), prior = ctx.existing[index] == null ? undefined : plain(ctx.existing[index]);
  const row = { ...prior, ...input };
  if (!Schema.is(Schema.NonEmptyString)(row.employment_id) || !Schema.is(Schema.String)(row.period) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period)) refuse('A monthly roster requires its actual profile and calendar month.');
  if (prior?.approval_id != null) refuse('A pending monthly roster cannot be replaced.');
  return { row, bounds: monthOf(PlainDate(`${row.period}-01`)) };
 });
 if (!rows.length) return inputs;
 const profiles = await readAll<{ id: string; company_id: string; effective_range: unknown; approval_id: unknown }>(ctx.db, 'employee_profiles', { id: { in: [...new Set(rows.map(value => value.row.employment_id))] }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true, effective_range: true, approval_id: true });
 for (const { row, bounds } of rows) {
  const profile = profiles.find(profile => profile.id === row.employment_id);
  if (profile == null || profile.approval_id != null) refuse('A monthly roster requires its actual approved employed profile.');
  const interval = Schema.decodeUnknownSync(Schema.Struct({ from: calendarDay, to: Schema.NullOr(calendarDay) }))(profile.effective_range);
  if (interval.from > bounds.to! || (interval.to != null && interval.to < bounds.from)) refuse('A monthly roster must intersect its actual employment period.');
 }
 const answers = await Promise.allSettled([
  readAll<{ id: string; company_id: string; attendance_from: unknown; attendance_to: unknown }>(ctx.db, 'payroll_runs', { company_id: { in: [...new Set(profiles.map(profile => profile.company_id))] } }, undefined, { id: true, company_id: true, attendance_from: true, attendance_to: true }),
  readAll<{ payroll_run_id: string; employment_id: string; status: string; paid_at: unknown; funding_received: unknown; settled_by_payment_event_id: unknown }>(ctx.db, 'payslips', { employment_id: { in: profiles.map(profile => profile.id) } }, undefined, { payroll_run_id: true, employment_id: true, status: true, paid_at: true, funding_received: true, settled_by_payment_event_id: true })
 ]);
 for (const answer of answers) if (answer.status === 'rejected') throw answer.reason;
 const [runs, slips] = answers;
 if (runs.status !== 'fulfilled' || slips.status !== 'fulfilled') refuse('Monthly roster settlement evidence is unavailable.');
 for (const { row, bounds } of rows) for (const slip of slips.value) {
  if (slip.employment_id !== row.employment_id || (slip.status !== 'PAID' && slip.paid_at == null && slip.settled_by_payment_event_id == null && decodeNumber(slip.funding_received ?? 0) <= 0)) continue;
  const profile = profiles.find(profile => profile.id === row.employment_id)!;
  const run = runs.value.find(run => run.id === slip.payroll_run_id && run.company_id === profile.company_id);
  if (run == null || run.attendance_from == null || run.attendance_to == null) refuse('A settled monthly roster requires its original payroll attendance window.');
  const from = Schema.decodeUnknownSync(calendarDay)(run.attendance_from), to = Schema.decodeUnknownSync(calendarDay)(run.attendance_to);
  if (from <= bounds.to! && to >= bounds.from) refuse('A settled payroll attendance window holds its monthly roster.');
 }
 return inputs;
});
