# CURRENT PROJECT STATE（当前项目状态）

## 2026-10-20：Owner提供的TikHub402报告已核对为9月24日历史记录

实际读取原acceptance.json：recorded_at=2026-09-23T23:59:54.778Z（本地9月24日），提交bda833e1fe69de78c41c1986f0dc3bd08c04a8ad、旧Production dpl_65CefkWQs4vzv6p8cxEL2dukhLYB、测试176/176、当时仅一次fresh请求，App/Web均402且code=null/message为空。该提交已在当前历史中，不能作为刚上线的新提交或当前回归证据。

已复核当前scripts/acquisition-worker.mjs显式providers:[directProvider]及采集文档：后来通过普通ChatGPT三次fresh完整OCR的公开浏览器Worker不使用TikHub。因此保留GOAL B已有PASS，不重复采集，也不以这份旧402报告要求充值。TikHub当前余额/赠送额度/接口权益仍NOT_READ：进程、两个相关仓库根目录env及已有Tree Brain凭据目录没有可用TikHub副本；远端decrypt=false元数据确认TIKHUB_API_KEY为preview/production敏感变量，未请求或导出值。已核对官方只读get_user_info接口，但没有凭据/可见已登录页面，未调用账号API。官方402说明涉及余额和免费额度适用性，空响应不足以确证具体原因。

证据tikhub-historical-report-review-2026-10-20.json；本轮零视频/TikHub请求、无付款、无凭据/源码/部署修改。原GOAL A入口和任务读取阻塞不变，未创建替代任务。

## 2026-10-20 续执行：排除已包含的上游空密钥修复；保留策略读取被403拒绝

固定授权到10月20日06:22:56仍有效，实际get_connection_status为ready，原隧道PID11448仍运行；Browser所需service文件仍缺失。本轮未重试Browser启动、普通聊天提示、task_status或视频验收，未续期、部署或改生产源码。

只读核对上游vercel/workflow#1203及维护者指向的#1174：实际修复针对成功响应key:null的解析，本机@workflow/world-vercel4.7.0已包含nullable及null返回undefined逻辑，非成功HTTP仍拒绝。它不能修复本项目最近实测的原索引run-key404；没有据此盲升SDK或重新部署候选。官方Deployment Retention提供成功构建的软删除部署恢复窗口和网页Settings/Security/Recently Deleted入口，但当前尚未确认原部署删除状态、恢复资格或项目具体策略。现有连接器返回的项目元数据不含策略；使用已有本机Vercel凭据进行一次公开项目元数据GET实际403，已停止，未换凭据重试或绕过。不能将上游Issue的原始猜测当本项目根因，也不能断言原数据丢失。

证据brain-upstream-readonly-diagnostics-2026-10-20.json。GOAL B保持三连PASS冻结；GOAL A仍BLOCKED，原任务/thread/remaining仍未读到。账号侧仍需当前网页Connection/Tunnel画面或受支持Browser恢复，由代理判断已有隧道注册；保留策略恢复只在获准可见事实成立后执行，不重置索引。

## 2026-10-19 22:19 续执行：原隧道已恢复，网页控制组件仍缺失

22:27新增账号侧工具证据：对明确名称Tree Brain Codex调用plugin_management.get_app_permissions，实际返回status=not_installed（当前名称查询的账号结果，不代表已识别私有hosted app ID或断言所有工作区均无此应用）。插件目录搜索没有返回同名精确匹配，目录本身非穷尽，不能据此断言私有插件不存在。当前管理能力仅查询权限/依赖、搜索/建议、卸载和更新权限，没有创建或连接自定义MCP接口；未更改权限、安装其它应用或使用替代服务。PID11448仍在运行。未重复Browser失败启动、普通聊天提示、task_status或视频验收；源码只读追踪未获得新的线上格式或运行时指纹证据，因此未再部署候选。账号侧仍需可见网页表单，由代理判断后复用已有隧道。

实际 get_connection_status 返回 ready，主体仍 bearer:tree-brain-desktop、可见工作区1；原固定授权到2026-10-20 06:22:56 +08:00仍有效，本轮未续期、未部署、未改源码。发现早晨原隧道进程已退出；旧日志仅确认两条含超时的记录，未确定退出根因。使用原PowerShell7隐藏启动器恢复同一隧道，PID11448、22:18:56启动；重新解析响应后 healthz 为200/live、readyz为200/ready。第一次本地健康探测解析抛ArgumentException，不能算服务失败或成功。

当前官方Browser启动再次实际失败，缺少26.1013.40934/scripts/browser-service.mjs；没有修改可信配置、伪造组件或重试先前被策略拒绝的外部页面启动。网页Connection/Tunnel区域仍未观察到，hosted注册仍未验证。没有重复发送普通聊天探测或重试条件未变的task_status；早晨普通聊天NOT_EXPOSED和原索引run-key404仍为最近实测结果，任务字段仍NOT_READ，未task_start/resume。

GOAL B三次真实客户端PASS保持冻结，本轮零视频请求。整体仍BLOCKED，需要当前网页Connection/Tunnel区域截图或恢复受支持Browser，由代理直接判断和操作既有隧道注册。证据：brain-evening-continuation-2026-10-19.json；此前完整部署与普通聊天证据不变。

## 2026-10-19 本轮最终检查点：续期同代码发布通过；新普通聊天验收仍 NOT_EXPOSED；读取候选已回滚

Owner 已明确回复“授权续期24小时并发布同一代码”。原令牌、主体、content-reader read/check 范围保持，仅更新既有敏感 Production 授权并固定到 2026-10-20 06:22:56 +08:00；没有自动续期。按原部署 2JLy、withLatestCommit=false 重建为 READY dpl_29u8iDtKcGYNLTBxEp25W3ZaVsGn，源码仍 7bb3f7c。认证 initialize 实测 200/server=tree-brain-codex；当前工程会话五个真实工具恢复，get_connection_status 为 ready；匿名同请求仍 401。Reader Preview 别名独立读回仍为 dpl_7CmSsArRnzMgyAf4uRnxkvWGAArE。

读取候选 3e722c8（Production 隔离提交 1949e5b）严格限定 SDK4.8.4 源文件指纹，延后明文帧不需要的密钥请求；37项相关测试通过，缺失密钥、无密钥、篡改密文均仍失败。候选 READY dpl_3A7FeX4hSwP8T4tv3nmqX2FoHV6o 的构建日志确认补丁 applied，但真实 task_status 仍 isError=true / 原索引 run-key HTTP404。因此未通过真实验收，已将 sigma 和原默认项目域名都回切到本次获准同代码的 29u8 部署，并以 8fba9f0 从默认构建移除候选激活；候选仅保留隔离 review 别名和 helper/tests 供审查，未修改本机安装依赖或升级 SDK。构建应用不代表运行时指纹及原索引数据格式已确定，不能推断加密、数据删除或不可恢复。另一个已发现的 get_task 只读诊断请求实际被 403/TREE_BRAIN_FORBIDDEN 拒绝，未重试、绕过或扩大权限。

已实际恢复桌面原普通 Tree 聊天，显式选择 Tree Brain Codex，于06:31:42发送限定只读的新探测。完整最终回复已复制保存：TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE，四个核心入口 NOT_EXPOSED，task/thread/status/remaining_steps 全部 NOT_READ，HTTP未提供且没有真实客户端后端调用。不能用工程会话工具或服务200替代普通聊天验收；本次未 task_start/resume，未创建替代任务。原隧道 PID29392 于06:27:46启动，healthz/readyz均200且 readyz正文为ready，仍不等于 hosted 注册成功。外部网页 Tunnel 表单仍未取得，Browser service组件仍缺失，之前自动打开插件页曾被 blocked by policy拒绝。

GOAL B三连PASS保持冻结，本轮零视频请求；GOAL A仍BLOCKED。需要当前网页 Connection/Tunnel 表单截图或受支持浏览器入口，由代理判断账号侧选项；不再要求Owner技术分类或重复泛化授权。后端保留原索引、任务和线程，继续仅用获准机制核对剩余404，未重置或从镜像重建。证据 brain-renewal-and-client-acceptance-2026-10-19.json、brain-2026-10-19-client-response.md 及 prompt。下文06:19的等待续期记录为历史，已经被本节明确批准/应用结果取代。

