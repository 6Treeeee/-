# 固定云端交接入口

- 任务编号：TREE_CONTENT_READER_RELIABILITY_001
- 目标：对 7690725127385894198 间歇失败做最小可靠性诊断；最终以连续3次 fresh 普通 ChatGPT 读取成功为验收。
- 状态：BLOCKED
- 更新时间：2026-10-11（Asia/Shanghai，UTC+08:00）
- 仓库：6Treeeee/-
- 分支：codex/a2a-control-loop
- 固定路径：gpt-handoff.md
- 实际结果：最后一项普通 ChatGPT 验收 FAIL（未执行，非三次读取失败），状态 BLOCKED。当前会话为 Codex desktop，已发现 Tree Content Reader start/poll 工具，但没有普通 ChatGPT 会话执行/恢复入口；read_thread、send_message_to_thread 未暴露。不能将当前 Codex 插件调用算作普通 ChatGPT 侧证据。本轮新增读取 0 次，普通 ChatGPT completed 0/3，三次所有结果字段均为 null / NOT_EXECUTED；未使用旧 runs 替代。此阻塞不代表普通 ChatGPT 产品内插件不可用。
- 证据路径/提交：artifacts/douyin/reliability-2026-10-11/ordinary-chatgpt-acceptance.json；docs/CONTENT_READER_RELIABILITY_001.md；docs/CURRENT_PROJECT_STATE.md。旧 Codex 证据保留在 artifacts/douyin/reliability-2026-10-10/，不计入本次普通 ChatGPT 验收。
- 下一步：待具备普通 ChatGPT 原 Tree 会话真实执行入口后，串行 start/poll/result 三次，逐次保留 completed、fresh_capture、transcript_cache_read、full_scan（原字段 full_video_scanned）、worker run 与来源校验。三次全通过才 PASS；当前不关闭任务。

## 工作方式

1. 当前对话负责限定目标、工作范围和判断标准。
2. 当前对话启动执行方。
3. 执行方使用已授权且可用的云端工具完成任务，并通过当前GitHub连接保存本入口。
4. 云端工作流自动生成gpt-handoff-receipt.json；执行方通过当前对话已有渠道自动返回结果位置。
5. 主代理实际读回自动回执与来源证据，核验后再决定是否继续。

## 后续复用

后续任务更新以下固定字段：任务编号、目标、实际结果、证据路径/提交、状态、下一步。
新接收方读取此入口即可恢复最近结果；应以入口指向的实际保存结果和提交证据为准。

## 范围与验收

此方式不依赖旧电脑或旧 Tree 对话，也不要求用户搬运日志。
工作范围是运行中的当前对话；本文件本身不会自动唤醒已结束的普通 ChatGPT 对话。
本次交付是当前对话内的交接与云端自动回执，不代表普通 ChatGPT 后台自动接收已经实现。
READY_FOR_REVIEW 表示等待验收；本任务 COMPLETE 表示上述文档交付完成，自动回执及接收方读回是否通过必须另核对真实运行和执行方最终证据。
本次云端自动生成已完成首轮运行和真实读回；后续任务的事实正确性仍必须依据各自证据核验。

## 自动回执

- 输入：本分支的gpt-handoff.md；输出：gpt-handoff-receipt.json。
- 当前GitHub连接或用户提交更新输入时自动触发；其它Actions内置令牌写入不保证触发。
- 接收方核对回执的source_blob_sha与来源文件，并依据workflow_run_url核对实际运行。
- 工作流只写生成的JSON，不读取业务代码，不使用原电脑，不自动唤醒已结束的聊天。
