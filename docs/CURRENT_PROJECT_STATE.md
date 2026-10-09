# CURRENT PROJECT STATE（当前项目状态）

最后更新：2026-10-10

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
