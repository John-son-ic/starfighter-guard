# DSH第四批：离线试玩交付与操作文档校正

2026-10-15；起点dd98f16。先读AGENTS.md、DSH_HANDOFF.md和docs/reports/codex-20261015-C03-usability.md。

D07、D08仍为REVIEW，由Codex随后审查；不用等待它们通过才能做本批。本批不扩展玩法、不写游戏后端、不安装依赖、不修改模型、画面、world.ts、package*.json或共享接口。这里的HTTP工具仅提供已构建的静态文件，固定监听127.0.0.1，帮助用户在浏览器打开ES模块。

## 执行与文件范围

| ID | 状态 | 依赖 | 允许实现文件 |
| --- | --- | --- | --- |
| D09 | READY | 无 | scripts/serve-release.mjs、start-play.cmd、tests/dsh/release-server.test.mjs |
| D10 | READY（等待D09自测通过） | D09实现与针对性检查通过，允许尚未最终审查 | scripts/package-release.mjs、tests/dsh/package-release.test.mjs、docs/OFFLINE_RELEASE.md |
| D11 | READY | 无；按dd98f16之后实际源码核对 | docs/PLAYER_GUIDE.md、docs/MANUAL_CHECKLIST.md |

另外允许更新本文件的状态/结果、DSH_REPORT.md，并新增docs/reports/dsh-20261015-D09.md至D11.md（重名用新后缀）。不覆盖旧D07/D08报告，不替Codex把它们改为DONE。禁止Git写入、全局配置修改、改其他文件来掩盖失败。源码读取不受这些编辑范围限制。

一次完成一个工作包。D09受阻可先D11。全部REVIEW后停下，等待审查；不自动续加任务或无变化循环检查。

## D09 — 无第三方依赖的本地试玩启动

目的：已经拿到构建文件的用户，安装Node.js 24后可以双击启动，不必再npm install或运行Vite。

实现契约：

- scripts/serve-release.mjs仅用Node内置模块；导出createReleaseServer(rootDirectory)，返回尚未listen的node:http Server。被import时无启动、网络监听或打开浏览器等副作用。
- CLI默认静态根为该脚本所在目录的../dist（不依赖启动时cwd），端口5174，仅listen在127.0.0.1。允许--port参数用于端口冲突处理/测试；范围1..65535，非法参数清楚报错并退出非0。
- index.html不存在时CLI在启动前报错，提示开发副本先npm run build；不下载、不自动安装或生成替代页面。端口占用需给出明确错误和--port用法；不结束其他进程。
- GET与HEAD支持/、/?mode=models和构建中实际用到的JS、CSS、GLB、JSON、图片。正确Content-Type（JS可作为ES模块执行）、HEAD无响应体。不存在的文件404，非GET/HEAD返回405；不对缺失资源返回index.html，不列目录。
- 文件访问限制在静态根内。拒绝越界路径、Windows反斜杠/盘符/UNC形式、NUL、坏百分号编码以及指向根外的符号链接。不要只做字符串startsWith判断兄弟目录。此处是本地静态工具，无需鉴权/数据库/上传/代理/通用Web框架。
- start-play.cmd使用脚本自身目录启动、支持含空格路径；检查Node是否可用，不自动联网。窗口保留日志与可点击/复制的地址，异常时保留错误供反馈。控制台停止服务后不留下后台进程。无需实现自动打开浏览器。

验证：导入无副作用；临时夹具+随机空闲端口检查主页/query、JS/CSS/GLB MIME、HEAD、404/405及越界/编码拒绝；并验证真实dist首页及其引用的入口JS/CSS可以200读取。测试结束关闭所有server、清理自己创建的夹具。不要删除dist或改源码来造失败样本。未做Windows双击实测应明确写未验证。

## D10 — 可移动的离线试玩目录

目的：交付一个不包含node_modules的目录，复制到其他位置仍能用D09启动游戏。仅打包本地，不上传、不发布、不生成安装程序。

实现契约：