## 2026-10-19：固定授权已到期，真实 401；离线验证 SDK 的明文帧密钥依赖问题

06:19 实测既有 Bearer 的 initialize 为 HTTP 401/TREE_BRAIN_UNAUTHORIZED。原固定 24 小时授权于 2026-10-18 21:54:17 +08:00 到期；未再次续期，未修改远端授权或部署。当前执行会话也不再暴露 mcp__tree_brain_codex 工具，不能把昨天工程会话的工具表视为今天仍可用。原隧道进程当前未运行；Browser 所需 service 文件仍缺失。两个别名独立读回：Production 仍 dpl_2JLy9WB5aBk6jbcFgMBW6hVRVquR，Reader Preview 仍 dpl_7CmSsArRnzMgyAf4uRnxkvWGAArE。

已准备单次 24 小时续期及同一 Production 代码 7bb3f7c 的审查稿，并提出异步确认；保留原令牌、主体、content-reader read/check、认证和 Reader 边界，不自动延长固定期限。审查稿 brain-renewal-2026-10-19-review.json 为 PREPARED_NOT_APPLIED，不代表已批准或应用。

独立离线验证发现 SDK 4.8.4 的 getDeserializeStream 在判断帧是否加密之前就解析密钥。使用合成明文帧与失败的模拟密钥解析器，真实复现“明文也因密钥请求失败而不可读”。私有隔离候选把密钥解析移到 encr 帧分支，验证明文无需密钥、加密帧用有效密钥可读、缺失密钥和篡改密文仍失败；没有修改安装依赖、仓库生产代码或线上部署。证据 sdk-stream-key-resolution-offline-2026-10-19.json。候选仅为后续最小修复依据，不证明原索引为明文，也没有读到真实任务正文。

GOAL B 保持 PASS 冻结；GOAL A 仍 BLOCKED，原索引密钥 404、普通聊天注册、工具暴露和任务状态读取均未被离线结果替代。恢复线上认证需等待这次有明确时限的续期答复；账号侧仍需可观察的网页表单或受支持浏览器入口。以下为历史检查点。

## 2026-10-18 续执行：索引查询最小修复已部署，真实正文读取仍遇到旧部署密钥 404

已修复两处有实测依据的问题：hook 查询不再把权限、网络、解密异常当作“不存在”并创建索引运行；只取 runId 时通过相同认证 World 的 hooks.getByToken 读取，不再让 SDK 4 提前解密未使用的 metadata。保留原索引、主体/工作区隔离、正文读取和解密、原线程恢复；未升级 SDK。主线提交 af685df、c8cf64e、e511f7f；30 项相关测试通过。

为保留 Production 边界，从原 5dccd27 单独应用上述修复到 codex/brain-hook-lookup-fix / 7bb3f7c002e39bb79cf37d5f1eb15fa5145fa89c，与原 Production 仅 control-service.js 和测试两个文件不同。READY Production dpl_2JLy9WB5aBk6jbcFgMBW6hVRVquR 已接原 sigma 域名；没有把新版 Reader Preview 发到 Production。原 Reader Preview 别名仍为 dpl_7CmSsArRnzMgyAf4uRnxkvWGAArE。匿名 initialize 实测仍 401/TREE_BRAIN_UNAUTHORIZED，现有工程会话连接工具实际 ready。

真实 task_status 先由安全分类定位为 A2A_WORKFLOW_HOOK_LOOKUP_KEY_READ_HTTP_404；去除无用 metadata 解密后，原索引正文读取仍报 run-key HTTP 404，指向 wrun_01M2DH54J8W01XKS1HFMF4405M / dpl_6C4Y6nK5hXBAh642WN8jsTgBBxgk。该旧部署元数据 API 同样 404/not_found。不能据此断言索引数据已删除、过期、加密或不可恢复。现有 CLI 身份对一个数据分片的格式探测返回 403，未取得正文或格式，未解密、未绕过。首次修复后查询前后运行列表及 SHA-256 完全相同，未再因查询失败新增索引运行；未 task_start/resume，task/thread/remaining_steps 仍 NOT_READ。

20:22 续执行现场：工程连接认证仍通过，Browser 所需 26.1013.40934/scripts/browser-service.mjs 仍缺失，网页表单未取得；没有重复发送普通聊天探测。原隧道进程已不在运行，已用现有 PowerShell 7 启动同一原隧道程序，PID 17936，20:24:06 启动，healthz/readyz 均 200；保留首次 2 秒 MCP 探测超时，不能当 hosted 插件验收。较早使用 Windows PowerShell 的隐藏启动失败，未将失败计作运行成功。既有 grant 仍仅 content-reader read/check，到期 2026-10-18 21:54:17 +08:00，没有再次续期。

整体仍 BLOCKED：普通 ChatGPT 注册/工具暴露未通过，持久索引正文也未读到；GOAL B 保持三连 PASS 并冻结。继续需要当前网页 Tunnel 表单截图或受支持的浏览器入口，由代理判断具体 UI；后端保留原索引，通过既有获准 Vercel 机制继续查明旧部署密钥依赖，不关闭加密、不重置或从镜像重建。证据：ordinary-chatgpt/brain-hook-lookup-repair.json。下节是本次修复前的历史检查点。

## 2026-10-18 当前检查点：授权及工程会话真实工具已恢复；普通聊天入口和持久状态查询仍 BLOCKED

Owner 已明确批准“授权续期 24 小时并重新发布原 Production 代码”。已复用现存令牌，仅将 content-reader、treebrain:read/treebrain:check 的既有授权续期至 2026-10-18 21:54:17 +08:00；没有旋转令牌、扩大工作区或关闭认证。远端 Secret 无法读回，实际使用本机已保存且令牌摘要匹配的既有 grant；没有声称远端旧值已逐字段比较。

原 Production dpl_BrtVwjcUrEQtoaJTYgxsQjQ7zsJq 按 deploymentId、withLatestCommit=false 重新构建为 dpl_CZcqr62yYs7R3zN2v7BfQEBLYHNg（READY、production），源码仍为 5dccd27c7668250574b3122b8c260bbecf031edc。只将原 sigma-silk-88.vercel.app 指向新部署；Reader 的 Preview 分支别名仍为 dpl_7CmSsArRnzMgyAf4uRnxkvWGAArE，未发布新版 Preview 到 Production。认证初始化 HTTP 200、server=tree-brain-codex；匿名同请求仍 401/TREE_BRAIN_UNAUTHORIZED。

当前执行环境已真实发现 mcp__tree_brain_codex 的五个工具。get_connection_status 实际返回 ready；list_workspaces 实际只返回 content-reader。对已有任务 wrun_01M33A83TFAFR2JAXT0TTP2EBS 的真实 task_status 仍返回 isError=true / A2A_WORKFLOW_HOOK_NOT_READY，未读到 thread_id 或持久任务正文，未 task_start/resume。

已用现有 Workflow SDK/CLI 只读核对：原索引运行 wrun_01M2DH54J8W01XKS1HFMF4405M 的元数据为 running，原 hook 元数据存在于同项目 production；查询触发的已观察索引运行 wrun_01M552H0DQZW8HN7YSE6RKTPR9 因 hook_conflict 指向原运行后 completed。独立本机 Vercel 凭据调用 hooks/by-token 返回 403。该 403 不是 Production 内部失败原因的充分证明，不能宣称索引过期/删除，也未重置 hook、创建替代索引或从镜像重构任务状态。

原生普通 Tree 聊天已再次显式选中 Tree Brain Codex 并发送只读探测，最终仍返回 TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE，任务字段 NOT_READ；此处未实际发出后端调用。工程会话真实工具与普通聊天必须分别验收。Owner 反馈网页插件页找不到 Tree Brain Codex，但有 Tunnel 选项；进一步明确只是列表未显示、尚未输入既有 ID，不能判定无权限或隧道不存在。

