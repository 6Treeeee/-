import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ReaderError, sanitizeDiagnostics } from "../errors.js";
import { DirectPublicWebProvider } from "../providers/direct-public-web.js";
import { PublicBrowserService } from "./public-browser.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const textKey = (text) => String(text ?? "").replace(/[\s，。！？、；：,.!?;:·•“”‘’《》（）—…↑↓]/g, "").toLowerCase();
function editSimilarity(left, right) {
  const a=textKey(left),b=textKey(right);
  if(!a.length||!b.length)return a===b?1:0;
  const row=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i+=1){
    let diagonal=row[0];row[0]=i;
    for(let j=1;j<=b.length;j+=1){
      const previous=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));
      diagonal=previous;
    }
  }
  return 1-row[b.length]/Math.max(a.length,b.length);
}
function selectedRowCount(selected) {
  const pieces=(Array.isArray(selected)?selected:[]).filter((piece)=>Number.isFinite(Number(piece?.cy)));
  if(!pieces.length)return 0;
  const sorted=[...pieces].sort((a,b)=>Number(a.cy)-Number(b.cy));let rows=1,last=sorted[0];
  for(const piece of sorted.slice(1)){
    const tolerance=Math.max(12,Math.min(Number(last.height)||20,Number(piece.height)||20)*.6);
    if(Number(piece.cy)-Number(last.cy)>tolerance)rows+=1;
    last=piece;
  }
  return rows;
}
const fail = (code, message, details) => new ReaderError(code, message, { status: 503, details });
function errorChain(error) {
  const output=[];let current=error;
  for(let depth=0;current&&depth<4;depth+=1){
    output.push(sanitizeDiagnostics({name:current.name,code:current.code,message:current.message,details:current.details}));
    current=current.cause;
  }
  return output;
}

class OcrProcess {
  constructor({ python, env, deadlineAt }) {
    this.lines = []; this.waiters = []; this.failure = null;
    this.child = spawn(python, ["-u", fileURLToPath(new URL("./hard-subtitle-worker.py", import.meta.url))], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...env, PYTHONIOENCODING: "utf-8", OMP_NUM_THREADS: "2" }
    });
    this.stderr = "";
    this.child.stderr.on("data", (value) => { this.stderr = (this.stderr + value).slice(-2000); });
    this.child.on("error", () => this.reject(fail("OCR_RUNTIME_UNAVAILABLE", "The configured Python OCR runtime could not start.")));
    this.child.on("exit", (code) => this.reject(fail("OCR_WORKER_EXITED", "The OCR worker exited before producing its result.", { exit_code: code })));
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on("line", (line) => {
      try {
        const value = JSON.parse(line);
        if (this.waiters.length) this.waiters.shift().resolve(value); else this.lines.push(value);
      } catch { this.reject(fail("OCR_WORKER_INVALID_OUTPUT", "The OCR worker returned an invalid record.")); }
    });
    this.deadlineAt = deadlineAt;
  }
  reject(error) { this.failure = error; for (const waiter of this.waiters.splice(0)) waiter.reject(error); }
  next() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolve, reject) => {
      const remaining = Math.min(30_000, this.deadlineAt - Date.now());
      const timer = setTimeout(() => { this.reject(fail("OCR_WORKER_TIMEOUT", "The OCR worker did not respond within its budget.")); }, Math.max(1, remaining));
      this.waiters.push({ resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    });
  }
  async read(id, image) {
    if (this.failure) throw this.failure;
    await new Promise((resolve, reject) => this.child.stdin.write(JSON.stringify({ id, image }) + "\n", (error) => error ? reject(error) : resolve()));
    const result = await this.next();
    if (result.id !== id) throw fail("OCR_WORKER_ID_MISMATCH", "OCR returned a different frame identity.");
    return result;
  }
  async probe(id, image) {
    if (this.failure) throw this.failure;
    await new Promise((resolve, reject) => this.child.stdin.write(JSON.stringify({ op:"probe", id, image }) + "\n", (error) => error ? reject(error) : resolve()));
    const result=await this.next();
    if(result.id!==id)throw fail("OCR_WORKER_ID_MISMATCH","OCR probe returned a different frame identity.");
    return result;
  }
  close() { this.reader.close(); this.child.stdin.destroy(); this.child.kill(); }
}

