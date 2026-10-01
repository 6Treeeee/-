export const config = { maxDuration: 30 };

function summarize(text, type) {
  const compact = String(text ?? "").slice(0, 2_000_000);
  const ids = [...compact.matchAll(/(?:aweme_id|awemeId)["':\\s]+(\\d{10,25})/g)].slice(0,5).map(m=>m[1]);
  const mediaHosts = [...compact.matchAll(/https?:\\/\\/[^"'<>\\s]+/g)]
    .map(m=>m[0])
    .filter(u=>/douyinvod|video|play_addr|playAddr/i.test(u))
    .slice(0,20)
    .map(u=>{try{return new URL(u.replace(/\\u002F/g,"/")).hostname}catch{return null}})
    .filter(Boolean);
  return {
    content_type:type||null,
    bytes:Buffer.byteLength(compact),
    contains_security:/安全验证|验证后继续|captcha|verify/i.test(compact),
    contains_login:/请先登录|登录后/.test(compact),
    aweme_ids:[...new Set(ids)],
    media_hosts:[...new Set(mediaHosts)],
    has_initial_state:/__INITIAL_STATE__|RENDER_DATA|UNIVERSAL_DATA_FOR_REHYDRATION/.test(compact),
    prefix:compact.slice(0,180).replace(/\\s+/g," ")
  };
}

export default async function handler(req,res){
  const id=String(Array.isArray(req.query?.id)?req.query.id[0]:req.query?.id??"");
  if(!/^\\d{10,25}$/.test(id)) return res.status(400).json({ok:false,error:"invalid_id"});
  const urls=[
    `https://www.douyin.com/video/${id}`,
    `https://www.iesdouyin.com/share/video/${id}`,
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`
  ];
  const out=[];
  for(const url of urls){
    const started=Date.now();
    try{
      const response=await fetch(url,{
        headers:{
          "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept-Language":"zh-CN,zh;q=0.9,en;q=0.8"
        },
        redirect:"manual",
        signal:AbortSignal.timeout(12000)
      });
      const text=await response.text();
      out.push({
        url:new URL(url).origin+new URL(url).pathname,
        status:response.status,
        location:response.headers.get("location"),
        ...summarize(text,response.headers.get("content-type")),
        elapsed_ms:Date.now()-started
      });
    }catch(error){
      out.push({url:new URL(url).origin+new URL(url).pathname,error:String(error?.message??error).slice(0,160),elapsed_ms:Date.now()-started});
    }
  }
  return res.status(200).json({ok:true,expected_aweme_id:id,results:out});
}
