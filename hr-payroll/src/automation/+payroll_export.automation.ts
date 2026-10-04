import {automation,type FileRef,type Id} from '@norbital-ai/bolt';
import {produceNativePayrollExport,captureNativePayrollFilingRequests} from '../lib/payroll-export-source.js';
import {readAll} from '../lib/payroll_engine/foundation/reads.js';
import {calendarDateInTimeZone} from '../lib/payroll_engine/foundation/time.js';
import {Effect,Schema} from 'effect';
import * as Predicate from 'effect/Predicate';
import {produceNativePayrollReports} from '../lib/payroll-report-source.js';
import {produceNativeIncomeReturns} from '../lib/payroll-income-source.js';
import {renderNativeIncomeRecordFiles,renderNativePayrollArtifacts,tableXlsx,type WorkbookSheet} from '../lib/payroll_engine/payslips/artifacts.js';
import {refuse} from '../lib/payroll_engine/foundation/primitives.js';
const kinds=['bank-files','payslip-pdfs','payroll-report-xlsx','catalogue-entries-xlsx','returns','income-tax-returns'] as const;
/** Native persisted export transport; every figure and source identity comes from the qualified saved-report programme. */
const payroll_export=automation({
 description:'Export caller-readable saved payroll reports into owned bank, payslip PDF and workbook files. Retain original payment evidence and report configuration; PDF requests paginate five saved payslips at a time.',
 input:{ids:{kind:'list',of:{kind:'id',of:'payroll_runs'},min:1},kind:{kind:'enum',values:kinds,optional:true},payslip_offset:{kind:'int',min:0,optional:true},codes:{kind:'list',of:{kind:'text'},optional:true},authorised_person:{kind:'object',fields:{name:{kind:'text'},designation:{kind:'text'},contact:{kind:'text'},date:{kind:'date'}},optional:true},submission:{kind:'enum',values:['ORIGINAL','AMENDMENT','REVISION'],optional:true},submitted:{kind:'list',of:{kind:'object',fields:{id_number:{kind:'text'},item:{kind:'text'},amount:{kind:'number'}}},optional:true}},
 output:{kind:'object',fields:{artefacts:{kind:'list',of:{kind:'object',fields:{kind:{kind:'enum',values:kinds},label:{kind:'text'},periods:{kind:'list',of:{kind:'text'}},files:{kind:'file',accept:['*/*'],max:'20MiB',multiple:true},included_payslips:{kind:'int',optional:true},skipped_employment_ids:{kind:'list',of:{kind:'text'},optional:true},bank_format:{kind:'text',optional:true},return_code:{kind:'text',optional:true},evidenced_obligation_ids:{kind:'list',of:{kind:'text'},optional:true}}}},next_payslip_offset:{kind:'int',optional:true}}},runAs:'trigger'
});
export default payroll_export;
payroll_export.run(async(input,ctx)=>{
 if(input.kind==='income-tax-returns'){
  if(input.authorised_person==null)refuse('An income return names the authorised person, their designation, contact and date.');
  const submitted:Record<string,Record<string,number>>=Object.create(null);
  for(const row of input.submitted??[]){submitted[row.id_number]??=Object.create(null);submitted[row.id_number]![row.item]=row.amount;}
  const filings=await produceNativeIncomeReturns(ctx,{run_ids:input.ids,authorised:input.authorised_person,submission:input.submission??'ORIGINAL',submitted,observation:{observedAt:String(ctx.now),timezone:'UTC'}});
  const artefacts=[];
  for(const filing of filings){
   const files=[];
   for(const file of renderNativeIncomeRecordFiles(filing))files.push(await ctx.files.put(file.bytes,{name:file.name,mime:file.mime,for:'payroll_export'}));
   if(files.length)artefacts.push({kind:'income-tax-returns' as const,label:'Income tax returns '+filing.label,periods:[String(filing.year)],files});
  }
  return {artefacts,next_payslip_offset:null};
 }
 const source=await produceNativePayrollReports(ctx,{run_ids:input.ids,observation:{observedAt:String(ctx.now),timezone:'UTC'}});
 const sheets=source as (WorkbookSheet & {runId:string;payDate:string;attendancePeriod:{start:string;end:string};skippedEmploymentIds?:readonly string[]})[];
 const offset=input.payslip_offset??0,total=sheets.reduce((sum,sheet)=>sum+sheet.payslips.length,0);
 if(!Number.isSafeInteger(offset)||offset<0)refuse('PDF pagination retains its actual non-negative saved payslip offset.');
 const rendered=input.kind==='returns'?[]:await renderNativePayrollArtifacts(sheets,input.kind??undefined,{offset,limit:5});
 const artefacts=[];
 const requests=await captureNativePayrollFilingRequests(ctx,{run_ids:input.ids,...(input.kind==='returns'?(input.codes==null?{}:{codes:input.codes}):{bank:true}),observation:{observedAt:String(ctx.now),timezone:'UTC'}});
 const put=async(bytes:Uint8Array,name:string,mime:string)=>ctx.files.put(bytes,{name,mime,for:'payroll_export'});
 const evidence=async(declaration:Record<string,unknown>,company_id:string,period:string,run_ids:readonly string[],bytes:Uint8Array,name:string,mime:string)=>{
  const declared=declaration.evidence;
  if(declared==null)return [];
  if(!Predicate.isObject(declared)||!Predicate.isString(declared.duty)||!Predicate.isString(declared.fact_key))refuse('Generated filing evidence retains its declared duty binding.');
  const target={duty:declared.duty,fact_key:declared.fact_key};
  const duties=await readAll<{id:Id<'obligations'>;facts?:unknown;input_files?:readonly FileRef[];input_proofs?:readonly unknown[]}>(ctx,'obligations',{company_id:{eq:company_id},duty_code:{eq:target.duty},trigger_ref:{eq:period},subject_id:{in:[company_id,...run_ids]},state:{eq:'OPEN'},approval_id:{isNull:true}});
  const ids=[];
  for(const duty of duties){
   const asset=await ctx.files.put(bytes,{name,mime,for:'obligations.input_files'});
   const prior=duty.input_proofs??[];
   const candidates=prior.flatMap(proof=>Predicate.isObject(proof)?[Object.fromEntries(Object.entries(proof).filter(([key])=>['id','fact_key','reference','file','received_on','expires_on','document_type'].includes(key)))]:[]);
   candidates.push({id:crypto.randomUUID(),fact_key:'input:/'+target.fact_key.replaceAll('~','~0').replaceAll('/','~1'),reference:name,file:asset,received_on:calendarDateInTimeZone(new Date(String(ctx.now)),String(ctx.tz))});
   const facts=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Union([Schema.Boolean,Schema.Number,Schema.String])))(duty.facts??{});
   const input_proofs=Schema.decodeUnknownSync(Schema.Array(Schema.Json))(candidates);
   const outcome=await ctx.act('obligations.update',{target:duty.id,set:{facts:{...facts,[target.fact_key]:name},input_files:[...(duty.input_files??[]),asset],input_proofs}});
   if(outcome.kind!=='committed')refuse('Generated filing evidence requires the actual committed original duty admission.');
   ids.push(String(duty.id));
  }
  return ids;
 };
 const filing=async(request:typeof requests[number])=>{
  const generated=await produceNativePayrollExport(ctx,{run_id:request.run_id,code:String(request.declaration.code),observation:{observedAt:String(ctx.now),timezone:'UTC'}});
  const table=Schema.decodeUnknownSync(Schema.Array(Schema.Array(Schema.Union([Schema.String,Schema.Number]))))(generated.table);
  const bytes=generated.text==null?new Uint8Array(await Effect.runPromise(tableXlsx(generated.name,table))):new TextEncoder().encode(generated.text);
  const file=await put(bytes,generated.name,generated.mime);
  const evidenced=await evidence(generated.declaration!,request.company_id,generated.period,generated.source.run_ids as string[],bytes,generated.name,generated.mime);
  return {generated,file,evidenced};
 };
 for(const artefact of rendered){
  const bank=artefact.kind==='bank-files'?requests.find(request=>artefact.run_ids.includes(request.run_id)):undefined;
  if(bank!=null){
   const {generated,file,evidenced}=await filing(bank);
   artefacts.push({kind:'bank-files' as const,label:artefact.label,periods:[bank.period],files:[file],bank_format:String(bank.declaration.code),return_code:String(bank.declaration.code),included_payslips:artefact.included_payslips??null,skipped_employment_ids:artefact.skipped_employment_ids??null,evidenced_obligation_ids:evidenced});
   continue;
  }
  const chosen=artefact.files;
  if(chosen.length===0)continue;
  const files=[];
  for(const file of chosen)files.push(await put(file.bytes,file.name,file.mime));
  const kind=Schema.decodeUnknownSync(Schema.Literals(['payslip-pdfs','payroll-report-xlsx','catalogue-entries-xlsx']))(artefact.kind);
  artefacts.push({kind,label:artefact.label,files,periods:sheets.filter(sheet=>artefact.run_ids.includes(sheet.runId)).map(sheet=>sheet.period),included_payslips:artefact.included_payslips??null,skipped_employment_ids:artefact.skipped_employment_ids??null});
 }
 if(input.kind==='returns')for(const request of requests){
  const {generated,file,evidenced}=await filing(request);
  artefacts.push({kind:'returns' as const,label:String(request.declaration.label??request.declaration.code)+' '+request.period,periods:[request.period],files:[file],return_code:String(request.declaration.code),included_payslips:generated.rows??null,evidenced_obligation_ids:evidenced});
 }
 return {artefacts,next_payslip_offset:input.kind==null||input.kind==='payslip-pdfs'?offset+5<total?offset+5:null:null};
});
