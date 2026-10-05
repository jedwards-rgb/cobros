import { DomainError } from './domain';
export async function boundedBody(request:Request,limit:number):Promise<Uint8Array> {
 if(Number(request.headers.get('content-length')||0)>limit)throw new DomainError('Solicitud demasiado grande.',413);
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 let length=0;const parts:Uint8Array[]=[];
 try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new DomainError('Solicitud demasiado grande.',413);}parts.push(value);}}
 finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
