import { today } from './domain';
export interface StaffCall {created_by:string;author:string;created_at:string;outcome:string;}
export function staffActivity(calls:StaffCall[],day=today()) {
 const people=new Map<string,{id:string;name:string;calls:number;contacts:number;unanswered:number}>();
 for(const call of calls) {
  if(today(new Date(call.created_at))!==day)continue;
  const person=people.get(call.created_by)||{id:call.created_by,name:call.author,calls:0,contacts:0,unanswered:0};
  person.calls++;
  if(['Contestó','Promesa de pago','Acuerdo de pago'].includes(call.outcome))person.contacts++;
  if(call.outcome==='No contestó')person.unanswered++;
  people.set(call.created_by,person);
 }
 return [...people.values()];
}
