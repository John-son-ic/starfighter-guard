# DSH第二批工作：D05 / D06

D01—D04已由Codex接受，决策见docs/reports/codex-20261015-DSH-review.md。直接实施下面两项，无需等待Codex完成飞行场景。不得修改src/app、src/visual、src/shared、package.json；Codex负责集成。

## D05 — 有界帧时间统计

状态：DONE（Codex已审查接受）（2026-10-15 完成自测）。结果：`node --test tests/dsh/frame-stats.test.mjs`退出码0，14用例通过0失败；`npm run check`退出码0（tsc通过，全仓105用例通过0失败，vite build通过）。容量默认300、1..10000整数校验、无效应忽略、empty全0、nearest-rank p95（ceil(n*0.95)-1）、fps=1000/mean、reset与多实例独立均已覆盖；另固定n=10/19/20/100的p95边界。未测量真实帧率，未据此声称性能达标。证据：docs/reports/dsh-20261015-D05.md。
允许：src/platform/frame-stats.ts、tests/dsh/frame-stats.test.mjs、DSH_REPORT.md、自己的历史报告与本文件状态。

实现以下公共接口（类型可以在本模块导出，不必改shared）：

```ts
interface FrameSummary { count: number; meanMs: number; p95Ms: number; maxMs: number; fps: number }
interface FrameStats { push(milliseconds: number): void; summary(): FrameSummary; reset(): void }
createFrameStats(capacity?: number): FrameStats
```

默认capacity=300，只保留最新capacity条样本；capacity应为1..10000整数，否则RangeError。push仅接受有限正数，否则忽略；summary不修改历史，返回快照；空样本各值为0；p95用排序后nearest-rank（ceil(n*0.95)-1）；fps=1000/meanMs。所有函数不依赖DOM、实际时间、计时器或网络。

验证：固定样本均值/p95/max/fps、容量溢出正确淘汰最旧记录、无效值、空值与reset、多实例独立、summary不能污染内部数据。不要据模拟数据声称游戏性能达标。

## D06 — 导出模型文件的一致性检查

状态：DONE（Codex已审查接受）（2026-10-15 完成自测），与D05独立。结果：`node scripts/verify-assets.mjs`退出码0，输出`verified 4 models, 533812 bytes`；`node --test tests/dsh/assets.test.mjs`退出码0，21用例通过0失败；`npm run check`退出码0。ID集合、文件名与路径穿越、GLB magic/版本2/头部长度、JSON chunk、accessor面数、scene mesh节点数、bytes长度、CLI退出码与报错输出均已覆盖。测试夹具建在artifacts/local/assets-test-<pid>/并在after钩子清理，public/models原件只读未改（manifest保持1397字节）。未做任何模型外观或比例判断。证据：docs/reports/dsh-20261015-D06.md。
允许：scripts/verify-assets.mjs、tests/dsh/assets.test.mjs、DSH_REPORT.md、自己的历史报告与本文件状态。

只读检查public/models/manifest.json和列出的GLB。脚本执行node scripts/verify-assets.mjs：任一错误退出非0并输出准确文件及原因，全部成功打印模型数和总字节。测试需能import导出函数而不触发CLI执行；可导出verifyAssets(directory: string)异步函数返回{modelCount,totalBytes}。

检查4个预期ID不缺失/不重复；文件名必须为该ID.glb，禁止路径穿越；GLB magic、版本2、头部声明长度匹配实际文件长度；JSON chunk可解析；三角形原语position/index accessor count算得的面数与manifest.triangles一致；顶层scene中mesh节点统计与manifest.materialBatches一致；实际文件长度匹配manifest.bytes。使用Node内置fs/path/assert，不添加依赖，不重导出模型，不改manifest。

测试使用仓库内artifacts/local下自建临时副本制造坏文件、截断、错bytes、错面数、错ID等，不能修改public/models原件。清理只删除本测试创建的明确目录。检查源工厂的几何比例是Codex模型测试职责，不要做截图判断。

## 完成方式

逐项测试后更新DSH_REPORT.md为REVIEW，保留D01—D04已经接受的事实，记录新报告路径。npm run check在Codex正在写UI时可能短暂失败：区分自身模块结果与集成状态，不修改Codex文件排错。两项完成即收束，不无限轮询或擅自增加工具。


2026-10-15：本批已收束。下一批读取docs/tasks/DSH_THIRD.md，任务D07/D08。
