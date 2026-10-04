import { readQualifiedRuleData } from '../../../lib/payroll_engine/execution/rule-sets.js';
import { captureAttendanceMonth } from '../../../app/hr_controller/people/attendance-source.js';
import { collection, type Id, type Insert, type Patch } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { calendarDateInTimeZone, calendarDay, isOffsetIsoInstant } from '../../../lib/payroll_engine/foundation/time.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { prepareConfiguredBehaviourExecution, stageConfiguredBehaviourExecution } from '../../../lib/payroll_engine/execution/behaviours.js';

import { PlainDate, Instant, monthOf } from '@norbital-ai/std/date';
import { plain, stableJson, decodeNumber } from '../../../lib/payroll_engine/foundation/primitives.js';
import { settingsInForce } from '../../../lib/payroll_engine/admission/schema-version.js';
import { allocateNativeWorkMonth } from '../../../lib/payroll_engine/ordering/work-allocation.js';
import { admitConfiguredWorkDayBatch, prepareConfiguredWorkMonthReads } from '../../../lib/configured-work-day.js';
import { entryDateCovered } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
const c = collection('roster_entries', {
 read: { fields: 'all' },
 create: { input: { columns: ['employment_id', 'work_date', 'shift_definition_id', 'worked_intervals', 'piece_units', 'piece_unit_rate', 'piece_overtime_units', 'approved_overtime_hours', 'incentive_hours', 'overtime_consented_at', 'facts', 'source_basis'] } },
 delete: { transform: true },
 update: { input: { columns: ['shift_definition_id', 'worked_intervals', 'piece_units', 'piece_unit_rate', 'piece_overtime_units', 'approved_overtime_hours', 'incentive_hours', 'overtime_consented_at', 'facts', 'source_basis'] } },
 actions: {
  import_attendance: {
   description: 'Atomically import normalized XLSX attendance rows through pinned WORK rules; every row must be admitted or the complete batch rolls back.',
   input: { entity_id: { kind: 'id', of: 'entities' }, snapshot_id: { kind: 'id', of: 'jurisdiction_settings' }, configuration_hash: { kind: 'text' }, month: { kind: 'text' }, rows: { kind: 'list', optional: true, of: { kind: 'object', fields: { employee_number: { kind: 'text' }, work_date: { kind: 'date' }, worked_intervals: { kind: 'json' } } } }, roster: { kind: 'list', optional: true, of: { kind: 'object', fields: { employee_number: { kind: 'text' }, work_date: { kind: 'date' }, shift_code: { kind: 'text' } } } }, pieces: { kind: 'list', optional: true, of: { kind: 'object', fields: { employee_number: { kind: 'text' }, work_date: { kind: 'date' }, piece_units: { kind: 'number' }, piece_unit_rate: { kind: 'number' }, piece_overtime_units: { kind: 'number', optional: true } } } }, overtime: { kind: 'list', optional: true, of: { kind: 'object', fields: { employee_number: { kind: 'text' }, work_date: { kind: 'date' }, overtime_hours: { kind: 'number' }, overtime_consented_at: { kind: 'text', optional: true }, facts: { kind: 'json', optional: true } } } } },
   output: { kind: 'json' }
  },
  capture: {
   description: 'Apply pinned WORK attendance rules using server time and literal native attendance writes; alerts are returned for the kiosk to sound.',
   input: { profile_id: { kind: 'id', of: 'employee_profiles' }, snapshot_id: { kind: 'id', of: 'jurisdiction_settings' }, configuration_hash: { kind: 'text' }, mode: { kind: 'enum', values: ['KIOSK', 'ATTENDANCE_IMPORT'] }, kind: { kind: 'enum', values: ['FACE', 'MANUAL'] }, replacement: { kind: 'json', optional: true }, work_date: { kind: 'date', optional: true }, worked_intervals: { kind: 'json', optional: true } },
   output: { kind: 'json' }
  }
 },
 queries: {
  attendance_template_configuration: { description: 'Dated employer workbook timezone and declared import columns from actual sealed WORK configuration.', input: { entity_id: { kind: 'id', of: 'entities' }, month: { kind: 'text' } }, output: { kind: 'json' } },
  attendance_overtime_headroom: { description: 'Configured overtime headroom with every other native month day held fixed.', input: { profile_id: { kind: 'id', of: 'employee_profiles' }, work_date: { kind: 'date' }, shift_code: { kind: 'text', optional: true } }, output: { kind: 'json' } },
  attendance_month: { description: 'Accepted original roster geometry and native attendance for one caller-readable profile month.', input: { profile_id: { kind: 'id', of: 'employee_profiles' }, month: { kind: 'text' } }, output: { kind: 'json' } },
  kiosk_configuration: { description: 'Resolve the actual server-local governing attendance configuration without exposing employee or entity facts.', input: { entity_id: { kind: 'id', of: 'entities' } }, output: { kind: 'object', fields: { snapshot_id: { kind: 'id', of: 'jurisdiction_settings' }, configuration_hash: { kind: 'text' }, timezone: { kind: 'text' } } } },
  plan_capture: {
   description: 'Prepare configured attendance from actual approved owners, pinned rules and server time. This does not capture attendance.',
   input: {
    profile_id: { kind: 'id', of: 'employee_profiles' },
    snapshot_id: { kind: 'id', of: 'jurisdiction_settings' },
    configuration_hash: { kind: 'text' },
    event_id: { kind: 'text' },
    mode: { kind: 'enum', values: ['KIOSK', 'ATTENDANCE_IMPORT'] }
   },
   output: { kind: 'json' }
  }
 }
});
export default c;
c.query('plan_capture', async (input, ctx) => {
 const versions = await readAll<{ id: string; payroll: { timezone: string } }>(ctx, 'jurisdiction_settings', { id: { eq: input.snapshot_id }, approval_id: { isNull: true } }, undefined, { id: true, payroll: true }, 1);
 const version = versions[0];
 if (versions.length !== 1 || version?.id !== String(input.snapshot_id) || !Schema.is(Schema.NonEmptyString)(version?.payroll?.timezone)) refuse('Attendance requires its actual jurisdiction payroll timezone.');
 const timezone = version.payroll.timezone;
 return Schema.decodeUnknownSync(Schema.Json)(await prepareConfiguredBehaviourExecution(ctx, {
 event: { id: input.event_id, kind: input.mode, subject: { collection: 'employee_profiles', id: String(input.profile_id) } },
 catalog: 'WORK', snapshot_id: String(input.snapshot_id), configuration_hash: input.configuration_hash,
 day: calendarDateInTimeZone(new Date(String(ctx.now)), timezone), observation: { observedAt: String(ctx.now), timezone }
}, { UPDATE: 'roster_entries', CREATE: 'roster_entries', SIGNAL: 'kiosk' }));
});

