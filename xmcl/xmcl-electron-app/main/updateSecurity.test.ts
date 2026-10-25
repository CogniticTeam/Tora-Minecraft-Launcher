import {describe,it,expect} from 'vitest'
import {createHash,generateKeyPairSync,sign} from 'node:crypto'
import {releasePayload,verifyReleaseFile} from './updateSecurity'
const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString(),keyId=createHash('sha256').update(publicKey).digest('hex').slice(0,16),key={publicKey,keyId}
const file={name:'TMCL.zip',url:'https://154.8.230.216/downloads/art_'+ 'a'.repeat(32)+'/TMCL.zip',size:20,sha256:'b'.repeat(64),platform:'darwin',arch:'arm64',kind:'zip',keyId,signature:''}
file.signature=sign(null,Buffer.from(releasePayload('0.3.0','stable',file)),pair.privateKey).toString('base64')
describe('release signature verification',()=>{it('accepts an intact signed artifact and rejects changed metadata',()=>{expect(verifyReleaseFile('0.3.0','stable',file,key)).toBe(true);for(const changed of [{...file,size:21},{...file,sha256:'c'.repeat(64)},{...file,url:'https://attacker.test/TMCL.zip'},{...file,keyId:'unknown'}])expect(verifyReleaseFile('0.3.0','stable',changed,key)).toBe(false);expect(verifyReleaseFile('0.3.1','stable',file,key)).toBe(false);expect(verifyReleaseFile('0.3.0','beta',file,key)).toBe(false)})})
