export type Role = 'cobranza'|'seguimiento'|'directora';
export interface Actor {id:string;school_id:string;name:string;email:string;role:Role;school_name:string;csrf?:string;}
export interface Invoice {id:string;school_id:string;student_id:string;reference:string;concept:string;due_date:string;amount_cents:number;late_fee_cents:number;paid_cents:number;student_name:string;guardian_name:string;guardian_id:string;grade:string;}
export interface Guardian {id:string;name:string;email:string|null;phone:string|null;email_consent:number;whatsapp_consent:number;consent_note:string|null;}
export interface PromiseRow {id:string;invoice_id:string;amount_cents:number;baseline_paid_cents:number;due_date:string;status:string;notes:string|null;paid_cents:number;guardian_name:string;student_name:string;}
