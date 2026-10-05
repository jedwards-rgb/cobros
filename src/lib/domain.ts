import { z } from 'zod';
import type { Actor, Role, Invoice } from './types';
export class DomainError extends Error { constructor(message:string, public status=400) {super(message);} }
export function allow(actor:Actor,roles:Role[]) {if(!roles.includes(actor.role)) throw new DomainError('Tu perfil no tiene permiso para esta operación.',403);}
export const id=z.string().uuid();
export const text=z.string().trim().min(1).max(180);
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'Fecha inválida');
export const amount=z.string().regex(/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/,'Usa punto decimal y máximo dos decimales');
export function cents(value:string,zero=false) {amount.parse(value);const [whole,fraction='']=value.split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!zero&&result===0)throw new DomainError('El monto debe ser mayor que cero.');return result;}
export function money(value:number) {return `B/. ${(value/100).toLocaleString('es-PA',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
export function today(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Panama',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function plusDays(day:string,days:number) {const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function daysLate(due:string,asOf=today()) {return Math.max(0,Math.round((Date.parse(asOf)-Date.parse(due))/86400000));}
export function balance(i:Pick<Invoice,'amount_cents'|'late_fee_cents'|'paid_cents'>) {return i.amount_cents+i.late_fee_cents-i.paid_cents;}
export function status(i:Invoice) {if(balance(i)===0)return 'Pagado';if(daysLate(i.due_date)>0)return 'Vencido';if(i.paid_cents>0)return 'Abono recibido';return 'Por vencer';}