/** Intrinsic attendance contracts are enforced on every native write, including a configured action. */
c.transform(async (inputs, ctx) => {
 // Workspace reads stay inside admission. The kiosk never receives confidential embedded owner inputs.
 const admitted = [];
 for (const [index, value] of inputs.entries()) {
  const input = plain(value), prior = ctx.existing[index] == null ? undefined : plain(ctx.existing[index]);
  if (!('source_basis' in input)) { admitted.push(value); continue; }
  const request = Schema.decodeUnknownSync(Schema.Struct({ snapshot_id: Schema.NonEmptyString, configuration_hash: Schema.NonEmptyString, kind: Schema.Literals(['FACE', 'MANUAL']) }))(input.source_basis, { onExcessProperty: 'error' });
  const row = { ...prior, ...input };
  if (!Schema.is(Schema.NonEmptyString)(row.employment_id)) refuse('Attendance requires its original native profile.');
  const versions = await readAll<{ id: string; payroll: { timezone: string } }>(ctx.db, 'jurisdiction_settings', { id: { eq: request.snapshot_id }, approval_id: { isNull: true } }, undefined, { id: true, payroll: true }, 1);
  const version = versions[0];
  if (versions.length !== 1 || version?.id !== request.snapshot_id || !Schema.is(Schema.NonEmptyString)(version?.payroll?.timezone)) refuse('Attendance requires its actual jurisdiction payroll timezone.');
  const date = calendarDateInTimeZone(new Date(String(ctx.now)), version.payroll.timezone);
  if (String(row.work_date) !== date) refuse('Kiosk attendance must retain its actual server-local work date.');
  const prepared = await prepareConfiguredBehaviourExecution(ctx.db, {
   event: { id: String(ctx.now) + ':' + String(row.employment_id), kind: 'KIOSK', subject: { collection: 'employee_profiles', id: row.employment_id }, data: { kind: request.kind } },
   catalog: 'WORK', snapshot_id: request.snapshot_id, configuration_hash: request.configuration_hash,
   day: date, observation: { observedAt: String(ctx.now), timezone: version.payroll.timezone }
  }, { CREATE: 'roster_entries', UPDATE: 'roster_entries', SIGNAL: 'kiosk' });
  if (prepared.execution.plan.some(step => step.operation.capability === 'SIGNAL')) refuse('NO_WORK_SHIFT: attendance is permitted only on its actual assigned or projected WORK shift.');
  const writes = prepared.execution.plan.filter(step => step.operation.target === 'roster_entries');
  if (writes.length !== 1 || writes[0]!.operation.capability !== (prior == null ? 'CREATE' : 'UPDATE')) refuse('Kiosk attendance requires exactly one configured native person-day write.');
  const args = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.optional(Schema.NonEmptyString), employment_id: Schema.NonEmptyString, work_date: calendarDay, worked_intervals: Schema.Array(Schema.Struct({ start: Schema.String, end: Schema.NullOr(Schema.String) })) }))(writes[0]!.args, { onExcessProperty: 'error' });
  if (args.employment_id !== row.employment_id || args.work_date !== date || (prior == null ? args.id != null : args.id !== prior.id)) refuse('Configured attendance must retain its exact actual person-day.');
  const native = { ...value, worked_intervals: args.worked_intervals.map(interval => ({ start: Instant(interval.start), end: interval.end == null ? null : Instant(interval.end) })), source_basis: { configuration_hash: prepared.hash, snapshot_id: request.snapshot_id, configuration_source_hash: request.configuration_hash } };
  admitted.push(native);
 }
 inputs = admitted;
 const rows = inputs.map((value, index) => {
  const input = plain(value), prior = ctx.existing[index] == null ? undefined : plain(ctx.existing[index]);
  if (prior?.approval_id != null) refuse('Pending attendance cannot be overwritten.');
  if ('$delete' in input) {
   if (prior == null || !Schema.is(Schema.NonEmptyString)(prior.employment_id)) refuse('Deleting attendance requires its exact original native row.');
   return { input, prior, row: prior, date: Schema.decodeUnknownSync(calendarDay)(prior.work_date) };
  }
  const row = { ...prior, ...input };
  if (!Schema.is(Schema.NonEmptyString)(row.employment_id)) refuse('Attendance requires its actual profile.');
  const date = Schema.decodeUnknownSync(calendarDay)(row.work_date);
  if ((row.piece_units == null) !== (row.piece_unit_rate == null)) refuse('Piece units and the actual rate must be captured together.');
  if (row.piece_overtime_units != null && (row.piece_units == null || decodeNumber(row.piece_overtime_units) > decodeNumber(row.piece_units))) refuse('Overtime piece units must be a subset of total actual units.');
  const approved = decodeNumber(row.approved_overtime_hours ?? 0), incentive = decodeNumber(row.incentive_hours ?? 0);
  if (!Number.isFinite(approved) || !Number.isFinite(incentive) || approved < 0 || incentive < 0 || approved + incentive > 24) refuse('Planned overtime and incentive hours must be nonnegative and cannot exceed the 24 hours a day has.');
  if (prior != null && Object.hasOwn(input, 'shift_definition_id') && input.shift_definition_id !== prior.shift_definition_id && prior.worked_intervals != null && !Object.hasOwn(input, 'worked_intervals')) refuse('Recorded attendance holds its planned shift unless the same write restates its attendance.');

  const intervals = Schema.decodeUnknownSync(Schema.NullOr(Schema.Array(Schema.Struct({ start: Schema.String, end: Schema.NullOr(Schema.String) }))))(row.worked_intervals ?? null, { onExcessProperty: 'error' });
  let previousEnd = -Infinity;
  for (const [index, interval] of (intervals ?? []).entries()) {
   if (!isOffsetIsoInstant(interval.start) || (interval.end != null && !isOffsetIsoInstant(interval.end))) refuse('Attendance must use actual offset-bearing instants.');
   const from = Date.parse(interval.start), to = interval.end == null ? null : Date.parse(interval.end);
   if (from < previousEnd || (to != null && to <= from) || (to == null && index !== (intervals?.length ?? 0) - 1)) refuse('Attendance intervals must be ordered, non-overlapping, and only the final interval may be open.');
   previousEnd = to ?? Infinity;
  }
  return { input, prior, row, date };
 });
 if (rows.length === 0) return [];
 const profiles = await readAll<{ id: string; company_id: string; effective_range: unknown; approval_id: unknown }>(ctx.db, 'employee_profiles', { id: { in: [...new Set(rows.map(x => x.row.employment_id))] }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true, effective_range: true, approval_id: true });
 const subjects = new Map(profiles.map(x => [x.id, x]));
 for (const item of rows) {
  const profile = subjects.get(item.row.employment_id!);
  if (profile == null || profile.approval_id != null || !entryDateCovered(profile.effective_range, item.date)) refuse('Attendance requires its approved profile active on the actual work date.');
 }
 await admitConfiguredWorkDayBatch(ctx.db, inputs.map(value => plain(value)), ctx.existing.map(value => value == null ? undefined : plain(value)), String(ctx.now));
 return inputs;
});

