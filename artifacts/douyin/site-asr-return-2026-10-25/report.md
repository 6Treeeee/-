# Tree Content Reader 原 Site 修复记录

状态：**已修复并部署；普通 ChatGPT 最终验收未完成，不能报告总体 PASS。**

2026-10-25（Asia/Shanghai），仅修复原 Site 的 MCP 返回校验。Site：https://tree-content-reader-bridge.clear-hake-8441.chatgpt.site/ 。插件 ID：`plugin_asdk_app_sites_af310756503881919ff366ba9baa6eef`，身份和访问范围保持。

## 根因与修复

GitHub 后端 `de71806` 已支持 Whisper；独立部署的 Site 第 10 版仍在 `worker/index.js` 的 `completed()` 中强制要求 OCR 专用 `full_video_scanned=true`。真实 Whisper 结果提供 `full_audio_scanned=true`，所以在最终桥接返回层被拒绝。

修复仅让原 Site 按 `method` 执行对应完整性契约：OCR 保留全视频扫描要求；Whisper 保留 fresh/no-cache、匹配视频身份、完整音频覆盖、分块数、Whisper 引擎与模型 SHA-256、已验证媒体以及非空/有序/有界时间戳检查。ASR 返回真实方法和音频覆盖字段，不改称 OCR，不关闭校验。

现有代理真实使用 `codex/a2a-control-loop` 的 Preview 分支别名。实时查询确认目标为 READY 的 `de71806b89562d5a6538437bdbd3be567b2579da`，没有改代理、后端或环境变量。

## 已完成证据

| 检查 | 结果与范围 |
| --- | --- |
| 原 Artifact | `12575305245`，run `40130743092`，ZIP SHA-256 与 GitHub digest 一致 |
| 同一真实结果回放 | 旧 Site 返回 `WORKER_RESULT_INVALID`；修复后返回 `completed` |
| 返回数据 | 视频 `7699751880649428250`；`local_whisper_cpp_base_q5_1`；4026 字符；343 段；`full_audio_scanned=true` |
| 全量对比 | 正文和每段文字/起止时间戳均与原 Artifact 精确一致 |
| 测试 | Site 12/12，含 28 种无效 ASR 拒绝检查；现有后端相关测试 18/18 |
| 构建 | 构建、ESM 导出校验与 diff 检查通过 |
| 原 Site 发布 | 第 11 版，`succeeded`，`has_mcp=true`，环境 revision=4、访问 revision=1 保持 |
| Site 源码提交 | `2ee90014143402dd68bbc92fbdcd21c5e61e75ac` |
| 发布 ID | `appgdep_6added65c89481918b4c39cb655b9597` |
| 线上插件只读拒绝检查 | Codex 已连接插件使用有意无效的测试票据，返回 `INVALID_TASK`、HTTP 400、stage=proxy；不能算有效任务完成 |

回放使用原真实 Artifact，但上游响应在本地注入。这证明修复解决了该结果在 Site 中的拒绝，不代表普通 ChatGPT 已收到结果。

## 真实阻塞和未完成步骤

受支持浏览器启动失败：缺少 `C:\Users\Administrator\.codex\plugins\cache\openai-bundled\browser\26.1016.62342\scripts\browser-service.mjs`。因此无法操作原普通 ChatGPT 页面。本工程上下文也没有原任务的有效签名 task，未伪造、重新签发或新建 task。

使用 Sites 返回的现有服务令牌作独立 MCP discovery 探测，平台返回 HTTP 401 / `Unauthorized`；没有生成或轮换令牌、伪造用户头或放宽认证。这与已连接插件的用户身份路径不同，不能归因为插件认证已坏。Vercel 14 小时历史日志查询被现有 Hobby 保留期限拒绝；较近日志未取得原 task，没有启用付费服务。

唯一未完成的产品验收：在原普通 ChatGPT 对话中，用已有有效 task 调用 `get_douyin_read_result`，确认 `status=completed`、视频 ID `7699751880649428250`、`method=local_whisper_cpp_base_q5_1`、4026 字符、343 段、`full_audio_scanned=true`。不要调用 `start_douyin_read`，不要重新采集，也不要把 task 凭证粘贴到聊天。

本轮新增视频采集=0，新增 OCR/ASR=0，新插件=0，新服务=0，安全校验关闭=0。普通 ChatGPT 验收仍为 `NOT_EXECUTED`。
