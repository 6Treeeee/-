# TREE_CONTENT_READER_RELIABILITY_001

## 2026-10-17：GOAL B 普通 ChatGPT 连续三次 fresh 完整闭环 PASS

原生桌面既有普通 Tree 聊天（输入框“询问 ChatGPT”）已仅凭陌生公开标准链接自动 start/poll，完整返回画面字幕 OCR、内容分析及 OCR 局限。原始 Worker artifact 与客户端完整文字独立比对通过。Tree大脑 项目已保存并重新读回自动调用及“先返回完整 OCR、再分析”指令；没有新建聊天或替代控制系统。

失败后当前连续验收：

| 轮次 | 输入 | request_id | Worker run | 当前结果 |
| --- | --- | --- | --- | --- |
| 4 | 陌生标准 /video/ 链接 | 5374dbe7-1658-4a17-8415-3729da11bf6e | 38979023164 | 完整客户端返回及来源核验 PASS |
| 5 | 真实作者主页 + numeric modal_id，仍为单视频 | 5257ca03-3033-40d8-ad75-bba78cfa3545 | 38988228481 | 完整客户端返回及来源核验 PASS |
| 6 | 同视频标准链接，新的 fresh 请求 | 4eff522b-ce6c-4f21-ba54-e8d309c0dfd2 | 38988853909 | 完整客户端返回及来源核验 PASS |

第 4、5、6 轮均为 aweme_id=7374041148219788595，90.836 秒、31 段、557 字；fresh_capture=true、transcript_cache_read=false、full_video_scanned=true、覆盖 0–90835ms，zip digest、request/aweme/Worker 来源、现有完整性契约和客户端完整原文全部通过。每轮在前一轮客户端最终回复后才发送纯链接，分别创建独立 request/run；客户端完整文字仅忽略空白及 Markdown 引用标记，与各自原始 artifact 逐字一致。第 5、6 轮回复未单独打印英文 status 字段，但完整返回了各自新 run 的实际结果；没有用旧结果充数。

第六轮 run=38988853909 的 probe job=117266478593 completed/success；worker commit=3033210dde2e4530003fe9454fb9a1780ab76e6c、attempt=1，artifact=12084437337，SHA-256=f80897d8c46fffae65b8e0a2c494844c5bf2c7e175028296b6969daccf1dd062，已下载原始 zip 并独立验证。汇总证据为 ordinary-chatgpt/three-fresh-client-acceptance.json。GOAL B 在当前画面字幕 OCR 能力范围内 PASS，读取链路冻结，不启动第七轮重复测试。

早期证据仍保留边界：第 1 轮为已知样本且显式选择插件；第 2 轮陌生长视频自动 completed/分析，339 段、4125 字已独立验证，但未在回复展示全部 OCR；第 3 轮真实 failed/WORKER_RESULT_INVALID，日志 OCR_CAPTIONS_SPARSE（字幕活动 2.28%），不能跳过它拼凑三次连续成功。只修正校验原因被笼统错误遮蔽的诊断输出，没有放宽完整 OCR 门槛。

范围：画面字幕 OCR，不等于完整语音转写；当前仅标准链接及带 modal_id 的主页单视频已取得新客户端证据，分享短链本轮尚未独立复测；纯主页批量不在本轮范围。无持续字幕的样本仍真实失败，字幕错字、短暂字幕漏读及未人工纠错的局限保留。证据见 artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/。GOAL A 的普通 ChatGPT Codex 工具暴露仍单独 BLOCKED，不由 Reader 成功替代。

## 2026-10-14：原入口故障已修复，普通 ChatGPT 三次仍待验收

TREE_MASTER_EXECUTION 已定位旧 Preview 主机 HTTP 410 / GONE，并将原 Proxy 固定上游替换为现有 Preview 分支别名。Proxy 提交 1c3e443、部署 dpl_7yQH9H4ttXAQJJ8THgA7XJRWnvAH；受保护调用保持既有身份和权限。

真实 Codex 插件请求 2f9b69a7-a548-4ce3-b596-1a72abdc5350 已轮询到 completed：run 38450670102、worker commit 828d7c775b81afb2c8ea3c63755d7c9b13d50226、86.588 秒、40 段、332 字，fresh/no-cache/full-scan 均满足。原始 artifact 与插件正文、分段、来源逐项独立核验通过；证据见 artifacts/tree-master-execution-2026-10-14/。

本轮普通 ChatGPT 三次均 NOT_EXECUTED，0/3；最新 Browser 返回 No browser is available，浏览器列表为空。不得用该 Codex 插件成功替代客户端验收。恢复登录的普通 ChatGPT 浏览器入口后沿用现有工具完成三次串行验收；不重复既有后台样本。OCR 的错字、漏字、短暂字幕及无字幕语音覆盖限制保留。

## 2026-10-11 主动查找普通 ChatGPT 入口

