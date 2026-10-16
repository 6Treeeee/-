# 固定云端交接入口

- 任务编号：TREE_MASTER_EXECUTION
- 目标：分别完成普通 ChatGPT 真正调动现有 Codex，以及真实读取公开抖音单视频两个闭环。
- 状态：RUNNING
- 更新时间：2026-10-17（Asia/Shanghai，UTC+08:00）
- 仓库：6Treeeee/-
- 分支：codex/a2a-control-loop
- 固定路径：gpt-handoff.md
- 实际结果：原 Proxy 与私有 Sites bridge 最小修复已上线，Vercel Authentication 保留。现已在原生桌面普通 ChatGPT 的既有 Tree 聊天取得一轮真实 completed 并返回完整 OCR/分析，request_id=70b9640f-97ae-409a-bab9-53a023e71a32，run=38727115080 success，40 段、332 字、86.588 秒，fresh/no-cache/full-scan 和原始 artifact 校验通过。该轮用了已知样本和显式插件选择，不冒充陌生纯链接验收。两个 GOAL 仍未整体 PASS。
- 证据路径/提交：artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/ 包含普通聊天完整回复、脱敏结果、来源校验和项目指令保存/读回证据；历史修复证据见 artifacts/tree-master-execution-2026-10-14/、bridge/content-reader-proxy/ 和 docs/CURRENT_PROJECT_STATE.md。执行线程保持 01a1317a-c479-7460-8c24-37351301787c。
- 最新客户端恢复结果：Browser 运行包缺失及反馈送达未确认的记录保留为历史，当前原生普通聊天已能实际使用 Reader，不再以 Browser 修复或前台条件作为当前唯一阻塞。Tree大脑项目的自定义指令原为空，已补入 Owner 原有 Reader 自动调用规则，实际保存并重新打开逐字读回一致。
- 当前普通聊天验收：第二轮陌生纯链接已自动 completed 并返回分析，run=38824126698 success；原始 artifact=12014621540、SHA-256=15f3f182598e6b35508902feef95c91cc0820fd29c99bfe847be02aa1cb41c64，契约验证通过，650741ms、339 段、4125 字、fresh/no-cache/full-scan。该轮没有在回复中完整展示 OCR，后续原文上下文已不可见，不能宣称全量文字交付通过。已保存并重新读回补充后的“先完整 OCR、再分析”项目指令，未重新采集第二轮。第三轮仅发送另一陌生链接 7693397287104890490，已自动进入 running：request_id=f8dcf988-2fae-4522-b1f9-c144865d3d7e、run=38978117206、commit=f6dba2e77d1f4e985b3becaf5d43808ffa5985ae。
- Goal A 独立结果：同一普通聊天显式选中 Tree Brain Codex 后，真实只读探测返回 TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE；连接检查/task_status 未暴露，task_id/thread_id/status 均 NOT_READ，未启动/恢复或创建替代任务。证据为 ordinary-chatgpt/brain-readonly-probe.json 及原回复；当前阻塞是普通聊天未加载实际工具，不能仅续期旧授权冒充修复。
- 下一步：继续普通 Tree 聊天中第三轮同一任务，取得客户端完整 OCR 和分析并独立核验 artifact；不得以当前 2 次 completed（仅 1 次完整 OCR 返回独立核验）宣称三次完整交付。Goal A 需现有合法的托管 MCP 连接真正暴露控制工具；本地安装/标签不等同托管连接。密钥不得发入聊天，不重造系统、不改 Production 安全边界。

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
