# CODEX NEXT TASK（下一项 Codex 任务）

## 目标

只完成 Tree Brain 收口的第三项：**只读任务状态镜像**。

不要重新开始项目，不要扩范围。

## 开始前必须读取

1. `/AGENTS.md`
2. `/docs/CURRENT_PROJECT_STATE.md`
3. 现有 Tree Brain 持久任务状态相关代码与测试

## 已冻结，不得重做

- Control Plane（控制平面）
- `task_start` / `task_status` / `task_resume`
- Worker（执行进程）
- `thread_id` 持久化
- 原线程恢复：已有线程必须 `resumeThread`，不得回退到 `startThread`
- 额度耗尽状态保存
- Content Reader（内容读取器）已通过链路
- Tunnel（安全隧道）、OAuth（开放授权）、本地聊天迁移、GitHub 第二套控制总线

## 只允许实现

从**现有 durable task state（持久任务状态）**生成只读投影，目标固定路径：

`artifacts/tree-brain/latest-task-state.json`

字段至少包括：

- `task_id`
- `thread_id`
- `status`
- `codex_status`
- `current_step`
- `completed_steps`
- `remaining_steps`
- `blockers`
- `last_result`
- `last_error`
- `updated_at`
- `start_thread_calls`
- `resume_thread_calls`
- `source`
- `generated_at`

## 设计约束

1. 镜像只能由现有持久任务状态派生，不能成为新的状态源。
2. 不增加数据库、队列、任务调度器或 GitHub 指令总线。
3. 不修改现有线程恢复语义。
4. 不伪造缺失字段；缺失时使用 `null` 或空数组，并保持来源可追溯。
5. 优先最小实现；如果“自动发布到 GitHub”需要新增凭据、长期守护进程或第二套控制路径，立即停止在该边界，只完成安全的只读投影能力并把剩余限制写入验收结果。
6. 不处理任何与本任务无关的工程优化。

## 必须新增测试

至少证明：

- 投影字段来自现有持久任务对象；
- 原任务对象不被修改；
- `thread_id` 原样保留；
- `start_thread_calls` / `resume_thread_calls` 原样保留；
- `BLOCKED_BY_QUOTA`（被额度阻塞）、`FAILED`（失败）、`COMPLETED`（完成）可正确反映；
- 不会改变原有 `resumeThread` / `startThread` 行为。

## 完成标准

只有在代码和测试都通过后才可报告完成。

最终只返回：

1. 实际修改文件
2. 测试结果
3. 是否真正生成 `latest-task-state.json`
4. 是否自动发布到 GitHub；若没有，写明真实阻塞原因
5. commit SHA
6. 剩余限制

禁止用“配置看起来正确”代替真实验收。
