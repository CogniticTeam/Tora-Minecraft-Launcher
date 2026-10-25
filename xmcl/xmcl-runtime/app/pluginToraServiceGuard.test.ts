import { describe,expect,it,vi } from 'vitest'
import { isRetiredXmclService,pluginToraServiceGuard } from './pluginToraServiceGuard'
describe('TORA service isolation',()=>{
  it('blocks upstream domains and relay IPs, preserving legitimate providers and internal IPC',()=>{
    for(const value of ['https://api.xmcl.app/news','https://xmcl-core-api.azurewebsites.net/api/latest','wss://signaling.xmcl.app/room','https://20.239.69.131'])expect(isRetiredXmclService(value)).toBe(true)
    for(const value of ['http://xmcl.runtime','https://launcher-api.cogniticteam.com','https://api.deepseek.com','https://api.modrinth.com','https://login.microsoftonline.com'])expect(isRetiredXmclService(value)).toBe(false)
  })
  it('rejects before dispatching a request, including a request carrying credentials',async()=>{
    const fetcher=vi.fn(async()=>new Response('ok'))
    const handlers:Function[]=[]
    const app:any={fetch:fetcher,protocol:{registerHandler:(_:string,handler:Function)=>handlers.push(handler)}}
    pluginToraServiceGuard(app,{} as any)
    await expect(app.fetch('https://api.xmcl.app/v1/account',{headers:{Authorization:'Bearer private-test-value'}})).rejects.toThrow('上游 XMCL 服务已移除')
    expect(fetcher).not.toHaveBeenCalled()
    await app.fetch('https://launcher-api.cogniticteam.com/health');expect(fetcher).toHaveBeenCalledTimes(1)
    const response:any={};await handlers[0]({request:{url:new URL('https://api.xmcl.app/news')},response})
    expect(response.status).toBe(410);expect(response.handled).toBe(true)
  })
})
