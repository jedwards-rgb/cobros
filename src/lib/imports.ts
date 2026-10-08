import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { z } from 'zod';
import { allow,amount,cents,date,DomainError,text } from './domain';
import { transaction } from './db';
import { audit } from './collections';
import type { Actor } from './types';
export const columns=['codigo_estudiante','estudiante','grado','acudiente','email','telefono','referencia','concepto','vencimiento','monto','mora'] as const;
export const importSchema=z.object({codigo_estudiante:text.max(40),estudiante:text,grado:text.max(60),acudiente:text,email:z.union([z.email().max(180),z.literal('')]),telefono:z.union([z.string().regex(/^\+[1-9]\d{7,14}$/),z.literal('')]),referencia:text.max(80),concepto:text,vencimiento:date,monto:amount,mora:amount});
export type ImportRow=z.infer<typeof importSchema>;
function inspectZip(bytes:Buffer) {
  let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw new DomainError('El archivo no es un XLSX válido.');
  const entries=bytes.readUInt16LE(eocd+10);let offset=bytes.readUInt32LE(eocd+16),total=0;
  if(entries>1000||entries===0)throw new DomainError('Archivo demasiado complejo.');
  for(let i=0;i<entries;i++) {
    if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw new DomainError('Estructura XLSX inválida.');
    const compressed=bytes.readUInt32LE(offset+20),declared=bytes.readUInt32LE(offset+24),method=bytes.readUInt16LE(offset+10),local=bytes.readUInt32LE(offset+42);
    const remaining=8*1024*1024-total;
    if(declared>remaining||(bytes.readUInt16LE(offset+8)&1)||![0,8].includes(method))throw new DomainError('Archivo comprimido demasiado grande o protegido.');
    if(local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)throw new DomainError('Estructura XLSX inválida.');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(start+compressed>bytes.length)throw new DomainError('Estructura XLSX inválida.');
    try {
      const data=bytes.subarray(start,start+compressed);
      // Independently cap actual inflation, rather than trusting the ZIP metadata.
      const actual=method===8?inflateRawSync(data,{maxOutputLength:Math.max(1,remaining)}):data;
      if(actual.length!==declared||actual.length>remaining)throw new Error('SIZE_MISMATCH');
      total+=actual.length;
    }catch{throw new DomainError('Tamaño o compresión XLSX inválidos.');}
    offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
  }
}
export async function parseWorkbook(bytes:Buffer):Promise<ImportRow[]> {
  if(bytes.length>2*1024*1024)throw new DomainError('Máximo 2 MB por archivo.');inspectZip(bytes);
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0];if(!sheet||sheet.rowCount<2||sheet.rowCount>501||sheet.columnCount>20)throw new DomainError('Usa de 1 a 500 filas y la plantilla indicada.');
  columns.forEach((key,index)=>{if(sheet.getRow(1).getCell(index+1).text.trim()!==key)throw new DomainError(`Columna ${index+1}: debe llamarse ${key}.`);});
  const rows:ImportRow[]=[];
  sheet.eachRow((row,index)=>{if(index===1)return;const value:Record<string,string>={};columns.forEach((key,j)=>{const cell=row.getCell(j+1);if(cell.type===ExcelJS.ValueType.Formula||cell.type===ExcelJS.ValueType.Hyperlink)throw new DomainError(`Fila ${index}: reemplaza fórmulas y enlaces por valores.`);value[key]=cell.value instanceof Date?cell.value.toISOString().slice(0,10):cell.text.trim();});try{rows.push(importSchema.parse(value));}catch{throw new DomainError(`Fila ${index}: revisa fechas AAAA-MM-DD, contactos y montos con punto decimal.`);}});
  return rows;
}
export async function importRows(actor:Actor,input:unknown) {
  allow(actor,['cobranza']);const rows=z.array(importSchema).min(1).max(500).parse(input);
  return transaction(async tx=>{
    // Serialize imports for this school so simultaneous files cannot create two family records.
    await tx.run('UPDATE ce_schools SET name=name WHERE id=?',[actor.school_id]);
    for(const row of rows) {
      const value=cents(row.monto),fee=cents(row.mora,true);
      if((await tx.query('SELECT id FROM ce_invoices WHERE school_id=? AND reference=?',[actor.school_id,row.referencia])).length)throw new DomainError(`Referencia duplicada: ${row.referencia}. No se importó ninguna fila.`);
      let [student]=await tx.query<{id:string;name:string;grade:string;guardian_id:string}>('SELECT * FROM ce_students WHERE school_id=? AND code=?',[actor.school_id,row.codigo_estudiante]);
      if(student) {
        const [g]=await tx.query<{name:string;email:string|null;phone:string|null}>('SELECT name,email,phone FROM ce_guardians WHERE school_id=? AND id=?',[actor.school_id,student.guardian_id]);
        if(student.name!==row.estudiante||student.grade!==row.grado||g.name!==row.acudiente||(g.email||'')!==row.email||(g.phone||'')!==row.telefono)throw new DomainError(`Los datos de ${row.codigo_estudiante} difieren de su ficha. No se importó ninguna fila.`);
      } else {
        const studentId=randomUUID(),timestamp=new Date().toISOString();
        // Reuse only an exact family identity within this school, with at least one contact.
        // A shared name or phone alone is not sufficient.
        const matching=(row.email||row.telefono)?await tx.query<{id:string}>(
          "SELECT id FROM ce_guardians WHERE school_id=? AND LOWER(TRIM(name))=? AND LOWER(TRIM(COALESCE(email,'')))=? AND TRIM(COALESCE(phone,''))=?",
          [actor.school_id,row.acudiente.trim().toLowerCase(),row.email.trim().toLowerCase(),row.telefono.trim()],
        ):[];
        if(matching.length>1)throw new DomainError(`El acudiente ${row.acudiente} tiene fichas duplicadas. Unifica las fichas antes de importar. No se importó ninguna fila.`);
        const guardianId=matching[0]?.id||randomUUID();
        if(!matching.length)await tx.run('INSERT INTO ce_guardians(id,school_id,name,email,phone,created_at) VALUES (?,?,?,?,?,?)',[guardianId,actor.school_id,row.acudiente,row.email||null,row.telefono||null,timestamp]);
        await tx.run('INSERT INTO ce_students(id,school_id,guardian_id,code,name,grade,created_at) VALUES (?,?,?,?,?,?,?)',[studentId,actor.school_id,guardianId,row.codigo_estudiante,row.estudiante,row.grado,timestamp]);
        student={id:studentId,name:row.estudiante,grade:row.grado,guardian_id:guardianId};
      }
      const invoiceId=randomUUID();await tx.run('INSERT INTO ce_invoices(id,school_id,student_id,reference,concept,due_date,amount_cents,late_fee_cents,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[invoiceId,actor.school_id,student.id,row.referencia,row.concepto,row.vencimiento,value,fee,actor.id,new Date().toISOString()]);await audit(tx,actor,'Cuenta importada desde Excel',invoiceId);
    }
    return rows.length;
  });
}
