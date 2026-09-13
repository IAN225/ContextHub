import {request as httpsRequest} from 'node:https';
import {resolveAttachmentUrl} from '../background-runner.mjs';
export async function publicModelRequest(input,signal,dependencies={}) {
  if(!input || typeof input.url!=='string' || typeof input.body!=='string' || Buffer.byteLength(input.body)>8*1024*1024)
    throw new Error('Invalid model request');
  const {url,address}=await resolveAttachmentUrl(input.url,dependencies.lookup);
  const allowed=new Set(['content-type','authorization','x-api-key','anthropic-version','anthropic-beta','x-goog-api-key','accept']);
  const headers={'Accept-Encoding':'identity'};
  for(const [name,value] of Object.entries(input.headers??{})) {
    if(allowed.has(name.toLowerCase())&&typeof value==='string'&&!/[\r\n]/.test(value))headers[name]=value;
  }
  return new Promise((resolve,reject)=>{
    const req=(dependencies.request??httpsRequest)(url,{
      method:'POST',headers,signal,timeout:120000,
      lookup:(_host,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family),
    },res=>{
      let bytes=0;const chunks=[];
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024)res.destroy(new Error('Model response too large'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
    });
    req.on('timeout',()=>req.destroy(new Error('Model request timeout')));
    req.on('error',reject);
    req.end(input.body);
  });
}
export function createModelProxy(key){
  let running=0;
  return async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);};
    if(req.method!=='POST'||req.headers['x-context-hub-account-key']!==key){req.resume();send(403,'{}');return;}
    if(running>=4){req.resume();send(429,'{}');return;}
    running++;
    const abort=new AbortController();
    res.on('close',()=>abort.abort());
    const timer=setTimeout(()=>abort.abort(),125000);
    try{
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw new Error('Body too large');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result=await publicModelRequest(input,abort.signal);
      if(!res.destroyed)send(result.status,result.body);
    }catch{if(!res.destroyed)send(502,'{"error":"模型连接失败，请检查公网 HTTPS 地址。"}');}
    finally{clearTimeout(timer);running--;}
  };
}