已启动原隧道 tunnel_6aa97a833a7481919834581673d9f199 的既有运行程序，仅一份隐藏进程；本地 healthz/readyz 均 200，readyz 同时保留首次 2 秒 MCP 探测超时提示。健康检查不替代真实平台轮询/工具调用证据。本次 Browser 初始化实际报缺 browser/26.1013.40934/scripts/browser-service.mjs，外部网页表单未取得；桌面普通聊天已实图确认。Owner 要求由代理判断，不再让 Owner 判断技术选项；需要当前网页截图或受支持浏览器入口恢复，才能继续账号侧注册。

GOAL B 的三次真实 fresh 完整 OCR/分析 PASS 保持冻结，未新增视频采集。整体仍 BLOCKED，原执行线程不变。新证据为 ordinary-chatgpt/brain-approved-renewal-verification.json、brain-after-approved-renewal-client-response.md、workflow-index-read-diagnostics.json；授权审查及明确批准记录见 brain-grant-renewal-review.json。

## 以下为阶段历史；到期和部署信息以当前检查点为准


## 2026-10-17 历史结论：GOAL B 连续三次 fresh 完整客户端闭环 PASS；GOAL A 独立验收未通过

普通 ChatGPT 既有 Tree 聊天（Tree大脑 项目，输入框“询问 ChatGPT”）已仅凭陌生公开视频标准链接自动调用 Reader，完整返回 OCR、分析及局限。此前修复该项目缺失的自动调用指令，并补充“同一回复先完整 OCR、再分析”，均实际保存、重新打开并复制读回一致。第 4–6 轮按序在前一轮最终回复后发送纯链接，独立新建 request/run，三轮均完整 PASS；不启动第七轮重复测试。

| 轮次 | 输入形式 | request_id | Worker run | worker commit | artifact |
| --- | --- | --- | --- | --- | --- |
| 4 | 陌生标准 /video/ 链接 | 5374dbe7-1658-4a17-8415-3729da11bf6e | 38979023164 | e1b766918056655b29e070d3a07b71e218f9d8cd | 12080471475 |
| 5 | 真实作者主页 + numeric modal_id 单视频 | 5257ca03-3033-40d8-ad75-bba78cfa3545 | 38988228481 | b85689156e82e664a1f4e4fc392f4f2763686279 | 12084092323 |
| 6 | 同视频标准链接，独立 fresh 请求 | 4eff522b-ce6c-4f21-ba54-e8d309c0dfd2 | 38988853909 | 3033210dde2e4530003fe9454fb9a1780ab76e6c | 12084437337 |

三轮 aweme_id=7374041148219788595，90.836 秒、31 段、557 字；fresh_capture=true、transcript_cache_read=false、full_video_scanned=true，覆盖 0–90835ms。各自原始 zip digest、request/aweme/run/attempt/commit、现有完整性契约和客户端完整 OCR 均通过。第六轮 job=117266478593 completed/success，zip SHA-256=f80897d8c46fffae65b8e0a2c494844c5bf2c7e175028296b6969daccf1dd062；客户端最后正文包含该新 run，完整 OCR 仅忽略空白及 Markdown 引用后与原始结果逐字一致。第 5、6 轮未单独打印英文 status 字段，实际终态证据为完整结果、分析及新 run；没有声称前端返回了不存在的 request/attempt/commit 字段。

验收范围是画面硬字幕 OCR，不能等同完整语音转写；短暂字幕、OCR 错字、未呈现为字幕的语音仍有限制。标准及 modal_id 单视频有本次客户端证据；分享短链保留既有支持，本轮三连未独立复测，纯主页批量不在范围。字幕稀疏样本仍可能真实失败。

保留早期未通过项：第 1 轮是历史已知样本并显式选择插件；第 2 轮陌生长视频自动 completed/分析（run=38824126698、339 段、4125 字、650741ms），但客户端没有展示完整 OCR，不能计为全量交付 PASS。第 3 轮 run=38978117206 真实 failed/WORKER_RESULT_INVALID，日志 OCR_CAPTIONS_SPARSE，active_ratio=0.022837、4/15 时间窗；失败证据保留，连续成功从第 4 轮重新计数。

最小诊断修复已发布：原校验器抛 plain Error，被 publicError 遮成 unexpectedly。现用既有 ReaderError 并在 Worker failed envelope 传递经过清理的白名单诊断；8 项针对性检查及 CI 38978867771 PASS。没有让 ASR 冒充 OCR或放宽身份/fresh/full-scan/覆盖门槛。主提交 f30d013e5f105dc0a92be746764681c0b451827f、Worker 提交 e23ef0b；第 4–6 轮实际运行修复后代码。新 Preview dpl_AnvKK8LSiYzFkaohPbcuYoW8um4o READY；Production 和已固定的 Preview 别名未改。

GOAL A：此前普通聊天显式选中 Tree Brain Codex 后实际返回 TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE，task_id/thread_id/status/remaining_steps 未读取。最新发现本机 config.toml 的同名条目关闭且启动通用 codex mcp-server，并非既有 Tree Brain。已私下备份，仅将该条目修正为已安装插件原有 HTTPS MCP、认证助手和工具白名单，保留 prompt 审批，其他配置逐字不变；CLI 解析和原生设置页读回通过。此修复只涉及本地连接，不等于托管 ChatGPT 注册或普通聊天工具验收通过。

既有服务实测 initialize 返回 HTTP 401 / TREE_BRAIN_UNAUTHORIZED；本地现存 content-reader、read/check 授权元数据已于 2026-09-14T14:45:50Z 到期。未读回远端敏感 grant，不能断言 401 仅由该到期值导致；未续期、旋转或扩大授权。配置修正后在同一普通聊天再次显式选中 Tree Brain Codex，最终回复仍为 TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE：get_connection_status/task_status/task_start/task_resume 均 NOT_EXPOSED，task_id/thread_id/status/remaining_steps 均 NOT_READ，没有发出后端任务查询。因此整体状态 BLOCKED。Owner 需在账号侧重新授权/连接既有 Tree Brain Codex，并恢复现有 content-reader read/check 范围的有效授权；凭据只在可信本地/产品授权界面输入，不发到聊天。不能通过改写服务端 grant 或重建 OAuth/Tunnel 代替该授权。之后在原执行线程继续，只验收尚未通过的 GOAL A，保留 GOAL B PASS。

证据目录 artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/，三连总证据 three-fresh-client-acceptance.json，各轮含结果、客户端正文及独立校验。原始 zip、媒体地址及签名票据均在仓库外。原执行线程 01a1317a-c479-7460-8c24-37351301787c 不变。GOAL B 已冻结；整个双目标项目未 COMPLETE。

## 以下为阶段历史，当前结论以上述 2026-10-17 小节为准

## 历史进度：普通 ChatGPT 已有一轮真实读取核验，纯链接自动触发继续验收

已通过原生桌面普通 ChatGPT 的既有“Tree”对话实际调用 Tree Content Reader 并取得 completed、完整 OCR 和内容分析，且已下载本轮 GitHub 原始 artifact 独立校验。request_id=70b9640f-97ae-409a-bab9-53a023e71a32，aweme_id=7690725127385894198，run=38727115080 success，attempt=1，worker commit=2d480fbb121197c9c8d3a3ab4b2ceaf09f349205；artifact=11968239746，SHA-256=fa5aa57108dc8d3f411068f838d1b2764e504d414f56440603576292b691cb06。40 段、332 字、86.588 秒，fresh=true、cache=false、full_scan=true，覆盖 0–86587ms；客户端完整 OCR 与原始 artifact 逐字一致（忽略 Markdown 引用标记及空白）。普通聊天真实读取已从 0 增至 1 轮；三次连续验收尚未完成，两个 GOAL 均未整体 PASS。

验收边界：本轮先只发送旧样本链接，普通聊天走了网页搜索，未创建采集任务。随后显式选择现有 Reader 插件才真实成功。因此这轮是 PASS_EXPLICIT_PLUGIN_READ，样本也属于历史已知样本，不能采用客户端回复中“陌生 Blind Test”或“纯链接已证明”的扩大判断。

