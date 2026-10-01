import { DirectPublicWebProvider } from "../providers/direct-public-web.js";

function hostOf(value){ try { return new URL(value).hostname; } catch { return null; } }

export async function runDouyinRegionProbe(req,res){
  const id=String(Array.isArray(req.query?.id)?req.query.id[0]:req.query?.id??"");
  if(!/^\d{10,25}$/.test(id)) return res.status(400).json({ok:false,error:"invalid_id"});
  const target=`https://www.douyin.com/video/${id}`;
  const started=Date.now();
  try{
    const provider=new DirectPublicWebProvider({
      fetchImpl:globalThis.fetch,
      retries:0,
      videoContentWaitMs:8000,
      videoNavigationTimeoutMs:15000,
      settleMs:200
    });
    const result=await provider.readVideo({inputUrl:target,resolvedUrl:target,awemeId:id});
    const urls=[
      ...(result.networkMediaUrls??[]),
      ...(result.aweme?.video?.play_addr?.url_list??[]),
      ...(result.aweme?.video?.download_addr?.url_list??[])
    ].filter(Boolean);
    return res.status(200).json({
      ok:true,
      aweme_id:String(result.aweme?.aweme_id??result.aweme?.awemeId??"")||null,
      method:result.meta?.method??null,
      browser:result.meta?.browser??null,
      media_hosts:[...new Set(urls.map(hostOf).filter(Boolean))],
      elapsed_ms:Date.now()-started
    });
  }catch(error){
    return res.status(200).json({
      ok:false,
      code:error?.code??"PROBE_FAILED",
      message:String(error?.message??"").slice(0,180),
      details:error?.details??null,
      elapsed_ms:Date.now()-started
    });
  }
}
