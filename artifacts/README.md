# 验证产物目录

2026-10-17按用户要求清理历史测试截图、浏览器临时资料、测试构建与旧便携包，释放2194172708字节。历史报告中指向artifacts的截图和临时包路径可能已不存在；报告保留原测试记录，不表示产物仍在磁盘。已提交的旧截图可从Git历史恢复，未提交的临时产物已删除。浏览器验证脚本运行后可重新生成截图。

仅保留local/c05-source-backup的旧模型源文件与GLB，以及local/venator-reference/official.jpg建模参考图，共约1.5MiB；这些资料不参与游戏运行。

本目录生成内容由Git忽略。运行游戏使用根目录start-play.cmd与dist，建模源码在src/visual/models，导出资产在public/models。自动化测试源码保留在tests（约170KiB），用于后续开发回归。