export function mergeCaptionFrames(frames, durationMs) {
  const rawGroups = [];
  for (const frame of frames) {
    // A hard-subtitle frame has at most two text rows. Three or more rows are
    // scene/UI copy (feeds, menus, slides), not a dialogue subtitle track.
    const text = selectedRowCount(frame.selected)>2 ? "" : String(frame.text ?? "").trim();
    const previous = rawGroups.at(-1);
    if (!text) { if (previous && !previous.end_ms) previous.end_ms = frame.time_ms; continue; }
    // Only adjacent recognized text is deduplicated. Never cluster visual changes before OCR.
    if (previous && textKey(previous.text) === textKey(text) && !previous.end_ms) {
      previous.last_seen_ms = frame.time_ms; previous.evidence.push(frame.file); continue;
    }
    if (previous && !previous.end_ms) previous.end_ms = frame.time_ms;
    rawGroups.push({ start_ms: frame.time_ms, end_ms: null, last_seen_ms: frame.time_ms,
      text, confidence: frame.confidence, evidence: [frame.file] });
  }
  if (rawGroups.length && !rawGroups.at(-1).end_ms) rawGroups.at(-1).end_ms = durationMs;

  // OCR can oscillate between one-character variants while the same subtitle remains
  // visible. Collapse only adjacent, near-identical readings after OCR; raw frames and
  // per-frame OCR stay untouched in the evidence journal.
  const runs=[];
  for(const group of rawGroups.filter((item)=>item.end_ms>item.start_ms)){
    const previous=runs.at(-1);
    const adjacent=previous && group.start_ms-previous.end_ms<=750;
    const sameReading=previous && previous.variants.some((item)=>editSimilarity(item.text,group.text)>=.72);
    if(adjacent&&sameReading){
      previous.end_ms=group.end_ms;previous.last_seen_ms=Math.max(previous.last_seen_ms,group.last_seen_ms);
      previous.variants.push(group);continue;
    }
    runs.push({...group,variants:[group]});
  }
  return runs.map((run)=>{
    const readings=new Map;
    for(const variant of run.variants){
      const key=textKey(variant.text),weight=Math.max(1,variant.evidence.length);
      const current=readings.get(key)??{text:variant.text,frames:0,confidenceTotal:0,duration:0};
      current.frames+=weight;current.confidenceTotal+=Number(variant.confidence||0)*weight;
      current.duration+=Math.max(0,variant.end_ms-variant.start_ms);
      if(variant.text.length>current.text.length)current.text=variant.text;
      readings.set(key,current);
    }
    const selected=[...readings.values()].sort((a,b)=>b.frames-a.frames||b.duration-a.duration||
      b.confidenceTotal/Math.max(1,b.frames)-a.confidenceTotal/Math.max(1,a.frames)||b.text.length-a.text.length)[0];
    const evidence=run.variants.flatMap((variant)=>variant.evidence);
    return {start_ms:run.start_ms,end_ms:run.end_ms,last_seen_ms:run.last_seen_ms,text:selected.text,
      confidence:selected.confidenceTotal/Math.max(1,selected.frames),evidence,recognition_variants:readings.size};
  }).filter((group)=>textKey(group.text).length>1 || group.evidence.length>1 || group.confidence>=.9);
}

export function assessCaptionCoverage(segments, durationMs, visualStepMs=250) {
  const duration=Math.max(1,Number(durationMs)||1),windowMs=10_000;
  const activeMs=segments.reduce((total,segment)=>total+Math.max(0,
    Math.min(duration,Number(segment.last_seen_ms??segment.end_ms??segment.start_ms)+visualStepMs)-
    Math.max(0,Number(segment.start_ms)||0)),0);
  const windowCount=Math.max(1,Math.ceil(duration/windowMs)),covered=new Set();
  for(const segment of segments){
    const start=Math.max(0,Math.floor(Number(segment.start_ms||0)/windowMs));
    const end=Math.min(windowCount-1,Math.floor(Number(segment.last_seen_ms??segment.end_ms??segment.start_ms)/windowMs));
    for(let index=start;index<=end;index+=1)covered.add(index);
  }
  const activeRatio=activeMs/duration,windowRatio=covered.size/windowCount;
  const sustained=duration<=30_000
    ? segments.length>=2&&segments.map((item)=>item.text).join("").length>=10
    : activeRatio>=.2&&windowRatio>=.75;
  return {sustained,active_ms:activeMs,active_ratio:+activeRatio.toFixed(6),window_ms:windowMs,
    covered_windows:covered.size,total_windows:windowCount,window_ratio:+windowRatio.toFixed(6),
    minimum_active_ratio:duration<=30_000?null:.2,minimum_window_ratio:duration<=30_000?null:.75};
}

