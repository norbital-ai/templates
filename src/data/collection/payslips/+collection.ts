import {captureNativeMinimumWageIssues} from '../../../lib/minimum-wage-issues.js';
import {assertNativeSourcePins} from '../../../lib/payroll_engine/foundation/misc.js';
import {nativeSourceAdmitted} from '../../../lib/payroll_engine/admission/prospective-reads.js';
import {prepareNativePayrollDeletion} from '../../../lib/payroll_engine/payslips/payment.js';
import {policyAdmissionFault} from '../../../lib/payroll_engine/catalogues/admission.js';
import {projectNativeCapturedFamilies} from '../../../lib/payroll_engine/admission/input-access.js';
import {resolveInputSchema} from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import {prepareNativePayslipPayment} from '../../../lib/payroll_engine/payslips/payment.js';
import { captureNativePayrollStages } from '../../../lib/payroll_engine/payslips/stages.js';
import { collection } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { admitEntryValues, type EntrySchemaSnapshot } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import { produceNativeSettlementCapture } from '../../../lib/payroll_engine/payslips/settlement-capture.js';
import { priceNativePayrollSources } from '../../../lib/payroll_engine/catalogues/entries.js';
import { priceNativeStatutory } from '../../../lib/payroll_engine/payslips/statutory.js';
import { prepareConfiguredBehaviourExecution } from '../../../lib/payroll_engine/execution/behaviours.js';
import { readAll, memoizedReads } from '../../../lib/payroll_engine/foundation/reads.js';
import { plain, decodeNumber } from '../../../lib/payroll_engine/foundation/primitives.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import model from '../../model/payslips/+model.ts';
import * as Predicate from 'effect/Predicate';

/** Calculated figures enter only through the immutable jurisdiction operation, never a submitted amount. */
const c = collection('payslips', {
 read: { fields: 'all', projection:{fields:['work_capture'],context:['work_capture']} },
 create: { input: { columns: ['source_basis'] } },
 update: { input: { columns: ['status', 'source_basis'] } },
 delete:{transform:true},
 actions:{delete_saved:{target:"record",description:"Delete an unpaid saved payslip and release its actual sources atomically.",input:{},output:{kind:"json"}}}
});
export default c;
c.action("delete_saved",async(_input,ctx)=>{
 const slip=plain(ctx.target);
 const run=await ctx.get('payroll_runs',String(slip.payroll_run_id) as never,{select:{company_id:true}});
 if(run==null)refuse('Delete requires its actual native payroll run.');
 await ctx.act("entities.update",{target:run.company_id,set:{source_basis:{operation:"DELETE_PAYROLL",run_ids:[],slip_ids:[ctx.target.id]}}});
 return {deleted:true,slip_id:ctx.target.id};
});

const requestSchema = Schema.Struct({
 run_id: Schema.NonEmptyString, profile_id: Schema.NonEmptyString
});

