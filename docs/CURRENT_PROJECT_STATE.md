# CURRENT PROJECT STATE（当前项目状态）

最后更新：2026-09-22

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

## 只读状态镜像实现与验收（2026-09-22）

只读导出能力已实现，9 项新增测试通过；**真实任务镜像尚未生成，普通 ChatGPT 读取验收未完成**。

- `src/a2a/task-state-mirror.js` 只投影持久对象字段，缺失值为 `null` / 空数组。`status` 与 `codex_status` 分别原样保留；不推断阻塞原因、不修改任务对象。
- `scripts/export-task-state.mjs` 一次性原子写入固定路径 `artifacts/tree-brain/latest-task-state.json`。失败保留旧文件，不创建任务、索引、调度器或发布进程。
- 在线模式直接读取已有 Workflow 的 `task-state` 流末条记录，避开会生成初始化占位状态的 `getTask` 和可能创建索引运行的读取路径。未修改现有 Control Plane、Worker 或线程恢复实现。
- 文件模式只接受原始持久任务对象，或原有本地持久记录中的 `state` 对象；拒绝验收摘要和镜像自身。来源记录文件名、SHA-256、JSON 指针及已有 scope，明确标注非实时快照。哈希用于追溯，不代表文件真实性认证。
- 在线来源记录任务 ID、持久版本、流名称与记录序号。`updated_at` 来自原任务，`generated_at` 仅代表导出时间。`latest` 指本次指定任务的最新读出记录，不表示跨任务自动发现。

运行方式（从仓库根目录执行）：

```powershell
node scripts/export-task-state.mjs --task-id <已有的真实Workflow任务ID>
node scripts/export-task-state.mjs --snapshot <原始持久任务JSON文件路径>
```

在线模式复用现有 Workflow SDK 运行环境与访问权限，不创建凭据。文件模式需要提供真实持久记录，不能将历史验收摘要当作原始状态。

验收证据：`artifacts/tree-brain/task-state-mirror-validation.json`。

- 新增测试 9/9，通过字段来源、不变性、线程 ID / 计数保留、三种终止或阻塞状态、原有 start/resume 转移行为一致性、只读流访问及 CLI 文件写入验证。
- 新模块和脚本语法检查通过。未重新运行已冻结系统的现场验收。
- 对已知历史摘要 `task-resume-2026-09-09.json` 实际执行导出，返回 `TASK_MIRROR_DURABLE_CODEX_STATE_REQUIRED`，退出码 1，未生成正式镜像；这是预期拒绝，不能计作真实任务导出成功。
- 该摘要记录的是历史本地测试任务，未包含原始 `state`，不能据此查询生产 Workflow。此次未取得可读取的真实原始状态或生产任务 ID，未尝试新增凭据或重新探测授权链路；没有声称发生新的授权故障。
- 未实现自动发布到 GitHub，也未执行推送。本次仅实现本地只读导出；正式镜像尚不存在，不能宣称 GitHub / 普通 ChatGPT 已可读取。后续发布仍需核对状态文本适合仓库可见范围。
- 同步前已有工作均保留并完成逐文件哈希备份，无同步冲突。全工作区 `git diff --check` 发现原有 `scripts/chatgpt-entry/start-existing-tunnel.ps1:74` 的末尾空行，未修改该文件。

## 下一步（仅剩验收条件）

用已有访问环境下的真实持久任务 ID，或真实原始持久状态文件，执行一次导出并核对字段；在该条件满足前，真实镜像与普通 ChatGPT 读取保持未验收。不得为此重开已关闭的路线或用测试数据补齐正式产物。
