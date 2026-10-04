<script lang="ts">
 import { bolt } from '$bolt';
 import type { FileRef, Id } from '@norbital-ai/bolt';
 import { Schema } from 'effect';
 import { PlainDate } from '@norbital-ai/std/date';
 import * as Predicate from 'effect/Predicate';
 import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
 import { Table, EmptyState } from '@norbital-ai/ui';
 import CompanyScope from '../../../lib/ui/scopes/CompanyScope.svelte';
 import { companyScope } from '../../../lib/ui/scopes/company-scope.svelte.js';
 import {liveRows} from '../../../lib/ui/state/live.svelte.js';
 import {collectNativePayslipPages} from '../../../lib/payroll_engine/services.js';
 import {getErrorMessage} from '../../../lib/payroll_engine/foundation.js';
   const exportedArtifacts=Schema.Struct({artefacts:Schema.Array(Schema.Struct({files:Schema.Array(Schema.Struct({id:Schema.NonEmptyString,name:Schema.NonEmptyString}))}))});
  const scope = companyScope();
 const runs=liveRows(()=>scope.id==null?null:bolt.read('payroll_run',{where:{company_id:{eq:scope.id},approval_id:{isNull:true}},select:{id:true,period:true},orderBy:{period:'desc'},all:true}));
 let runId=$state<Id<'payroll_run'>|''>(''),filingCode=$state(''),exporting=$state(false),exportError=$state('');
 let signerName=$state(''),signerDesignation=$state(''),signerContact=$state(''),signerDate=$state(''),submission=$state<'ORIGINAL'|'AMENDMENT'|'REVISION'>('ORIGINAL');
 let submittedAmounts=$state<{id_number:string;item:string;amount:number}[]>([]);
 async function exportSaved(kind:'PAYROLL'|'CATALOGUE'|'FILING'|'PAYSLIPS'|'BANK'|'INCOME'){
  const selectedRunId=runId;
  if(selectedRunId===''||!(runs.current??[]).some(run=>run.id===selectedRunId))return;
  exporting=true;exportError='';
  try{
   if(kind==='FILING'||kind==='INCOME'){
    const submitted: {id_number:string;item:string;amount:number}[]=kind==='INCOME'&&submission!=='ORIGINAL'?submittedAmounts:[];
    if(!Array.isArray(submitted)||submitted.some(row=>row==null||!Predicate.isString(row.id_number)||!Predicate.isString(row.item)||!Predicate.isNumber(row.amount)||!Number.isFinite(row.amount)))throw new Error('Submitted amounts require an array of identity number, declared item and finite amount records.');
    const result=await bolt.start('payroll_export',kind==='FILING'?{ids:[selectedRunId],kind:'returns',codes:[filingCode]}:{ids:[selectedRunId],kind:'income-tax-returns',authorised_person:{name:signerName,designation:signerDesignation,contact:signerContact,date:PlainDate(signerDate)},submission,submitted});
    if(result.kind!=='committed')throw new Error('message' in result?String(result.message):'The export requires approval.');
    const output=Schema.decodeUnknownSync(exportedArtifacts)(result.output);
    for(const file of output.artefacts.flatMap(artefact=>artefact.files)){const anchor=document.createElement('a');anchor.href=bolt.fileUrl(file as FileRef);anchor.download=file.name;anchor.click();}
   }else{
    const requested=kind==='BANK'?'bank-files':kind==='PAYSLIPS'?'payslip-pdfs':kind==='PAYROLL'?'payroll-report-xlsx':'catalogue-entries-xlsx';
    const fetchPage=async(payslip_offset:number)=>{
     const result=await bolt.start('payroll_export',{ids:[selectedRunId],kind:requested,payslip_offset});
     if(result.kind!=='committed')throw new Error('message' in result?String(result.message):'The export requires approval.');
     return result.output;
    };
    const files=kind==='PAYSLIPS'?await collectNativePayslipPages(fetchPage):Schema.decodeUnknownSync(exportedArtifacts)(await fetchPage(0)).artefacts.flatMap(artefact=>artefact.files);
    if(kind==='CATALOGUE'&&files.length===0)throw new Error('The selected run has no settled catalogue entries.');
    for(const file of files){const anchor=document.createElement('a');anchor.href=bolt.fileUrl(file as FileRef);anchor.download=file.name;anchor.click();}
   }
  }catch(error){exportError=getErrorMessage(error);}finally{exporting=false;}
 }
