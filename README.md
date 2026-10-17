# Starfighter Guard · 狩猎者护航

单人网页太空战。当前可玩任务为**三波防守 → 两艘慷慨级跃迁 → 分别击破护盾 → 两批支援出击 → 摧毁两艘舰桥**。

玩家驾驶Eta-2，支持激光、锁定质子鱼雷与加速尾焰；每击破一艘敌舰的护盾，母舰放出1架Y翼和2架ARC-170；可护航轰炸机或亲自攻击舰桥。Y翼320生命、ARC-170为120、玩家仍为100。敌舰持续补充拦截机，同时最多10架敌机。新模型慷慨级与Y翼已加入模型页和GLB导出，资产总计6种。

双击start-play.cmd打开已构建试玩版，页面Ctrl+F5刷新。当前说明见[docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md)，完整范围见[docs/MVP.md](docs/MVP.md)。真人难度与设备帧率仍待试玩。

清理说明：历史验证截图和临时试玩包已按用户要求删除；保留源码、模型、自动化测试与当前dist。旧报告中的产物路径可能失效，详见[artifacts/README.md](artifacts/README.md)。

## 给使用者

1. 把**本目录**作为Codex和DSH的项目目录。
2. 把下面的话发给DSH：

> 请读取根目录 AGENTS.md、DSH_HANDOFF.md 和它指向的最新批次任务书，从第一个满足依赖的 READY 任务开始，完成一个就测试并更新 DSH_REPORT.md。仅修改你的任务允许的文件。图形、模型和视觉验收留给 Codex。无需等我逐项批准，按队列推进；遇到阻塞先记录，再做其他不依赖它的任务；本批完成后收束。

3. DSH完成一批任务后，给Codex发：

> 请读取 DSH_REPORT.md 和 CODEX_RESUME.md，检查 DSH 的改动，按既定计划继续开发。不要仅依据报告判断完成，请核对代码和测试。

默认轮流写入同一个目录，交接时让上一方结束写入。不要同时在这个目录切分支或提交。详细规则见 `docs/COLLABORATION.md`。

## 安装与检查

需要Node.js 24 LTS和npm，Windows PowerShell中推荐使用 `npm.cmd`。

```text
npm ci
npm run check
npm run dev
```

`npm ci` 需要网络；有完整依赖后，检查和本地运行不依赖外部API。`npm run dev` 打开飞行原型；点“查看舰船模型”或访问 `/?mode=models` 可回到模型预览。`npm run build` 生成 `dist/`，`npm run preview` 在本地预览构建产物。

没有安装依赖时仍可用 `node --test tests/baseline.test.mjs` 检查数据基线。

Windows双击 `start-dev.cmd` 启动；第一次缺少依赖时会安装，随后进入任务简报，点击“进入战场”开始。关闭命令窗口可停止服务。

已经构建好时，可双击 `start-play.cmd`，按窗口提示打开 `http://127.0.0.1:5174/`。这个入口运行时只需Node.js 24和支持WebGL 2的浏览器，不需要Vite或npm安装。

制作可复制分享的试玩目录：先 `npm run build`，再 `node scripts/package-release.mjs`。输出位置会打印在窗口中；整目录复制即可，详见 [离线试玩包说明](docs/OFFLINE_RELEASE.md)。旧打包目录不会自动包含后续修复，请重新生成。

## 首次试玩

鼠标离画面中心越远，转向越快；移回中心保持当前方向。W/S调油门，Q/E滚转，F开启5秒主动护盾（30秒冷却，激光免伤、撞舰弹开），Shift短时加速，空格向前短程跃迁（最多2500米，冷却10秒），左键开火。Tab选敌，跟随金色提前量提示瞄准；1让四架僚机集火，2召回掩护。Esc暂停，切换到其他窗口会自动暂停。暂停页可调整音量、灵敏度和画质。

屏外箭头指示敌机方向，蓝色“守望号”标记帮助找回母舰。目标被舰体挡住时会显示遮挡说明并隐藏射击提前量。恢复飞行时鼠标转向归零，重新移动鼠标后再转向。“低”画质将内部渲染像素比降到0.75，界面保持原尺寸。

提前量现已使用DSH的匀速截击求解，从实际炮口计算弹体两秒寿命内的预测位置；敌机后续转弯仍可能使射击落空。没有有效截击点时隐藏金色圆环并提示接近目标。

