import { verify } from 'node:crypto'
import trust from '../tora-release-key.json'
export interface SignedReleaseFile { name:string;url:string;size:number;sha256:string;platform:string;arch:string;kind:string;signature?:string;keyId?:string }
export function releasePayload(version:string,channel:string,file:SignedReleaseFile){return JSON.stringify({schema:1,version,channel,platform:file.platform,arch:file.arch,kind:file.kind,name:file.name,size:file.size,sha256:file.sha256,url:file.url})}
export function verifyReleaseFile(version:string,channel:string,file:SignedReleaseFile,key=trust){
  if(!file||typeof file.name!=='string'||file.name.length>160||file.name.includes('/')||file.name.includes('\\')||!Number.isSafeInteger(file.size)||file.size<1||file.size>1024**3||!/^[a-f0-9]{64}$/.test(file.sha256)||file.keyId!==key.keyId||typeof file.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(file.signature))return false
  try{const url=new URL(file.url);if(url.origin!=='https://154.8.230.216'||url.username||url.password||url.search||url.hash||!/^\/downloads\/art_[a-f0-9]{32}\//.test(url.pathname))return false;return verify(null,Buffer.from(releasePayload(version,channel,file)),key.publicKey,Buffer.from(file.signature,'base64'))}catch{return false}
}