</script>

<AppShell icon="lucide:receipt" title={bolt.t('app.payroll.runs_title')} description={bolt.t('app.payroll.configured_description')}>
 {#snippet actions()}<CompanyScope {scope} />{/snippet}
 {#if scope.id == null}
  <EmptyState title={bolt.t('app.payroll.empty_runs')} />
 {:else}
  <Stack gap="md">
   <Cluster align="end" gap="md">
    <label>Saved run<select bind:value={runId}><option value="">Select a run</option>{#each runs.current??[] as run(run.id)}<option value={run.id}>{run.period}</option>{/each}</select></label>
    <button type="button" disabled={!runId||exporting} onclick={()=>exportSaved('BANK')}>Bank file</button>
    <button type="button" disabled={!runId||exporting} onclick={()=>exportSaved('PAYROLL')}>Payroll workbook</button>
    <button type="button" disabled={!runId||exporting} onclick={()=>exportSaved('CATALOGUE')}>Catalogue workbook</button>
    <button type="button" disabled={!runId||exporting} onclick={()=>exportSaved('PAYSLIPS')}>Payslip PDFs</button>
    <label>Declared export code<input bind:value={filingCode}/></label>
    <button type="button" disabled={!runId||!filingCode.trim()||exporting} onclick={()=>exportSaved('FILING')}>Export file</button>
   </Cluster>
   <details><summary>Income tax returns</summary>
    <Cluster align="end" gap="md">
     <label>Authorised person<input bind:value={signerName}/></label>
     <label>Designation<input bind:value={signerDesignation}/></label>
     <label>Contact<input bind:value={signerContact}/></label>
     <label>Signature date<input type="date" bind:value={signerDate}/></label>
     <label>Submission<select bind:value={submission}><option value="ORIGINAL">Original</option><option value="AMENDMENT">Amendment</option><option value="REVISION">Revision</option></select></label>
     {#if submission!=='ORIGINAL'}
      {#each submittedAmounts as row,index}<Cluster align="end" gap="sm"><label>Identity number<input bind:value={row.id_number}/></label><label>Declared return item<input bind:value={row.item}/></label><label>Previously submitted amount<input type="number" step="any" bind:value={row.amount}/></label><button type="button" onclick={()=>submittedAmounts=submittedAmounts.filter((_,at)=>at!==index)}>Remove amount</button></Cluster>{/each}
      <button type="button" onclick={()=>submittedAmounts=[...submittedAmounts,{id_number:'',item:'',amount:0}]}>Add submitted amount</button>
     {/if}
     <button type="button" disabled={!runId||exporting||!signerName.trim()||!signerDesignation.trim()||!signerContact.trim()||!signerDate} onclick={()=>exportSaved('INCOME')}>Export income tax returns</button>
    </Cluster>
   </details>
   {#if exportError}<p role="alert">{exportError}</p>{/if}
   <Table of="payroll_runs" key="payroll_runs" where={{company_id: {eq: scope.id}}}
         orderBy={{period:'desc'}}
    toolbar={{title:bolt.t('app.payroll.runs_title')}}
    columns={['period','kind','sequence','calculation_state','pay_date','attendance_from','attendance_to']}
    actions={[{action:'payroll_runs.calculate',label:bolt.t('app.payroll.calculate_configured') }]} />
   <Table of="payslips" key="payslips" where={{payroll_run_id:{is:{company_id:{eq:scope.id}}}}}
    toolbar={{title:bolt.t('app.payroll.payslips_title')}}
    columns={['payroll_run_id','employment_id','status','currency','gross','total_deductions','net']} />
  </Stack>
 {/if}
</AppShell>