完成三波防守并摧毁两艘慷慨级舰桥且自己与母舰存活即获胜；座机或母舰被毁即失败。守望号的标记区域会受到敌机攻击，舰体也会阻挡激光和战机。当前是街机原型，操控、提示和难度会根据试玩反馈继续调整。

目前已验证：真实弹体伤害和舰体遮挡、碰撞反馈、事件接入、全关脚本驾驶、浏览器输入/暂停/胜负/重开、真实存储保存和不可用存储回退。软件渲染截图不能证明硬件帧率，5—8分钟仍是体验目标。

## 模型交付

- 2026-10-16：狩猎者级已按用户参考图片再次细化，94,744三角面、9材质批次，GLB约5.56 MB。双击 `start-play.cmd` 后访问 `http://127.0.0.1:5174/?mode=models&model=venator`，可切换舰桥近景、引擎近景和腹面。源码位于 `src/visual/models/venator*.ts`；新截图见 `artifacts/c06-venator/`。其他战机仍为首版低模。

- 修改源模型后运行 `npm run models:export`，更新6个GLB及manifest.json；脚本会重新导入GLB核对长度。
- 预览页的“导出GLB”可以下载当前单机或同尺度编队；GLB可供其他3D工具导入。
- 四种模型的透视、俯视及编队截图在 `artifacts/c01/`；视觉检查记录见 `docs/reports/codex-20261015-C01.md`。
- Windows本机安装Chrome后可运行 `node scripts/preview-qa.mjs` 复现浏览器检查。其他路径用CHROME_PATH指定；它使用隔离临时资料目录，不接管日常浏览器。
- 模型是便于接入游戏的近似低模，长度按参考值归一化，宽度、厚度和细节为近似设计；模型自身不包含飞行或伤害逻辑。
- `npm run check`现在也运行DSH提供的模型文件一致性检查；`npm run assets:verify`可单独执行。
- `node scripts/flight-qa.mjs`可在本机Chrome复现输入和任务流程检查，截图在artifacts/c02/。
- `node scripts/flight-usability-qa.mjs`检查暂停镜头、恢复输入、遮挡/屏外提示、画质分辨率、重开资源计数与小屏桌面布局，截图在artifacts/c03-usability/。两项飞行浏览器脚本使用同一端口，请顺序运行。
- `node scripts/release-browser-qa.mjs`运行生产试玩包并阻断外部网页请求，检查实际画面、输入和模型页；截图在artifacts/c04-release/。同样使用5188端口，请与其他浏览器脚本顺序执行。

## 仓库地图

| 路径 | 用途 / 负责人 |
| --- | --- |
| `AGENTS.md` | 双方共享的简短仓库规则 |
| `DSH_HANDOFF.md` | DSH起步入口 |
| `DSH_REPORT.md` | DSH最新进度摘要及下一步 |
| `CODEX_RESUME.md` | Codex中断后恢复入口 |
| `docs/MVP.md` | 冻结的首版需求 |
| `docs/ARCHITECTURE.md` | 依赖方向与集成方式 |
| `docs/CONTRACTS.md`、`src/shared/` | 模块接口，Codex维护 |
| `docs/tasks/DSH_QUEUE.md` | DSH可直接执行的工作包 |
| `src/sim/`、`src/platform/` | DSH：纯逻辑与存储适配 |
| `src/visual/`、`src/app/` | Codex：模型、渲染、飞行、整合 |
| `tests/dsh/` | DSH行为测试 |
| `assets/source/` | Blender等源资产（若将来需要） |
| `public/models/` | 导出的GLB（若将来需要） |
| `docs/reports/` | 不覆盖的阶段报告 |
| `docs/references/` | 原始调研，首版范围以MVP为准 |

本地Git仓库与GitHub风格目录已准备；远程仓库尚未创建、尚未上传。依赖目录、构建产物、个人配置与临时报告不纳入源码。模型源文件与最终运行所需资产必须留在本目录内，禁止引用父目录的绝对路径。

A/D：按住向左/右转向，按键期间优先于鼠标水平转向，两键同时按下水平转向归零；松开后恢复鼠标控制。鼠标俯仰及Q/E滚转保持可用。