c.action('capture', async (input, ctx) => {
 const versions = await readAll<{ id: string; payroll: { timezone: string } }>(ctx, 'jurisdiction_settings', { id: { eq: input.snapshot_id }, approval_id: { isNull: true } }, undefined, { id: true, payroll: true }, 1);
 const version = versions[0];
 if (versions.length !== 1 || version?.id !== String(input.snapshot_id) || !Schema.is(Schema.NonEmptyString)(version?.payroll?.timezone)) refuse('Attendance requires its actual jurisdiction payroll timezone.');
 const observedDate = calendarDateInTimeZone(new Date(String(ctx.now)), version.payroll.timezone);
 const date = input.mode === 'KIOSK' ? observedDate : Schema.decodeUnknownSync(calendarDay)(String(input.work_date ?? ''));
 if (date > observedDate && (input.replacement == null || Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(input.replacement).replace == null || Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(input.replacement).replace).attendance === true)) refuse('Attendance imports cannot invent future attendance.');
 if (input.mode === 'KIOSK' && (input.work_date != null || input.worked_intervals != null)) refuse('Kiosk attendance uses only its actual server observation.');
 const imported = input.mode === 'ATTENDANCE_IMPORT' && input.replacement == null ? Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ start: Schema.String, end: Schema.NullOr(Schema.String) })))(input.worked_intervals, { onExcessProperty: 'error' }) : undefined;
 const profiles = await readAll<{ id: Id<'employee_profiles'>; employee_id: Id<'employees'> }>(ctx, 'employee_profiles', { id: { eq: input.profile_id }, approval_id: { isNull: true } }, undefined, { id: true, employee_id: true }, 1);
 if (profiles.length !== 1 || profiles[0]?.id !== String(input.profile_id)) refuse('Attendance requires its actual caller-readable profile.');
 const profile = profiles[0];
 if (input.mode === 'KIOSK') {
  const people = await readAll<{ id: Id<'employees'>; face_enrollment_status: string; face_last_match_at: unknown }>(ctx, 'employees', { id: { eq: profile.employee_id }, approval_id: { isNull: true } }, undefined, { id: true, face_enrollment_status: true, face_last_match_at: true }, 1);
  const person = people[0];
  if (people.length !== 1 || person?.id !== profile.employee_id) refuse('Attendance requires its actual approved employee.');
  if (input.kind === 'FACE' && person.face_enrollment_status !== 'APPROVED') refuse('Face attendance requires an approved face enrollment.');
  if (person.face_last_match_at != null) {
   const previous = String(person.face_last_match_at);
   if (!isOffsetIsoInstant(previous) || Date.parse(String(ctx.now)) - Date.parse(previous) < 10_000) refuse('Wait ten seconds between kiosk matches.');
  }
 }

 if (input.mode === 'KIOSK') {
  const days = await readAll<{ id: Id<'roster_entries'>; employment_id: string; work_date: unknown; approval_id: unknown; worked_intervals: readonly { start: string; end: string | null }[] | null }>(ctx, 'roster_entries', { employment_id: { eq: input.profile_id }, work_date: { eq: PlainDate(date) } }, undefined, { id: true, employment_id: true, work_date: true, approval_id: true, worked_intervals: true }, 1);
  if (days.length > 1 || days.some(day => day.approval_id != null)) refuse('The kiosk requires a unique approved person-day.');
  const source_basis = { snapshot_id: String(input.snapshot_id), configuration_hash: input.configuration_hash, kind: input.kind };
  if (days.length === 0) await ctx.act('roster_entries.create', { employment_id: profile.id, work_date: PlainDate(date), source_basis });
  else await ctx.act('roster_entries.update', { target: days[0]!.id, set: { source_basis } });
  await ctx.act('employees.kiosk_receipt', { id: profile.employee_id, kind: input.kind });
  return { phase: 'STAGED', completed: false, signals: [], status: (days[0]?.worked_intervals?.length ?? 0) === 0 ? 'in' : 'out', kind: input.kind, intervalIndex: Math.max(0, (days[0]?.worked_intervals?.length ?? 1) - 1), time: String(ctx.now) };
 }
 const signals: { reason: string; audible: boolean }[] = [];
 const warnings: string[] = [];
 const interval = Schema.Struct({ start: Schema.String, end: Schema.NullOr(Schema.String) });
 const halfFields = { worked_intervals: Schema.optional(Schema.NullOr(Schema.Array(interval))), shift_definition_id: Schema.optional(Schema.NullOr(Schema.String)), piece_units: Schema.optional(Schema.NullOr(Schema.Number)), piece_unit_rate: Schema.optional(Schema.NullOr(Schema.Number)), piece_overtime_units: Schema.optional(Schema.NullOr(Schema.Number)), approved_overtime_hours: Schema.optional(Schema.Number), incentive_hours: Schema.optional(Schema.Number), overtime_consented_at: Schema.optional(Schema.NullOr(Schema.String)), facts: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))) };
 const capture = Schema.Struct({ employment_id: Schema.NonEmptyString, work_date: calendarDay, ...halfFields });
 const assertSubject = (values: { employment_id: string; work_date: string }) => {
  if (values.employment_id !== String(input.profile_id) || values.work_date !== date) refuse('Configured attendance must retain its actual event profile and server work date.');
 };
 const nativeHalves = (values: Schema.Schema.Type<typeof capture>) => {
  const { worked_intervals, shift_definition_id, piece_units, piece_unit_rate, piece_overtime_units, approved_overtime_hours, incentive_hours, overtime_consented_at, facts, ...rest } = values;
  return { ...rest, work_date: PlainDate(values.work_date),
   ...(worked_intervals === undefined ? {} : { worked_intervals: worked_intervals == null ? null : worked_intervals.map(x => ({ start: Instant(x.start), end: x.end == null ? null : Instant(x.end) })) }),
   ...(shift_definition_id === undefined ? {} : { shift_definition_id }),
   ...(piece_units === undefined ? {} : { piece_units }),
   ...(piece_unit_rate === undefined ? {} : { piece_unit_rate }),
   ...(piece_overtime_units === undefined ? {} : { piece_overtime_units }),
   ...(approved_overtime_hours === undefined ? {} : { approved_overtime_hours }),
   ...(incentive_hours === undefined ? {} : { incentive_hours }),
   ...(overtime_consented_at === undefined ? {} : { overtime_consented_at: overtime_consented_at == null ? null : Instant(overtime_consented_at) }),
   ...(facts === undefined ? {} : { facts }) };
 };
 const result = await stageConfiguredBehaviourExecution(ctx, {
  event: { id: ctx.invocationId + ':' + date, kind: input.replacement == null ? input.mode : 'WORKBOOK_REPLACE', subject: { collection: 'employee_profiles', id: String(input.profile_id) }, data: { kind: input.kind, ...(imported == null ? {} : { worked_intervals: imported }), ...(input.replacement == null ? {} : Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(input.replacement)) } },
  catalog: 'WORK', snapshot_id: String(input.snapshot_id), configuration_hash: input.configuration_hash,
  day: date, observation: { observedAt: String(ctx.now), timezone: version.payroll.timezone }
 }, {
  CREATE: { target: 'roster_entries', async stage(args) {
   const values = Schema.decodeUnknownSync(capture)(args, { onExcessProperty: 'error' });
   assertSubject(values);
   const profiles = await readAll<{ id: Id<'employee_profiles'> }>(ctx, 'employee_profiles', { id: { eq: input.profile_id }, approval_id: { isNull: true } }, undefined, { id: true }, 1);
   if (profiles.length !== 1 || profiles[0]?.id !== values.employment_id) refuse('Attendance requires its actual caller-readable profile.');
   await ctx.act('roster_entries.create', { ...nativeHalves(values), employment_id: profiles[0].id });
  } },
  UPDATE: { target: 'roster_entries', async stage(args) {
   const values = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, employment_id: Schema.NonEmptyString, work_date: calendarDay, ...halfFields }))(args, { onExcessProperty: 'error' });
   assertSubject(values);
   const days = await readAll<{ id: Id<'roster_entries'>; employment_id: string; work_date: unknown }>(ctx, 'roster_entries', { id: { eq: values.id }, employment_id: { eq: input.profile_id }, work_date: { eq: PlainDate(date) }, approval_id: { isNull: true } }, undefined, { id: true, employment_id: true, work_date: true }, 1);
   if (days.length !== 1 || days[0]?.id !== values.id || days[0].employment_id !== values.employment_id || String(days[0].work_date) !== date) refuse('Attendance requires its exact approved person-day.');
   const { id: _id, ...withoutId } = values;
   const { employment_id: _profile, work_date: _date, ...set } = nativeHalves(withoutId);
   await ctx.act('roster_entries.update', { target: days[0].id, set });
  } },
  KEEP: { target: 'roster_entries', async stage(args) {
   const values = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, employment_id: Schema.NonEmptyString, work_date: calendarDay, ...halfFields }))(args, { onExcessProperty: 'error' });
   assertSubject(values);
   const days = await readAll<{ id: Id<'roster_entries'> }>(ctx, 'roster_entries', { id: { eq: values.id }, employment_id: { eq: input.profile_id }, work_date: { eq: PlainDate(date) }, approval_id: { isNull: true } }, undefined, undefined, 1);
   if (days.length !== 1 || days[0]?.id !== values.id) refuse('An unchanged restatement requires its actual approved person-day.');
   const stored: Record<string, unknown> = { ...plain(days[0]!) };
   for (const [field, value] of Object.entries(values)) if (stableJson(value) !== stableJson(stored[field])) refuse('An unchanged payroll-captured restatement must retain every original value.');
  } },
  DELETE: { target: 'roster_entries', async stage(args) {
   const values = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, employment_id: Schema.NonEmptyString, work_date: calendarDay }))(args, { onExcessProperty: 'error' });
   assertSubject(values);
   const days = await readAll<{ id: Id<'roster_entries'>; employment_id: string }>(ctx, 'roster_entries', { id: { eq: values.id }, employment_id: { eq: input.profile_id }, work_date: { eq: PlainDate(date) }, approval_id: { isNull: true } }, undefined, { id: true, employment_id: true }, 1);
   if (days.length !== 1 || days[0]?.id !== values.id || days[0].employment_id !== values.employment_id) refuse('Replacement requires its exact approved person-day.');
   await ctx.act('roster_entries.delete', { target: days[0].id });
  } },
  WARN: { target: 'workbook', async stage(args) {
   const warning = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.NonEmptyString }))(args, { onExcessProperty: 'error' });
   warnings.push(warning.message);
  } },
  SIGNAL: { target: 'kiosk', async stage(args) {
   const signal = Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.NonEmptyString, audible: Schema.Boolean }))(args, { onExcessProperty: 'error' });
   signals.push(signal);
  } }
 });
 const captured = result.execution.plan.some(step => step.operation.target === 'roster_entries');
 if (signals.length && captured) refuse('A refused shift cannot also capture attendance.');
 if (input.mode === 'ATTENDANCE_IMPORT' && (signals.length || !captured)) refuse('Every imported attendance row must be admitted; the whole import rolls back on a refused row.');
 return Schema.decodeUnknownSync(Schema.Json)({ ...result, signals, warnings });
});


