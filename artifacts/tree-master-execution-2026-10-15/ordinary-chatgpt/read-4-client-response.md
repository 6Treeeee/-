## 完整 OCR 原文

以下为这次 `get_douyin_read_result` 返回的**完整画面字幕 OCR 原文**，不改字、不纠错：

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

这条视频是在解决一个很具体的 Windows 问题：

> **“完美世界竞技平台已经卸载，但重新安装时仍被系统判断为已安装/无法正常重新安装。”**

作者认为根因是：程序虽然被卸载了，但 Windows 注册表里还残留着安装信息。

视频给出的处理思路是：

1. 打开 **注册表编辑器**。
2. 在 `HKEY_LOCAL_MACHINE → SOFTWARE → WOW6432Node` 一带寻找与“完美世界竞技平台”对应的安装项。
3. 通过右侧的 `InstallLocation`、`ShortcutName` 等字段确认目标。
4. 删除对应残留项。
5. 再继续寻找另一处卸载信息。
6. 通过 `UninstallString` 和 `DisplayName = 完美世界竞技平台` 判断目标。
7. 删除该卸载残留。
8. 然后重新安装平台。

视频最后还特别说，如果第二处找不到，可能是之前已经从控制面板卸载过。

### 有几个 OCR 字样明显值得注意

我没有修改上面的原文，但从上下文判断：

- `HKEYLOCAL_MACHINE` 很可能是 `HKEY_LOCAL_MACHINE`
- `Uainstall` 很可能是 `Uninstall`
- `Len再往下展开SOFTWARE`
- `注意哥能有的网友找不到这架`

后两处明显存在 OCR 识别异常。

因此如果你真的准备照视频操作，**不要根据这份 OCR 里的拼写直接删除注册表项**；注册表删错位置可能影响其他软件。应以视频画面里的实际路径、字段名和目标软件名称为准。

## 本次真实读取信息

```text
aweme_id = 7374041148219788595
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

worker.run_id = 38979023164
worker.elapsed_ms = 305810
```

这次 completed 返回里**没有实际暴露 `worker.attempt` 和 `worker.commit`**，所以我不补造。

### OCR 能力边界

这次是**全片画面硬字幕 OCR**，不是完整语音 ASR。`full_video_scanned = true` 表示 90.8 秒画面都扫描了，不代表所有说出口但未上字幕的话都被读取。

插件本次明确标记的限制还包括：只读取视觉字幕区域、时间戳近似、极短字幕可能漏掉、原字幕错误会保留、OCR 没有人工纠错。
