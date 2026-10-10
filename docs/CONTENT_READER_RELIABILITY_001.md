# TREE_CONTENT_READER_RELIABILITY_001

日期：2026-10-10（Asia/Shanghai）

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