c.action('import_attendance', async (input, ctx) => {
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) refuse('A workbook requires its actual calendar month.');
 if (input.rows == null && input.roster == null && input.pieces == null && input.overtime == null) refuse('A workbook requires at least one attendance, roster, pieces or overtime sheet.');
 const bounds = monthOf(PlainDate(`${input.month}-01`));
 const owners = await readAll<{ id: string; settings_code: string }>(ctx, 'entities', { id: { eq: input.entity_id }, approval_id: { isNull: true } }, undefined, { id: true, settings_code: true }, 1);
 if (owners.length !== 1 || owners[0]?.id !== String(input.entity_id)) refuse('A workbook requires its actual approved legal entity.');
 const lineage = await readAll<{ id: Id<'jurisdiction_settings'>; code: string; sealed_at: string; voided_at: unknown; effective_range: unknown; approval_id: unknown; behaviours: unknown; work_day_facts: unknown; payroll: { timezone: string } }>(ctx, 'jurisdiction_settings', { code: { eq: owners[0].settings_code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } }, undefined, { id: true, code: true, sealed_at: true, voided_at: true, effective_range: true, approval_id: true, behaviours: true, work_day_facts: true, payroll: true });
 const declared = lineage.find(version => version.id === input.snapshot_id);
 const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
 if (declared == null || await digest(declared.behaviours) !== input.configuration_hash) refuse('The workbook requires its exact declared native configuration pin.');
 const profiles = await readAll<{ id: Id<'employee_profiles'>; company_id: Id<'entities'>; employee_number: string; effective_range: unknown; approval_id: unknown }>(ctx, 'employee_profiles', { company_id: { eq: input.entity_id }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true, employee_number: true, effective_range: true, approval_id: true });
 const replace = { attendance: input.rows != null, roster: input.roster != null, pieces: input.pieces != null, overtime: input.overtime != null };
 const file = new Map<string, { profile: typeof profiles[number]; date: string; row: Record<string, Schema.Schema.Type<typeof Schema.Json>> }>();
 const owner = (number: string, date: string) => {
  if (!number.trim() || date.slice(0, 7) !== input.month) refuse('Every workbook row must name an employee and a date in the actual import month.');
  const candidates = profiles.filter(profile => profile.employee_number === number && profile.company_id === input.entity_id && profile.approval_id == null && entryDateCovered(profile.effective_range, date));
  if (candidates.length !== 1) refuse('Each employee number must resolve to exactly one approved profile active on the actual work date.');
  return candidates[0]!;
 };
 const merge = (profile: typeof profiles[number], date: string, values: Record<string, Schema.Schema.Type<typeof Schema.Json>>) => {
  const key = `${profile.id}:${date}`, previous = file.get(key);
  file.set(key, { profile, date, row: { ...previous?.row, ...values } });
 };
 for (const [kind, rows] of [['attendance', input.rows], ['roster', input.roster], ['pieces', input.pieces], ['overtime', input.overtime]] as const) {
  const seen = new Set<string>();
  for (const row of rows ?? []) {
   const date = String(row.work_date), profile = owner(row.employee_number, date), key = `${profile.id}:${date}`;
   if (seen.has(key)) refuse('Each sheet must group a person-day into one row before import.');
   seen.add(key);
   if (kind === 'attendance' && 'worked_intervals' in row) merge(profile, date, { worked_intervals: Schema.decodeUnknownSync(Schema.Json)(row.worked_intervals) });
   if (kind === 'roster' && 'shift_code' in row) merge(profile, date, { shift_code: row.shift_code.trim() });
   if (kind === 'pieces' && 'piece_units' in row) {
    const units = Schema.decodeUnknownSync(Schema.Finite)(row.piece_units), rate = Schema.decodeUnknownSync(Schema.Finite)(row.piece_unit_rate), extra = Schema.decodeUnknownSync(Schema.Finite)(row.piece_overtime_units ?? 0);
    if (units < 0 || rate < 0 || extra < 0 || extra > units) refuse('Piece work must retain nonnegative units/rate and overtime units within total units.');
    merge(profile, date, { piece_units: units, piece_unit_rate: rate, piece_overtime_units: extra });
   }
   if (kind === 'overtime' && 'overtime_hours' in row) {
    const total = Schema.decodeUnknownSync(Schema.Finite)(row.overtime_hours);
    if (total < 0 || total > 24) refuse('The stated overtime total must fall between zero and 24 hours.');
    if (row.overtime_consented_at != null && !isOffsetIsoInstant(row.overtime_consented_at)) refuse('Overtime consent requires its actual offset-bearing instant.');
    merge(profile, date, { overtime_hours: total, overtime_consented_at: row.overtime_consented_at ?? null, facts: Schema.decodeUnknownSync(Schema.Json)(row.facts ?? {}) });
   }
  }
 }
 const existing = await readAll<{ id: Id<'roster_entries'>; employment_id: Id<'employee_profiles'>; work_date: string }>(ctx, 'roster_entries', { employment_id: { in: profiles.map(profile => profile.id) }, work_date: { gte: bounds.from, lte: bounds.to } }, undefined, undefined);
 const coordinates = new Map(file);
 for (const day of existing) {
  const profile = profiles.find(profile => profile.id === day.employment_id);
  if (profile == null || !entryDateCovered(profile.effective_range, String(day.work_date))) refuse('Every replaced native day must retain its original approved active profile.');
  const key = `${profile.id}:${String(day.work_date)}`;
  if (!coordinates.has(key)) coordinates.set(key, { profile, date: String(day.work_date), row: {} });
 }
 const overwritten: string[] = [];
 const warnings: string[] = [];
 const preparedWrites: { capability: string; args: Record<string, unknown>; prior: ({ id: Id<'roster_entries'> } & Record<string, unknown>) | undefined }[] = [];
 const workbookReads = await prepareConfiguredWorkMonthReads(ctx, profiles.map(profile=>String(profile.id)), input.month);
 const allocations = new Map<string, { approved_overtime_hours: number; incentive_hours: number }>();
 if (replace.overtime) {
  for (const profile of profiles) {
   const days = [...coordinates.values()].filter(coordinate => coordinate.profile.id === profile.id);
   if (!days.length) continue;
   const allocated = await allocateNativeWorkMonth(workbookReads, { profile_id: String(profile.id), month: input.month, rows: days.map(coordinate => ({ employment_id: String(profile.id), work_date: coordinate.date, ...coordinate.row, ...(replace.roster ? { shift_code: coordinate.row.shift_code ?? null } : {}), ...(replace.attendance ? { worked_intervals: coordinate.row.worked_intervals ?? null } : {}), total_overtime_hours: coordinate.row.overtime_hours ?? 0 })), observation: { observedAt: String(ctx.now), timezone: declared.payroll.timezone } });
   for (const day of allocated) allocations.set(`${profile.id}:${day.date}`, { approved_overtime_hours: day.approved_overtime_hours, incentive_hours: day.incentive_hours });
  }
 }
 for (const [key, coordinate] of coordinates) {
  const governing = settingsInForce(lineage, owners[0].settings_code, coordinate.date);
  if (governing == null) refuse('Every replaced day must retain its actual sealed jurisdiction in force on that date.');
  if (replace.attendance && coordinate.row.worked_intervals != null && coordinate.date > calendarDateInTimeZone(new Date(String(ctx.now)), governing.payroll.timezone)) refuse('Attendance imports cannot invent future attendance.');
  const factFields = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ key: Schema.NonEmptyString, import: Schema.optional(Schema.Boolean) })))(governing.work_day_facts);
  const import_keys = factFields.filter(field => field.import === true).map(field => field.key);
  const configuration_hash = await digest(governing.behaviours);
  const row = {
   ...(replace.roster ? { shift_code: coordinate.row.shift_code ?? null } : {}),
   ...(replace.attendance ? { worked_intervals: coordinate.row.worked_intervals ?? null } : {}),
   ...(replace.pieces ? { piece_units: coordinate.row.piece_units ?? null, piece_unit_rate: coordinate.row.piece_unit_rate ?? null, piece_overtime_units: coordinate.row.piece_overtime_units ?? null } : {}),
   ...(replace.overtime ? { overtime_hours: coordinate.row.overtime_hours ?? 0, overtime_consented_at: coordinate.row.overtime_consented_at ?? null, facts: coordinate.row.facts ?? {} } : {})
  };
  if (replace.overtime && !allocations.has(key)) refuse('Every imported overtime coordinate requires its actual full-month configured allocation.');
  const prepared = await prepareConfiguredBehaviourExecution(workbookReads, {
   event: { id: ctx.invocationId + ':' + coordinate.date, kind: 'WORKBOOK_REPLACE', subject: { collection: 'employee_profiles', id: String(coordinate.profile.id) }, data: { kind: 'MANUAL', replace, row, file_present: file.has(key), import_keys, ...(replace.overtime && allocations.get(key)!=null ? { allocation: allocations.get(key)! } : {}) } },
   catalog: 'WORK', snapshot_id: String(governing.id), configuration_hash, day: coordinate.date,
   observation: { observedAt: String(ctx.now), timezone: governing.payroll.timezone }
  }, { CREATE: 'roster_entries', UPDATE: 'roster_entries', KEEP: 'roster_entries', DELETE: 'roster_entries', SIGNAL: 'kiosk', WARN: 'workbook' });
  for (const step of prepared.execution.plan) {
   const args = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(step.args);
   if (step.operation.capability === 'SIGNAL') refuse('Every workbook row must be admitted; ' + String(args.reason));
   if (step.operation.capability === 'WARN') { warnings.push(Schema.decodeUnknownSync(Schema.NonEmptyString)(args.message)); continue; }
   if (step.operation.target !== 'roster_entries' || args.employment_id !== coordinate.profile.id || args.work_date !== coordinate.date) refuse('Workbook rules must retain the exact actual native person-day.');
   const prior = existing.find(day => day.employment_id === coordinate.profile.id && String(day.work_date) === coordinate.date);
   const before = prior == null ? undefined : { ...plain(prior), id: prior.id } as { id: Id<'roster_entries'> } & Record<string, unknown>;
   if (step.operation.capability !== 'CREATE' && (before == null || args.id !== before.id)) refuse('Workbook replacement requires its exact original native row.');
   if (step.operation.capability === 'KEEP') {
    for (const [field, value] of Object.entries(args)) if (stableJson(value) !== stableJson(before?.[field])) refuse('An unchanged workbook row must retain every original native value.');
   } else preparedWrites.push({ capability: step.operation.capability, args, prior: before });
  }
  if (preparedWrites.some(write => write.prior != null && `${write.prior.employment_id}:${String(write.prior.work_date)}` === key)) overwritten.push(`${coordinate.profile.employee_number} on ${coordinate.date}`);
 }
 // Admit the complete overlay before staging any mutation, including omitted month coordinates.
 warnings.push(...await admitConfiguredWorkDayBatch(workbookReads, preparedWrites.map(write => write.capability === 'DELETE' ? { ...write.args, $delete: true } : write.args), preparedWrites.map(write => write.prior), String(ctx.now)));
 const native = (args: Record<string, unknown>) => {
  const { id: _id, ...row } = args;
  return { ...row, work_date: PlainDate(String(row.work_date)), ...(Object.hasOwn(row, 'worked_intervals') ? { worked_intervals: row.worked_intervals == null ? null : Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ start: Schema.String, end: Schema.NullOr(Schema.String) })))(row.worked_intervals).map(interval => ({ start: Instant(interval.start), end: interval.end == null ? null : Instant(interval.end) })) } : {}), ...(Object.hasOwn(row, 'overtime_consented_at') ? { overtime_consented_at: row.overtime_consented_at == null ? null : Instant(String(row.overtime_consented_at)) } : {}) };
 };
 const replacements = preparedWrites.filter(write => write.capability === 'CREATE' || write.capability === 'UPDATE');
 if (replacements.length) await ctx.act('roster_entries.upsert', replacements.map(write => {
  const values = native(write.args);
  if (write.capability === 'CREATE') return { ...values, employment_id: Schema.decodeUnknownSync(Schema.NonEmptyString)(write.args.employment_id) as Id<'employee_profiles'> } as Insert<'roster_entries'>;
  const patch = Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'employment_id' && key !== 'work_date' && key !== 'id'));
  return { id: write.prior!.id, ...patch } as { id: Id<'roster_entries'> } & Patch<'roster_entries'>;
 }), { onConflict: 'update' });
 const deletes = preparedWrites.filter(write => write.capability === 'DELETE');
 if (deletes.length) await ctx.act('roster_entries.delete', { target: deletes.map(write => write.prior!.id) });
 if (replace.roster) {
  const saved = await readAll<{ id: Id<'rosters'>; employment_id: Id<'employee_profiles'> }>(ctx, 'rosters', { employment_id: { in: profiles.map(profile => profile.id) }, period: { eq: input.month } }, undefined, { id: true, employment_id: true });
  const wanted = new Set((input.roster ?? []).map(row => owner(row.employee_number, String(row.work_date)).id));
  const creates = [...wanted].filter(id => !saved.some(row => row.employment_id === id));
  if (creates.length) await ctx.act('rosters.create', creates.map(employment_id => ({ employment_id, period: input.month })));
  const omitted = saved.filter(row => !wanted.has(row.employment_id)).map(row => row.id);
  if (omitted.length) await ctx.act('rosters.delete', { target: omitted });
 }
 return { phase: 'STAGED', completed: false, rows: coordinates.size, overwritten: overwritten.toSorted(), warnings };
});


