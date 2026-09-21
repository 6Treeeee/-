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

## 下一步

实现“只读状态镜像”，并用最小测试证明：
- 镜像字段只来自现有 durable state（持久任务状态）
- 不改变 `thread_id`
- 不改变 `startThread / resumeThread` 语义
- 不伪造任务数据