已发现并最小修复客户端配置：此普通聊天所在“Tree大脑”项目的自定义指令为空；已填入 Owner 原有的抖音单视频先调用 start_douyin_read、按 poll_after_ms 查询 get_douyin_read_result、仅按真实 OCR 总结且不泄露票据的规则。已实际保存、重新打开并复制读回，逐字比对一致。没有改 synced sources、读取器、部署或安全配置。随后仅发送陌生候选链接 https://www.douyin.com/video/7650055582929456425，不附插件标签或调用提示，正在等待其真实工具调用及结果；本地 artifacts/docs 搜索未见该 ID 的历史读取记录。不要再以 Browser 缺包或此前前台问题作为当前读取验收的唯一阻塞。

证据目录：artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/，包含 read-1-result.json、read-1-verification.json、read-1-client-response.md、project-instruction-repair.json。签名票据、媒体下载地址和完整原始 zip 保留在仓库之外。Goal A 的本执行会话仍未发现可调用控制工具，旧授权过期；须独立真实验收，不能由 Reader 成功代替。

## 2026-10-15：原任务入口复核仍 BLOCKED

最新客户端入口：已通过桌面原生 UI 打开现有普通 ChatGPT“Tree”对话，实图确认标题 Tree、输入框“询问 ChatGPT”，与本执行线程的“使用 ChatGPT Work”不同；未创建新聊天。此候选入口不需要 Browser 运行包，但尚未验证插件调用。Owner 两次确认置前后，实际系统前台在发送链接前仍为其他原生程序，前台保护正确停止了操作，未粘贴或发送视频链接。已尝试正常窗口激活、AppActivate 及原生窗口最小化请求；实际前台未改变，未声称最小化生效，原因未知。当前唯一桌面动作是 Owner 在这台 Windows 电脑上手动 Alt+Tab 切到 ChatGPT，并在约 5–10 分钟的验收期间持续保持前台；可继续尝试原普通聊天三次串行读取，而不必先以 Browser 修复为唯一前提。仍为 0/3、未新增视频/控制任务，不把打开聊天或旧回复算作 PASS。证据：artifacts/tree-master-execution-2026-10-15/ordinary-desktop-entry.json。

最新反馈执行：Owner 对“是否发送无附件反馈给 OpenAI”的明确提问回复继续后，已恢复原生反馈表单，核对正文并取消文档、诊断日志、浏览器标签页/日志全部三项附件，实际点击提交一次。随后窗口关闭，没有取得成功回执、反馈 ID 或可见错误；当前客户端日志文件为 0 字节，不能补证送达。因此记录 submission_attempted=true、delivery_status=UNCONFIRMED，不声称反馈送达或 Browser 修复成功，也不重复发送。既有两个入口阻塞和普通 ChatGPT 0/3 状态不变；本轮未新增读取或控制任务。

最新恢复结果：正常退出请求已记录，旧主进程 4144 已被新主进程 10148 替代，新进程本地启动时间 04:58:26；Owner 已回到原线程继续。辅助启动器只留下 normal_quit_requested 回执，不能声称其自动重开步骤完成。重启后的 Browser 工具仍实际返回缺少 26.1007.71326/scripts/browser-service.mjs，本机仍只有 26.1002.52244、26.1007.21434。当前为 BLOCKED_CLIENT_RUNTIME_AFTER_RESTART，不能继续以“需要重启/安装扩展”为待办。

已打开原生“帮助 → 反馈”，填写脱敏故障说明，并取消文档、诊断日志和浏览器标签页/日志三类附件。反馈尚未提交，留给 Owner 审核发送；不发送本任务会话或敏感日志。当前工具发现仍没有 Tree Brain task_start/status/resume；插件目录搜索也未返回现有私有 Tree Brain 入口。两个目标仍未完成：普通 ChatGPT 视频 0/3 NOT_EXECUTED；Tree Brain 原生控制待连接与原范围授权。新增视频请求及控制任务均为 0。恢复条件为官方客户端修复运行包，以及现有 Tree Brain 合法连接/授权恢复；保持原线程、分支和已通过后端证据。

Owner 新截图已确认 Edge 商店的 OpenAI ChatGPT 扩展确实安装，显示“删除”和已安装说明；安装确认不再是当前待办。重试控制工具仍在初始化时报同一缺失 Browser 运行文件。当前已保存原线程检查点，准备正常重启桌面应用并通过 codex://threads/01a1317a-c479-7460-8c24-37351301787c 返回原任务，重新检查运行包是否由客户端恢复。不要移除现有扩展或新建平行任务。

Owner 随后授权直接操作客户端或打开正确页面。已用官方深链接打开原桌面应用设置，实图确认 Edge 扩展已安装/启用；Chrome 未安装。已通过原生“帮助 → 检查更新”取得 ChatGPT is up to date；内置浏览器开关关闭后重开并确认恢复启用，控制工具仍报同一缺失运行文件。已进入 Edge 的官方管理页面，实际点击“重新安装扩展程序”，打开 Microsoft Edge Addons 的 ChatGPT 页面。Owner 提供的 Chrome 商店截图提示商品无法购买或下载；不能推断具体地区、付款或账号原因。当前待 Owner 在已打开的 Edge 官方页面完成安装/权限确认；未声称重装或 Browser 恢复成功。证据：artifacts/tree-master-execution-2026-10-15/native-ui-recovery.json。不要移除现有扩展、关闭验证或改写受信服务来假装通过。

本日再次继续后已实际尝试官方 CLI 自行恢复：codex plugin add browser@openai-bundled --json 返回 exit 1，明确提示原 Browser 不在该市场。当前 CLI 配置的市场为 personal、openai-primary-runtime、openai-curated；完整可用列表也未返回原 bundled Browser。未将名称相近的第三方浏览器插件作为替代。CLI 的本地 Tree Brain Codex 插件确实 installed/enabled，但普通 ChatGPT 插件管理仍为 not_installed，两者不能互相替代。官方恢复文档要求桌面 Settings → Computer Use 重新安装/连接并确认 Manage；原入口恢复仍需要 Owner 完成桌面操作。未修改 trusted-service 配置或权限。

Owner 要求继续后，仅复核未完成的普通 ChatGPT 入口。Tree Brain Codex 插件实时返回 not_installed，当前未发现可调用的 task_start/task_status/task_resume；本机原授权元数据仍已过期。未原样重复此前已记录的 MCP 401 请求。

Browser 当前失败发生在初始化之前：Cannot find module browser/26.1007.71326/scripts/browser-service.mjs。config.toml:155 的 trusted service 指向该文件，实际该版本/文件不存在；本机只有 26.1002.52244 与 26.1007.21434，技能对应的 26.1002.52244 服务文件存在。该错误更新了 2026-10-14 的 No browser is available 现场；不能由旧 Browser 成功连接记录推断当前可用。通过官方插件更新/重装和连接界面恢复，不手工拼装受信服务或改造浏览器控制方式。

已发布的 Proxy 修复和真实 Codex 插件结果继续复用，普通 ChatGPT 三次仍 0/3 NOT_EXECUTED，本轮新增视频请求 0。恢复条件是 Owner 完成 Browser 官方更新/重装、连接已登录普通 ChatGPT 的浏览器，并连接现有 Tree Brain Codex、续期原范围授权。随后从本线程继续两个真实验收；不重建后端，不重做已冻结样本。脱敏证据：artifacts/tree-master-execution-2026-10-15/entry-recheck.json。

## 2026-10-14：TREE_MASTER_EXECUTION，两个普通 ChatGPT 闭环仍待外部入口

本节取代下文历史记录的当前判断。工程修复已上线，整体状态 **BLOCKED_EXTERNAL_ENTRY**，两个 GOAL 均未标记普通 ChatGPT PASS。

