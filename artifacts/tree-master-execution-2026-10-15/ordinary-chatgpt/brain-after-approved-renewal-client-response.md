## Tree Brain Codex：普通聊天只读验收

验收结果：`TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE`

我检查了此刻本会话实际可调用的工具表，没有发现 `get_connection_status` 或 `task_status`，因此无法执行连接检查或查询持久任务。

### 1. 实际工具发现结果

| 工具                      | 当前状态          |
| ----------------------- | ------------- |
| `get_connection_status` | `NOT_EXPOSED` |
| `task_status`           | `NOT_EXPOSED` |
| `task_start`            | `NOT_EXPOSED` |
| `task_resume`           | `NOT_EXPOSED` |

### 2. 指定任务查询结果

目标工作区：`content-reader`

目标任务：`wrun_01M33A83TFAFR2JAXT0TTP2EBS`

| 字段                | 实际结果                       |
| ----------------- | -------------------------- |
| `task_id`         | `NOT_READ`                 |
| `thread_id`       | `NOT_READ`                 |
| `status`          | `NOT_READ`                 |
| `remaining_steps` | `NOT_READ`                 |
| 连接检查错误码           | `NOT_APPLICABLE`，连接检查工具未暴露 |
| 任务查询错误码           | `NOT_APPLICABLE`，任务查询工具未暴露 |

注意： 本次没有发起真实连接请求，因此不能报告 `401`、`200` 或其他服务端状态码。服务授权续期、重新发布等说明，也不能代替本会话的实际调用证据。

### 3. 执行边界

- 未调用 `task_start` 或 `task_resume`。
- 未创建 Work/Codex 替代流程。
- 未采集视频、部署、修改代码、配置或授权。
- 未使用历史消息或 GitHub 镜像补造任务状态。

最终结论： 当前阻塞点是普通聊天没有暴露 Tree Brain Codex 的只读工具入口。指定任务的真实持久状态仍未读取，不能判断它是否正在运行、已完成或仍有剩余步骤。
