import { collection } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { versionsById, refuseUnlessDraftOnBoth } from '../../../lib/payroll_engine/catalogues/settings-seal.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { validateCatalogueDraft,validateCatalogueIntrinsicPolicies } from '../../../lib/payroll_engine/catalogues/authoring.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
const columns = ['entry_schema', 'pricing', 'code', 'preceding_leave_code', 'preceding_leave_same_event', 'preceding_leave_contiguous', 'name', 'description', 'authority', 'eligibility', 'evidence', 'is_npl', 'requires_no_pay_origin', 'pay_fraction', 'episode_start', 'time_off_amount', 'payment_component_when', 'payment_release_when', 'payment_instruction_facts', 'payment_release_facts', 'payment_suspend_when', 'payment_component_amount', 'payment_component_monthly_when', 'payment_deduction_reference', 'payment_deduction_policy', 'time_off_rate_required_when', 'time_off_rate_basis', 'time_off_basis_when', 'time_off_retained_basis', 'time_off_unit', 'paid_by', 'consumes_code', 'unit', 'can_encash', 'encash_on_exit', 'evidence_after_days', 'entitlement', 'event_facts', 'schedule'] as const;
const c = collection('leave_catalogue', { read: { fields: 'all' },  create: { input: { columns: ['settings_id', ...columns] } }, update: { input: { columns } }, delete: { transform: true } });
export default c;
c.transform(async (inputs,ctx)=>{
 const rows=inputs.map(input=>plain(input));
 const stored=ctx.existing.map(value=>value==null?undefined:plain(value));
 for(const [index,row]of rows.entries())if(!('$delete' in row))validateCatalogueIntrinsicPolicies('leave_catalogue',{...stored[index],...row});
 const ids=[...new Set(rows.flatMap((row,index)=>['settings_id' in row?row.settings_id:undefined,stored[index]?.settings_id]).filter(id=>id!=null&&id!==''))];
 const versions=await versionsById(ctx.db,ids);
 const parents=await readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{in:ids}});
 for(const [index,row] of rows.entries()){
  const before=stored[index],deleting='$delete' in row,next={...before,...row};
  refuseUnlessDraftOnBoth(versions,before?.settings_id,deleting?undefined:row.settings_id,'leave_catalogue');
  if(deleting)continue;
  if(next.settings_id==null)continue; // Nested children are validated by the actual root transform.
  const parent=parents.find(value=>value.id===next.settings_id);if(!parent)refuse('Catalogue authoring requires its actual owning jurisdiction.');
  await validateCatalogueDraft('leave_catalogue',next,parent);
 }
 return inputs;
});