- Content Reader 当前故障根因已实时复核：Proxy 写死的旧 Preview 主机认证访问返回 HTTP 410 / GONE；Alias API 虽然指向 READY 部署，实际 HTTP 路由仍已删除。现有分支稳定 Preview 别名返回 HTTP 200、enabled/github_configured/api_auth_configured=true。
- 从原 Proxy 部署恢复真实源码，保存在 bridge/content-reader-proxy/。运行逻辑仅替换一个固定上游地址；既有 Bearer、OIDC、受限路径/方法和大小/时间边界保留。提交 1c3e443fe1f93ba0c2e8bec58ce0b4575420d689；原 Proxy 项目部署 dpl_7yQH9H4ttXAQJJ8THgA7XJRWnvAH READY，实际生产别名已独立匹配。Vercel Authentication 仍启用。后端 Production 未执行 promote 或部署。
- 现有私有 Sites bridge 已部署最小诊断改动：白名单错误码及受限 HTTP 状态，不转发原始正文、凭据、票据或签名链接。Sites 源码 ab4daf29f38200313a4866b2b28eab538bb7de89，部署 appgdep_6acdfe3c01e48191bc15d7cddb16cd66 succeeded。桥接测试 10/10，Proxy 测试 3/3，语法与 diff 检查通过。
- 修复后插件无效票据返回 INVALID_TASK / HTTP 400，真实 fresh 请求 request_id=2f9b69a7-a548-4ce3-b596-1a72abdc5350 已从 queued/running 轮询到 completed。Codex 插件返回 86.588 秒、40 段、332 字；fresh_capture=true、transcript_cache_read=false、full_video_scanned=true。GitHub run 38450670102 success，artifact 11841110527 已下载校验 SHA-256，并逐一核对 request、视频身份、run/attempt/commit、正文、分段与覆盖。Worker commit=828d7c775b81afb2c8ea3c63755d7c9b13d50226。**这是真实 Codex 插件链路 PASS，不是普通 ChatGPT 验收。**
- 普通 ChatGPT 3 次仍为 0/3 NOT_EXECUTED。此前本任务 Browser 一度连接，但 ChatGPT 页面 ERR_CONNECTION_CLOSED；最新初始化返回 No browser is available，官方发现接口返回 []。没有通过其他自动化绕过登录或浏览器边界。
- Tree Brain Codex 插件管理实时返回 not_installed；当前会话没有 task_start/task_status/task_resume。现有凭据访问生产 MCP 实测 HTTP 401 / TREE_BRAIN_UNAUTHORIZED，request_id=mcp_985e43c0-5928-4604-a974-9f8908d0d3eb。旧授权元数据已过期；没有扩大或重新签发授权。latest-task-state.json 仍是历史只读快照，未充当实时权威状态。Issue #2 机器人仍要求为仓库创建 Cloud Environment；Codex CLI 已登录 ChatGPT、cloud list 返回空，CLI help 未提供环境创建操作。该 GitHub 路线也不等同 Tree Brain 原生工具验收。
- Owner 必需操作：恢复一个可控制、已登录普通 ChatGPT 的 Browser 连接；通过原合法连接流程安装/连接现有 Tree Brain Codex，并续期原范围授权。不要把密钥发入聊天。恢复后从当前执行线程 01a1317a-c479-7460-8c24-37351301787c、原分支和下列证据继续，普通 ChatGPT 串行执行三次 Content Reader start/poll/result，以及 Tree Brain 真正的 status/start/resume 验收。已有 Codex 线程一律 resumeThread。
- 证据：artifacts/tree-master-execution-2026-10-14/acceptance.json、codex-plugin-result.json、worker-provenance.json。签名任务票据保存在仓库之外的本机私有执行目录，不进入 GitHub。OCR 仍只识别画面字幕，不能把全片扫描写成完整音轨转录。

## 2026-10-11 主动查找普通 ChatGPT 入口

Owner 要求“你自己找入口”后，实际尝试现有浏览器入口：Browser 初始化失败，配置引用的 26.1007.21434/scripts/browser-service.mjs 不存在，本地 Browser 插件只找到 26.1002.52244；没有取得浏览器控制对象。Opera list_tabs 返回 Browser not connected。TinyFish 使用现有默认 profile 只读访问原大脑3会话，run 6ce3829a-163e-43ce-9c82-df9ac99804b5 被用户取消，result=null；其 profile 未记录 ChatGPT 登录，不据此假定现场一定登出。未重启该已取消路线，未发视频读取请求。

普通 ChatGPT 侧三次仍全部 NOT_EXECUTED（0/3）；BLOCKED / 验收 FAIL。恢复条件为取得已登录且能控制的现有普通 ChatGPT 浏览器入口，再在原 Tree 会话完成三次真实 start/poll/result。原阻塞 handoff 9704856 的自动回执已真实读回，workflow 38099618458 completed/success，source commit/blob 一致；回执不代表普通 ChatGPT 验收。入口检查证据补入 artifacts/douyin/reliability-2026-10-11/ordinary-chatgpt-acceptance.json。


## 2026-10-11 最后一项验收：BLOCKED

本轮验收结果 FAIL（未执行，不是视频读取失败）。已核对当前 Codex desktop 工具清单：Tree Content Reader 的 start_douyin_read / get_douyin_read_result 可用，但未暴露普通 ChatGPT 会话执行/恢复入口，也无 read_thread / send_message_to_thread。此事实仅限定当前执行环境，不推断普通 ChatGPT 内插件不可用。引用对话的缓存摘要不作为新验收证据。

普通 ChatGPT completed 为 0/3；三次均 NOT_EXECUTED，completed、fresh_capture、transcript_cache_read、full_scan、worker run、来源校验均无新证据（null）。本轮新读取请求 0 次；没有以 Codex 调用或旧 runs 38014710217、38014848065、38015014811 替代。

证据：artifacts/douyin/reliability-2026-10-11/ordinary-chatgpt-acceptance.json。handoff 保持 BLOCKED；未修改 Content Reader 代码、Production、基础设施或权威 task-state。恢复条件是普通 ChatGPT 原 Tree 会话具备真实执行入口，随后完成三次串行 start/poll/result 和来源校验；full_scan 对应实际结果字段 full_video_scanned。


最后更新：2026-10-11

## 最新执行：目标视频三次 fresh 后台读取成功（2026-10-10）

- Owner 后续指令“执行”“继续”后，当前 Codex 通过已连接 Tree Content Reader 串行启动且仅启动 3 次 7690725127385894198 读取；运行 38014710217、38014848065、38015014811 均 success，三个原始结果包均已核对 request_id、视频身份、worker commit/attempt/run、非空 OCR 与 coverage，全部 PASS。
- 每次返回 38 段、323 字，fresh_capture=true、transcript_cache_read=false、full_video_scanned=true。三次采集耗时分别为 72170 / 98393 / 73169ms；完整等待时间还包含工作流准备与轮询。未重现此前两类失败，但三次小样本不证明间歇故障根除。
- 证据范围：前两次 get_douyin_read_result 已实际返回 completed；第三次 start 成功后，跨用户轮次的临时轮询凭证未保留，未观察到插件 completed，改为读取该次 GitHub 原始结果 artifact 核验，没有另开第4次读取。结论为后台连续3/3 PASS、Codex 插件终态实际观察2/3；普通 ChatGPT 连续3次验收仍未执行，不能改写成 PASS。
- 完整证据：artifacts/douyin/reliability-2026-10-10/plugin-attempt-1.json、plugin-attempt-2.json、plugin-attempt-3-artifact.json、fresh-run-verification.json。仅提交脱敏内容字段，不提交签名 task 凭证、临时下载链接或媒体地址。本轮未改业务代码、Production 或冻结基础设施。

## 最新进展：TREE_CONTENT_READER_RELIABILITY_001（2026-10-10）

- 最小只读诊断已完成；Owner 明确选择“先保存诊断，普通 ChatGPT 验收待续”。新增普通 ChatGPT 连续 fresh 验收为 0/3（未执行），可靠性尚未 PASS。
- 已从 GitHub 历史日志确认目标 7690725127385894198 的两种失败：run 37573781047 在 OCR 播放器等待阶段超过 15000ms；run 37722788945 的 live_player_page 返回其他视频 ID 7691602079621647651，身份检查正确拒绝。两者最终日志均为 TRANSCRIPTION_UNAVAILABLE，尚不能与聊天中的 WORKER_RESULT_INVALID / VIDEO_READ_FAILED 逐一对应。
- 采集分支已有 f6f6beb2218f0e9f2c8b14cdd0999335140eef44 的有限播放器等待补丁；未重复实施。补丁后的身份不匹配说明不能把超时等待视为所有失败的统一根因。
- 历史成功 run 37454293533、37574363370、37574693235 均有 fresh/no-cache/full-scan 日志，但并非连续三次普通 ChatGPT 成功验收。旧完整 artifacts 当前不可读取，不以日志摘要重建完整结果。
- 详细证据、请求与运行映射、验收条件：docs/CONTENT_READER_RELIABILITY_001.md；脱敏事件：artifacts/douyin/reliability-2026-10-10/historical-log-events.json。本轮未触发新读取、修改业务代码或部署；保持冻结范围。唯一后续仍为原 Tree 普通 ChatGPT 连续 3 次 fresh 读取及真实结果核验。