Owner 要求“你自己找入口”后，实际尝试现有浏览器入口：Browser 初始化失败，配置引用的 26.1007.21434/scripts/browser-service.mjs 不存在，本地 Browser 插件只找到 26.1002.52244；没有取得浏览器控制对象。Opera list_tabs 返回 Browser not connected。TinyFish 使用现有默认 profile 只读访问原大脑3会话，run 6ce3829a-163e-43ce-9c82-df9ac99804b5 被用户取消，result=null；其 profile 未记录 ChatGPT 登录，不据此假定现场一定登出。未重启该已取消路线，未发视频读取请求。

普通 ChatGPT 侧三次仍全部 NOT_EXECUTED（0/3）；BLOCKED / 验收 FAIL。恢复条件为取得已登录且能控制的现有普通 ChatGPT 浏览器入口，再在原 Tree 会话完成三次真实 start/poll/result。原阻塞 handoff 9704856 的自动回执已真实读回，workflow 38099618458 completed/success，source commit/blob 一致；回执不代表普通 ChatGPT 验收。入口检查证据补入 artifacts/douyin/reliability-2026-10-11/ordinary-chatgpt-acceptance.json。


## 2026-10-11 最后一项验收：BLOCKED

本轮验收结果 FAIL（未执行，不是视频读取失败）。已核对当前 Codex desktop 工具清单：Tree Content Reader 的 start_douyin_read / get_douyin_read_result 可用，但未暴露普通 ChatGPT 会话执行/恢复入口，也无 read_thread / send_message_to_thread。此事实仅限定当前执行环境，不推断普通 ChatGPT 内插件不可用。引用对话的缓存摘要不作为新验收证据。

普通 ChatGPT completed 为 0/3；三次均 NOT_EXECUTED，completed、fresh_capture、transcript_cache_read、full_scan、worker run、来源校验均无新证据（null）。本轮新读取请求 0 次；没有以 Codex 调用或旧 runs 38014710217、38014848065、38015014811 替代。

证据：artifacts/douyin/reliability-2026-10-11/ordinary-chatgpt-acceptance.json。handoff 保持 BLOCKED；未修改 Content Reader 代码、Production、基础设施或权威 task-state。恢复条件是普通 ChatGPT 原 Tree 会话具备真实执行入口，随后完成三次串行 start/poll/result 和来源校验；full_scan 对应实际结果字段 full_video_scanned。


日期：2026-10-10（Asia/Shanghai）

## 后续执行结果（取代下文历史“本轮新发请求为0”的当前状态）

Owner 后续要求执行。当前 Codex 通过已连接 Tree Content Reader 串行发起3次独立 fresh 请求，没有并发、没有第4次请求，也未改代码或部署。

| 次数 | run ID | request_id | 采集耗时 | 返回与验证 |
| --- | --- | --- | --- | --- |
| 1 | 38014710217 | c1febeaa-aaf9-4e44-9f98-2a5ebc4cfeda | 72170ms | 插件 completed；原始 artifact 独立核验 PASS |
| 2 | 38014848065 | e277f730-b7fe-4b58-abb9-85ab9612c527 | 98393ms | 插件 completed；原始 artifact 独立核验 PASS |
| 3 | 38015014811 | e937b207-1306-4d32-9cfb-213b1e738292 | 73169ms | 插件 start 成功；跨轮临时票据丢失，插件终态未观察；原始 artifact 核验 PASS |

每次都是 aweme_id 7690725127385894198，38 段、323 字，fresh_capture=true、transcript_cache_read=false、full_video_scanned=true。原始 envelope 的 request_id、aweme_id、worker run/attempt/commit 与 GitHub 元数据匹配；method=hard_subtitle_ocr、status=complete、duration>0、扫描结束接近或达到视频时长、非空 text/segments 均通过。运行时间证实前一次 completed 后才启动下一次。

证据文件位于 artifacts/douyin/reliability-2026-10-10/：plugin-attempt-1.json、plugin-attempt-2.json 为实际插件终态；plugin-attempt-3-artifact.json 为第三次原始 artifact 的白名单字段投影；fresh-run-verification.json 保存三次 run/commit/artifact 与完整性核对。未将签名票据、媒体签名链接、GitHub 下载临时地址写入仓库。

**后台连续3次 fresh 采集 PASS；Codex 插件终态仅实际观察2次；普通 ChatGPT 连续3次入口验收仍未执行。** 第三次通过 GitHub 核验不替代插件终态，也不以本轮 Codex 调用代替普通 ChatGPT 验收。三次未复现失败不代表根因已修复或长期可靠性保证。本轮执行与证据归档完成后停止。

## 以下为执行前的历史诊断

状态：最小只读诊断完成；普通 ChatGPT 连续 3 次 fresh 验收待续。Owner 明确选择“先保存诊断，普通 ChatGPT 验收待续”。本轮新发读取请求为 0，未修改或部署业务代码、Worker、Production、Control Plane、OAuth、Tunnel。

## 已核对的历史运行

