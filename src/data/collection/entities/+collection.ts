import {paymentSourceProofDemands,type SourceInputProofDemand} from '../../../lib/payroll_engine/admission/runtime-proof.js';
import {decodeConfiguredSource} from '../../../lib/payroll_engine/execution/configured-program.js';
import {appendNativeColumnAdmission,captureNativeColumnAdmission} from '../../../lib/payroll_engine/admission/input-column-admission.js';
import {evaluateConfigured} from '../../../lib/payroll_engine/execution/expressions/core.js';
import derivedSourceAuthority from '../../../../library/native-derived-source-authority.json' with {type:'json'};
import {prepareNativeNoncontractSource,prepareNativePaymentReceipt,prepareNativePayableSources,prepareNativePayrollDeletion} from '../../../lib/payroll_engine/payslips/payment.js';
import { settingsInForce } from '../../../lib/payroll_engine/admission/schema-version.js';
import { isCalendarDate,isOffsetIsoInstant } from '../../../lib/payroll_engine/foundation/time.js';
import { prepareConfiguredEntryReceipt, prepareConfiguredCatalogSource } from '../../../lib/payroll_engine/catalogues/entries.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { stableJson } from '../../../lib/payroll_engine/foundation/primitives.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import type { InputSchema } from '../../../lib/payroll_engine/datatypes/input-schema.js';
import { projectNativeInputs,originalSourceWriteAllowed,type InputWriteAccess } from '../../../lib/payroll_engine/admission/input-access.js';
import { collection, type FileRef } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { admitNativeInputUpdates } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import {createNativeAdmissionGraph} from '../../../lib/payroll_engine/admission/owner-graph.js';
import { Schema } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import * as Predicate from 'effect/Predicate';

/** The first column admission issue's actual native message. */
const columnFault = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }));