## 当前结论：TREE_BRAIN_CLOSED_LOOP_001（2026-10-10）

本节更新当前判断；下文按日期保留的阻塞与验收是历史记录。Tree / Finance Tree 继续现有主线，Infrastructure v1 保持冻结。

### 普通 ChatGPT 直接消费 Content Reader：PASS；可靠性待加固

- 普通 ChatGPT 已真实调用 Tree Content Reader 的 start_douyin_read / get_douyin_read_result，成功读取 aweme_id `7688672103729483058`、`7690725127385894198`；带数字 modal_id 的主页单视频链接也已成功读取。这是普通聊天 direct consumption path 的 PASS，已超出此前仅 Preview API 的可行性证明；不代表纯个人主页可批量读取。
- 已确认的成功链路包含 fresh capture、不读 transcript cache、全片扫描与真实 OCR 返回。`7690725127385894198` 曾先后出现 `WORKER_RESULT_INVALID`、`VIDEO_READ_FAILED`，随后成功。因此能力链路 PASS 不等于可靠性验收通过，也不能据此声称连续成功。
- 证据来源：Owner 在本任务中的明确确认，以及引用对话“大脑3”（conversation_id `6ab419c8-6754-83ea-818e-303bd709fb99`）的验收回顾。本轮归档既有事实，不重跑视频；未提供的原始工具 task/run ID、完整 OCR、modal_id 完整 URL 不补造。历史 Preview run `36954015208` 仍只证明其自身后端链路。
- OCR 是画面可见字幕的识别，可能漏字、错字或漏掉短暂字幕；全片扫描不等于完整音轨转录，也不保证无字幕语音、画面信息均被覆盖。

### 既有云端结果回传：PASS，限已验证范围

- `GPT_HANDOFF_PROBE_001` 云端结果回传 PASS：Codex 留下 GitHub 结果，云端接收方读回。Owner 与“大脑3”确认云端任务已返回结果；结果属于任务所属聊天，不代表任意旧普通 ChatGPT 聊天会被自动唤醒。
- 可核对的原始文件：`gpt-handoff-probe.md`，commit `46e17027c899cc088a74ef72c911ff972d6da91b`；独立读回记录 `gpt-handoff-probe-receipt.md`，commit `8e763ee378e1a441727ee11ab09cda7c13ec88b9`。该历史记录只证明其标注的独立 Codex 读回，保留其中 original_tree_read / automatic_trigger / unattended_discovery 的 NOT_VERIFIED，不把 Owner 后续确认倒写为当时的机器证据。
- 固定 `gpt-handoff.md` 与既有 `.github/workflows/gpt-handoff-receipt.yml` 已提供自动云端回执；此前运行 `37822646928` 对应 source commit `5427f473877df23f9749f634a3e359f7ec617009`、receipt commit `9aff107`。这些是既有机制证据，不是本任务的新 receipt。

### 本任务范围与验收边界

- task_id：`TREE_BRAIN_CLOSED_LOOP_001`。本轮从 Owner 的继续请求执行文档归档，提交原分支 `codex/a2a-control-loop`，再更新固定 handoff 为 COMPLETE，等待既有工作流生成 receipt，实际读回并核对 source_blob_sha、source_commit_sha、run 与 receipt commit。
- 文档提交与 handoff 提交分开；本任务最终验收以实际返回的 commit SHA、workflow run URL/ID、自动 receipt 与 SHA 一致性为准。此处不预填尚未发生的工作流结果。
- 本轮交付证明当前任务执行 → GitHub 结果 → 自动 receipt → 当前执行对话读回；不单凭 receipt 宣称原始“大脑3”已自动接收、普通 ChatGPT 原生 task_start/task_resume 写控制已通过，或完整无人值守闭环成立。
- 仅更新必要状态文档、固定交接入口和自动生成回执。Content Reader 代码、Production、Tree Brain Control Plane、Worker、task_start/task_status/task_resume、OAuth、Tunnel 均不改；不重做探针，不新增 command bus，不把 GitHub 文档变为第二套权威任务状态。
- 完成后停止。唯一下一任务：对 `7690725127385894198` 间歇失败做最小可靠性诊断，以连续 3 次 fresh 普通 ChatGPT 读取成功为验收；保留每次真实 task/run、错误或结果、fresh_capture / transcript_cache_read / full_video_scanned 证据，不以本地或 Preview 请求替代普通 ChatGPT 验收。本轮不执行该下一任务。

## Owner Goal（用户最终目标）

让普通 ChatGPT 能长期知道 Codex 的真实执行状态，并尽量减少人工传话、重复扫描和重复开发；同时不让“控制 Codex 的基础设施”反过来吞掉 Tree / Finance Tree / Content Reader 本身。

## 已验证通过

以下能力已有真实代码和验收证据，默认冻结：

- Tree Brain Control Plane（控制平面）
- `task_start`（启动任务）
- `task_status`（查询任务状态）
- `task_resume`（恢复任务）
- Codex `thread_id`（线程 ID）持久保存
- 已有线程使用 `resumeThread`（恢复原线程），不回退到 `startThread`（新建线程）
- 持久任务状态保存 `completed_steps` / `remaining_steps`
- 额度耗尽分类为 `BLOCKED_BY_QUOTA`（被额度阻塞）
- Worker（执行进程）真实执行
- GitHub App 已于 2026-09-22 安装到账号 `6Treeeee`，仓库 `6Treeeee/-` 当前具备 push（写入）权限

关键已验收基线：
- commit `31d425b709ab329c994b451f23c434be3b5918f9`
- 历史恢复证据：`artifacts/tree-brain/task-resume-2026-09-09.json`

## 当前被阻塞 / 暂停

### 普通 ChatGPT 原生完整写控制

状态：外部产品能力阻塞 / 暂停。

已确认 Tree Brain 后端不是主要问题。此前已尝试安全隧道、插件创建流程和普通 ChatGPT 入口验证，但普通 ChatGPT 侧未形成稳定的完整 `task_start / task_resume` 原生写控制路径。

处理方式：
- 不再扩建 Tunnel（安全隧道）
- 不再重做 OAuth（开放授权）
- 不再尝试把当前 Tree 项目变成本地聊天
- 不再用 GitHub 重新造第二套任务控制系统

只有 OpenAI 产品能力、账号/工作空间条件或官方支持路径发生实质变化时才重新打开。

## 当前收口目标

只做三件事：

1. 用 `AGENTS.md` 固化 Codex 执行规则，防止重复劳动。
2. 用本文件作为人类可读的当前项目状态入口。
3. 从现有 Tree Brain 持久任务状态生成只读镜像 `artifacts/tree-brain/latest-task-state.json`，让普通 ChatGPT 能读取真实状态；镜像不得成为新的状态源或控制系统。

## 禁止无新证据重试

- 本地聊天迁移
- 新 Tunnel（安全隧道）替代现有路径
- 重新设计 OAuth（开放授权）来绕过当前产品入口
- GitHub command bus（GitHub 指令总线）/ 第二套任务状态机
- 重做已经通过的 Control Plane / Worker / thread recovery（线程恢复）
- 重做 Content Reader（内容读取器）已通过链路

## 只读状态镜像真实验收（2026-09-22）

Owner 本轮明确授权创建且仅创建 1 条标记为 infrastructure-v1-mirror-acceptance 的真实 Codex 任务。实际生产执行完成，真实持久状态已生成正式镜像。2026-09-22，普通 ChatGPT 已通过 GitHub 连接独立读取远程 `artifacts/tree-brain/latest-task-state.json`，并核对 task_id、thread_id、status、completed_steps、remaining_steps、start_thread_calls、resume_thread_calls 与本轮验收结果一致。Tree Brain Infrastructure v1 正式收口。

