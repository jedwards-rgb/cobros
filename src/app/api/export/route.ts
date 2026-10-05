import { NextRequest,NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { currentActor } from '@/lib/auth';
import { getData } from '@/lib/collections';
import { balance,today } from '@/lib/domain';
import { audit } from '@/lib/collections';
import { transaction } from '@/lib/db';
import { columns } from '@/lib/imports';
export const runtime='nodejs';
export async function GET(request:NextRequest) {
 const actor=await currentActor();if(!actor)return NextResponse.json({error:'No autorizado'},{status:401});
 const template=request.nextUrl.searchParams.get('template')==='true';
 const data=await getData(actor);
 const rows:(string|number)[][]=template?[[...columns],['JA-001','Estudiante de ejemplo','10 A','Acudiente de ejemplo','familia@example.invalid','+50760000000','MEN-001','Mensualidad','2026-10-05','400.00','0.00']]:[['Referencia','Estudiante','Acudiente','Concepto','Vencimiento','Cargo (B/.)','Mora (B/.)','Abonado (B/.)','Saldo (B/.)'],...data.invoices.map(i=>[i.reference,i.student_name,i.guardian_name,i.concept,i.due_date,i.amount_cents/100,i.late_fee_cents/100,i.paid_cents/100,balance(i)/100])];
 await transaction(tx=>audit(tx,actor,template?'Plantilla descargada':'Cartera exportada',actor.school_id));
 const name=template?'plantilla-cobroedu':`cartera-${today()}`;
 const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
 if(request.nextUrl.searchParams.get('format')==='csv') {
   const csv='\ufeff'+rows.map(row=>row.map(value=>{const safe=typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?"'"+value:value;return '"'+String(safe).replaceAll('"','""')+'"';}).join(',')).join('\r\n');
   return new NextResponse(csv,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}.csv"`}});
 }
 const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet(template?'Importar':'Cartera');sheet.addRows(rows);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF152A3B'}};sheet.columns.forEach(c=>c.width=24);sheet.views=[{state:'frozen',ySplit:1}];
 const bytes=await workbook.xlsx.writeBuffer();return new NextResponse(new Uint8Array(bytes as ArrayBuffer),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}.xlsx"`}});
}
