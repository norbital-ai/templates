import {automation,type Id} from '@norbital-ai/bolt';
import {captureNativeScheduledOccurrences,captureNativeScheduledFulfillments} from '../lib/configured-scheduled-occurrences.js';
import {readAll,memoizedReads} from '../lib/payroll_engine/foundation/reads.js';
import {getErrorMessage,refuse} from '../lib/payroll_engine/foundation/primitives.js';
import * as Predicate from 'effect/Predicate';
import {configuredDutyPayload} from './utils/duty-payload.js';
const scheduled_entries=automation({description:'Raise each mandatory scheduled payment once from its genuine catalogue schedule and record the legal occurrence. Existing manual or consumed entries are recorded without another request.',on:{cron:'0 4 * * *'},input:{company_id:{kind:'id',of:'entities',optional:true}},output:{kind:'json'},runAs:['scheduled_entries_automation'],concurrency:{max:1}});
export default scheduled_entries;
scheduled_entries.run(async(input,ctx)=>{
 const reads=memoizedReads(ctx),entities=await readAll<{id:Id<'entities'>;settings_code:string}>(reads,'entities',{approval_id:{isNull:true},...(input.company_id==null?{}:{id:{eq:input.company_id}})}),raised=[],failures=[];
 for(const entity of entities){
  const versions=await readAll<{id:Id<'jurisdiction_settings'>;payroll?:{timezone?:string}|null}>(reads,'jurisdiction_settings',{code:{eq:entity.settings_code},approval_id:{isNull:true},voided_at:{isNull:true},sealed_at:{lte:String(ctx.now)}});
  const zones=[...new Set(versions.map(row=>row.payroll?.timezone).filter(value=>Predicate.isString(value)))];
  if(zones.length!==1)refuse('A scheduled employer sweep requires its actual original calendar timezone.');
  const [zone]=zones;
  if(zone===undefined)refuse('A scheduled employer sweep requires its actual original calendar timezone.');
  const today=String(ctx.todayIn(zone));
  const profiles=await readAll<{id:string}>(reads,'employee_profiles',{company_id:{eq:entity.id},approval_id:{isNull:true}});
  for(const profile of profiles){
   try{const captured=await captureNativeScheduledOccurrences(reads,{profile_id:profile.id,date:today,observation:{observedAt:String(ctx.now),timezone:zone}});
    for(const occurrence of captured.occurrences){const basis={operation:'SCHEDULED_OCCURRENCE',profile_id:profile.id,catalogue_id:occurrence.catalogue.id,due:occurrence.occurrence.due,raised_on:today};
     if(occurrence.entry!=null)await ctx.act('catalogue_entries.create',{...occurrence.entry,source_basis:basis});
     const raw=occurrence.obligation;
     if(!Predicate.isObject(raw)||!Predicate.isString(raw.settings_id))refuse('A scheduled duty retains its actual governing snapshot.');
     const settings_id=versions.find(version=>version.id===raw.settings_id)?.id;
     if(settings_id===undefined)refuse('A scheduled duty retains its actual original governing version.');
     await ctx.act('obligations.create',configuredDutyPayload(entity.id,settings_id,raw,basis));raised.push({profile_id:profile.id,code:occurrence.catalogue.code,due:occurrence.occurrence.due,request:occurrence.entry!=null});
    }
   }catch(error){failures.push({profile_id:profile.id,message:getErrorMessage(error)});}
  }
 }
 for(const entity of entities){const updates=await captureNativeScheduledFulfillments(ctx,{entity_id:entity.id});for(const update of updates)await ctx.act('obligations.update',{target:update.target,set:update.set});}
 return {raised,failures};
});