从 GitHub Actions API 读取运行及 job 元数据，从相应提交的 acquisition-request.json 核对 request_id 和 aweme_id；以下均属于 7690725127385894198。日志原始事件见 ../artifacts/douyin/reliability-2026-10-10/historical-log-events.json。

| run ID | job ID | request_id | commit | 日志事实 |
| --- | --- | --- | --- | --- |
| 37454293533 | 112237988687 | 5a2172e6-0f26-4e80-b90f-f8065cc4a1ec | b931e4482954746cf73be253b02772876f5c9244 | pass=true，38 段、323 字 |
| 37573781047 | 112638022734 | 2269a602-42ac-4fc3-9d0f-4b6beadc31b3 | c8cbb20436808ad871ca2b030d6e2fae477470d2 | OCR_CAPTURE_FAILED；TimeoutError：Waiting failed: 15000ms exceeded；最终 TRANSCRIPTION_UNAVAILABLE |
| 37574363370 | 112639820009 | fe9e2f3b-5571-49d7-accf-bcc03b475a3d | df9fc9880d4188c2b952892c41f759e39f85e24f | pass=true，38 段、323 字 |
| 37574693235 | 112640844465 | 8f9d05da-bbcc-441c-b042-91a7ef2c9d2a | cde50dc71b3989fac74a2a304867ed093cd89daa | pass=true，38 段、323 字 |
| 37722788945 | 113134067900 | 4ec2afb2-1016-46f8-a1d6-b3d19370ffcd | a8072e72ba3cdc934ccf2b76026afde049d4b8db | DOUYIN_PUBLIC_WEB_IDENTITY_MISMATCH；最终 TRANSCRIPTION_UNAVAILABLE |

run URL 格式：https://github.com/6Treeeee/-/actions/runs/<run ID>。

三条成功运行的 acquisition.completed 日志均记录 fresh_capture=true、transcript_cache_read=false、full_video_scanned=true；每条 OCR 日志记录 214 帧。它们夹有失败，并非连续三次成功，也不单凭 worker 日志证明普通 ChatGPT 已收到完整内容。

## 最小诊断结论

1. **等待超时已定位到播放器就绪阶段。** run 37573781047 的 OCR 事件记录 15000ms 超时。采集分支随后已有 f6f6beb2218f0e9f2c8b14cdd0999335140eef44：首次 15 秒超时后检查访问边界，在剩余 deadline 内额外等待最多 10 秒，再检查访问边界。本轮只读核对，不重复实施、移植或宣称该补丁已通过本任务验收。
2. **身份不匹配是另一种失败。** 补丁之后的 run 37722788945 期望 7690725127385894198，但 live_player_page 实际观察到 7691602079621647651，目标 host/path 为 www.iesdouyin.com /share/video/7690725127385894198。拒绝错误视频是正确边界；不能去掉身份检查或仅延长等待来宣布修好。页面为何返回其他视频尚无足够证据。
3. **外层错误丢失了诊断层次。** 两条失败最终均以 TRANSCRIPTION_UNAVAILABLE 结束，而更早的 ocr.failed 保存了超时或身份不匹配。本次读取的原分支 src/mcp/douyin-tools.js、src/services/acquisition-github.js、src/services/acquisition-result.js 中，WORKER_RESULT_INVALID 覆盖多种来源、身份、freshness、coverage、内容完整性检查。仅凭聊天错误名无法定位具体检查。
4. **不能硬配对聊天中的错误。** Owner 已确认普通 ChatGPT 曾返回 WORKER_RESULT_INVALID 和 VIDEO_READ_FAILED，但本轮未取得它们各自的原始 task/run 映射和当时部署版本，不能把某条日志冒充其直接根因。上述五个 run 的 artifact API 当前均返回空列表；工作流设置 retention-days: 1，旧完整 result.json 无法从本次读取恢复。保留日志事实，不由摘要重建结果。

## 验收待续

当前 Codex 可发现 Tree Content Reader 插件，但 Codex 插件调用不等同普通 ChatGPT 入口验收。按 Owner 选择，本轮不启动新读取，当前新增普通 ChatGPT 验收计数为 0/3（未执行，不是三次失败）。

后续在普通 ChatGPT 的原 Tree 聊天，串行调用 start_douyin_read，每次按 poll_after_ms 轮询 get_douyin_read_result 至终态，再开始下一次。目标固定为 https://www.douyin.com/video/7690725127385894198 。连续三次均须 completed，并核对视频身份、非空真实文字与分段、fresh_capture=true、transcript_cache_read=false、full_video_scanned=true。

每次保留 request_id、worker run URL/ID、运行 commit、终态与上述内容字段；签名 task 票据不提交到 GitHub。若失败，保留原始错误码与该次 run 对应关系、及时保存仍在保留期内的脱敏结果证据，再做最小定位，不无限重跑。OCR 的错字、漏字和无字幕内容缺失限制仍然成立。

本轮停止于诊断归档和原固定交接入口回执，不启动第二套控制总线。
