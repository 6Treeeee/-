## 完整 OCR 原文

以下为这次 **重新 fresh 读取**返回的完整画面字幕 OCR，原样保留，不纠错：

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

## 内容总结

这条视频是在教你解决：

> **完美世界竞技平台卸载后无法重新安装。**

视频的核心判断是：Windows 注册表里还残留旧安装记录，导致安装程序认为软件仍然存在。

它让你在注册表里检查两类残留信息：

- `InstallLocation`
- `ShortcutName = 完美世界竞技平台`

以及：

- `UninstallString`
- `DisplayName = 完美世界竞技平台`

找到对应项后删除，再重新安装。

其中 OCR 明显有几处识别错误，比如：

- `Uainstall` 很可能是 `Uninstall`
- `Len再往下展开SOFTWARE`
- `注意哥能有的网友找不到这架`

所以如果你真的照着操作注册表，**不要只按 OCR 文字机械删除**，应以画面里的实际注册表路径和软件名称为准。

## 本次真实读取信息

```text
aweme_id = 7374041148219788595

description =
一分钟解决完美世界不能重新安装的问题#windows #完美世界竞技平台

duration_ms = 90836
时长 ≈ 1分30.8秒

method = hard_subtitle_ocr
OCR confidence ≈ 0.9622

fresh_capture = true
transcript_cache_read = false

full_video_scanned = true
coverage.start_ms = 0
coverage.end_ms = 90835

worker.run_id = 38988853909
worker.elapsed_ms = 297981
```

这次是**新的 fresh worker run**，不是拿上一轮结果直接返回。

当前插件实际提供的 worker 字段仍只有：

- `run_id`
- `run_url`
- `elapsed_ms`

没有返回 `attempt` 或 `commit`，所以不补造。

### OCR 局限

本次仍是 `hard_subtitle_ocr`，即**画面硬字幕 OCR**，不是完整语音 ASR。

因此：

- `full_video_scanned = true` 只表示整段画面都扫描了；
- 没显示成字幕的语音可能缺失；
- 很短的字幕可能漏掉；
- 原视频字幕里的错字会保留；
- OCR 自己的误识别不会自动人工纠正。