- task_id：`wrun_01M33A83TFAFR2JAXT0TTP2EBS`
- thread_id：`01a0c6a4-c76e-7422-ba49-1cfff9294931`
- status：`completed`；codex_status：`COMPLETED`
- completed_steps：`["infrastructure-v1-mirror-acceptance"]`；remaining_steps：`[]`
- start_thread_calls：1；resume_thread_calls：0。
- 实际 Codex 返回：`infrastructure-v1-mirror-acceptance: 17 + 25 = 42`。
- 通过现有 WorkflowControlService.createTask、现有 Vercel CLI 授权和生产 Workflow 创建；现有 Worker executeTask / Codex SDK 执行。未修改 Control Plane、Worker、MCP、恢复逻辑或镜像设计。
- 初次 REST 创建请求因现有 /tasks 不允许 codex_task 字段而被 HTTP 400 拒绝，没有创建任务；随后使用上述已有服务方法完成唯一一次逻辑任务创建，沿用同一 request_id。
- 任务完成后以现有 SignedA2AClient.getTask 重新读取真实持久对象，再调用原有 scripts/export-task-state.mjs --snapshot 导出；全部 13 个任务投影字段逐一与原始对象深比较通过，源文件 SHA-256 校验通过。
- 正式镜像：`artifacts/tree-brain/latest-task-state.json`。source 记录真实读取链路、源文件哈希、任务版本和采样时间。原始对象保存在本机工作目录，未提交凭据或完整任务内部记录。
- 测试：npm test 272/272（含 9 项镜像测试），npm run test:worker 34/34。证据：`artifacts/tree-brain/task-state-mirror-validation.json`。
- 发布目标：GitHub 分支 `codex/a2a-control-loop`。推送后的远程文件核验及 commit SHA 记录在本轮最终回执中。
- 镜像是本次采样快照，不是实时订阅；未新增自动刷新进程或第二套状态源。保留原有未提交的无关工作。

## 已关闭的历史任务问题

历史 run wrun_01M2ETX7ZQ4N530W2FW6VARDWN 的元数据仍在，但数据于 2026-09-15T02:14:05.189Z 达到存储保留期限，task-state 读取抛出 RunExpiredError，应用将其转换为 HTTP 500 / A2A_INTERNAL_ERROR。此前只读证据：`artifacts/tree-brain/workflow-run-root-cause-2026-09-22.json`。

该历史任务不再尝试恢复。本轮验收完全基于上面的真实新任务，不使用历史摘要反推数据。

## Content Reader Level 2 生产现实审计（2026-09-23）

执行入口：`docs/CONTENT_READER_LEVEL2_NEXT_TASK.md`。状态：**BLOCKED_BEFORE_IMPLEMENTATION / Level 2 未通过**。本轮完成 Step 1 的部署、API、源码和授权审计；没有修改后端、新增工具、部署或重跑已验收视频。

- 真实生产入口：`https://sigma-silk-88.vercel.app/api`；现有 `api/index.js` 直接调用 `src/content-reader.js` 的 `readPublicContent`，可复用单视频请求 `type: "video", fresh: true`。
- Vercel CLI 当前部署证据：`dpl_GLUz9U7G7rn9SAYyuoMaFbxukkxX`，READY，源码 commit `31d425b709ab329c994b451f23c434be3b5918f9`。READY 不代表内容读取验收。API / MCP 请求上限分别为 300 / 60 秒。
- 线上 `/api` 返回 JSON、HTTP 200，`hard_subtitle_ocr.configured=false`；生产变量列表没有 `CONTENT_READER_OCR_PYTHON`。现有 `config/ocr-requirements.txt` 指定 `rapidocr-onnxruntime==1.4.4`。尚未执行生产 Python/import 探针，不能把“未配置”写成“平台绝无 Python”。OCR 生产部署缺口仍待修复。
- 同一健康响应报告本地 Whisper runtime 已验证；Gateway 标志为 true 只表示已有认证来源，不证明付费可用或新视频转录成功。
- 对 `/mcp` 的 `initialize`，匿名和本机已有 DPAPI 凭据均实际返回 HTTP 401 / `TREE_BRAIN_UNAUTHORIZED`。本机授权元数据到期时间为 `2026-09-14T14:45:50Z`；未读取/发布服务端完整 grant，不把本机副本当成生产配置证明。
- 部署 commit 与当前源码均未注册 `read_douyin_video`。生产工具列表因认证拒绝未能取得；普通 ChatGPT 调用与内容级问题均未验收。
- 当前首先需要解决的外部前提是可被现有 MCP 接受、且普通 ChatGPT 能使用的有效授权入口。按 AGENTS.md 第 4、5、6、10 条，遇到该授权阻塞后不继续扩建，不重开 OAuth / Tunnel / Tree Brain Infrastructure v1，不弱化认证。
- 后续仍有明确工程步骤：现有 OCR 的最小生产部署补齐 → 只读工具适配 → fresh 陌生视频与普通 ChatGPT 内容级验收。**不能宣称只剩授权、其他工程已经完成。**
- 脱敏证据：`artifacts/douyin/level2-production-audit-2026-09-23.json`。无新视频 URL / aweme_id，无新 transcript，无新 deployment；没有伪造验收样本。

## Content Reader 生产 OCR 独立任务（2026-09-23）

执行入口：`docs/CONTENT_READER_LEVEL2_PRODUCTION_OCR_TASK.md`。本轮独立推进公开 HTTP 后端，不以 ChatGPT MCP 授权阻塞工程。最终状态：**BLOCKED_BY_VERCEL_DEPLOYMENT_PERMISSION / 生产后端未通过**，不是 Level 2 完成。

- 已完成最小生产打包，源码 commit `d611d0a4e77f764d292df69fe59d216a6d5df26c` 已推送至 `codex/a2a-control-loop`。固定版本 CPython + 原 RapidOCR 及依赖，仅 `/api` 包含运行包；未改解析、OCR 算法/阈值/模型、ASR、MCP 或 Tree Brain。三个 OCR 模型哈希与原验收证据相同。
- 云端实际探针：默认 Python 不存在（ENOENT）；打包后 Python 能启动。默认 GUI OpenCV 导入缺 `libxcb.so.1`，改用同版本 headless 包后 Python / NumPy / OpenCV / ONNX Runtime / RapidOCR 初始化通过。现有 Chromium 截图通过、H.264 支持返回 probably。详细部署 ID 与证据见 `docs/CONTENT_READER_PRODUCTION_OCR_RUNTIME.md`。
- 陌生样本 `https://www.douyin.com/video/7421538381705907475` 在既有公开浏览器播放器探针中返回 `DOUYIN_SECURITY_VERIFICATION_REQUIRED`；未绕过验证，未取得文字稿，未证明播放器绑定或全片覆盖。
- 生产和预览环境已保存两个非敏感配置：`CONTENT_READER_OCR_PYTHON=assets/ocr/python/bin/python3.12`、`VERCEL_SUPPORT_LARGE_FUNCTIONS=1`。这些仅供包含打包改动的新部署使用，不会使旧部署自动启用 OCR。
- 生产部署 `dpl_BUT9xX7ZeyEwB7YRKjCds23WFnHh` 被平台拒绝。推送真实提交、核对 GitHub 作者为 `6Treeeee` 后的新尝试 `dpl_82JyKemzBDCeUB4uTdfneHAt7R2M` 仍为 BLOCKED / TEAM_ACCESS_REQUIRED；平台明确说提交作者没有该项目的部署权限。没有伪造作者、变更账号身份或绕过权限。
- 当前正式域名仍指向旧部署 `dpl_GLUz9U7G7rn9SAYyuoMaFbxukkxX`，新读的 `/api` 健康响应仍为 `hard_subtitle_ocr.configured=false`。**未发送/伪造新版本生产验收请求，未取得生产文字稿或内容级答案。**
- 这是明确的 Vercel 账号/作者部署授权阻塞，不是已证明的运行时资源硬限制；另有预览样本的抖音安全验证阻塞。按 AGENTS.md 第 5、6、10 条停止原样重试，不重设计架构。
- 验证：相关回归测试 154/154；既有语法检查与新增脚本语法检查通过；云端实际导入与引擎初始化通过；既有读取链路源码差异为零。
- 证据：`artifacts/douyin/production-ocr-2026-09-23/acceptance.json` 及同目录探针/部署/健康回执。恢复条件：Vercel 正确认可真实提交作者与项目账号的关联及部署权限；随后部署现有改动，继续真实 fresh 生产验收，无需重做运行包。
- 普通 ChatGPT 授权仍是另一独立待办；本轮未处理，未新增 `read_douyin_video`。

