import {automation,type Id} from '@norbital-ai/bolt';
import {Schema} from 'effect';
import {readAll} from '../lib/payroll_engine/foundation/reads.js';
import {captureNativeCalendarObligations} from '../lib/payroll_engine/catalogues/obligations.js';
import {evaluateConfiguredProgramFrame} from '../lib/payroll_engine/execution/configured-program.js';
import {resolveBehaviourProgram} from '../lib/payroll_engine/execution/behaviours.js';
import {calendarDay,calendarDateInTimeZone,isCalendarDate} from '../lib/payroll_engine/foundation/time.js';
import {getErrorMessage,refuse} from '../lib/payroll_engine/foundation/primitives.js';
import {configuredDutyPayload} from './utils/duty-payload.js';

/** One scheduled catalog dispatcher, retaining the original calendar automation authority. */
const catalog_sweep=automation({description:'Catch up actual calendar occurrences and dispatch the admitted catalog duty configurations under their original automation authority. Existing original occurrence keys are retained; no declared duty is fulfilled, waived or deleted.',on:{cron:'30 1 * * *'},runAs:['obligation_calendar_automation'],concurrency:{max:1},output:{kind:'json'}});
export default catalog_sweep;
catalog_sweep.run(async(_input,ctx)=>{
 const entities=await readAll<{id:Id<'entities'>;name?:unknown;settings_code:string;effective_range?:{from?:string|null;to?:unknown}|null}>(ctx,'entities',{approval_id:{isNull:true}},undefined,{id:true,name:true,settings_code:true,effective_range:true});
 const failures:string[]=[];let raised=0;
 for(const entity of entities){
  try{
   const versions=await readAll<{id:Id<'jurisdiction_settings'>;effective_range:{from:string;to?:string|null};payroll?:{timezone?:string}|null;behaviours?:unknown}>(ctx,'jurisdiction_settings',{code:{eq:entity.settings_code},sealed_at:{lte:String(ctx.now)},voided_at:{isNull:true},approval_id:{isNull:true}},1,undefined);
   const first=versions.map(row=>row.effective_range?.from).filter(isCalendarDate).sort()[0];
   if(first==null)continue;
   const opened=entity.effective_range?.from;
   if(opened!=null&&!isCalendarDate(opened))refuse('A catalog sweep retains the actual native legal-entity opening date.');
   const from=opened!=null&&opened>first?opened:first;
   const latest=versions.filter(row=>Schema.is(Schema.NonEmptyString)(row.payroll?.timezone)).sort((left,right)=>left.effective_range.from.localeCompare(right.effective_range.from)).at(-1);
   const timezone=latest?.payroll?.timezone;
   if(latest==null||timezone==null)refuse('Scheduled catalog occurrences require their actual payroll timezone.');
   const through=calendarDateInTimeZone(new Date(String(ctx.now)),timezone);
   if(from>through)continue;
   const program=await resolveBehaviourProgram(latest.behaviours,'calendar_duty_occurrences_program',ctx);
   const openingVersion=versions.filter(row=>row.effective_range.from<=from&&(row.effective_range.to==null||row.effective_range.to>=from));
   if(openingVersion.length!==1)refuse('A company opening requires its actual original sealed governing version.');
   const [openingSetting]=openingVersion;
   const openingTimezone=openingSetting?.payroll?.timezone;
   if(openingSetting==null||openingTimezone==null)refuse('A company opening requires its actual original payroll timezone.');
   const opening=await captureNativeCalendarObligations(ctx,{entity_id:String(entity.id),date:from,every:'YEAR',event_kind:'COMPANY_OPENED',observation:{observedAt:String(ctx.now),timezone:openingTimezone}});
   if(opening.obligations.length){await ctx.act('obligations.create',opening.obligations.map(row=>configuredDutyPayload(entity.id,openingSetting.id,row)));raised+=opening.obligations.length;}
   const population=await readAll<{id:Id<'employee_profiles'>;effective_range:{from:string;to?:string|null}}>(ctx,'employee_profiles',{company_id:{eq:entity.id},approval_id:{isNull:true}},undefined,{id:true,company_id:true,effective_range:true});
   for(const every of ['MONTH','QUARTER','YEAR'] as const){
    for(const raw of evaluateConfiguredProgramFrame(program,{every,from,through}).output){
     const occurrence=Schema.decodeUnknownSync(Schema.Struct({date:calendarDay,start:calendarDay,end:calendarDay}))(raw);
     const original=versions.filter(row=>row.effective_range.from<=occurrence.date&&(row.effective_range.to==null||row.effective_range.to>=occurrence.date));
     if(original.length!==1)refuse('A calendar occurrence requires its unambiguous actual historical governing version.');
     const [originalSetting]=original;
     const originalTimezone=originalSetting?.payroll?.timezone;
     if(originalSetting==null||originalTimezone==null)refuse('A calendar occurrence requires its actual original governing timezone.');
     const observation={observedAt:String(ctx.now),timezone:originalTimezone};
     const subjects=[undefined,...population.filter(row=>row.effective_range.from<=occurrence.end&&(row.effective_range.to==null||row.effective_range.to>=occurrence.start)).map(row=>String(row.id))];
     for(const profile_id of subjects){
      const captured=await captureNativeCalendarObligations(ctx,{entity_id:String(entity.id),date:String(occurrence.date),every,...(profile_id==null?{}:{profile_id}),observation});
      if(captured.obligations.length){await ctx.act('obligations.create',captured.obligations.map(row=>configuredDutyPayload(entity.id,originalSetting.id,row)));raised+=captured.obligations.length;}
     }
    }
   }
  }catch(error){failures.push(String(entity.name??entity.id)+': '+getErrorMessage(error));}
 }
 return {raised,failures};
});
