export type Role = 'cobranza'|'seguimiento'|'directora';
export interface Actor {id:string;school_id:string;name:string;email:string;role:Role;school_name:string;csrf?:string;}
export interface Invoice {id:string;school_id:string;student_id:string;reference:string;concept:string;due_date:string;amount_cents:number;late_fee_cents:number;paid_cents:number;student_name:string;guardian_name:string;guardian_id:string;grade:string;}
export interface Guardian {version:number;archived_at:string|null;id:string;name:string;email:string|null;phone:string|null;email_consent:number;whatsapp_consent:number;consent_note:string|null;}
export interface PromiseRow {id:string;invoice_id:string;amount_cents:number;baseline_paid_cents:number;due_date:string;status:string;notes:string|null;paid_cents:number;guardian_name:string;student_name:string;}

export interface Student {id:string;school_id:string;guardian_id:string;code:string;name:string;grade:string;created_at:string;version:number;archived_at:string|null;guardian_name?:string;}
export interface Contact {id:string;school_id:string;guardian_id:string;name:string;relationship:'madre'|'padre'|'otro';email:string|null;phone:string|null;is_primary:number;email_consent:number;whatsapp_consent:number;consent_note:string|null;created_at:string;updated_at:string;}
export interface ProfileChange {id:string;author:string|null;action:string;reason:string;before_json:string|null;after_json:string|null;created_at:string;}