const c = collection('entities', {
 read: { fields: 'all', projection: { fields: ['facts','input_originals','input_history','input_proofs','input_files','input_census','input_column_history'], context: ['input_schema_snapshot', 'input_originals', 'facts', 'input_proofs', 'input_files'] } },
 create: { input: { columns: ['settings_code','name','registration_number','pay_cutoff_day','late_arrival_grace_minutes','pay_frequency','pay_cycle_months','pay_cycle_anchor','instalment_statutory_cutoff','semi_monthly_statutory_cutoff','risk_class','region','effective_range','holiday_source','workbook_layout','disbursement_account','facts','input_proofs','input_files'] } },
 update: { input: { columns: ['settings_code','name','registration_number','pay_cutoff_day','late_arrival_grace_minutes','pay_frequency','instalment_statutory_cutoff','pay_cycle_months','pay_cycle_anchor','risk_class','region','holiday_source','workbook_layout','disbursement_account','effective_range','facts','input_proofs','input_files','source_basis'],with:{payroll_runs:{delete:true,update:{columns:[],with:{payslips:{delete:true,update:{columns:['status','paid_at','payment_method_assessment','settled_by_payment_event_id','work_capture','source_basis']}}}}}} } },
 actions: { record_noncontract: {target:'record',description:'Admit documentary non-contract remuneration and payable sources under actual dated law.',input:{profile_id:{kind:'id',of:'employee_profiles'},input:{kind:'json'}},output:{kind:'json'}}, delete_saved_payrolls:{target:'record',description:'Release unpaid saved payrolls and their actual financial sources atomically.',input:{run_ids:{kind:'json'},slip_ids:{kind:'json'}},output:{kind:'json'}}, record_standalone_payment: {target:'record',description:'Admit original standalone payment sources and actual allocations without inventing a payroll target.',input:{profile_id:{kind:'id',of:'employee_profiles'},input:{kind:'json'}},output:{kind:'json'}}, record_payment: {target:'record',description:'Admit actual documentary payment and allocations through the governing stored payment source programme.',input:{payslip_id:{kind:'id',of:'payslips'},input:{kind:'json'}},output:{kind:'json'}}, execute_source: { target:'record', description: 'Execute a catalog’s stored source lifecycle operation against qualified actual owners.', input: { catalogue_id: { kind: 'id', of: 'adhoc_catalogue' }, profile_id: { kind: 'id', of: 'employee_profiles' }, program_ref: { kind: 'text' }, input: { kind: 'json' } }, output: { kind: 'json' } }, record_receipt: { target:'record', description: 'Admit documentary receipt input against its original paid component and configured source program.', input: { request_id: { kind: 'id', of: 'catalogue_entries' }, input: { kind: 'json' } }, output: { kind: 'json' } } }
});
export default c;
c.action('delete_saved_payrolls',async(input,ctx)=>{await ctx.act('entities.update',{target:ctx.target.id,set:{source_basis:{operation:'DELETE_PAYROLL',run_ids:input.run_ids,slip_ids:input.slip_ids}}});return {deleted:true,entity_id:ctx.target.id};});
c.action('record_noncontract',async(input,ctx)=>{await ctx.act('entities.update',{target:ctx.target.id,set:{source_basis:{operation:'NONCONTRACT_SOURCE',profile_id:input.profile_id,input:input.input}}});return {executed:true,entity_id:ctx.target.id};});
c.action('record_standalone_payment',async(input,ctx)=>{
 await ctx.act('entities.update',{target:ctx.target.id,set:{source_basis:{operation:'PAYMENT_SOURCE',profile_id:input.profile_id,input:input.input}}});
 return {executed:true,entity_id:ctx.target.id};
});
c.action('record_payment',async(input,ctx)=>{
 await ctx.act('entities.update',{target:ctx.target.id,set:{source_basis:{operation:'PAYMENT_SOURCE',payslip_id:input.payslip_id,input:input.input}}});
 return {executed:true,entity_id:ctx.target.id};
});
c.action('execute_source',async(input,ctx)=>{
 const prepared=await prepareConfiguredCatalogSource(ctx,{entity:plain(ctx.target),profile_id:String(input.profile_id),catalogue_id:String(input.catalogue_id),program_ref:input.program_ref,input:Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(input.input),observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
 const requestOutputs=prepared.output.filter(raw=>Schema.is(Schema.Record(Schema.String,Schema.Json))(raw)&&raw.operation==='REQUEST_CREATE');
 if(requestOutputs.length&&prepared.output.length!==requestOutputs.length)refuse('One native source operation stages a request batch or a bank batch with a complete prior capture.');
 if(requestOutputs.length){
  const requests=requestOutputs.map(raw=>{
   const operation=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(raw),value=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(operation.value);
   if(value.company_id!==ctx.target.id||value.employment_id!==input.profile_id||value.catalog!=='ADHOC'||value.catalogue_id!==input.catalogue_id||'id' in value||Object.keys(value).some(key=>!['company_id','employment_id','catalog','catalogue_id','reference','occurred_on','values','input_files','input_proofs'].includes(key)))refuse('A declared request operation retains its actual source owners and native admission contract.');
   const files=value.input_files==null?{}:{input_files:Schema.decodeUnknownSync(Schema.Array(Schema.Struct({id:Schema.NonEmptyString,name:Schema.NonEmptyString,mime:Schema.NonEmptyString})))(value.input_files) as readonly FileRef[]};
   return {catalog:'ADHOC' as const,catalogue_id:input.catalogue_id,company_id:ctx.target.id,employment_id:input.profile_id,reference:Schema.decodeUnknownSync(Schema.NonEmptyString)(value.reference),occurred_on:PlainDate(Schema.decodeUnknownSync(Schema.NonEmptyString)(value.occurred_on)),values:Schema.decodeUnknownSync(Schema.Json)(value.values),...(value.input_proofs==null?{}:{input_proofs:Schema.decodeUnknownSync(Schema.Json)(value.input_proofs)}),...files};
  });
  await ctx.act('catalogue_entries.create',requests);
 }else await ctx.act('entities.update',{target:ctx.target.id,set:{source_basis:{operation:'SOURCE',catalogue_id:input.catalogue_id,profile_id:input.profile_id,program_ref:input.program_ref,input:input.input}}});
 return {executed:true,entity_id:ctx.target.id};
});
c.action('record_receipt',async(input,ctx)=>{
 await ctx.act('entities.update',{target:ctx.target.id,set:{source_basis:{operation:'RECEIPT',request_id:input.request_id,input:input.input}}});
 return {recorded:true,entity_id:ctx.target.id};
});
c.transform(async (inputs, ctx) => {
 const rows = [...inputs];
 const existing = structuredClone(ctx.existing);
 const protectedOriginals: (unknown[] | undefined)[] = [];
 const trustedSourceFamiliesByInput: string[][] = rows.map(()=>[]);
 const maintainedCensus: (unknown[] | undefined)[] = [];
 const completionsByInput:unknown[]=rows.map(()=>undefined);
 const sourceProofDemandsByInput:SourceInputProofDemand[][]=rows.map(()=>[]);
 const derivedDeletesByInput:{family:string;id:string;original:string}[][]=rows.map(()=>[]);
 const derivedCreatesByInput:{family:string;id:string;original:string}[][]=rows.map(()=>[]);
 for(let index=0;index<rows.length;index++){
  const input=rows[index]!, prior=existing[index];
  if(input.source_basis==null)continue;
  if(prior==null||prior.approval_id!=null||Object.keys(input).some(key=>key!=='source_basis'))refuse('Receipt routing retains the actual approved entity and cannot supply financial facts or original provenance.');
  const routing=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(input.source_basis);
  if(routing.operation==='DELETE_PAYROLL'){
   if(Object.keys(routing).some(key=>!['operation','run_ids','slip_ids'].includes(key)))refuse('Payroll deletion accepts only actual saved source identities.');
   const run_ids=Schema.decodeUnknownSync(Schema.Array(Schema.NonEmptyString))(routing.run_ids),slip_ids=Schema.decodeUnknownSync(Schema.Array(Schema.NonEmptyString))(routing.slip_ids);
   const released=await prepareNativePayrollDeletion(ctx.db,{run_ids,slip_ids,observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
   if([...released.runs,...released.parentRuns,...released.slips].some(row=>row.company_id!==prior.id))refuse('Atomic payroll deletion retains one actual financial owner.');
   const actor={actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']};
   for(const run of released.runs)if(!await originalSourceWriteAllowed(derivedSourceAuthority.parents.payroll_runs_delete.grants,'delete',run,actor))refuse('The native actor lacks original payroll deletion authority.');
   for(const slip of released.slips)if(!await originalSourceWriteAllowed(derivedSourceAuthority.parents.payslips_delete.grants,'delete',slip,actor))refuse('The native actor lacks original unpaid payslip deletion authority.');
   const partition=released.partitions.find(partition=>Schema.is(Schema.Record(Schema.String,Schema.Json))(partition.entity)&&partition.entity.id===prior.id);
   const facts={...Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(prior.facts)};
   if(partition!=null){
    const remove=new Set(Schema.decodeUnknownSync(Schema.Array(Schema.String))(partition.remove_ids));
    const bank=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(facts.payable_tranches);
    if([...remove].some(id=>bank.filter(row=>row.id===id).length!==1))refuse('Atomic payroll deletion retains exact current certified tranche identities.');
    for(const row of bank.filter(row=>remove.has(String(row.id))))derivedDeletesByInput[index]!.push({family:'payable_tranches',id:String(row.id),original:stableJson(row)});
    facts.payable_tranches=bank.filter(row=>!remove.has(String(row.id)));
    if(remove.size){trustedSourceFamiliesByInput[index]!.push('payable_tranches');maintainedCensus[index]=releaseNativeBankCensus(plain(prior),facts,'payable_tranches',[...remove]);}
   }
   const updates=new Map<string,string[]>();for(const slip of released.slips)if(!run_ids.includes(String(slip.payroll_run_id))){const target=String(slip.payroll_run_id);updates.set(target,[...(updates.get(target)??[]),String(slip.id)]);}
   completionsByInput[index]={...(run_ids.length?{delete:run_ids}:{}),...(updates.size?{update:[...updates].map(([target,ids])=>({target,set:{payslips:{delete:ids}}}))}:{})};
   rows[index]={facts,input_files:prior.input_files??[],input_proofs:prior.input_proofs??[]};
   continue;
  }
  if(routing.operation==='SOURCE'||routing.operation==='PAYMENT_SOURCE'||routing.operation==='PAYABLE_SOURCE'||routing.operation==='NONCONTRACT_SOURCE'){
   if(routing.operation==='SOURCE'&&(!Predicate.isString(routing.catalogue_id)||!Predicate.isString(routing.profile_id)||!Predicate.isString(routing.program_ref)||!Predicate.isObject(routing.input)||Object.keys(routing).some(key=>!['operation','catalogue_id','profile_id','program_ref','input'].includes(key))))refuse('Source routing names only an actual catalog, profile, declared program and documentary rows.');
   if(routing.operation==='PAYMENT_SOURCE'&&(Object.hasOwn(routing,'payslip_id')===Object.hasOwn(routing,'profile_id')||(Object.hasOwn(routing,'payslip_id')?(!Predicate.isString(routing.payslip_id)||!routing.payslip_id.trim()):(!Predicate.isString(routing.profile_id)||!routing.profile_id.trim()))||!Predicate.isObject(routing.input)||Object.keys(routing).some(key=>!['operation','payslip_id','profile_id','input'].includes(key))))refuse('Payment source routing selects exactly one actual saved payslip or standalone profile and documentary receipt input.');
   if(routing.operation==='PAYABLE_SOURCE'&&(!Predicate.isString(routing.payslip_id)||Object.keys(routing).some(key=>!['operation','payslip_id'].includes(key))))refuse('Payable source routing selects only its actual saved calculation.');
   if(routing.operation==='NONCONTRACT_SOURCE'&&(!Predicate.isString(routing.profile_id)||!routing.profile_id.trim()||!Predicate.isObject(routing.input)||Object.keys(routing).some(key=>!['operation','profile_id','input'].includes(key))))refuse('Non-contract source routing retains its actual recipient profile and documentary agreement.');
   const prepared= routing.operation==='NONCONTRACT_SOURCE'?await prepareNativeNoncontractSource(ctx.db,{company_id:String(prior.id),profile_id:String(routing.profile_id),input:routing.input,observedAt:String(ctx.now)}):routing.operation==='PAYABLE_SOURCE'?await prepareNativePayableSources(ctx.db,{payslip_id:String(routing.payslip_id),observedAt:String(ctx.now)}):routing.operation==='PAYMENT_SOURCE'?await prepareNativePaymentReceipt(ctx.db,{...(Predicate.isString(routing.payslip_id)?{payslip_id:routing.payslip_id}:{company_id:String(prior.id),profile_id:String(routing.profile_id)}),input:routing.input,observedAt:String(ctx.now)}):await prepareConfiguredCatalogSource(ctx.db,{entity:plain(prior),profile_id:String(routing.profile_id),catalogue_id:String(routing.catalogue_id),program_ref:String(routing.program_ref),input:Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(routing.input),observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
   if(prepared.profile.company_id!==prior.id)refuse('A configured source write retains the actual payer entity.');
   const pin=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(prior.input_schema_snapshot);
   const versions=await readAll<{id:string;entity_input_schema:InputSchema}>(ctx.db,'jurisdiction_settings',{id:{eq:pin.snapshot_id},approval_id:{isNull:true},sealed_at:{isNull:false,lte:String(ctx.now)}},undefined,{id:true,entity_input_schema:true},1);
   if(versions.length!==1||versions[0]?.id!==pin.snapshot_id)refuse('Source append requires its actual accepted owner schema.');
   const facts={...Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(prior.facts)},original=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(prior.input_originals??[]);
   const originals=[...original],files=new Map<string,unknown>();for(const file of prior.input_files??[])files.set(String(file.id),file);
   const parentName=routing.operation==='PAYMENT_SOURCE'?'payment_events':routing.operation==='PAYABLE_SOURCE'?'payslips':routing.operation==='NONCONTRACT_SOURCE'?'noncontract_settlements':null;
   const parentAuthority=parentName==null?null:derivedSourceAuthority.parents[parentName];
   const parentGrants=Schema.is(Schema.Record(Schema.String,Schema.Json))(parentAuthority?.grants)?parentAuthority.grants:undefined;
   if(parentAuthority!=null&&!ctx.admin&&!ctx.policies.some(policy=>parentGrants?.[policy]===true))refuse('Derived original sources require the actual original parent write authority.');
   const completionPlans:Record<string,Schema.Json>[]=[];
   const documentaryProofs:Record<string,Schema.Json>[]=[];
   if(parentName==='payment_events'&&prepared.output.filter(raw=>{const operation=Schema.is(Schema.Record(Schema.String,Schema.Json))(raw)?raw:undefined;return operation?.operation==='APPEND'&&operation.family==='payment_events'&&operation.key==='payment';}).length!==1)refuse('Derived payment writes require exactly one genuine configured parent receipt.');
   if(parentName==='noncontract_settlements'&&prepared.output.filter(raw=>{const operation=Schema.is(Schema.Record(Schema.String,Schema.Json))(raw)?raw:undefined;return operation?.operation==='APPEND'&&operation.family===parentName&&operation.key==='settlement';}).length!==1)refuse('A non-contract source requires its one genuine configured parent agreement.');
   const minted=new Map<string,string>();
   for(const raw of prepared.output){const operation=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(raw);if(operation.key!=null){if(operation.operation!=='APPEND'||!Predicate.isString(operation.key)||!operation.key.trim()||minted.has(operation.key))refuse('Native source keys uniquely identify newly appended rows within the actual source batch.');const assigned=routing.operation==='NONCONTRACT_SOURCE'&&'assigned_ids' in prepared?(prepared.assigned_ids as Record<string,string>)[operation.key]:undefined;if(routing.operation==='NONCONTRACT_SOURCE'&&!Predicate.isString(assigned))refuse('Agreement source identities retain their actual native producer assignment.');minted.set(operation.key,assigned??crypto.randomUUID());}}
   for(const raw of prepared.output){
    const operation=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(raw);
    if(operation.operation==='COMPLETE'){
     if(routing.operation!=='PAYMENT_SOURCE'||operation.family!=='payslips'||!Predicate.isString(operation.id)||!Predicate.isString(operation.run_id)||Object.keys(operation).some(key=>!['operation','family','id','run_id','fields'].includes(key)))refuse('Payment completion selects only genuine configured original saved-slip updates.');
     const fields=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(operation.fields);
     if(Object.keys(fields).some(key=>!['status','paid_at','payment_method_assessment'].includes(key))||fields.status!=='PAID'||!isOffsetIsoInstant(fields.paid_at)||Date.parse(String(fields.paid_at))>Date.parse(String(ctx.now))||completionPlans.some(plan=>plan.id===operation.id))refuse('Payment completion retains unique original paid outcomes and actual observation.');
     completionPlans.push(operation);continue;
    }
    if(!Predicate.isString(operation.family))refuse('Source operations must name a declared native bank family.');
    if(operation.family==='fact_evidence'){
     if(!(parentName==='payment_events'||parentName==='noncontract_settlements')||operation.operation!=='APPEND'||!Predicate.isObject(operation.value))refuse('Payment documentary proofs derive only from the actual original parent admission.');
     const evidence=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(operation.value);
     const columns=(parentAuthority!.children as Record<string,readonly string[]>).fact_evidence;
     if(columns==null||Object.keys(evidence).some(key=>![...columns,'subject'].includes(key)))refuse('Payment proof transport retains the exact original parent documentary fields.');
     const subject=Schema.decodeUnknownSync(Schema.Struct({collection:Schema.Literal(parentName!),id:Schema.Null}))(evidence.subject,{onExcessProperty:'error'});
     if(subject.id!==null||stableJson(operation.references)!==stableJson({'/subject/id':parentName==='payment_events'?'payment':'settlement'}))refuse('Payment proof ownership derives from the actual server-minted parent identity.');
     documentaryProofs.push(evidence);
     if(evidence.file!=null){const file=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(evidence.file);if(!Predicate.isString(file.id)||!file.id.trim())refuse('Payment documentary evidence retains its actual native file.');const previous=files.get(file.id);if(previous!=null&&stableJson(previous)!==stableJson(file))refuse('Payment proof file metadata is immutable.');files.set(file.id,file);}
     continue;
    }

    const family=versions[0]!.entity_input_schema.properties?.[operation.family],authority=family?.['x-norbital']?.original_read_grants;
    if(family?.['x-norbital']?.source_kind!==operation.family||family['x-norbital'].stable_item_key!=='id'||!Predicate.isObject(authority))refuse('A source operation cannot invent an undeclared bank or its original authority.');
    const derivedColumns=parentAuthority==null?undefined:(parentAuthority.children as Record<string,readonly string[]>)[operation.family];
    const appendGrants=Schema.is(Schema.Record(Schema.String,Schema.Json))(authority)?authority:undefined;
   if(derivedColumns==null&&!ctx.admin&&!ctx.policies.some(policy=>{const grant=appendGrants?.[policy];return Predicate.isObject(grant)&&Schema.is(Schema.Record(Schema.String,Schema.Json))(grant)&&grant.create===true;}))refuse('A source append requires an actual principal with this original bank’s exact create authority.');
    const bank=facts[operation.family];if(!Array.isArray(bank))refuse('Source append requires an actual qualified complete bank, including explicit original empty scope.');
    if(operation.operation==='KEEP'){
     if(!Predicate.isString(operation.id)||bank.filter(value=>Predicate.isObject(value)&&value.id===operation.id).length!==1)refuse('Source replay retains one actual existing bank identity.');
     continue;
    }
    if(operation.operation!=='APPEND'||!Predicate.isObject(operation.value)||'id' in operation.value)refuse('A source program may only append server-identified new original values or retain an actual existing identity.');
    const row:Record<string,Schema.Json>={...Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(operation.value)};row.id=Predicate.isString(operation.key)?minted.get(operation.key)!:crypto.randomUUID();
    if(operation.references!=null){
     const references=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.String))(operation.references);
     for(const [pointer,key] of Object.entries(references)){
      const identity=minted.get(key);if(identity==null||!pointer.startsWith('/')||pointer==='/id')refuse('Native source references select an actual newly minted batch identity.');
      const parts=pointer.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
      if(parts.some(part=>!part||['__proto__','constructor','prototype'].includes(part)))refuse('Native source identity references retain safe original field coordinates.');
      let target:Record<string,unknown>=row;for(const part of parts.slice(0,-1)){const nested=target[part];if(!Schema.is(Schema.Record(Schema.String,Schema.Json))(nested))refuse('Native source references require actual declared object fields.');target=nested;}
      const field=parts.at(-1)!;if(target[field]!=null)refuse('A native minted identity cannot replace submitted original source identity.');target[field]=identity;
     }
    }
    if(derivedColumns!=null){
     const inverse=operation.family==='payable_tranches'?['settlement']:operation.family==='fact_evidence'?['subject']:['payment_event_id'];
     const allowed=new Set([...derivedColumns,...inverse,'id','currency']);
     if(Object.keys(row).some(key=>!allowed.has(key)))refuse('A derived source retains the exact original parent child field contract.');
     if(parentName==='payment_events'){
      const parentId=minted.get('payment');if(parentId==null)refuse('A derived payment child requires its actual newly admitted parent identity.');
      if(operation.family==='fact_evidence'){const rawSubject=row.subject;if(!Predicate.isObject(rawSubject))refuse('Derived payment evidence retains its actual original parent.');const subject=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Unknown))(rawSubject);if(subject.collection!=='payment_events'||subject.id!==parentId)refuse('Derived payment evidence retains its actual original parent.');}
      else if(row.payment_event_id!==parentId)refuse('Derived payment children retain the actual server-minted original parent identity.');
     }else if(parentName==='noncontract_settlements'){const rawSettlement=row.settlement;if(!Predicate.isObject(rawSettlement))refuse('Agreement payable sources retain their actual native admitted parent.');const settlement=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Unknown))(rawSettlement);if(settlement.collection!==parentName||settlement.id!==minted.get('settlement')||row.source_id!==minted.get('settlement'))refuse('Agreement payable sources retain their actual native admitted parent.');}else{const rawSettlement=row.settlement;if(!Predicate.isObject(rawSettlement))refuse('Derived payable sources retain their actual qualified saved calculation.');const settlement=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Unknown))(rawSettlement);if(settlement.collection!=='payslips'||settlement.id!==routing.payslip_id)refuse('Derived payable sources retain their actual qualified saved calculation.');}
     derivedCreatesByInput[index]!.push({family:operation.family,id:row.id,original:stableJson(row)});
    }
    if(Object.hasOwn(row,'company_id')&&row.company_id!==prior.id||Object.hasOwn(row,'employee_id')&&row.employee_id!==prepared.profile.employee_id||Object.hasOwn(row,'employment_id')&&row.employment_id!==prepared.profile.id)refuse('A source append cannot change the actual legal employer or profile owner.');
    trustedSourceFamiliesByInput[index]!.push(operation.family);
    facts[operation.family]=[...bank,row];
    const retainFiles=(schema:InputSchema,value:unknown):void=>{
     if(value==null)return;
     if(schema['x-norbital']?.datatype==='file'){
      if(!Predicate.isObject(value)||!('id' in value)||!Predicate.isString(value.id))refuse('Configured source files retain actual native reference identities.');
      const old=files.get(value.id);if(old!=null&&stableJson(old)!==stableJson(value))refuse('Source evidence retains the exact original native file metadata.');files.set(value.id,value);return;
     }
     for(const branch of schema.oneOf??[])retainFiles(branch,value);
     if(Array.isArray(value)){if(schema.items)for(const child of value)retainFiles(schema.items,child);return;}
     if (value !== null && Predicate.isObjectOrArray(value))for(const [key,child]of Object.entries(value)){const node=schema.properties?.[key]??(schema.additionalProperties != null && Predicate.isObjectOrArray(schema.additionalProperties)?schema.additionalProperties:undefined);if(node)retainFiles(node,child);}
    };
    if(family.items)retainFiles(family.items,row);

    const original_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(row)))),byte=>byte.toString(16).padStart(2,'0')).join('');
    const source_event=operation.event==null?undefined:Schema.decodeUnknownSync(Schema.Struct({kind:Schema.String,date:Schema.String}))(operation.event);
    if(source_event!=null&&(source_event.kind!=='CASE_EVENT'||!isCalendarDate(source_event.date)||source_event.date>prepared.day))refuse('A source event retains its configured actual elapsed occurrence.');
    const eventVersions=source_event==null?[]:await readAll<{id:string;code:string;effective_range:{from:string;to:string|null};sealed_at:string;voided_at?:string|null}>(ctx.db,'jurisdiction_settings',{code:{eq:prior.settings_code},approval_id:{isNull:true},voided_at:{isNull:true},sealed_at:{isNull:false,lte:String(ctx.now)}},undefined,{id:true,code:true,effective_range:true,sealed_at:true,voided_at:true});
    const governingEvent=source_event==null?undefined:settingsInForce(eventVersions,String(prior.settings_code),String(source_event.date));
    if(source_event!=null&&governingEvent==null)refuse('An original source event needs its actual received-day governing jurisdiction.');
    originals.push({...(source_event==null?{}:{source_event:{...source_event,occurred_at:String(ctx.now),snapshot_id:governingEvent!.id,catalog:'ADHOC'}}),source_kind:operation.family,id:row.id,owner:{collection:'entities',id:prior.id},schema:pin,original_hash,original_read_grants:authority,original:row,source_capture:Schema.decodeUnknownSync(Schema.Json)(prepared)});
   }
   if(routing.operation==='PAYMENT_SOURCE'||routing.operation==='NONCONTRACT_SOURCE'){
    if(!('proof_source' in prepared))refuse('Payment proof admission requires its actual qualified source programme.');
    if(!('proof_fact_fields' in prepared))refuse('Payment proof admission requires its actual qualified source programme.');
    const proofBank=routing.operation==='PAYMENT_SOURCE'?'payment_events':'noncontract_settlements';
    const paymentId=minted.get(routing.operation==='PAYMENT_SOURCE'?'payment':'settlement');const bank=facts[proofBank];
    if(paymentId==null||!Array.isArray(bank))refuse('Payment proof admission retains its actual server-minted bank parent.');
    const bankIndex=bank.findIndex(value=>Predicate.isObject(value)&&value.id===paymentId);
    if(bankIndex<0)refuse('Payment proof admission cannot precede its actual parent source.');
    const payment=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(bank[bankIndex]);
    const context=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Unknown))(decodeConfiguredSource(Schema.decodeUnknownSync(Schema.Json)(prepared.context)));
    const demands=paymentSourceProofDemands({fields:prepared.proof_fact_fields as Parameters<typeof paymentSourceProofDemands>[0]['fields'],facts:Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Unknown))(payment.facts),context,payment_id:paymentId,bank_index:bankIndex,bank:proofBank,source:Schema.decodeUnknownSync(Schema.Struct({settings_id:Schema.NonEmptyString,source_program_ref:Schema.NonEmptyString}))(prepared.proof_source)});
    sourceProofDemandsByInput[index]!.push(...demands);
    const candidates=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(prior.input_proofs??[]).map(proof=>Object.fromEntries(Object.entries(proof).filter(([key])=>['id','fact_key','reference','file','received_on','expires_on','document_type'].includes(key))));
    for(const evidence of documentaryProofs){
     const escaped=String(evidence.fact_key).replaceAll('~','~0').replaceAll('/','~1');
     const key='input:/'+proofBank+'/@'+paymentId+'/facts/'+escaped;
     if(demands.filter(demand=>demand.key===key).length!==1)refuse('Payment evidence identifies one genuine paid-date documentary demand.');
     candidates.push({id:crypto.randomUUID(),fact_key:key,received_on:prepared.day,...Object.fromEntries(Object.entries(evidence).filter(([field])=>['reference','file','received_on','expires_on','document_type'].includes(field)))});
    }
    rows[index]={...rows[index]!,input_proofs:candidates};
   }
   if(completionPlans.length){
    const eventId=minted.get('payment');if(eventId==null||!Array.isArray(facts.payment_events)||facts.payment_events.filter(value=>Predicate.isObject(value)&&value.id===eventId).length!==1)refuse('Atomic completion requires its actual newly admitted parent receipt.');
    const nativeSlips=await readAll<Record<string,unknown>>(ctx.db,'payslips',{id:{in:completionPlans.map(plan=>plan.id)},approval_id:{isNull:true}});
    const nativeRuns=await readAll<Record<string,unknown>>(ctx.db,'payroll_runs',{id:{in:[...new Set(completionPlans.map(plan=>plan.run_id))]},company_id:{eq:prior.id},approval_id:{isNull:true}});
    if(nativeSlips.length!==completionPlans.length||nativeRuns.length!==new Set(completionPlans.map(plan=>plan.run_id)).size)refuse('Atomic payment updates retain every actual approved run and slip source.');
    const byRun=new Map<string,{target:string;set:Record<string,unknown>}[]>();
    for(const plan of completionPlans){
     const slip=nativeSlips.find(slip=>slip.id===plan.id),run=nativeRuns.find(run=>run.id===plan.run_id);
     if(slip==null||run==null||slip.approval_id!=null||run.approval_id!=null||run.company_id!==prior.id||slip.payroll_run_id!==run.id||!['DRAFT','ON_HOLD'].includes(String(slip.status)))refuse('Atomic payment cannot replace paid, held, foreign or mismatched saved financial sources.');
     const profileRows=await readAll<Record<string,unknown>>(ctx.db,'employee_profiles',{id:{eq:String(slip.employment_id)},company_id:{eq:prior.id},employee_id:{eq:prepared.profile.employee_id},approval_id:{isNull:true}},undefined,undefined,1);
     if(profileRows.length!==1||profileRows[0]?.id!==slip.employment_id||profileRows[0]?.approval_id!=null)refuse('Atomic completion retains its genuine paying person and employer.');
     const tranches=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(facts.payable_tranches).filter(row=>{const settlement=row.settlement;return Predicate.isObject(settlement)&&settlement.collection==='payslips'&&settlement.id===slip.id;});
     const allocations=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(facts.payment_allocations).filter(row=>tranches.some(tranche=>tranche.id===row.payable_tranche_id));
     const events=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(facts.payment_events).filter(event=>allocations.some(allocation=>allocation.payment_event_id===event.id));
     if(tranches.length===0||!allocations.some(allocation=>allocation.payment_event_id===eventId))refuse('Atomic completion consumes its actual allocated payable sources.');
     const minor=(value:unknown)=>BigInt(evaluateConfigured('source_amount_minor(value,currency)',{value,currency:slip.currency}) as number);
     for(const tranche of tranches){const own=allocations.filter(allocation=>allocation.payable_tranche_id===tranche.id);if(own.reduce((sum,row)=>sum+minor(row.gross_amount),0n)!==minor(tranche.gross_amount)||own.reduce((sum,row)=>sum+minor(row.non_event_deduction_amount),0n)!==minor(tranche.non_event_deduction_amount))refuse('Atomic payment completion requires exact full original payable gross and deduction conservation.');}
     const capture=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(slip.work_capture),basis=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(slip.source_basis);
     if(capture.complete!==true)refuse('Atomic completion retains the full immutable original work capture.');
     const set={...Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(plan.fields),settled_by_payment_event_id:eventId,work_capture:{...capture,payable_tranches:tranches,payment_allocations:allocations,payment_events:events},source_basis:{...basis,payment:{event_id:eventId,parent_entity_id:prior.id,atomic:true}}};
     const group=byRun.get(String(run.id))??[];group.push({target:String(slip.id),set});byRun.set(String(run.id),group);
    }
    completionsByInput[index]={update:[...byRun].map(([target,updates])=>({target,set:{payslips:{update:updates}}}))};
   }
   rows[index]={facts,input_files:[...files.values()] as readonly FileRef[],...(rows[index]!.input_proofs==null?{}:{input_proofs:rows[index]!.input_proofs})};protectedOriginals[index]=originals;continue;
  }
  if(routing.operation!=='RECEIPT'||!Predicate.isString(routing.request_id)||!Predicate.isObject(routing.input)||Object.keys(routing).some(key=>!['operation','request_id','input'].includes(key)))refuse('Financial receipt routing selects only an actual request and documentary input.');
  const original=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(prior.input_originals??[]);
  const repeated=original.filter(capture=>capture.source_kind==='source_cash_payments'&&capture.receipt_request_id===routing.request_id&&stableJson(capture.receipt_input)===stableJson(routing.input));
  if(repeated.length>1)refuse('A documentary receipt cannot have duplicate protected native identities.');
  if(repeated.length===1){
   const accepted=repeated[0]!;const actual=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(prior.facts).source_cash_payments;
   if(!Array.isArray(actual)||actual.filter(row=>Predicate.isObject(row)&&row.id===accepted.id&&stableJson(row)===stableJson(accepted.original)).length!==1)refuse('Receipt replay requires the exact retained original native bank row.');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(accepted.original)))),byte=>byte.toString(16).padStart(2,'0')).join('');
   if(digest!==accepted.original_hash)refuse('Receipt replay cannot replace its original protected capture.');
   rows[index]={facts:prior.facts,input_files:prior.input_files??[]};continue;
  }
  const prepared=await prepareConfiguredEntryReceipt(ctx.db,{entity_id:String(prior.id),request_id:routing.request_id,input:routing.input,observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
  const pin=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(prior.input_schema_snapshot);
  const versions=await readAll<{id:string;entity_input_schema:InputSchema}>(ctx.db,'jurisdiction_settings',{id:{eq:pin.snapshot_id},approval_id:{isNull:true},sealed_at:{isNull:false,lte:String(ctx.now)}},undefined,{id:true,entity_input_schema:true},1);
  const family=versions[0]?.entity_input_schema.properties?.source_cash_payments;
  if(versions.length!==1||versions[0]?.id!==pin.snapshot_id||family?.['x-norbital']?.source_kind!=='source_cash_payments'||family['x-norbital'].stable_item_key!=='id'||family['x-norbital'].original_read_grants==null)refuse('Financial append retains its exact accepted native family and original authority grants.');
  const authority=family['x-norbital'].original_read_grants;
  const receiptGrants=Schema.is(Schema.Record(Schema.String,Schema.Json))(authority)?authority:undefined;
  if(!ctx.admin&&!ctx.policies.some(policy=>{const grant=receiptGrants?.[policy];return Predicate.isObject(grant)&&Schema.is(Schema.Record(Schema.String,Schema.Json))(grant)&&grant.create===true;}))refuse('Receipt capture requires actual original native create authority for this bank.');
  if('id' in routing.input)refuse('A new financial receipt identity is minted by its native writer.');
  const row=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))({...prepared.row,id:crypto.randomUUID()});
  const facts=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(prior.facts);
  const bank=facts.source_cash_payments;
  if(!Array.isArray(bank))refuse('Receipt append requires the actual complete original bank, including an explicitly qualified empty table.');
  if(bank.some(value=>Predicate.isObject(value)&&value.source_system===row.source_system&&value.source_payment_id===row.source_payment_id&&value.adhoc_request_id===routing.request_id))refuse('The actual source receipt already exists; changed documentary contents cannot create another receipt.');
  const files=new Map<string,unknown>();
  for(const file of prior.input_files??[])files.set(String(file.id),file);
  for(const [key,value] of Object.entries(row))if(key.endsWith('_file')&&Predicate.isObject(value)&&'id' in value){const file=Schema.decodeUnknownSync(Schema.Struct({id:Schema.String}))(value);const previous=files.get(file.id);if(previous!=null&&stableJson(previous)!==stableJson(file))refuse('Financial evidence retains its exact original native file metadata.');files.set(file.id,file);}
  trustedSourceFamiliesByInput[index]!.push('source_cash_payments');
  rows[index]={facts:{...facts,source_cash_payments:[...bank,row]},input_files:[...files.values()] as readonly FileRef[]};
  const original_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(row)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  protectedOriginals[index]=[...original,{source_kind:'source_cash_payments',id:row.id,owner:{collection:'entities',id:prior.id},schema:pin,original_hash,original_read_grants:family['x-norbital'].original_read_grants,original:row,receipt_request_id:routing.request_id,receipt_input:routing.input,receipt_capture:prepared}];
 }
 for(let index=0;index<rows.length;index++)if(trustedSourceFamiliesByInput[index]!.length&&maintainedCensus[index]==null)maintainedCensus[index]=advanceNativeBankCensus(plain(existing[index]!),plain(rows[index]!).facts,[...new Set(trustedSourceFamiliesByInput[index]!)]);
 const assigned=ctx.staged.filter(row=>row.collection==='entities'&&row.parent==null);
 const admissionReads=existing.every(row=>row==null)?createNativeAdmissionGraph(ctx.db,ctx.staged):ctx.db;
 const dynamicFields=['facts','input_proofs','input_files'];
 const selected=rows.flatMap((input,index)=>existing[index]==null||dynamicFields.some(field=>Object.hasOwn(input,field))?[index]:[]);
 
 const captures=selected.length?await admitNativeInputUpdates(admissionReads,'entities',selected.map(index=>existing[index]==null?plain(rows[index]!):Object.fromEntries(Object.entries(plain(rows[index]!)).filter(([key])=>dynamicFields.includes(key)))),selected.map(index=>existing[index]==null?undefined:plain(existing[index])),{observedAt:String(ctx.now),timezone:ctx.tz,day:String(ctx.today)},{...(existing.every(row=>row==null)?{assignedIds:selected.map(index=>assigned[index]!.id)}:{}),trustedSourceFamiliesByInput:selected.map(index=>trustedSourceFamiliesByInput[index]!),derivedCreatesByInput:selected.map(index=>derivedCreatesByInput[index]!),derivedDeletesByInput:selected.map(index=>derivedDeletesByInput[index]!),sourceProofDemandsByInput:selected.map(index=>sourceProofDemandsByInput[index]!),inputAccess:{actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']}}):[];
 const result=rows.map(input=>({...input}));
 for(const [at,index]of selected.entries()){const capture=captures[at]!;const custody='input_census' in capture?{input_census:Schema.decodeUnknownSync(Schema.Json)(capture.input_census),input_originals:Schema.decodeUnknownSync(Schema.Json)(capture.input_originals)}:{};Object.assign(result[index]!,capture,custody,{input_files:rows[index]!.input_files??existing[index]?.input_files??[]});}
 for(const [index]of result.entries()){
  const input=plain(result[index]!),previous=existing[index]==null?undefined:plain(existing[index]);
  const row={...previous,...input};
  const codes=[...new Set([row.settings_code,previous?.settings_code].filter((code):code is string=>Predicate.isString(code)&&code.trim().length>0))];
  
  const columns=await captureNativeColumnAdmission(admissionReads,{subjects:[{collection:'entities',row,...(previous==null?{}:{previous}),record_id:String(previous?.id??assigned[index]!.id),lineages:codes}],observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
  if(columns.issues.length)refuse(columnFault(columns.issues[0]!).message);
  const history=await appendNativeColumnAdmission({...previous,...(input.input_column_history==null?{}:{input_column_history:input.input_column_history})},{collection:'entities',id:String(previous?.id??assigned[index]!.id)},[columns],{observedAt:String(ctx.now),timezone:ctx.tz});
  result[index]={...result[index]!,input_column_history:Schema.decodeUnknownSync(Schema.Json)(history.input_column_history),...(completionsByInput[index]==null?{}:{payroll_runs:completionsByInput[index]}),...(maintainedCensus[index]==null?{}:{input_census:Schema.decodeUnknownSync(Schema.Json)(maintainedCensus[index])}),...(protectedOriginals[index]==null?{}:{input_originals:Schema.decodeUnknownSync(Schema.Json)(protectedOriginals[index])})};
 }
 return result;
});

c.project((row, ctx) => projectNativeInputs('entities', row, ctx));

/** Append-only source production advances a genuinely complete native ledger without inventing old migration evidence. */
function advanceNativeBankCensus(owner:Readonly<Record<string,unknown>>,after:unknown,families:readonly string[]):unknown[] {
 const censuses=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(owner.input_census);
 const before=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(owner.facts),next=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(after);
 for(const family of families)if(censuses.filter(value=>value.source_kind===family).length!==1)refuse('A native source write cannot fabricate missing or duplicate completeness certificates.');
 return censuses.map(census=>{
  if(!Predicate.isString(census.source_kind)||!families.includes(census.source_kind))return census;
  const family=census.source_kind,old=before[family],bank=next[family];
  if(census.complete!==true||census.key!=='input:/'+family||stableJson(census.owner)!==stableJson({collection:'entities',id:owner.id})||stableJson(census.schema)!==stableJson(owner.input_schema_snapshot)||!Array.isArray(census.source_record_ids)||!Array.isArray(old)||!Array.isArray(bank))refuse('Native source append requires the exact actual owner, schema and complete previous family census.');
  const rows=(values:readonly unknown[])=>values.map(value=>{const row=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(value);if(!Predicate.isString(row.id)||!row.id.trim())refuse('Native bank census contains only actual admitted row identities.');return row;});
  const previous=rows(old),current=rows(bank),ids=previous.map(row=>row.id);
  if(new Set(ids).size!==ids.length||stableJson([...ids].sort())!==stableJson([...census.source_record_ids].sort())||new Set(current.map(row=>row.id)).size!==current.length||previous.some(row=>current.filter(value=>value.id===row.id&&stableJson(value)===stableJson(row)).length!==1))refuse('Source append cannot omit, replace or duplicate an original certified native record.');
  const migration_source=census.migration_source??((Object.hasOwn(census,'source_table_hash')||Object.hasOwn(census,'source_table_count'))?{source_table_hash:census.source_table_hash??null,source_table_count:census.source_table_count??null,source_record_ids:census.source_record_ids}:undefined);
  const {source_table_hash:_oldHash,source_table_count:_oldCount,...retained}=census;
  return {...retained,...(migration_source==null?{}:{migration_source}),source_record_ids:current.map(row=>row.id),native_appended_record_ids:[...(Array.isArray(census.native_appended_record_ids)?census.native_appended_record_ids:[]),...current.filter(row=>!ids.includes(row.id)).map(row=>row.id)]};
 });
}


function releaseNativeBankCensus(owner:Readonly<Record<string,unknown>>,after:unknown,family:string,ids:readonly string[]):unknown[]{
 const censuses=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(owner.input_census);
 const before=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(owner.facts),next=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(after);
 const matches=censuses.filter(census=>census.source_kind===family);if(matches.length!==1)refuse('Source release cannot invent a native completeness certificate.');
 const census=matches[0]!,old=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(before[family]),current=Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(next[family]);
 if(census.complete!==true||census.key!=='input:/'+family||stableJson(census.owner)!==stableJson({collection:'entities',id:owner.id})||stableJson(census.schema)!==stableJson(owner.input_schema_snapshot)||!Array.isArray(census.source_record_ids)||stableJson(old.map(row=>row.id).sort())!==stableJson([...census.source_record_ids].sort())||old.some(row=>!ids.includes(String(row.id))&&current.filter(value=>stableJson(value)===stableJson(row)).length!==1)||current.some(row=>!old.some(value=>stableJson(value)===stableJson(row)))||ids.some(id=>current.some(row=>row.id===id)))refuse('Source release retains exact previous provenance and removes only its independently qualified unpaid rows.');
 return censuses.map(value=>value!==census?value:{...value,migration_source:value.migration_source??{source_table_hash:value.source_table_hash??null,source_table_count:value.source_table_count??null,source_record_ids:value.source_record_ids},source_record_ids:current.map(row=>row.id),source_release:{removed_ids:[...ids],original_ids:old.map(row=>row.id)}});
}
