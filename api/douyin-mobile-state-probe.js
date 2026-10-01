export const config = { maxDuration: 30 };

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

function findObjects(root, expectedId) {
  const matches = [];
  const queue = [{ value: root, path: "$", depth: 0 }];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 8000 && matches.length < 12) {
    const { value, path, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    const id = String(value.aweme_id ?? value.awemeId ?? value.item_id ?? value.itemId ?? "");
    if (id === expectedId) {
      matches.push({
        path,
        keys: Object.keys(value).slice(0, 40),
        has_video: Boolean(value.video),
        video_keys: value.video && typeof value.video === "object" ? Object.keys(value.video).slice(0, 40) : [],
        desc: typeof value.desc === "string" ? value.desc.slice(0, 120) : null
      });
    }
    if (depth >= 8) continue;
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object") queue.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
    }
  }
  return matches;
}

function parseCandidate(text) {
  const source = String(text ?? "").trim();
  const candidates = [source];
  const firstObject = source.indexOf("{"), lastObject = source.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(source.slice(firstObject, lastObject + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

export default async function handler(req,res){
  const id=String(Array.isArray(req.query?.id)?req.query.id[0]:req.query?.id??"");
  if(!/^\d{10,25}$/.test(id)) return res.status(400).json({ok:false,error:"invalid_id"});
  const url=`https://www.iesdouyin.com/share/video/${id}`;
  try{
    const response=await fetch(url,{
      headers:{"User-Agent":UA,"Accept-Language":"zh-CN,zh;q=0.9,en;q=0.8"},
      redirect:"manual",
      signal:AbortSignal.timeout(12000)
    });
    const html=await response.text();
    const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
      .map((m,index)=>({index,attrs:m[1]??"",text:m[2]??""}))
      .filter((item)=>item.text.includes(id)||/__INITIAL_STATE__|RENDER_DATA|UNIVERSAL_DATA_FOR_REHYDRATION|_ROUTER_DATA/.test(item.text));
    const result=scripts.slice(0,12).map((item)=>{
      const parsed=parseCandidate(item.text);
      const idx=item.text.indexOf(id);
      return {
        index:item.index,
        attrs:item.attrs.slice(0,300),
        length:item.text.length,
        starts_with:item.text.slice(0,120),
        around_id:idx>=0?item.text.slice(Math.max(0,idx-350),Math.min(item.text.length,idx+900)):null,
        json_parsed:Boolean(parsed),
        root_keys:parsed&&typeof parsed==="object"?Object.keys(parsed).slice(0,40):[],
        exact_object_matches:parsed?findObjects(parsed,id):[]
      };
    });
    return res.status(200).json({
      ok:true,
      http_status:response.status,
      content_type:response.headers.get("content-type"),
      expected_aweme_id:id,
      script_count:scripts.length,
      scripts:result
    });
  }catch(error){
    return res.status(200).json({ok:false,error:String(error?.message??error).slice(0,180)});
  }
}
