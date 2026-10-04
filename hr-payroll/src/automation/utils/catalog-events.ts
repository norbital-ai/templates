import { type AutomationCtx, type Id } from '@norbital-ai/bolt';
import { PlainDate, parseInstant } from '@norbital-ai/std/date';
import { plainRows } from '../../lib/payroll_engine/foundation/primitives.js';
import { prepareNativeCatalogSourceEvent, type CatalogEffectSource } from '../../lib/payroll_engine/execution/behaviours.js';
import { calendarDateInTimeZone } from '../../lib/payroll_engine/foundation/time.js';
import { refuse } from '../../lib/payroll_engine/foundation/primitives.js';
import * as Predicate from 'effect/Predicate';

/** Shared native catalog dispatcher; operations remain in the sealed configuration. */
export type CatalogKind = 'LEAVE'|'CLAIM'|'LOAN'|'ADHOC';
export async function runCatalogEvents(catalog: CatalogKind, input: { readonly ids: readonly string[] }, ctx: AutomationCtx<{ runAs: 'trigger' }>): Promise<void> {
 for (const sourceId of input.ids) {
  let request: CatalogEffectSource | undefined;
  const profileRequests: CatalogEffectSource[] = [];
  const entries = plainRows<{ id: string; revision: number; catalog: string }>(await ctx.read('catalogue_entries', {
   where: { id: { eq: sourceId as Id<'catalogue_entries'> }, approval_id: { isNull: true } }, select: { id: true, revision: true, catalog: true }, limit: 1
  }));
  const entry = entries[0];
  if (entry != null) {
   if (entry.id !== sourceId) refuse('A catalog automation retains its actual source identity.');
   if (entry.catalog !== catalog) continue;
   request = { source_collection: 'catalogue_entries', source_id: entry.id, source_revision: entry.revision, event_kind: 'ENTRY_ACCEPTED', catalog: catalog };
  } else {
   const profiles = plainRows<{ id: string; revision: number; effective_range: { from: string; to: string | null } }>(await ctx.read('employee_profiles', {
    where: { id: { eq: sourceId as Id<'employee_profiles'> }, approval_id: { isNull: true } }, select: { id: true, revision: true, effective_range: true }, limit: 1
   }));
   const profile = profiles[0];
   if (profile != null) {
    if (profile.id !== sourceId) refuse('A catalog lifecycle automation retains its actual profile identity.');
    request = { source_collection: 'employee_profiles', source_id: profile.id, source_revision: profile.revision, event_kind: profile.effective_range.to == null ? 'HIRE' : 'EXIT', catalog: catalog };
   } else {
    const runs = plainRows<{ id: string; revision: number; calculation_state: string; company_id: string; salary_from: string; salary_to: string }>(await ctx.read('payroll_runs', {
     where: { id: { eq: sourceId as Id<'payroll_runs'> }, approval_id: { isNull: true }, calculation_state: { eq: 'CALCULATED' } }, select: { id: true, revision: true, calculation_state: true, company_id: true, salary_from: true, salary_to: true }, limit: 1
    }));
    const run = runs[0];
    if (run == null) {
     const owners=plainRows<{id:string;revision:number;input_originals?:unknown}>(await ctx.read('entities',{where:{id:{eq:sourceId as Id<'entities'>},approval_id:{isNull:true}},select:{id:true,revision:true,input_originals:true},limit:1}));
     const owner=owners[0];if(owner==null)continue;
     if(owner.id!==sourceId||!Array.isArray(owner.input_originals))refuse('Catalog bank lifecycle dispatch retains its actual admitted owner and protected source events.');
     for(const value of owner.input_originals){if(!Predicate.isObject(value))continue;const event=value.source_event;if(!Predicate.isObject(event))continue;if(event.catalog!==catalog)continue;if(event.kind!=='CASE_EVENT'||!Predicate.isString(value.source_kind)||!Predicate.isString(value.id))refuse('A bank lifecycle occurrence retains its exact configured family, kind and admitted original identity.');profileRequests.push({source_collection:'entities',source_id:owner.id,source_family:value.source_kind,source_record_id:value.id,event_kind:'CASE_EVENT',catalog});}
    } else {

    if (run.id !== sourceId || run.calculation_state !== 'CALCULATED') refuse('A catalog lifecycle automation requires its actual completed run.');
    request = { source_collection: 'payroll_runs', source_id: run.id, source_revision: run.revision, event_kind: 'RUN_FINALISED', catalog: catalog };
    const population = plainRows<{ id: string; company_id: string; effective_range: { from: string; to: string | null } }>(await ctx.read('employee_profiles', {
     where: { company_id: { eq: run.company_id as Id<'entities'> }, approval_id: { isNull: true }, effective_range: { overlaps: { from: PlainDate(run.salary_from), to: PlainDate(run.salary_to) } } },
     select: { id: true, company_id: true, effective_range: true }, all: true
    }));
    for (const member of population) {
     if (member.company_id !== run.company_id || member.effective_range.from > run.salary_to || (member.effective_range.to != null && member.effective_range.to < run.salary_from)) refuse('A catalog run lifecycle retains its actual salary-period population.');
     profileRequests.push({ ...request, profile_id: member.id });
    }
    }
   }
  }
  for (const occurrence of [...(request==null?[]:[request]), ...profileRequests]) {
  const options = await prepareNativeCatalogSourceEvent(ctx, occurrence, String(ctx.now));
  const day = options.day;
  if (day == null) refuse('A lifecycle event requires its actual governing calendar day.');
  if (day > calendarDateInTimeZone(new Date(String(ctx.now)), options.observation.timezone)) {
   // A future service boundary cannot cause side effects before its actual day.
   const at = parseInstant(`${day} 00:00:00`, options.observation.timezone);
   if (at == null) refuse('A deferred lifecycle event requires its actual jurisdiction calendar instant.');
   await ctx.schedule('catalog_deferred', { catalog, ids: [sourceId] }, { at, key: options.event.id });
   continue;
  }
  await ctx.act('catalogue_entries.execute_event', {
   catalog: catalog, source_collection: occurrence.source_collection, source_id: occurrence.source_id, ...(occurrence.source_revision==null?{}:{source_revision:occurrence.source_revision}),
   ...(occurrence.source_family==null?{}:{source_family:occurrence.source_family}),...(occurrence.source_record_id==null?{}:{source_record_id:occurrence.source_record_id}),
   ...(options.event.subject.collection === 'employee_profiles' ? { profile_id: options.event.subject.id as Id<'employee_profiles'> } : { entity_id: options.event.subject.id as Id<'entities'> }),
   snapshot_id: options.snapshot_id as Id<'jurisdiction_settings'>, configuration_hash: options.configuration_hash, original_event_hash: String(options.event.data.original_event_hash),
   event_kind: options.event.kind, day: PlainDate(day)
  }, { once: `catalog:${occurrence.catalog}:${options.event.id}` });
  }
 }
}
