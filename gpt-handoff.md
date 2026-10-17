# 固定云端交接入口

- 任务编号：TREE_MASTER_EXECUTION
- 目标：分别完成普通 ChatGPT 真正调动现有 Codex，以及真实读取公开抖音单视频两个闭环。
- 状态：BLOCKED
- 更新时间：2026-10-17（Asia/Shanghai，UTC+08:00）
- 仓库：6Treeeee/-
- 分支：codex/a2a-control-loop
- 固定路径：gpt-handoff.md
- 实际结果：GOAL B 已在原生普通 ChatGPT 既有 Tree 聊天完成连续三次独立 fresh 完整 OCR/分析交付，run=38979023164、38988228481、38988853909 均 success；90.836 秒、31 段、557 字，身份、来源、原始 artifact digest、fresh/no-cache/full-scan、完整原文逐字核验均 PASS。GOAL A 仍 BLOCKED：修正本机同名错误 MCP 配置后，普通聊天真实复核仍为 TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE，task/thread/status 未读取；独立既有服务 initialize 返回 HTTP 401/TREE_BRAIN_UNAUTHORIZED，现存本地授权元数据已过期。两个目标没有同时通过，整个项目不 COMPLETE。
- 证据路径/提交：artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/two-goal-status.json、three-fresh-client-acceptance.json、read-4/5/6-verification.json 及客户端完整正文；brain-existing-connection-correction.json、brain-after-config-probe-response.md 保存独立 A 阻塞。既有错误诊断修复 f30d013e5f105dc0a92be746764681c0b451827f、Worker e23ef0b、CI 38978867771 PASS，Preview dpl_AnvKK8LSiYzFkaohPbcuYoW8um4o READY；Production/安全边界未改。原执行线程 01a1317a-c479-7460-8c24-37351301787c 不变。
- GOAL B 验收边界：第 4 轮为陌生标准链接，第 5 轮为真实作者主页 numeric modal_id 单视频，第 6 轮为该视频标准链接重新 fresh。三轮依次在前一轮客户端最终回复后开始，原始结果分别独立下载验证；客户端仅忽略空白和 Markdown 引用后完整匹配。早期第 3 轮 OCR_CAPTIONS_SPARSE 的真实失败保留，连续成功从第 4 轮重新计数；第 2 轮只有摘要未完整交付的缺口不计为完整 PASS。不启动第七轮重复测试。
- OCR 范围：画面字幕 OCR，不是完整语音转写；字幕错字、短暂字幕漏识别、无字幕语音及稀疏字幕样本的限制保留。分享短链仍按既有代码支持，本轮三连未独立复测；纯主页批量不在范围。
- GOAL A 最小修复：原本关闭的 tree_brain_codex 条目实际启动通用 codex mcp-server，已私下备份，仅改为已安装 Tree Brain 插件原有 HTTPS MCP、认证助手及工具白名单；保留 prompt 审批，其余配置逐字不变。CLI 和原生设置页读回 PASS，不能据此声称托管 ChatGPT 已连接。未 task_start/resume、未创建替代 Work/Codex 任务、未改权威持久任务镜像或续期授权。
- 下一步：Owner 在账号侧重新授权/连接现有 Tree Brain Codex，并恢复 content-reader read/check 范围的有效授权；不要把凭据发到聊天。完成后在原执行线程发送“继续”，先取真实 get_connection_status/task_status，再继续已授权的实际任务及原线程 resume 验收，只做 GOAL A 剩余工作。GOAL B 保持 PASS 冻结。已实测自动打开外部插件页被 blocked by policy 拒绝；不要重试绕过、重造 OAuth/Tunnel 或改 Production 认证。

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