- scripts/package-release.mjs仅用Node内置模块。可导出packRelease({ projectRoot, outputRoot })供临时夹具测试，返回新生成目录绝对路径；被import无写入副作用。CLI默认projectRoot为项目根，outputRoot为artifacts/local/release。
- 打包前要求dist/index.html存在，以及D09脚本、启动器和本项说明存在；缺项非0退出并给出准备步骤。不自动运行npm安装/构建，避免与Codex正在执行的构建竞争；使用者先npm run build，再node scripts/package-release.mjs。
- 每次创建不冲突的新子目录，不删除/覆盖旧包，不递归移动源目录；输出路径不能位于dist内或复制源自身。按明确清单只复制dist/**、scripts/serve-release.mjs、start-play.cmd及简短中文试玩说明（可从docs/OFFLINE_RELEASE.md复制为包内README.md）。禁止顺带复制仓库根、.git、node_modules、源码、代理/环境文件、历史截图或测试夹具；拒绝复制符号链接。
- 包内结构保持dist/、scripts/serve-release.mjs、start-play.cmd，让D09的相对路径不变。说明写明已安装Node.js 24是前提，运行不需要npm/网络，首次开发依赖安装仍需要网络；关闭窗口停止服务，5174冲突如何处理，开发副本更新构建后需重新打包。
- 输出生成路径、总文件数和总字节数即可；无ZIP依赖/全量压缩/版本管理框架。用户确有需要再增加压缩形式。

验证：缺少构建时报错且不生成伪成功包；文件清单精确；源码/环境/依赖等诱饵文件不进入包；同一outputRoot重复打包不覆盖；拒绝源内输出和链接。将生成包复制到含空格的新路径，用包内CLI实际启动并HTTP读取首页与其本地入口资源，证明不依赖仓库绝对路径或node_modules。真实构建打包结果留在artifacts/local/release（已被Git忽略），报告给出路径，不声称已通过画面或断网适配验收。

## D11 — 以最新实现校正玩家说明

目的：把D08写成与实际游戏一致、初学者可用的说明。无需加新玩法或修改游戏来迎合旧文档；不为纯文字写单元测试。

已由Codex看到的具体偏差，必须核对并修正：

1. MANUAL_CHECKLIST E3写“有命中音效”，E8却说无独立命中音效；按audio.ts、start.ts消除矛盾。
2. E5写对友机开火会掉血；world.ts跳过与弹体同队的飞机，当前没有友伤。校正预期，不改游戏。
3. G2/PLAYER_GUIDE写重开返回第一波简报，实际上restart直接进入playing；说明应是重置并开始新的任务，首波仍延迟3秒。
4. B3/B4/B5不能把“标记永远在前面”“一次命中必击毁”“机身瞄准一定失败”写成必然结果；区分目标运动方向、提前量近似、辅助角度和击中/击毁。D07尚未接入，不写成精确截击已上线。
5. 补上新HUD的屏外方向箭头、蓝色母舰定位、目标血条/提前量虚线、舰体遮挡时隐藏提前量，以及右下角目标详情。
6. 补上暂停/恢复输入归零、暂停中移动鼠标不积累转向；低画质内部像素比0.75（标准上限1.5），不保证FPS提高某个固定值。

继续核对其他明显矛盾。当前源码是行为依据，说明尽量避免不必要的转向率等调参数字。人工记录列保持空白，不能把Codex的脚本截图当作DSH真人试玩。D09/D10尚在REVIEW时，将其说明标为本地交付工具待验收，不替换已有start-dev入口的可靠指引。报告列出文档修正依据的代码位置。

## 交付与门槛

每项完成先跑相关检查，标REVIEW并更新最新摘要；全部完成后跑一次npm run check。报告准确记录命令、退出码、机器检查与未验证项。若因Codex独立修改导致失败，保存失败摘要及与本任务的关联，不越界改文件。无需无变化重复全量检查。Codex随后负责代码审查、生产页面实际浏览器与视觉验收，以及接入D07后真实弹体整局回归。