/** The same source-qualified producer serves direct writes and atomic native parent settlement. */
export const prepareNativePayslipWrites:Parameters<typeof c.transform>[0]=async (inputs, ctx) => {
 if(inputs.some(input=>'$delete' in input)){
  if(!inputs.every(input=>'$delete' in input)||ctx.existing.some(row=>row==null))refuse('Deletion cannot mix saved payroll releases and financial mutations.');
  const captured=await prepareNativePayrollDeletion(ctx.db,{run_ids:[],slip_ids:ctx.existing.map(row=>String(plain(row!).id)),observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
  if(captured.partitions.some(partition=>Array.isArray(partition.remove_ids)&&partition.remove_ids.length))refuse('Use delete_saved to release the actual unpaid financial ledger and source pins atomically.');
  return inputs;
 }
 const writes=inputs.map(input=>'$delete' in input?undefined:input).filter((input): input is NonNullable<typeof input>=>input!==undefined);

 const reads = memoizedReads(ctx.db);
 const payments=new Map<number,Record<string,unknown>>();
 for(const [index,input] of writes.entries()){
  const basis=input.source_basis;
  if(Schema.is(Schema.Record(Schema.String,Schema.Json))(basis)&&basis.operation==='PAYMENT'){
   const existing=ctx.existing[index];if(existing==null)refuse('Payment completion requires its actual saved payslip.');
   if(input.status!=null)refuse('Payment status is derived from actual original receipt allocations.');
   const request=Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literal('PAYMENT'),payment_event_id:Schema.NonEmptyString}))(basis,{onExcessProperty:'error'});
   payments.set(index,await prepareNativePayslipPayment(reads,{payslip_id:String(plain(existing).id),payment_event_id:request.payment_event_id,observedAt:String(ctx.now)}));
  }
 }
 const requests = writes.map((input, index) => {
  if(payments.has(index))return null;
  const existing = ctx.existing[index];
  if (existing != null) {
   const row = plain(existing);
   if (row.status === 'PAID' || row.approval_id != null) refuse('An approved paid settlement is immutable; correct it in a later run.');
   if (input.source_basis != null) {
    const request = Schema.decodeUnknownSync(requestSchema)(input.source_basis, { onExcessProperty: 'error' });
    if (request.run_id !== row.payroll_run_id || request.profile_id !== row.employment_id) refuse('Recalculation retains the original run, profile and payslip identity.');
    return request;
   }
   if (input.status !== 'DRAFT' && input.status !== 'ON_HOLD') refuse('Cash settlement requires its configured payment sources and frozen payment allocation.');
   return null;
  }
  return Schema.decodeUnknownSync(requestSchema)(input.source_basis, { onExcessProperty: 'error' });
 });
 const runIds = [...new Set(requests.flatMap(value => value == null ? [] : [value.run_id]))];
 const runs = await readAll<{ id: string; revision:number;company_id: string; settings_id: string; configuration_hash: string; attendance_from: string; attendance_to: string; salary_from: string; salary_to: string; approval_id: unknown;[key:string]:unknown }>(reads, 'payroll_runs', { id: { in: runIds }, approval_id: { isNull: true } });
 const profiles = await readAll<{ id: string; company_id: string; effective_range: { from: string; to: string | null }; approval_id: unknown }>(reads, 'employee_profiles', { id: { in: [...new Set(requests.flatMap(value => value == null ? [] : [value.profile_id]))] }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true, effective_range: true, approval_id: true });
 const versions = await readAll<{ id: string; payroll: { timezone: string } }>(reads, 'jurisdiction_settings', { id: { in: [...new Set(runs.map(run => run.settings_id))] }, approval_id: { isNull: true } }, undefined, { id: true, payroll: true });
 const results = [];
 for (let index = 0; index < writes.length; index++) {
  const request = requests[index];
  if (request == null) { results.push(payments.has(index)?{...writes[index],...payments.get(index)}:writes[index]); continue; }
  const run = runs.find(row => row.id === request.run_id);
  const profile = profiles.find(row => row.id === request.profile_id);
  const version = versions.find(row => row.id === run?.settings_id);
  if (run == null || profile == null || profile.company_id !== run.company_id || profile.approval_id != null || version == null || !nativeSourceAdmitted(reads,'payroll_runs',run) || !Schema.is(Schema.NonEmptyString)(version.payroll?.timezone)) refuse('A calculated payslip requires its actual approved saved run or engine-prepared source and jurisdiction.');
  const observation = { observedAt: String(ctx.now), timezone: version.payroll.timezone };
  const existing = ctx.existing[index] == null ? undefined : plain(ctx.existing[index]);
  const rerun = existing == null ? {} : { rerun_slip_id: String(existing.id) };
  const nativeSources=await priceNativePayrollSources(reads,{profile_id:profile.id,run_id:run.id,observation,...rerun});
  const {work,allowance}=nativeSources.static;
  const entries=nativeSources.entries;
  const stat = await priceNativeStatutory(reads, { profile_id: profile.id, run_id: run.id, observation, static: { work, allowance }, entries, ...rerun });
  const minimumWage=await captureNativeMinimumWageIssues(reads,{profile_id:profile.id,work,entries,statutory:stat,observation});
  const assessed = Schema.decodeUnknownSync(Schema.Struct({ static: Schema.Struct({ work: Schema.Json, allowance: Schema.Json }), entries: Schema.Json }))('assessed_sources' in stat ? stat.assessed_sources : { static: { work, allowance }, entries });
  const capture = await produceNativeSettlementCapture(reads, { run_id: run.id, profile_id: profile.id, observation, work: assessed.static.work, allowance: assessed.static.allowance, ...(existing == null ? {} : { existing }) });
  const finalEntries = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(assessed.entries);
  if (finalEntries.monthly_charge_allocation != null) capture.additional_fields.monthlyChargeAllocation = finalEntries.monthly_charge_allocation;
  if (finalEntries.leave_settlements != null) capture.additional_fields.leave_settlements = finalEntries.leave_settlements;
  const finalWork = Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(assessed.static.work);
  const {original_assessments:_diagnostic,...statCapture}=stat;
  const data = Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))({ static: assessed.static, entries: assessed.entries, stat:statCapture, capture, profile_settlement: finalWork.profile_settlement, minimum_wage_issues:minimumWage.issues });
  const prepared = await prepareConfiguredBehaviourExecution(reads, {
   event: { id: `${run.id}:${request.profile_id}`, data, kind: 'PAYROLL', subject: { collection: 'employee_profiles', id: request.profile_id } },
   catalog: 'WORK', snapshot_id: run.settings_id, configuration_hash: run.configuration_hash,
   day: run.salary_to, observation,
   run_id: run.id
  }, { CREATE_PAYSLIP: 'payslips' });
  const operations = prepared.execution.plan.filter(row => row.operation.capability === 'CREATE_PAYSLIP');
  if (operations.length !== 1) refuse('Payroll requires exactly one complete configured settlement for its selected original profile.');
  const step = operations[0]!;
  if (step == null || step.args.payroll_run_id !== run.id || step.args.employment_id !== request.profile_id) refuse('A calculated payslip must retain its configured operation and actual run/profile identity.');
  const baseValues=step.args.base;
  const baseCore=Array.isArray(baseValues)?baseValues.map(value=>Predicate.isObject(value)?{component_code:value.component_code,amount:value.amount}:value):baseValues;
  const baseFault=policyAdmissionFault('payslip_base',baseCore);if(baseFault!=null)refuse(baseFault);
  const prorationFault=policyAdmissionFault('payslip_proration',step.args.proration);if(prorationFault!=null)refuse(prorationFault);
  const nativeStages=await captureNativePayrollStages(reads,{profile_id:profile.id,work:assessed.static.work,entries:assessed.entries,payslip:step.args,observation});
  const allowed = new Set([...Object.keys(model.fields), 'payroll_run_id', 'employment_id', 'source_ids', 'attendance_ids']);
  if (Object.keys(step.args).some(key => !allowed.has(key) || ['source_basis', 'status', 'paid_at', 'settled_by_payment_event_id'].includes(key))) refuse('Configured payroll cannot replace provenance or assert payment.');
  const sourceIds = Schema.decodeUnknownSync(Schema.Array(Schema.NonEmptyString))(step.args.source_ids);
  const attendanceIds = Schema.decodeUnknownSync(Schema.Array(Schema.NonEmptyString))(step.args.attendance_ids);
  assertNativeSourcePins(sourceIds,attendanceIds);
  const settledLines = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Json)))(step.args.adjustments);
  const requiredPins = entries.sources.filter(source => source.catalog !== 'LOAN' || settledLines.some(line => line.family === 'LOAN_REPAYMENT' && line.source_id === source.id)).map(source => source.id);
  const takenOrders = entries.orders.filter(order => settledLines.some(line => line.family === 'LOAN_REPAYMENT' && line.source_id === order.source_id && Predicate.isNumber(line.amount) && line.amount > 0));
  assertNativeSourcePins(sourceIds,attendanceIds,takenOrders.map(order=>order.source_id));
  const approvedIds = [...requiredPins, ...takenOrders.map(order => String(order.source_id))];
  if (sourceIds.length !== approvedIds.length || sourceIds.some(id => !approvedIds.includes(id))) refuse('Payroll must retain every successful consumed entry and release only whole unpaid loan shortfalls.');
  const [entryRows, attendanceRows] = await Promise.all([
   readAll<{ id: string; revision: number; employment_id: string; company_id: string; payslip_id: string | null; approval_id: unknown }>(reads, 'catalogue_entries', { employment_id: { eq: profile.id }, company_id: { eq: run.company_id } }, undefined, { id: true, revision: true, employment_id: true, company_id: true, payslip_id: true, approval_id: true }),
   readAll<{ id: string; revision: number; employment_id: string; work_date: string; payslip_id: string | null; approval_id: unknown }>(reads, 'roster_entries', { employment_id: { eq: profile.id }, work_date: { gte: run.attendance_from, lte: run.attendance_to } }, undefined, { id: true, revision: true, employment_id: true, work_date: true, payslip_id: true, approval_id: true })
  ]);
  for (const id of approvedIds) {
   const source = entryRows.find(row => row.id === id), capture = entries.sources.find(row => row.id === id) ?? takenOrders.map(order => Schema.decodeUnknownSync(Schema.Struct({id:Schema.NonEmptyString,revision:Schema.Number,catalogue_id:Schema.NonEmptyString}))(order.source)).find(row => row.id === id);
   if (source == null || capture == null || source.revision !== capture.revision || source.approval_id != null || (source.payslip_id != null && source.payslip_id !== existing?.id)) refuse('A payroll entry pin requires its exact approved unchanged source and original unpaid owner.');
  }
  for (const id of attendanceIds) {
   const source = attendanceRows.find(row => row.id === id);
   if (source == null || source.approval_id != null || (source.payslip_id != null && source.payslip_id !== existing?.id)) refuse('An attendance pin requires its exact approved original day and unpaid settlement owner.');
  }
  const {orderCreates,orderUpdates,obsoleteOrders,orderKeys}=await prepareNativeOrderReceipts({entries,takenOrders,settledLines,run,profile,prepared,...(existing==null?{}:{existing})});
  const workCapture = Schema.decodeUnknownSync(Schema.Struct({ complete: Schema.Literal(true), payable_tranches: Schema.Array(Schema.Json), payment_allocations: Schema.Array(Schema.Json), compliance_sources: Schema.Array(Schema.Json), weekly_work: Schema.optionalKey(Schema.Array(Schema.Json)), payment_events: Schema.optionalKey(Schema.Array(Schema.Json)) }))(step.args.work_capture, { onExcessProperty: 'error' });
  if (!workCapture.complete) refuse('Payroll requires its full configured original work and funding capture.');
  const { source_ids: _sources, attendance_ids: _attendance, ...fields } = step.args;
  for (const field of ['terms_through', 'salary_from', 'salary_to'] as const) if (fields[field] != null) Object.assign(fields,{[field]:PlainDate(Schema.decodeUnknownSync(Schema.String)(fields[field]))});
  results.push({ ...fields, status: existing?.status ?? 'DRAFT',
   catalogue_entries: { ...(orderCreates.length ? { create: orderCreates } : {}), ...(orderUpdates.length ? { update: orderUpdates } : {}), ...(obsoleteOrders.length ? { delete: obsoleteOrders.map(row => row.id) } : {}), link: [...requiredPins, ...orderUpdates.map(row => row.target)], unlink: entryRows.filter(row => row.payslip_id === existing?.id && !requiredPins.includes(row.id) && !obsoleteOrders.some(receipt => receipt.id === row.id) && !entries.history.some(receipt => receipt.id === row.id && Predicate.isString(receipt.effect_key) && orderKeys.has(receipt.effect_key))).map(row => row.id) },
   roster_entries: { link: attendanceIds, unlink: attendanceRows.filter(row => row.payslip_id === existing?.id && !attendanceIds.includes(row.id)).map(row => row.id) },
   source_basis: { request, key: prepared.key, hash: prepared.hash, execution: prepared.execution, native_stages:nativeStages,minimum_wage:minimumWage } });
 }
 return results as never;
};
c.transform(prepareNativePayslipWrites);