## Infrastructure v1 冻结边界

Tree Brain Infrastructure v1 已正式收口。除出现真实回归证据，或外部产品能力发生实质变化外，不再继续开发该基础设施；后续回到 Owner 当前最高优先级的实际项目。

## Content Reader 独立公开 provider 修复（2026-09-24）

- 当前任务仅处理 Content Reader 读取链路；Infrastructure v1、OCR、ASR、MCP 和项目基础设施未改。
- 已实时确认原生产部署 `dpl_BuYZkfvhdsSvvnKEvTFAVEdA7tNS` READY，正式域名 `sigma-silk-88.vercel.app` 指向它；`/api` HTTP 200，OCR configured=true。此前 OCR 打包发布已成功。
- 源码提交 `f236a38`：仅已知视频 ID、且 direct_public_web 明确报告 provider_path 安全验证时，允许现有 TikHub 独立单视频方法。只发送规范公开 URL，不转发浏览器状态。必须有明确公开状态字段；所有 filter_list/filter_detail 或已知受限标记优先于视频对象，不能当成经验证的访问状态，也不能继续切换 TikHub 路由。
- 独立读取失败仍保留终止型安全验证错误和脱敏尝试记录，防止媒体刷新失败后使用旧媒体、字幕或缓存。其他访问边界及 profile 路径保留原限制。
- 修改前相关测试 142/142；修改后 168/168，三个修改源文件语法检查通过，本次改动 diff 检查通过。测试不等于生产内容验收。
- 从干净 worktree 向同一 Vercel 项目实际提交生产部署 `dpl_HJLHxZn77rUuMzmkhuxqW2bwhsWP`；部署 API 返回 BLOCKED，seatBlock.blockCode=TEAM_ACCESS_REQUIRED，isVerified=false。旧部署成功未解除新提交的权限检查。没有改作者身份或原样反复部署。
- 当前状态：**IMPLEMENTED_AND_TESTED / BLOCKED_BY_VERCEL_DEPLOYMENT_PERMISSION**。本次修复尚未上线，未执行或声称新版 fresh 生产内容验收，没有取得新文字稿。
- Owner 下一步：在现有项目为这次上传部署完成真实授权或重新部署；READY 并核对正式域名后继续 fresh 陌生视频验收。无需重做代码、OCR 或 Tree Brain。
- 证据：`artifacts/douyin/public-provider-2026-09-24/acceptance.json`、`tests.log`、`production-health.json`。

### Git Integration 发布验收续记（2026-09-24，取代上面的当前部署阻塞状态）

- Owner 授权继续推送，已将 `f236a38` 及证据提交 `affe5af0c5c25e4225442a819d0e7a32ac44ae3d` 推送到原远程分支 `codex/a2a-control-loop`，远程 SHA 已核对。
- Git Integration 自动部署 `dpl_CQ6HRCJLHSRkPe8Fkpsm2R6frTF2`：source=git、作者=6Treeeee、SHA=affe5af、READY、无 seatBlock。生产分支配置为 main，因此此部署先作为预览构建。
- 预览健康检查通过后，现有 promote 操作实际创建生产部署 `dpl_FTYosi84UgYk7jhFW9fFdeLmeL5E`：同一 SHA，READY、target=production、无 seatBlock。正式域名独立查询已确认指向该部署；公开 /api HTTP 200，OCR configured=true。此次发布无需 Owner 操作，CLI 直接上传的旧拒绝不再作为当前发布阻塞。
- 两条此前未运行的公开搜索样本 `7679344860440071459`、`7673753332166430002` 均通过正式生产 /api POST type=video、fresh=true 实测；均 HTTP 422。provider_attempts 证实 direct_public_web 路径级安全验证后，TikHub 已实际尝试。第二条明确记录 TikHub App/Web 两条路由均 UPSTREAM_HTTP_ERROR。没有返回视频内容或文字稿。
- 上游具体 HTTP 状态被既有嵌套诊断深度限制截断，不能推断余额不足、401 或访问限制。补充本地诊断尝试使用既有生产环境配置，但 Vercel 拒绝导出 sensitive secrets，TIKHUB_API_KEY 未提供，本地没有发送 TikHub 请求；本地 SERVICE_NOT_CONFIGURED 不代表生产未配置。
- 最终分项：Git 推送 PASS；Git Integration PASS；生产发布 PASS；独立 provider 路由 PASS；fresh 内容读取 FAIL。当前待查为 TikHub 上游 HTTP 拒绝的真实原因，不再是 Vercel 发布权限或 fallback 未执行。本轮无源码修改，复用此前 168/168 测试。
- 新证据：同目录 `git-integration-acceptance.json`、`git-production-health.json`、两个 `fresh-*.json` 和 `tikhub-status-diagnostic.json`。这些续记证据保存本地，未额外推送触发另一轮部署。

## 2026-10-02：普通 ChatGPT 内容读取入口的实际状态

用户目标是：在普通 ChatGPT 的 Tree 项目对话中粘贴公开视频链接，由 GPT 自己调用 Content Reader、等待读取完成并给出基于真实全片文字的总结；同时能直接查询和恢复已有 Codex 任务，不再手工传话。

- 先前已真实验收 Preview 后端：aweme_id `7688672103729483058`，GitHub worker run `36954015208`，440000ms 全片、196 OCR 段、2757 字、fresh_capture=true、transcript_cache_read=false、full_video_scanned=true。证据见 `prototype/evidence/vercel-curl-preview-*.json`；该证据只证明 Preview API → worker → OCR → 结果，并不证明普通 ChatGPT 已调用。
- 新增 MCP 工具 `start_douyin_read` 与 `get_douyin_read_result`，限定 content-reader 工作区。前者仅接受公开单视频/分享 URL、触发既有 GitHub worker 并返回签名任务票据；后者轮询，只有经过现有 worker 完整性校验后才返回文字、分段、覆盖和来源状态。媒体签名 URL、Cookie、原始上游错误不会发给 GPT。开发分支提交 `2b642c37fb2f8c001fd82e476d02d22fee206782`；后续安全收紧在本节之后的提交。单元测试 11/11 通过。
- 对应 Vercel Preview 部署 `dpl_8iJip5W3wWio4v6Wgnoi19hZDAuh` 已 READY，源码 SHA 与提交一致；受保护 GET `/api/acquisition` 显示 Preview、GitHub、worker 密钥均已配置。GET `/mcp` 到达新函数并返回预期 405；这不是 MCP 工具调用 PASS。
- 当前实际阻塞：Preview 的 `/.well-known/oauth-protected-resource` 返回 503 / `TREE_BRAIN_OAUTH_NOT_CONFIGURED`。现有正式域名只有静态 bearer 资源配置，不具备 ChatGPT 所需的 OAuth 授权服务器；旧 Secure MCP Tunnel 的本机运行密钥与程序不在当前电脑。普通 ChatGPT 插件页目前要求用户登录。尚未完成 MCP 真实 start/poll/result、插件安装、Tree 项目对话总结、Codex 任务写控制验收。Production 未改动。
- 现有历史 `latest-task-state.json` 是一次性快照，不会自动更新；本轮没有把它当实时检测系统，也没有新建第二套任务状态源。MCP 的 `task_status` 是待接入的实时读入口。
- 下一关是完成 ChatGPT 登录/工作区权限检查，选择可持续的 OAuth 或现有安全隧道入口，并用一个真实公开视频在普通 ChatGPT 对话里完成工具发现、触发、轮询、完整结果和总结。只有这些实测通过，才能把 Level 2 标记为完成。个人主页批量读取未纳入本次单视频 PASS。