// Executed in the same fresh, identity-checked public page used by the provider.
async function initializeCapture({ expectedId, expectedDurationSeconds, deadlineAt }) {
  const candidates = [...document.querySelectorAll("video")].filter((v) => v.videoWidth > 0);
  const v = candidates.sort((a,b) => Math.abs(a.duration-expectedDurationSeconds)-Math.abs(b.duration-expectedDurationSeconds))[0];
  if (!v) throw new Error("OCR_NO_PUBLIC_PLAYER");
  if(Math.abs(v.duration-expectedDurationSeconds)>Math.max(3,expectedDurationSeconds*.02))throw new Error("OCR_PLAYER_DURATION_MISMATCH");
  v.muted = true; v.pause();
  const originalSrc = v.currentSrc || v.src;
  const style=document.createElement("style");style.dataset.contentReaderOcr="true";
  style.textContent="html,body{margin:0!important;background:#000!important;overflow:hidden!important}body *{visibility:hidden!important}video{visibility:visible!important;position:fixed!important;inset:0!important;width:1280px!important;height:720px!important;object-fit:contain!important;z-index:2147483647!important}";
  document.head.appendChild(style);
  const state = { v, originalSrc, expectedId, deadlineAt };
  state.seekOnce = async (target, timeoutMs=8000) => {
    if (Date.now() >= deadlineAt-1000) throw new Error("OCR_DEADLINE_EXCEEDED");
    if ((v.currentSrc || v.src) !== originalSrc) throw new Error("OCR_PLAYER_CHANGED");
    v.pause();
    if (Math.abs(v.currentTime-target)<.001 && v.readyState>=2 && !v.seeking) return;
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => { clean(); reject(new Error("OCR_SEEK_TIMEOUT")); }, timeoutMs);
      const clean = () => { clearTimeout(timeout); v.removeEventListener("seeked", done); };
      const done = () => { if (v.readyState>=2) { clean(); resolve(); } };
      v.addEventListener("seeked", done); v.currentTime=target;
    });
  };
  state.seek = async (target) => {
    try { await state.seekOnce(target); return; } catch (first) {
      if(first.message!=="OCR_SEEK_TIMEOUT")throw first;
    }
    v.muted=true;v.play().catch(()=>{});await new Promise(r=>setTimeout(r,1200));v.pause();
    try { await state.seekOnce(target,12000); return; } catch (second) {
      if(second.message!=="OCR_SEEK_TIMEOUT")throw second;
    }
    v.load();
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{clean();reject(new Error("OCR_PLAYER_RELOAD_TIMEOUT"));},15000);
      const done=()=>{clean();resolve();};const clean=()=>{clearTimeout(timer);v.removeEventListener("loadeddata",done);};
      v.addEventListener("loadeddata",done,{once:true});
    });
    if((v.currentSrc||v.src)!==originalSrc)throw new Error("OCR_PLAYER_CHANGED");
    await state.seekOnce(target,15000);
  };
  window.__contentReaderOcr = state;
  return { duration_ms: Math.round(v.duration*1000), source_width:v.videoWidth, source_height:v.videoHeight, capture_width:1280,capture_height:720,
    media_url: originalSrc, page_url: location.href, expected_id: expectedId };
}

async function seekCaptureFrame({ target, deadlineAt }) {
  const s=window.__contentReaderOcr;if(!s)throw new Error("OCR_CAPTURE_NOT_INITIALIZED");
  await s.seek(target);return {time_ms:Math.round(s.v.currentTime*1000),requested_ms:Math.round(target*1000),ready_state:s.v.readyState,captured_at:new Date().toISOString()};
}

