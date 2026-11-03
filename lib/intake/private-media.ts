import {MAX_FILE_BYTES,ownsStoragePath,validateUpload} from './validation';

type Download = (path:string)=>Promise<{data:Blob|null;error:unknown}>;
const headers={
 'X-Content-Type-Options':'nosniff',
 'Cache-Control':'private, no-store, max-age=0',
 'Content-Security-Policy':"default-src 'none'; sandbox",
 'Cross-Origin-Resource-Policy':'same-origin',
};
function error(message:string,status:number){return Response.json({error:message},{status,headers});}

/** Only original PNG/JPEG bytes may be displayed; no transforms, SVG, HTML or PDF inline. */
export function privatePreviewMime(bytes:Uint8Array,declaredType:string):'image/png'|'image/jpeg'|null {
 const mime=declaredType.split(';')[0].trim().toLowerCase();
 if(mime!=='image/png'&&mime!=='image/jpeg')return null;
 try{if(validateUpload(bytes,mime).mime!==mime)return null;}catch{return null;}
 if(mime==='image/png'){
  if(bytes.length<45||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8)!==13||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  if(!width||!height||width*height>12_000_000||![0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82].every((value,index)=>bytes[bytes.length-8+index]===value))return null;
 }else if(bytes.length<4||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)return null;
 return mime;
}

/** The route supplies a verified tracker owner and that owner's RLS-bound Storage client. */
export async function privateMediaResponse(request:Request,ownerId:string|null,download:Download|null):Promise<Response>{
 if(!ownerId||!download)return error('Authentication required.',401);
 const url=new URL(request.url),path=url.searchParams.get('path')||'',preview=url.searchParams.get('preview');
 if(!ownsStoragePath(ownerId,path))return error('File not found.',404);
 if(preview!==null&&preview!=='image')return error('Unsupported preview.',400);
 let result:Awaited<ReturnType<Download>>;
 try{result=await download(path);}catch{return error('Private file unavailable.',404);}
 if(result.error||!result.data)return error('Private file unavailable.',404);
 const blob=result.data;
 if(preview==='image'){
  if(!blob.size||blob.size>MAX_FILE_BYTES)return error('Image preview unavailable.',415);
  let bytes:Uint8Array;try{bytes=new Uint8Array(await blob.arrayBuffer());}catch{return error('Image preview unavailable.',415);}
  const mime=privatePreviewMime(bytes,blob.type);
  if(!mime)return error('Image preview unavailable.',415);
  return new Response(blob,{headers:{...headers,'Content-Type':mime,'Content-Disposition':`inline; filename="private-intake-image.${mime==='image/png'?'png':'jpg'}"`,'Content-Length':String(blob.size)}});
 }
 return new Response(blob,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="private-intake-file"'}});
}