c.query('kiosk_configuration', async (input, ctx) => {
 const entities = await readAll<{ id: string; settings_code: string }>(ctx, 'entities', { id: { eq: input.entity_id }, approval_id: { isNull: true } }, undefined, { id: true, settings_code: true }, 1);
 const entity = entities[0];
 if (entities.length !== 1 || entity?.id !== String(input.entity_id)) refuse('The kiosk requires its actual approved entity.');
 const versions = await readAll<{ id: Id<'jurisdiction_settings'>; code: string; sealed_at: string; voided_at: unknown; effective_range: unknown; approval_id: unknown; payroll: { timezone: string }; behaviours: unknown }>(ctx, 'jurisdiction_settings', { code: { eq: entity.settings_code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } }, undefined, { id: true, code: true, sealed_at: true, voided_at: true, effective_range: true, approval_id: true, payroll: true, behaviours: true });
 const candidates = versions.filter(version => {
  const zone = version.payroll?.timezone;
  if (!zone) return false;
  const date = calendarDateInTimeZone(new Date(String(ctx.now)), zone);
  return settingsInForce(versions, entity.settings_code, date)?.id === version.id;
 });
 if (candidates.length !== 1) refuse('The kiosk requires exactly one governing server-local attendance configuration.');
 const version = candidates[0]!;
 const configuration_hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(version.behaviours)))), byte => byte.toString(16).padStart(2, '0')).join('');
 return { snapshot_id: version.id, configuration_hash, timezone: version.payroll.timezone, observed_day: calendarDateInTimeZone(new Date(String(ctx.now)),version.payroll.timezone) };
});

