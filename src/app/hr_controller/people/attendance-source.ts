import {captureNativeScheduleCalendar} from '../../../lib/schedule-calendar-source.js';
import {captureNativeAttendanceLocks} from '../../../lib/attendance-lock-source.js';
import {readAll,memoizedReads,type Reads} from '../../../lib/payroll_engine/foundation/reads.js';
import {settingsInForce} from '../../../lib/payroll_engine/admission/schema-version.js';
import {decodeNumber,stableJson} from '../../../lib/payroll_engine/foundation/primitives.js';
import {refuse} from '../../../lib/payroll_engine/foundation/primitives.js';
import {isOffsetIsoInstant,calendarDateInTimeZone} from '../../../lib/payroll_engine/foundation/time.js';
import {indexWorkDaysByPersonDay,assessAttendanceDraft,type AttendanceInterval} from './attendance-state.js';
import * as Predicate from 'effect/Predicate';
type Row=Record<string,unknown>;
const object=(value:unknown):Row=>{if(!Predicate.isObject(value))refuse('Attendance requires its actual qualified source record.');return value as Row;};
const period=(value:unknown)=>{const row=object(value);return {from:String(row.from),to:row.to==null?null:String(row.to)};};
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');

/** The stored nonfinancial calendar supplies both plans and observed holidays; native clocks remain distinct. */
export async function captureAttendanceMonth(reads:Reads,options:{profile_id:string;month:string;observed_at:string}){
 if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(options.month)||!isOffsetIsoInstant(options.observed_at))refuse('Attendance requires an actual month and server observation.');
 const cached=memoizedReads(reads),profiles=await readAll<Row>(cached,'employee_profiles',{id:{eq:options.profile_id},approval_id:{isNull:true}},undefined,{id:true,company_id:true,effective_range:true},1);
 if(profiles.length!==1)refuse('Attendance requires its actual approved caller-readable profile.');
 const profile=profiles[0]!,range=period(profile.effective_range),start=`${options.month}-01`,last=new Date(`${start}T00:00:00Z`);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);const end=last.toISOString().slice(0,10);
 const from=range.from>start?range.from:start,to=range.to!=null&&range.to<end?range.to:end;
 if(from>to)return {cells:[],observed_day:null};
 const entities=await readAll<Row>(cached,'entities',{id:{eq:profile.company_id},approval_id:{isNull:true}},undefined,{id:true,settings_code:true},1);
 if(entities.length!==1)refuse('Attendance requires its actual approved employer.');
 const versions=await readAll<Row&{id:string;code:string;effective_range:unknown}>(cached,'jurisdiction_settings',{code:{eq:entities[0]!.settings_code},approval_id:{isNull:true},voided_at:{isNull:true},sealed_at:{isNull:false,lte:options.observed_at}},undefined,{id:true,code:true,effective_range:true,sealed_at:true,approval_id:true,voided_at:true,payroll:true,behaviours:true});
 const first=settingsInForce(versions,String(entities[0]!.settings_code),from);if(!first)refuse('Attendance requires its actual sealed dated jurisdiction.');
 const timezone=String(object(first.payroll).timezone),observation={observedAt:options.observed_at,timezone};
 const actual=await readAll<Row>(cached,'roster_entries',{employment_id:{eq:profile.id},work_date:{gte:start,lte:end}},undefined,{id:true,employment_id:true,work_date:true,shift_definition_id:true,worked_intervals:true,approved_overtime_hours:true,incentive_hours:true,payslip_id:true,approval_id:true});
 const indexed=indexWorkDaysByPersonDay(actual as never,timezone),locks=await captureNativeAttendanceLocks(cached,{profile_id:options.profile_id,from:start,to:end,observation}),cells:(Row&{date:string})[]=[],captures=[];
 for(const version of versions){
  const span=period(version.effective_range),lower=span.from>from?span.from:from,upper=span.to!=null&&span.to<to?span.to:to;if(lower>upper)continue;
  const zone=String(object(version.payroll).timezone),calendar=await captureNativeScheduleCalendar(cached,{profile_id:options.profile_id,settings_id:version.id,from:lower,to:upper,observation:{observedAt:options.observed_at,timezone:zone}}),configurationHash=await hash(version.behaviours);
  captures.push({window:calendar.window,rule_source:calendar.source.rule,program:calendar.program,outputs:calendar.days});
  for(const raw of calendar.days){
   const day=object(raw),date=String(day.date),frame=calendar.source.frames.find(frame=>frame.date===date);if(!frame||cells.some(cell=>cell.date===date))refuse('Attendance requires one actual dated calendar frame per day.');
   const row=indexed.get(`${profile.id}:${date}`) as Row|undefined,baseline=frame.baseline==null?null:object(frame.baseline),facts=object(frame.source.assignment.entity.value);
   if(!Array.isArray(facts.shift_definitions))refuse('Attendance requires actual owned shift choices.');
   const choices=facts.shift_definitions.map(object).filter(shift=>{const span=period(shift.effective_range);return shift.company_id===profile.company_id&&span.from<=date&&(span.to==null||span.to>=date);});
   const assignments=row?.shift_definition_id==null?[]:choices.filter(shift=>shift.id===row.shift_definition_id);if(assignments.length>1||row?.shift_definition_id!=null&&assignments.length!==1)refuse('Attendance assignment requires one actual owned dated shift.');
   const assignment=assignments[0],shape=assignment==null?baseline:({...object(assignment.variant),id:assignment.id,code:assignment.code}),designation=shape?.kind??null;
   const intervals=row?.worked_intervals==null?null:row.worked_intervals as AttendanceInterval[],measured=intervals==null?null:assessAttendanceDraft(intervals,shape?.break_minutes==null?null:decodeNumber(shape.break_minutes)),open=intervals?.some(interval=>interval.end==null)??false;
   const holiday=day.observed_holiday==null?null:object(day.observed_holiday),sourceLock=locks.locks.get(`${profile.id}:${date}`)??{kind:'NONE'},slip=row?.payslip_id==null?null:locks.sources.slips.find(slip=>slip.id===row.payslip_id);
   if(row?.payslip_id!=null&&!slip)refuse('Consumed attendance requires its actual caller-readable payslip.');
   const rung=row?.approval_id!=null?'PENDING':sourceLock.kind==='SETTLED'||slip?.status==='PAID'?'PAID':slip?'CONSUMED':sourceLock.kind==='IN_WINDOW'?'IN_DRAFT_RUN':'OPEN';
   cells.push({employmentId:profile.id,date,workDayId:row?.id??null,base:baseline==null?null:{code:baseline.code,kind:baseline.kind,patternCode:baseline.patternCode??null},override:assignment==null?null:{code:assignment.code,kind:designation},effective:assignment!=null?'OVERRIDE':baseline!=null?'BASE':'NONE',designation,shiftCode:shape?.code??null,shiftStart:shape?.start_time??null,shiftEnd:shape?.end_time??null,shiftBreakMinutes:shape?.break_minutes??null,approvedOvertimeHours:row?.approved_overtime_hours==null?null:decodeNumber(row.approved_overtime_hours),incentiveHours:row?.incentive_hours==null?null:decodeNumber(row.incentive_hours),plannedOT:designation==='WORK'&&baseline?.kind!=='WORK',attendanceState:intervals==null?null:open?'OPEN':'CLOSED',breakMinutes:measured?.breakMinutes??null,workedMinutes:measured?.workedMinutes??null,clockedIn:(intervals?.length??0)>0,status:open?'OPEN':designation==='REST'?'REST':designation==='OFF'?'OFF':intervals?.length===0&&designation==='WORK'&&holiday==null?'ABSENT':intervals!=null&&intervals.length>0?'ATTENDED':designation==null?'UNROSTERED':'PLANNED',lock:sourceLock,lock_rung:rung,writable:!['PENDING','PAID','CONSUMED'].includes(rung),intervals,withinCutoff:sourceLock.kind==='IN_WINDOW',snapshot_id:version.id,snapshot_range:span,configuration_hash:configurationHash,timezone:zone,projected_shift_id:baseline?.id??null,shift_options:choices.map(shift=>{const shape=object(shift.variant);return {id:shift.id,code:shift.code,kind:shape.kind,start_time:shape.start_time??null,end_time:shape.end_time??null,break_minutes:shape.break_minutes??null};}),holiday:holiday!=null,holidayName:holiday?.name??null,holidayFrom:holiday?.from??null,resolved_day_type:day.resolved_day_type});
  }
 }
 cells.sort((a,b)=>a.date.localeCompare(b.date));if(cells.length!==(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000+1)refuse('Attendance requires complete governed calendar coverage.');
 return {cells,schedule_calendar_captures:captures,payroll_lock_capture:locks.execution,observed_day:calendarDateInTimeZone(new Date(options.observed_at),timezone)};
}
