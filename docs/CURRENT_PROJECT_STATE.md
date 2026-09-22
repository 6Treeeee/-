# CURRENT PROJECT STATE（当前项目状态）

最后更新：2026-09-23

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

## Infrastructure v1 停止边界（继续有效）

Tree Brain Infrastructure v1 已正式收口。除出现真实回归证据，或外部产品能力发生实质变化外，不再继续开发该基础设施；后续回到 Owner 当前最高优先级的实际项目。
