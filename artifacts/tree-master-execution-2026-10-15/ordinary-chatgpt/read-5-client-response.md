## 完整 OCR 原文

以下是这次对“主页 + `modal_id` 单视频链接”实际 fresh 读取返回的完整画面字幕 OCR，**不改字、不纠错**：

> 本期视频教大家以最简单的方式
> 解决完美世界不能重新安装的问题
> 小白也看得懂哈
> 完美世界竞技平台1.0.24052311<上一步（P）下一步（D）>
> 注册表编辑器
> 点击打开上方搜索结果中的注册表编辑器
> 打开注册表编辑器以后
> 点击前面三角展开HKEYLOCAL_MACHINE
> Len再往下展开SOFTWARE
> 滑到下面展开WOW6432Node
> WOW6432Node展开后有很多子项
> 其他的不用管
> 就看子项名字是一长串字母和数字组合的
> 如果有多条就挨个点一下看右边
> 有没有名称为InstallLocation
> 并且ShortcutName是完美世界竞技平台
> 找到以后我们需要把右边对应的子项删除
> 删除后继续往下展开Microsoft
> ScriptedDiagnosticsProvider再往下展开Windows
> 再往下展开CurrentVersion
> 再往下展并Uainstall
> 展开之后会有很多子项
> 和刚才一样只关注名字是一长串字母和数字的
> 挨个点一下看看右边
> 是不是如图所示有UninstallString
> 并且DisplayName是完美世界竞技平台
> 同样的删除右边对应的子项
> 注意哥能有的网友找不到这架
> 找不到这个通常是从控制面板删除过
> 只删除这两项就可以重新安装了
> <上一步（P)完成（F）取消（C)

## 内容分析

这条视频解决的是：

> **完美世界竞技平台卸载后，仍然无法重新安装。**

视频给出的判断是：Windows 注册表里还残留着安装/卸载记录，所以安装器仍认为软件存在。

核心操作是去注册表里找两类残留：

- 一类通过 `InstallLocation`、`ShortcutName = 完美世界竞技平台` 识别；
- 另一类通过 `UninstallString`、`DisplayName = 完美世界竞技平台` 识别。

然后删除对应的软件残留项，再重新安装。

需要注意：这是**注册表修改**。OCR 里有明显错字，例如 `Uainstall`、`Len再往下展开SOFTWARE`，所以如果真操作，不应该只照 OCR 拼写删除；应以画面里实际注册表路径和“完美世界竞技平台”对应项为准。

## 本次真实读取信息

```text
input_type = Douyin user page + modal_id
modal_id = 7374041148219788595

aweme_id = 7374041148219788595
canonical_url = https://www.douyin.com/video/7374041148219788595

description = 一分钟解决完美世界不能重新安装的问题#windows #完美世界竞技平台

duration_ms = 90836
时长 ≈ 1分30.8秒

method = hard_subtitle_ocr
OCR confidence ≈ 0.9622

fresh_capture = true
transcript_cache_read = false

full_video_scanned = true
coverage.start_ms = 0
coverage.end_ms = 90835

worker.run_id = 38988228481
worker.elapsed_ms = 327474
```

这次结果里实际可用的 worker 字段只有：

- `run_id`
- `run_url`
- `elapsed_ms`

没有返回 `attempt` 或 `commit`，所以不补造。

## 这次额外验证了什么

这次不是标准 `/video/...` 链接，而是：

```text
/user/<用户ID>?modal_id=<视频ID>
```

系统成功识别出了：

```text
modal_id
→ aweme_id
→ canonical single-video URL
→ fresh 全片 OCR
```

所以可以正式记为：

> **抖音个人主页里的“带数字 modal_id 的单视频链接”读取 PASS。**

但它仍然只读取这个 `modal_id` 对应的视频，**不代表已经支持读取整个个人主页全部视频**。

### OCR 局限

本次仍然是 `hard_subtitle_ocr`，即**画面硬字幕 OCR**，不是完整语音 ASR。

因此：

- `full_video_scanned = true` 只表示整段画面被扫描；
- 没上字幕的语音可能缺失；
- 极短字幕可能漏掉；
- 原字幕错误会保留；
- OCR 本身的错字不会被自动纠正。