c.project(async(row,ctx)=>{
 if(!ctx.fields.includes('work_capture')||row.work_capture==null)return {};
 const capture=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(row.work_capture);
 const run=await ctx.get('payroll_runs',String(row.payroll_run_id) as never,{select:{company_id:true}});
 if(run==null)refuse('Financial capture reads retain their actual native legal employer.');
 const entity=await ctx.get('entities',String(run.company_id) as never,{select:{id:true,settings_code:true,input_schema_snapshot:true,approval_id:true}});
 if(entity==null||entity.id!==run.company_id)refuse('Financial capture reads retain their actual native legal employer.');
 const accepted=await resolveInputSchema(ctx,{field:'entity_input_schema',code:entity.settings_code,originalPin:entity.input_schema_snapshot});
 const families=Object.fromEntries(['payable_tranches','payment_allocations','payment_events'].filter(key=>capture[key]!=null).map(key=>[key,capture[key]]));
 return {work_capture:{...capture,...await projectNativeCapturedFamilies(accepted.schema,families,ctx)}};
});

/** Stage genuine order repayment receipts; the transform qualifies owners and source revisions first. */
export async function prepareNativeOrderReceipts(options:{
 entries:Awaited<ReturnType<typeof priceNativePayrollSources>>['entries'];
 takenOrders:Awaited<ReturnType<typeof priceNativePayrollSources>>['entries']['orders'];
 settledLines:readonly Record<string,unknown>[];
 run:{id:string;company_id:string;salary_to:string};profile:{id:string};
 prepared:{hash:string;key:string};existing?:{id:string}|null;
}) {
 const {entries,takenOrders,settledLines,run,profile,prepared,existing}=options;
  const orderCreates: Record<string, unknown>[] = [], orderUpdates: { target: string; set: Record<string, unknown> }[] = [];
  const orderKeys = new Set<string>();
  for (const order of takenOrders) {
   const source = Schema.decodeUnknownSync(Schema.Struct({id:Schema.NonEmptyString,revision:Schema.Number,catalogue_id:Schema.NonEmptyString}))(order.source);
   const lines = settledLines.filter(line => line.family === 'LOAN_REPAYMENT' && line.source_id === source.id);
   if (lines.length !== 1 || lines[0]!.bucket !== 'DEDUCTION' || !Predicate.isNumber(lines[0]!.amount) || lines[0]!.amount <= 0 || lines[0]!.amount > decodeNumber(order.balance)) refuse('An order repayment requires its exact positive configured withholding within remaining principal.');
   const catalogue = Schema.decodeUnknownSync(Schema.Struct({settings_id:Schema.NonEmptyString,entry_schema:Schema.Unknown}))(order.catalogue);
   const key = `${run.id}:${profile.id}:loan-order:${source.id}`;
   orderKeys.add(key);
   const keyedReceipts = entries.history.filter(row => row.effect_key === key);
   const reusable = entries.history.find(row => row.catalog === 'LOAN' && row.approval_id == null && row.payslip_id == null && Schema.is(Schema.Record(Schema.String,Schema.Json))(row.values) && row.values.loan_id === source.id && row.values.due_date === run.salary_to && row.values.amount_due === lines[0]!.amount);
   const receipts = keyedReceipts.length ? keyedReceipts : reusable == null ? [] : [reusable];
   if (receipts.length > 1 || receipts.some(row => row.payslip_id != null && row.payslip_id !== existing?.id || row.approval_id != null)) refuse('An original generated order receipt retains its unique unpaid settlement owner.');
   const repayments = entries.history.filter(row => row.catalog === 'LOAN' && Schema.is(Schema.Record(Schema.String,Schema.Json))(row.values) && row.values.loan_id === source.id);
   const sequence = receipts[0] == null ? Math.max(0, ...repayments.map(row => decodeNumber(Schema.is(Schema.Record(Schema.String,Schema.Json))(row.values)?row.values.sequence:undefined))) + 1 : decodeNumber(Schema.is(Schema.Record(Schema.String,Schema.Json))(receipts[0].values)?receipts[0].values.sequence:undefined);
   if (!Number.isSafeInteger(sequence) || sequence < 1) refuse('An order repayment requires the actual original integer receipt sequence.');
   const values = { ...(receipts[0] == null ? {} : Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(receipts[0].values)), source_kind: 'loan_repayments', employment_id: profile.id, loan_id: source.id, due_date: String(run.salary_to), amount_due: lines[0]!.amount, sequence };
   const schema_snapshot = await admitEntryValues({ catalog: 'LOAN', catalogue_id: source.catalogue_id, settings_id: catalogue.settings_id, schema: catalogue.entry_schema as EntrySchemaSnapshot['schema'], values, ...(receipts[0] == null ? {} : { original: receipts[0].schema_snapshot }) });
   const payload = { company_id: run.company_id, employment_id: profile.id, catalog: 'LOAN', catalogue_id: source.catalogue_id, reference: source.id, occurred_on: PlainDate(String(run.salary_to)), values, schema_snapshot, source_kind: 'loan_repayments', effect_key: key, effect_hash: prepared.hash, source_basis: { run_id: run.id, profile_id: profile.id, agreement_id: source.id, agreement_revision: source.revision, key: prepared.key, hash: prepared.hash } };
   if (receipts[0] == null) orderCreates.push(payload); else orderUpdates.push({ target: receipts[0].id, set: payload });
  }
  const obsoleteOrders = entries.history.filter(row => {
   const values=row.values;
   return row.payslip_id === existing?.id && Predicate.isString(row.effect_key) && row.effect_key.startsWith(`${run.id}:${profile.id}:loan-order:`) && !orderKeys.has(row.effect_key)
   || row.catalog === 'LOAN' && row.payslip_id == null && Schema.is(Schema.Record(Schema.String,Schema.Json))(values)
    && values.source_kind === 'loan_repayments'
    && values.due_date === run.salary_to
    && takenOrders.some(order => order.source_id === values.loan_id)
    && !orderUpdates.some(update => update.target === row.id); });
  if (obsoleteOrders.some(row => row.approval_id != null)) refuse('A held original order receipt cannot be replaced.');
 return {orderCreates,orderUpdates,obsoleteOrders,orderKeys};
}
