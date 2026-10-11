# TREE_CONTENT_READER_RELIABILITY_001

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
