# Starfighter Guard · 狩猎者护航

单人网页太空战项目。当前是**可交接的工程基线，尚不是可玩的游戏**。

## 首版范围

玩家驾驶Eta-2，与2架AI ARC-170，在1艘狩猎者级附近迎击秃鹫战机。敌人分3波到达，每波3/4/4架，同时最多4架敌机，战场最多7架活动战机。目标时长3—5分钟：清除三波敌人，并保住自己与母舰。

只制作4种程序化低模；无需人物、座舱、机库内部、敌方母舰、轰炸机、三联战机或过场动画。当前模型尚未制作，建模源码未来统一放在 `src/visual/models/`。

## 给使用者

1. 把**本目录**作为Codex和DSH的项目目录。
2. 把下面的话发给DSH：

> 请读取根目录 AGENTS.md、DSH_HANDOFF.md 和 docs/tasks/DSH_QUEUE.md，从第一个满足依赖的 READY 任务开始，完成一个就测试并更新 DSH_REPORT.md。仅修改你的任务允许的文件。图形、模型和视觉验收留给 Codex。无需等我逐项批准，按队列持续推进；遇到阻塞先记录，再做其他不依赖它的任务。

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

`npm ci` 需要网络；有完整依赖后，检查和本地运行不依赖外部API。`npm run dev` 当前只打开工程基线说明页。`npm run build` 生成 `dist/`，`npm run preview` 在本地预览构建产物。

没有安装依赖时仍可用 `node --test tests/baseline.test.mjs` 检查数据基线。

Windows也可双击 `start-dev.cmd` 启动；第一次缺少依赖时会安装，随后打开基线说明页。关闭命令窗口可停止服务。当前不是游戏试玩入口。

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