c.query('attendance_month', async (input, ctx) => Schema.decodeUnknownSync(Schema.Json)(await captureAttendanceMonth(ctx, { profile_id: String(input.profile_id), month: input.month, observed_at: String(ctx.now) })));

c.query('attendance_overtime_headroom', async (input, ctx) => {
 const date = Schema.decodeUnknownSync(calendarDay)(String(input.work_date));
 const profiles = await readAll<{ id: string; company_id: string }>(ctx, 'employee_profiles', { id: { eq: input.profile_id }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true }, 1);
 if (profiles.length !== 1) refuse('Overtime preview requires its actual approved profile.');
 const companies = await readAll<{ id: string; settings_code: string }>(ctx, 'entities', { id: { eq: profiles[0]!.company_id }, approval_id: { isNull: true } }, undefined, { id: true, settings_code: true }, 1);
 if (companies.length !== 1) refuse('Overtime preview requires its actual approved employer.');
 const versions = await readAll<{ id: string; code: string; effective_range: unknown; payroll: { timezone: string } }>(ctx, 'jurisdiction_settings', { code: { eq: companies[0]!.settings_code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } }, undefined, { id: true, code: true, effective_range: true, payroll: true, sealed_at: true, approval_id: true, voided_at: true });
 const version = settingsInForce(versions, companies[0]!.settings_code, date);
 if (!version) refuse('Overtime preview requires its actual dated sealed jurisdiction.');
 const allocation = await allocateNativeWorkMonth(ctx, { profile_id: String(input.profile_id), month: date.slice(0, 7), rows: [{ employment_id: String(input.profile_id), work_date: date, ...(input.shift_code == null ? {} : { shift_code: input.shift_code }), total_overtime_hours: 0 }], headroom_date: date, observation: { observedAt: String(ctx.now), timezone: version.payroll.timezone } });
 if (allocation.length !== 1 || allocation[0]?.date !== date) refuse('Overtime preview requires its exact configured person-day allocation.');
 return Schema.decodeUnknownSync(Schema.Json)({ date, hours: allocation[0].headroom?.hours ?? null, limit: allocation[0].headroom?.limit ?? null, rule_set_sources: allocation[0].rule_set_sources });
});

