import {admitNativeScheduledEffect,captureNativeScheduledFulfillments} from '../../../lib/configured-scheduled-occurrences.js';
import {prepareNativeDutyTransition} from '../../../lib/obligation-transition.js';
import {captureNativeCalendarObligations,admitNativeCalendarDutyEffect,calendarDutyPayload} from '../../../lib/payroll_engine/catalogues/obligations.js';
import {readQualifiedRuleData} from '../../../lib/payroll_engine/execution/rule-sets.js';
import { prepareNativeCatalogSourceEvent, type CatalogEffectSource, admitConfiguredCatalogEffect } from '../../../lib/payroll_engine/execution/behaviours.js';
import { collection, type FileRef, type Id } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { plain, stableJson } from '../../../lib/payroll_engine/foundation/primitives.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { calendarDay, isOffsetIsoInstant } from '../../../lib/payroll_engine/foundation/time.js';
import { entryDateCovered } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import { produceConfiguredObligationDocument, produceConfiguredObligationReceipt } from '../../../lib/payroll_engine/catalogues/obligations.js';
import { configuredDutyPayload } from '../../../automation/utils/duty-payload.js';
import * as Predicate from 'effect/Predicate';

const c = collection('obligations', {
 read: { fields: 'all' },
 create: { input: { columns: ['source_basis', 'company_id', 'settings_id', 'duty_code', 'subject_kind', 'subject_id', 'trigger_ref', 'triggered_on', 'due_on', 'amount_due', 'recipient_id', 'facts', 'retain_until'] } },
 update: { input: { columns: ['document_capture','amount_settled','state','fulfilled_on','waive_reason','reference','evidence_file','facts','input_proofs','input_files'] } },
 actions: { raise_calendar: {description:'Raise the actual admitted employer or worker occurrence using its original declared dates and obligations.',input:{entity_id:{kind:'id',of:'entities'},date:{kind:'date'},every:{kind:'enum',values:['MONTH','QUARTER','YEAR']},profile_id:{kind:'id',of:'employee_profiles',optional:true}},output:{kind:'json'}}, record_document_receipt: { target: 'record', description: 'Apply an accepted signed receipt to its immutable configured original document.', input: { request_id: { kind: 'text' } }, output: { kind: 'json' } }, prepare_document: { target: 'record', description: 'Prepare the configured original certificate from accepted private documentary sources.', input: { request_id: { kind: 'text' } }, output: { kind: 'json' } } }
});
export default c;
c.action('raise_calendar',async(input,ctx)=>{
 const captured=await captureNativeCalendarObligations(ctx,{entity_id:String(input.entity_id),date:String(input.date),every:input.every,...(input.profile_id==null?{}:{profile_id:String(input.profile_id)}),observation:{observedAt:String(ctx.now),timezone:String(ctx.tz)}});
 if(captured.obligations.length)await ctx.act('obligations.create',captured.obligations.map(calendarDutyPayload).map(payload=>configuredDutyPayload(input.entity_id,Schema.decodeUnknownSync(Schema.NonEmptyString)(payload.settings_id) as Id<'jurisdiction_settings'>,payload)));
 return Schema.decodeUnknownSync(Schema.Json)({raised:captured.obligations.length,source:captured.source});
});
c.action('prepare_document', async (input, ctx) => {
 const request_id = Schema.decodeUnknownSync(Schema.NonEmptyString)(input.request_id);
 await ctx.act('obligations.update',{target:ctx.target.id,set:{document_capture:{operation:'PREPARE',request_id}}});
 return Schema.decodeUnknownSync(Schema.Json)({prepared:true,obligation_id:ctx.target.id});
});

c.action('record_document_receipt', async (input, ctx) => {
 const request_id=Schema.decodeUnknownSync(Schema.NonEmptyString)(input.request_id);
 await ctx.act('obligations.update',{target:ctx.target.id,set:{document_capture:{operation:'RECEIPT',request_id}}});
 return Schema.decodeUnknownSync(Schema.Json)({recorded:true,obligation_id:ctx.target.id});
});

