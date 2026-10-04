import { collection } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { versionsById, refuseUnlessDraftOnBoth } from '../../../lib/payroll_engine/catalogues/settings-seal.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { validateCatalogueDraft,validateCatalogueIntrinsicPolicies } from '../../../lib/payroll_engine/catalogues/authoring.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
const columns = ['entry_schema', 'pricing', 'code', 'distribution_worker_fraction', 'distribution_equal_fraction', 'distribution_member_facts', 'distribution_calendar_month', 'debt_fine_start_day', 'debt_fine_initial_end_day', 'debt_fine_initial_rate', 'debt_fine_later_rate', 'debt_fine_cap_fraction', 'debt_fine_automatic_max_days', 'earnings_pool_kind', 'name', 'authority', 'destination', 'direction', 'bands', 'eligibility', 'qualifies_when', 'evidence', 'request_requirements', 'request_facts', 'source_award_policy', 'assessed_for', 'assessment_ceiling', 'counts_toward', 'reduces_unpaid_salary', 'raised_by', 'schedule'] as const;
const c = collection('adhoc_catalogue', { read: { fields: 'all' },  create: { input: { columns: ['settings_id', ...columns] } }, update: { input: { columns } }, delete: { transform: true } });
export default c;
c.transform(async (inputs,ctx)=>{
 const rows=inputs.map(input=>plain(input));
 const stored=ctx.existing.map(value=>value==null?undefined:plain(value));
 for(const [index,row] of rows.entries())if(!('$delete' in row))validateCatalogueIntrinsicPolicies('adhoc_catalogue',{...stored[index],...row});
 const ids=[...new Set(rows.flatMap((row,index)=>['settings_id' in row?row.settings_id:undefined,stored[index]?.settings_id]).filter(id=>id!=null&&id!==''))];
 const versions=await versionsById(ctx.db,ids);
 const parents=await readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{in:ids}});
 for(const [index,row] of rows.entries()){
  const before=stored[index],deleting='$delete' in row,next={...before,...row};
  refuseUnlessDraftOnBoth(versions,before?.settings_id,deleting?undefined:row.settings_id,'adhoc_catalogue');
  if(deleting)continue;
  if(next.settings_id==null)continue; // Nested children are validated by the actual root transform.
  const parent=parents.find(value=>value.id===next.settings_id);if(!parent)refuse('Catalogue authoring requires its actual owning jurisdiction.');
  await validateCatalogueDraft('adhoc_catalogue',next,parent);
 }
 return inputs;
});