export class HardSubtitleOcr {
  constructor({ env=process.env, provider=null, requestId=null } = {}) {
    this.env=env; this.requestId=requestId;
    this.available=env.CONTENT_READER_HARD_SUBTITLES !== "0" && Boolean(env.CONTENT_READER_OCR_PYTHON);
    this.provider=provider ?? new DirectPublicWebProvider({
      browserService:new PublicBrowserService({ protocolTimeoutMs:45_000 }), retries:1,
      videoNavigationTimeoutMs:20_000, videoContentWaitMs:15_000
    });
    this.busy=false;
  }
  status() { return { configured:this.available, engine:"rapidocr_onnxruntime", scope:"single_video", live_frames_only:true, visual_step_ms:250 }; }
  async read(video,{deadlineAt=Date.now()+270_000,requestId=this.requestId}={}) {
    if(!this.available)throw fail("OCR_RUNTIME_NOT_CONFIGURED","A Python runtime with the OCR requirements must be configured.");
    if(this.busy)throw fail("OCR_BUSY","The single-video OCR worker is busy; retry later.");
    const id=String(video?.aweme_id ?? video?.id ?? "");
    if(!/^\d{10,25}$/.test(id))throw fail("OCR_VIDEO_ID_INVALID","A stable public video identity is required.");
    this.busy=true;
    const runId=randomUUID(),startedAt=new Date().toISOString();
    const root=join(this.env.CONTENT_READER_OCR_EVIDENCE_DIR || join(tmpdir(),"content-reader-ocr"),runId);
    let worker;
    const journal=async(event)=>{
      const entry={at:new Date().toISOString(),run_id:runId,request_id:requestId,aweme_id:id,...event};
      await appendFile(join(root,"events.jsonl"),JSON.stringify(entry)+"\n");
      console.info(JSON.stringify(entry));
    };
    try {
      await mkdir(join(root,"frames"),{recursive:true});
      await journal({event:"ocr.started",fresh_capture:true,transcript_cache_read:false});
      worker=new OcrProcess({python:this.env.CONTENT_READER_OCR_PYTHON,env:this.env,deadlineAt});
      const engine=await worker.next();
      if(!engine.ready)throw fail("OCR_RUNTIME_UNAVAILABLE","OCR engine did not initialize.");
      const retrieval=await this.provider.readVideo({awemeId:id,consumeVideo:async({page,assertAccess})=>{
        const rawDuration=Number(video?.duration_ms ?? video?.media?.duration_ms ?? video?.duration ?? 0);
        const expectedDurationSeconds=rawDuration>=1000?rawDuration/1000:rawDuration;
        if(!Number.isFinite(expectedDurationSeconds)||expectedDurationSeconds<=0)throw fail("OCR_EXPECTED_DURATION_MISSING","Target video duration is required to bind the live player.");
        await page.waitForFunction((expected)=>[...document.querySelectorAll("video")].some(v=>v.readyState>=2&&v.videoWidth&&Number.isFinite(v.duration)&&Math.abs(v.duration-expected)<=Math.max(3,expected*.02)),{timeout:15_000},expectedDurationSeconds);
        const playback=await page.evaluate(initializeCapture,{expectedId:id,expectedDurationSeconds,deadlineAt});
        const duration=playback.duration_ms;
        if(!Number.isFinite(duration)||duration<=0||duration>1_500_000)throw fail("OCR_DURATION_UNSUPPORTED","OCR accepts public single videos up to 25 minutes.");
        const mediaHash=hash(playback.media_url); delete playback.media_url;
        await writeFile(join(root,"session.json"),JSON.stringify({run_id:runId,request_id:requestId,aweme_id:id,started_at:startedAt,engine,playback,media_url_sha256:mediaHash,cache_read:false},null,2));
        const records=[];let chain="",probeChain="";let checked=0,probeId=0;
        for(let start=0;start<duration/1000;start+=30){
          await assertAccess();
          const end=Math.min(start+29.75,Math.floor((duration-1)/250)*.25);
          const captured=[],scores=[];
          for(let target=start;target<=end+.00001;target+=.25){
            const state=await page.evaluate(seekCaptureFrame,{target,deadlineAt});
            const low=Buffer.from(await page.screenshot({type:"jpeg",quality:30,clip:{x:0,y:0,width:1280,height:720},captureBeyondViewport:false}));
            const probe=await worker.probe(`p${probeId++}`,low.toString("base64"));
            probeChain=hash(probeChain+probe.frame_sha256+state.time_ms);checked++;
            scores.push([state.time_ms,+probe.score.toFixed(6)]);
            if(checked===1||probe.score>=.003){
              const stable=Math.min(target+.18,duration/1000-.05);
              const frameState=await page.evaluate(seekCaptureFrame,{target:stable,deadlineAt});
              const image=Buffer.from(await page.screenshot({type:"jpeg",quality:95,clip:{x:0,y:0,width:1280,height:720},captureBeyondViewport:false}));
              captured.push({...frameState,score:probe.score,reason:checked===1?"baseline":"visual_change",image:image.toString("base64")});
            }
          }
          if(end>=duration/1000-.3){
            const target=duration/1000-.05,frameState=await page.evaluate(seekCaptureFrame,{target,deadlineAt});
            const image=Buffer.from(await page.screenshot({type:"jpeg",quality:95,clip:{x:0,y:0,width:1280,height:720},captureBeyondViewport:false}));
            captured.push({...frameState,score:null,reason:"end_boundary",image:image.toString("base64")});
          }
          await appendFile(join(root,"visual-changes.jsonl"),JSON.stringify({start_ms:start*1000,end_ms:end*1000,scores})+"\n");
          for(const frame of captured){
            if(Date.now()>=deadlineAt-1000)throw fail("OCR_DEADLINE_EXCEEDED","Live OCR could not complete the entire video inside the request budget.");
            const bytes=Buffer.from(frame.image,"base64"),frameHash=hash(bytes),number=records.length;
            const file=`frames/${String(number).padStart(5,"0")}-${String(frame.time_ms).padStart(7,"0")}.jpg`;
            await writeFile(join(root,file),bytes);
            const ocr=await worker.read(number,frame.image);
            if(ocr.frame_sha256!==frameHash)throw fail("OCR_FRAME_HASH_MISMATCH","OCR input does not match the newly captured image.");
            chain=hash(chain+frameHash+frame.time_ms);
            const record={...frame,...ocr,file,recognized_at:new Date().toISOString(),chain_sha256:chain};delete record.image;
            records.push(record);await appendFile(join(root,"ocr-frames.jsonl"),JSON.stringify(record)+"\n");
          }
          await journal({event:"ocr.progress",scanned_ms:Math.round(end*1000),frames:records.length,checked_frames:checked,elapsed_ms:Date.now()-Date.parse(startedAt)});
        }
        await assertAccess();
        const segments=mergeCaptionFrames(records,duration);
        if(!segments.length || segments.map(s=>s.text).join("").length<10)throw fail("OCR_NO_READABLE_CAPTIONS","The live video frames did not yield usable hard subtitles.");
        const captionCoverage=assessCaptionCoverage(segments,duration);
        await writeFile(join(root,"caption-coverage.json"),JSON.stringify(captionCoverage,null,2));
        if(!captionCoverage.sustained)throw fail("OCR_CAPTIONS_SPARSE","Readable scene text was found, but it does not form a sustained hard-subtitle track.",captionCoverage);
        const provenance={type:"ocr",provider:"live_browser_rapidocr",run_id:runId,request_id:requestId,
          stable_aweme_id:id,started_at:startedAt,finished_at:new Date().toISOString(),fresh_capture:true,transcript_cache_read:false,
          frame_count:records.length,checked_frames:checked,frame_hash_chain:chain,probe_hash_chain:probeChain,media_url_sha256:mediaHash,engine,
          coverage:{start_ms:0,end_ms:duration,full_video_scanned:true,visual_step_ms:250,threshold:.003,caption_activity:captionCoverage}};
        const result={status:"complete",method:"hard_subtitle_ocr",text:segments.map(s=>s.text).join("\n"),segments,language:null,
          confidence:segments.reduce((a,s)=>a+s.confidence,0)/segments.length,
          limitations:["visual_subtitles_only_not_spoken_audio","approximate_frame_capture_timestamps","sub_250ms_or_low_change_captions_may_be_missed","source_subtitle_errors_preserved","short_lived_ocr_variants_collapsed_by_temporal_consensus","ocr_not_manually_corrected"],source:provenance,
          media_resolution:{stable_identity:"aweme_id",media_kind:"video",media_type:"browser_decoded_video",acquired_at:startedAt,validated_at:provenance.finished_at,
            validation:{status:"live_browser_frames_read",frame_count:records.length,media_url_sha256:mediaHash}}};
        await writeFile(join(root,"result.json"),JSON.stringify(result,null,2));
        await journal({event:"ocr.completed",segments:segments.length,frame_count:records.length,frame_hash_chain:chain});
        return result;
      }});
      if(!retrieval.consumed)throw fail("OCR_PUBLIC_PLAYER_UNAVAILABLE","The public provider did not expose a playable video for OCR.");
      return retrieval.consumed;
    } catch(error) {
      await journal({event:"ocr.failed",code:error.code || "OCR_CAPTURE_FAILED",error_chain:errorChain(error)}).catch(()=>{});
      if(error instanceof ReaderError){error.details={...error.details,ocr_run_id:runId};throw error;}
      throw fail("OCR_CAPTURE_FAILED","The live subtitle capture failed.",{ocr_run_id:runId});
    } finally { worker?.close();this.busy=false; }
  }
}