// Ledger mutations retain the original documentary and principal-specific admission.
c.transform(async (inputs, ctx) => {
 if(ctx.existing.some(row=>row!=null) && inputs.some(input=>!Object.hasOwn(plain(input),'document_capture'))){
  if(ctx.existing.some(row=>row==null)||inputs.some(input=>Object.hasOwn(plain(input),'document_capture')))refuse('Ledger completion cannot mix with original document preparation or raised creation.');
  const policies=ctx.policies??[];
  if(ctx.admin!==true && policies.includes('obligation_calendar_automation') && !policies.some(policy=>['hr_controller','hr_manager','scheduled_entries_automation'].includes(policy))){
   for(const [index,input] of inputs.entries()){
    const prior=plain(ctx.existing[index]!),change=plain(input);
    if(prior.duty_code!=='FACT_OWED'||Object.keys(change).some(key=>!['state','fulfilled_on'].includes(key))||change.state!=='FULFILLED')refuse('The calendar dispatcher may only close a recorded fact reminder; it cannot fulfil or waive a declared duty.');
   }
  }
  if(ctx.admin!==true&&policies.includes('scheduled_entries_automation')&&!policies.some(policy=>['hr_controller','hr_manager'].includes(policy))){
   return Promise.all(inputs.map(async(input,index)=>{const prior=plain(ctx.existing[index]!),change=plain(input);if(Object.keys(change).some(key=>!['state','fulfilled_on'].includes(key)))refuse('Scheduled settlement completion retains its original immutable occurrence.');const updates=await captureNativeScheduledFulfillments(ctx.db,{entity_id:String(prior.company_id),obligation_id:String(prior.id)});if(updates.length!==1||stableJson(updates[0]!.set)!==stableJson(change))refuse('A scheduled occurrence can be fulfilled only by its actual paid captured entry.');const {source_dependents:_scheduledDependents,...scheduledChange}=change;return {...scheduledChange,...(inputs[index]!.source_dependents==null?{}:{source_dependents:inputs[index]!.source_dependents}),scheduled_capture:{original:prior.scheduled_capture,fulfilment:updates[0]!.source}};}));
  }
  return Promise.all(inputs.map((input,index)=>prepareNativeDutyTransition(ctx.db,{obligation_id:String(plain(ctx.existing[index]!).id),input:plain(input),observation:{observedAt:String(ctx.now),timezone:String(ctx.tz)}}))) as never;
 }
 if (ctx.existing.some(row=>row != null)) {
  if (ctx.existing.some(row=>row == null)) refuse('Document preparation cannot mix with raised duty creation.');
  return Promise.all(inputs.map(async (input,index)=>{
   const existing = plain(ctx.existing[index]!);
   if (existing.approval_id != null) refuse('Document preparation retains its actual approved duty.');
   const route = Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literals(['PREPARE','RECEIPT']),request_id:Schema.NonEmptyString}))(plain(input).document_capture);
   if (route.operation==='PREPARE' && existing.document_capture != null) refuse('A prepared original document is immutable and retains its documentary receipts.');
   const versions = await readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{eq:String(existing.settings_id)},approval_id:{isNull:true}},undefined,undefined,1);
   const payroll = Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Unknown))(versions[0]?.payroll);
   const timezone = Schema.decodeUnknownSync(Schema.NonEmptyString)(payroll.timezone);
   const capture = await (route.operation==='PREPARE'?produceConfiguredObligationDocument:produceConfiguredObligationReceipt)(ctx.db,{obligation_id:String(existing.id),request_id:route.request_id,observation:{observedAt:String(ctx.now),timezone}});
   const prepared = Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(capture);
   return {document_capture:Schema.decodeUnknownSync(Schema.Json)(capture),...(prepared.files==null?{}:{document_files:Schema.decodeUnknownSync(Schema.Array(Schema.Struct({id:Schema.NonEmptyString,name:Schema.NonEmptyString,mime:Schema.NonEmptyString})))(prepared.files) as readonly FileRef[]})};
  }));
 }
 const rows = inputs.map((input, index) => {
  if (ctx.existing[index] != null) refuse('Raised duties retain their original source and cannot be rewritten.');
  return plain(input);
 });
 if (!rows.length) return [];
 const now = String(ctx.now);
 if (!isOffsetIsoInstant(now)) refuse('Duties require the actual native observation instant.');
 const runBasis = Schema.Struct({ source_collection: Schema.Literals(['payroll_runs']), source_id: Schema.NonEmptyString });
 const runIds = [...new Set(rows.flatMap(row => [...(row.subject_kind === 'RUN' ? [row.subject_id!] : []), ...(Schema.is(runBasis)(row.source_basis) ? [row.source_basis.source_id] : [])]))];
 const answers = await Promise.allSettled([
  readAll<{ id: string; settings_code: string; approval_id?: unknown }>(ctx.db, 'entities', { id: { in: [...new Set(rows.map(row => row.company_id!))] }, approval_id: { isNull: true } }),
  readAll<{ id: string; code: string; sealed_at: string; effective_range: unknown; voided_at?: unknown; approval_id?: unknown }>(ctx.db, 'jurisdiction_settings', { id: { in: [...new Set(rows.map(row => row.settings_id!))] }, approval_id: { isNull: true } }),
  readAll<{ id: string; company_id: string; effective_range: unknown; approval_id?: unknown }>(ctx.db, 'employee_profiles', { id: { in: [...new Set(rows.filter(row => row.subject_kind === 'EMPLOYMENT').map(row => row.subject_id!))] }, approval_id: { isNull: true } }),
  readAll<{ id: string; company_id: string; settings_id: string; salary_from: string; salary_to: string; approval_id?: unknown }>(ctx.db, 'payroll_runs', { id: { in: runIds }, approval_id: { isNull: true } })
 ]);
 for (const answer of answers) if (answer.status === 'rejected') throw answer.reason;
 if (answers[0].status !== 'fulfilled' || answers[1].status !== 'fulfilled' || answers[2].status !== 'fulfilled' || answers[3].status !== 'fulfilled') refuse('Duty source reads failed.');
 const entities = answers[0].value, settings = answers[1].value, profiles = answers[2].value, runs = answers[3].value;
 return Promise.all(rows.map(async (row,index) => {
  const triggered = Schema.decodeUnknownSync(calendarDay)(row.triggered_on);
  const runSource = Schema.is(runBasis)(row.source_basis) ? row.source_basis : undefined;
  const sourceRun = runSource == null ? undefined : runs.find(run => run.id === runSource.source_id);
  if (Schema.is(runBasis)(row.source_basis) && (sourceRun == null || sourceRun.company_id !== row.company_id || sourceRun.settings_id !== row.settings_id || sourceRun.approval_id != null)) refuse('A duty retains its actual completed source run and original governing capture.');
  const governingDay = sourceRun == null ? triggered : Schema.decodeUnknownSync(calendarDay)(sourceRun.salary_to);
  Schema.decodeUnknownSync(calendarDay)(row.due_on);
  const entity = entities!.find(candidate => candidate.id === row.company_id);
  const version = settings!.find(candidate => candidate.id === row.settings_id);
  if (entity == null || version == null || !Object.hasOwn(version,'code') || !Object.hasOwn(entity,'settings_code') || entity.approval_id != null || version.approval_id != null || entity.settings_code !== version.code || !Object.hasOwn(version,'sealed_at') || !isOffsetIsoInstant(version.sealed_at) || Date.parse(version.sealed_at) > Date.parse(now) || !Object.hasOwn(version,'effective_range') || !entryDateCovered(version.effective_range, governingDay) || (Object.hasOwn(version,'voided_at') && version.voided_at != null)) refuse('A duty requires its actual approved owner and original sealed governing snapshot.');
  const regulatory=await readQualifiedRuleData(ctx.db,{settings_id:String(version.id),observation:{observedAt:now,timezone:String(ctx.tz)},family:'OBLIGATIONS',code:'DUTY_TYPES'});
  if(!Array.isArray(regulatory.data))refuse('A duty requires its complete declared governing duty types.');
  const declarations=regulatory.data as readonly {code:string;authority:string;subject:string;recipient_required?:boolean}[];
  const declared = declarations.filter(duty => duty.code === row.duty_code);
  if (declared.length !== 1 || declared[0]!.subject !== row.subject_kind) refuse('A duty must identify one declared duty and its original subject kind.');
  if (declared[0]!.recipient_required && !Schema.is(Schema.NonEmptyString)(row.recipient_id)) refuse('This declared duty requires its original recipient.');
  if (row.subject_kind === 'COMPANY') {
   if (row.subject_id !== row.company_id) refuse('A company duty must name its actual entity.');
  } else if (row.subject_kind === 'EMPLOYMENT') {
   const profile = profiles!.find(candidate => candidate.id === row.subject_id);
   if (profile == null || !Object.hasOwn(profile,'company_id') || profile.company_id !== row.company_id || profile.approval_id != null || !Object.hasOwn(profile,'effective_range') || (sourceRun == null ? !entryDateCovered(profile.effective_range, triggered) : !Schema.is(Schema.Struct({ from: calendarDay, to: Schema.NullOr(calendarDay) }))(profile.effective_range) || profile.effective_range.from > sourceRun.salary_to || (profile.effective_range.to != null && profile.effective_range.to < sourceRun.salary_from))) refuse('An employment duty must name an actual approved profile owned on its trigger day.');
  } else if (row.subject_kind === 'RUN') {
   const run = runs!.find(candidate => candidate.id === row.subject_id);
   if (run == null || !Object.hasOwn(run,'company_id') || run.company_id !== row.company_id || !Object.hasOwn(run,'settings_id') || run.settings_id !== row.settings_id || run.approval_id != null) refuse('A run duty must retain its actual approved run and governing snapshot.');
  } else if(row.subject_kind==='CASE'){
   const caseBasis=Schema.decodeUnknownSync(Schema.Struct({source_collection:Schema.Literals(['entities']),source_id:Schema.NonEmptyString,source_family:Schema.NonEmptyString,source_record_id:Schema.NonEmptyString,event_kind:Schema.Literals(['CASE_EVENT']),catalog:Schema.Literals(['ADHOC','WORK','LEAVE','CLAIM','LOAN','CONTRIBUTION','ALLOWANCE'])}))(row.source_basis);
   if(caseBasis.source_id!==row.company_id||caseBasis.source_record_id!==row.subject_id)refuse('A case duty retains its actual admitted native source bank identity and legal employer.');
   const accepted=await prepareNativeCatalogSourceEvent(ctx.db,caseBasis as CatalogEffectSource,now);
   if(accepted.snapshot_id!==row.settings_id||accepted.day!==triggered)refuse('A case duty retains its actual original occurrence date and governing source.');
  } else refuse('Worksite duties require migrated original subject admission.');
  if (!Predicate.isString(row.trigger_ref) || !row.trigger_ref.trim()) refuse('A duty requires its actual trigger identity.');
  if (row.amount_due != null && (!Predicate.isNumber(row.amount_due) || !Number.isFinite(row.amount_due) || row.amount_due < 0)) refuse('A duty amount must be a finite nonnegative original amount.');
  const { source_basis, ...receiptArgs } = row;
  if (source_basis == null) refuse('A duty must be raised from an actual configured native source occurrence.');
  const derivedReceipt = Predicate.isObject(source_basis) && source_basis.operation==='SCHEDULED_OCCURRENCE' ? await admitNativeScheduledEffect(ctx.db,source_basis,'obligations',receiptArgs,now,String(ctx.tz)) : Predicate.isObject(source_basis) && source_basis.operation==='CALENDAR_DUTY' ? await admitNativeCalendarDutyEffect(ctx.db,source_basis,receiptArgs,now,String(ctx.tz)) : await admitConfiguredCatalogEffect(ctx.db, source_basis, 'obligations', receiptArgs, now);
  const { source_dependents:_plainDependents, ...rowWithoutDependents } = row;
  return { ...rowWithoutDependents, ...derivedReceipt, ...(inputs[index]!.source_dependents==null?{}:{source_dependents:inputs[index]!.source_dependents}), rule_set_source: Schema.decodeUnknownSync(Schema.Json)(regulatory.source), authority: declared[0]!.authority, state: 'OPEN' as const, amount_settled: 0 };
 }));
});
