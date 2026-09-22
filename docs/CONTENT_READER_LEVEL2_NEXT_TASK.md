# Content Reader Level 2 — 下一项真实任务

## Owner Goal（最终目标）

Owner 在普通 ChatGPT 对话框里直接发送任意正常公开、陌生、未提前缓存的抖音单视频链接，ChatGPT 可以调用已存在的 Content Reader（内容读取器），真正取得视频内容，并基于完整内容进行分析。

A. Douyin single-video backend（抖音单视频后端）
B. ChatGPT direct consumption path（ChatGPT 直接调用路径）

A 完成不等于 Level 2 完成。

## 当前已验证事实

以下能力已有真实证据，默认冻结，不得重做：

- 抖音陌生公开单视频身份解析、元数据、媒体发现与校验。
- Content Reader 正式单视频读取流程。
- 真实公开字幕轨优先。
- fresh live-browser hard-subtitle OCR（实时浏览器硬字幕 OCR）正式路径。
- Yuan 长视频完整硬字幕 OCR 验收。
- 一条陌生视频的诚实负例路由验收。
- 一条陌生视频的完整正例读取验收。
- 已有媒体 / ASR fallback（语音识别回退）保持不变。
- Tree Brain Infrastructure v1 已收口，不得在本任务中重开。

证据入口：
- `gpt-handoff-content-reader-level2-blind-test.md`
- `gpt-handoff-yuan-full-subtitle.md`
- `gpt-handoff-yuan-hard-subtitle.md`

## 当前真正未完成

普通 ChatGPT 尚没有一个已经验收的、可直接调用现有 Content Reader 的只读工具。

当前 `src/mcp/server.js` 只暴露 Tree Brain / Codex 任务控制工具，没有 `read_douyin_video`。

此外，已有 handoff 明确说明：硬字幕 OCR 路径目前是“本地正式入口已验证”，不能直接假设 Vercel 生产环境已经安装并实际跑通 Python OCR runtime（运行环境）。

## 本轮唯一目标

在不重做已 PASS 后端的前提下，完成 **普通 ChatGPT → read_douyin_video → 现有 Content Reader → 真实陌生公开视频内容** 的最小真实路径。

## 执行顺序

### Step 1 — 只读审计生产现实

先检查当前生产部署和已有 API / Content Reader 入口：

- 哪个正式生产 endpoint（接口）已经能调用现有单视频读取逻辑；
- 生产环境是否具备 hard-subtitle OCR 所需 Python runtime 与 `config/ocr-requirements.txt`；
- 是否已经存在可复用的只读 Content Reader 函数 / service；
- 不因“本地 PASS”推断“生产 PASS”。

只输出真实证据。不要先改代码。

### Step 2 — 找到最小接入点

如果现有生产 Content Reader 已可真实读取目标范围：
- 在现有 MCP server 中增加一个最小只读工具：
  `read_douyin_video`
- 输入只接受公开 Douyin 单视频 URL。
- 直接调用现有 Content Reader 逻辑。
- 不复制、不重写、不 fork 现有解析 / OCR / ASR 流程。
- 工具必须标记 read-only（只读）。
- 返回足够让普通 ChatGPT 理解和分析视频的完整内容与必要来源 / 置信信息，但不得泄露签名媒体 URL、cookies、凭据或内部敏感路径。

如果生产 Content Reader 尚未具备本地已 PASS 的关键读取能力：
- 只修“本地已 PASS 能力到生产”的最小部署缺口；
- 不扩展平台、不新增付费 ASR、不重新开发已有链路；
- 修复后再接 `read_douyin_video`。

### Step 3 — 真实验收

必须使用一条正常公开、陌生、未提前缓存的抖音单视频链接进行最终验收。

PASS 条件不是 HTTP 200，也不是工具注册成功。

必须证明：

1. 普通工具入口实际接受该陌生链接；
2. 调用的是现有 Content Reader 正式读取链路；
3. 视频 identity（身份）与请求链接匹配；
4. fresh 模式不读取旧 transcript cache（文字稿缓存）；
5. 实际取得足以分析视频内容的完整/合理覆盖文本；
6. ChatGPT 可基于返回内容回答至少一个内容级问题；
7. 不使用手工转录、fixture（固定测试数据）、预生成 transcript（文字稿）或缓存冒充真实结果；
8. 失败时返回真实阻塞，不伪造成功。

## 禁止

- 不重做 A2A / Tree Brain。
- 不扩个人主页。
- 不扩 Kuaishou / Bilibili / 其他平台。
- 不新增付费 ASR。
- 不把 GitHub 做成第二控制平面。
- 不重新开发已 PASS 的 Douyin 解析、OCR、媒体发现或线程恢复。
- 不因为“工具存在”或“配置正确”宣布 PASS。

## 最终回报

只返回：

1. 生产现实审计结果；
2. 实际修改文件；
3. 是否新增并真实暴露 `read_douyin_video`；
4. 真实陌生视频 URL / aweme_id；
5. 实际读取来源（caption / hard-subtitle OCR / ASR）；
6. 内容覆盖与关键证据；
7. ChatGPT 内容级验证结果；
8. 测试结果；
9. deployment（部署）ID；
10. commit SHA；
11. 最终 PASS / FAIL 与唯一剩余阻塞。
