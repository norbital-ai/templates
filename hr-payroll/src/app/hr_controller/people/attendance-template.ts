import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import {PlainDate,days,monthOf} from '@norbital-ai/std/date';
import {isYearMonth} from '../../../lib/payroll_engine/foundation/time.js';
import {SETTINGS_SHEET_NAME,ROSTER_SHEET_NAME,ATTENDANCE_SHEET_NAME,OVERTIME_SHEET_NAME,PIECE_SHEET_NAME} from './attendance-workbook.js';
/** A downloadable input workbook for the same grammar the native attendance importer accepts. */
export function schedulingTemplateWorkbook(options:{legalEntity:string;month:string;timezone:string;overtimeConsent?:boolean;factColumns?:readonly string[]}){
 if(!options.legalEntity.trim()||!isYearMonth(options.month)||!options.timezone.trim())throw new Error('Attendance template requires the selected employer, calendar month and governing timezone.');
 new Intl.DateTimeFormat('en',{timeZone:options.timezone});
 const workbook=new ExcelJSBrowser.Workbook();
 const instructions=workbook.addWorksheet('Read me');
 for(const line of ['Enter the employee number on file. Keep sheet names and column names unchanged.','Roster cells name a shift code. Blank cells clear the selected month sheet.','Time entries use local HH:MM–HH:MM clocks in the Settings timezone.','Overtime cells declare hours. Piecework declares actual units and unit rates.'])instructions.addRow([line]);
 const settings=workbook.addWorksheet(SETTINGS_SHEET_NAME);settings.addRow(['Setting','Value']);
 settings.addRows([['legal_entity',options.legalEntity],['month',options.month],['timezone',options.timezone]]);
 const grid=['employee_number',...Array.from({length:days(monthOf(PlainDate(options.month+'-01')))},(_,index)=>String(index+1))];
 workbook.addWorksheet(ROSTER_SHEET_NAME).addRow(grid);
 workbook.addWorksheet(ATTENDANCE_SHEET_NAME).addRow(grid);
 workbook.addWorksheet(PIECE_SHEET_NAME).addRow(['employee_number','work_date','piece_units','piece_unit_rate','piece_overtime_units']);
 const extra=options.factColumns??[];if(extra.some(key=>!key.trim())||new Set(extra).size!==extra.length)throw new Error('Attendance template requires distinct actual declared import fact columns.');
 workbook.addWorksheet(OVERTIME_SHEET_NAME).addRow(options.overtimeConsent===true||extra.length?['employee_number','work_date','overtime_hours',...(options.overtimeConsent===true?['overtime_consented_at']:[]),...extra]:grid);
 return workbook;
}