c.query('attendance_template_configuration', async (input, ctx) => {
 if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month)) refuse('The template requires an actual calendar month.');
 const employers = await readAll<{ id: string; settings_code: string }>(ctx, 'entities', { id: { eq: input.entity_id }, approval_id: { isNull: true } }, undefined, { id: true, settings_code: true }, 1);
 if (employers.length !== 1) refuse('The template requires its actual approved employer.');
 const versions = await readAll<{ id: string; code: string; effective_range: unknown; payroll: { timezone: string }; work_day_facts: unknown }>(ctx, 'jurisdiction_settings', { code: { eq: employers[0]!.settings_code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } }, undefined, { id: true, code: true, effective_range: true, payroll: true, work_day_facts: true, sealed_at: true, approval_id: true, voided_at: true });
 const end = new Date(input.month + '-01T00:00:00Z'); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
 const selected = new Map<string, typeof versions[number]>();
 for (let at = 1; at <= end.getUTCDate(); at++) { const version = settingsInForce(versions, employers[0]!.settings_code, input.month + '-' + String(at).padStart(2, '0')); if (!version) refuse('Every template day requires its actual governing jurisdiction.'); selected.set(version.id, version); }
 const zones = new Set([...selected.values()].map(version => version.payroll.timezone));
 if (zones.size !== 1) refuse('A workbook cannot mix governing timezones.');
 const timezone = [...zones][0]!; let overtimeConsent = false; const factColumns = new Set<string>(); const rule_set_sources = [];
 for (const version of selected.values()) {
  const rule = await readQualifiedRuleData(ctx, { settings_id: version.id, family: 'WORK', code: 'WORK', observation: { observedAt: String(ctx.now), timezone } });
  rule_set_sources.push(rule.source);
  overtimeConsent ||= Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(rule.data).overtime_consent != null;
  const fields = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ key: Schema.NonEmptyString, import: Schema.optional(Schema.Boolean) })))(version.work_day_facts);
  for (const field of fields) if (field.import === true) factColumns.add(field.key);
 }
 return Schema.decodeUnknownSync(Schema.Json)({ timezone, overtimeConsent, factColumns: [...factColumns], rule_set_sources });
});
