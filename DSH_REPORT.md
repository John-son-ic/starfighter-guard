# DSH最新报告

状态：D01—D04 已由 Codex 审查接受（可接入游戏）。D05 帧时间统计、D06 模型文件一致性检查已完成自测并提交 REVIEW，等待 Codex 审查。无 BLOCKED 项，队列已收束，无剩余 READY 任务。

- 任务ID：D01 任务状态机、D02 伤害与武器状态、D03 设置存储、D04 有界确定性回归（以上已接受）；D05 有界帧时间统计、D06 导出模型文件一致性检查（REVIEW）
- 起始Git commit：b7da457（chore: establish reduced MVP and Codex-DSH handoff baseline）
- 完成日期：2026-10-15，Asia/Shanghai
- 环境：Windows，Node v24.16.0，npm 11.13.0
- 已完成：6/6 自测通过。D01—D04 状态 DONE（Codex 接受，见 docs/reports/codex-20261015-DSH-review.md）；D05、D06 状态 REVIEW

## 修改文件（本轮 DSH 交付）

| 文件 | 任务 | 说明 |
| --- | --- | --- |
| src/sim/mission.ts | D01 | 波次/结果纯状态机：createMission、advanceMission |
| src/sim/combat.ts | D02 | 伤害与武器纯函数：applyDamage、createWeapon、advanceWeapon |
| src/platform/settings.ts | D03 | 注入 StorageLike 的版本化设置读写：loadSettings、saveSettings |
| src/platform/frame-stats.ts | D05 | 有界帧时间统计：createFrameStats（环形缓冲、nearest-rank p95） |
| scripts/verify-assets.mjs | D06 | 导出模型一致性检查：verifyAssets + CLI（只读，退出码 0/1） |
| tests/dsh/mission.test.mjs | D01 | 20 个行为用例 |
| tests/dsh/combat.test.mjs | D02 | 16 个行为用例 |
| tests/dsh/settings.test.mjs | D03 | 16 个行为用例 |
| tests/dsh/regression.test.mjs | D04 | 11 个有界确定性回归用例 |
| tests/dsh/frame-stats.test.mjs | D05 | 14 个行为用例 |
| tests/dsh/assets.test.mjs | D06 | 21 个行为用例 |
| docs/tasks/DSH_QUEUE.md、docs/tasks/DSH_NEXT.md | 全部 | 状态与结果字段 |
| docs/reports/dsh-20261015-D01.md … -D06.md | 全部 | 六份独立证据报告 |
| DSH_REPORT.md | 全部 | 本快照 |

未修改 src/shared/**、src/visual/**、src/app/**、index.html、package*.json、tsconfig.json、vite.config.ts、assets/**、public/**（均为 Codex 维护范围）。未提交 Git，未切分支。D06 只读打开 public/models 下的 manifest 与 4 个 GLB，未改写。

## 测试命令 / 退出码 / 用例数

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --test tests/dsh/mission.test.mjs` | 0 | pass 20，fail 0 |
| `node --test tests/dsh/combat.test.mjs` | 0 | pass 16，fail 0 |
| `node --test tests/dsh/settings.test.mjs` | 0 | pass 16，fail 0 |
| `node --test tests/dsh/regression.test.mjs` | 0 | pass 11，fail 0；连续 3 次 digest 一致 |
| `node --test tests/dsh/frame-stats.test.mjs` | 0 | pass 14，fail 0 |
| `node --test tests/dsh/assets.test.mjs` | 0 | pass 21，fail 0 |
| `node scripts/verify-assets.mjs` | 0 | `verified 4 models, 533812 bytes` |
| `npm test`（全仓，`npm run check` 的测试阶段） | 0 | tests 105，pass 105，fail 0，skip 0 |
| `npm run check`（集成门槛：tsc + 测试 + build） | **0** | tsc --noEmit 通过；105 用例通过 0 失败；vite build 通过 |
| `npx tsc --noEmit --ignoreConfig ...`（DSH 四个模块，严格选项） | 0 | 独立确认 DSH 范围类型正确 |

**交付后复核（D01—D04 全部完成后重跑）**：20/16/16/11 用例各自通过、`npm run check` 退出码 0（当时 70 用例）；D04 的 seed 1 digest 复核为 `e67c7fa0`，与记录基线逐位一致。复核在未设置 NODE_OPTIONS 的标准环境下执行，未使用任何沙箱绕过参数。**D05/D06 加入后**全仓 105 用例通过、`npm run check` 仍为退出码 0。

计数口径：Codex 审查已明确 **`npm test` 为唯一用例计数入口**，无需为直接 `node --test` 的发现差异重命名运行器（该差异来自 Node 把 `scripts/test.mjs` 也当测试文件执行）。

## 关键实现结论

1. **D01**：判定顺序、事件一次性、每步最多一次阶段转换、ID 规则（`wave-{波号}-enemy-{序号}`）、spawn 当步不计杀、dt=0 语义均按 docs/CONTRACTS.md 实现并逐项覆盖。
2. **D02 修复一处真实数值缺陷**：武器冷却按 1/60 步递减 9 次后余 `2.08e-17`，原 `cooldownSeconds === 0` 判断使每发子弹晚一帧，射速随帧率漂移：实测射击间隔为 10 步（0.1667 秒）而非 9 步（0.15 秒），首次过热被推迟到第 12 发／第 110 步（修复后为第 11 发／第 90 步）。已用模块内 1e-9 容差把耗尽的冷却归零；修复后射击固定在 0/9/18/27/36… 步。未放宽任何校验、未改公共 API。修复前**仍会过热**，只是更慢——D02 报告已按 Codex 审查意见改为只陈述可复现的步号与热量数据。
3. **D03**：坏 JSON、null、数组、旧版本、字符串数值、错误 quality、getItem/setItem 抛错全部安全回退；写入只含四个约定字段。用 Proxy 断言模块不读取约定外字段（含私密字段）。
4. **D04**：单一 32 位 PRNG（mulberry32，内联无新依赖）驱动整局模拟；每步断言敌机上限、ID 唯一、生命与热量区间；种子 1 的 digest 基线为 `e67c7fa0`，跨进程可复现。D04 未发现 D01—D03 缺陷。
5. **D05**：`Float64Array` 环形缓冲只保留最新 capacity 条（默认 300，允许 1..10000）；`push` 只接受有限正数，其余静默忽略且不扰动窗口；空样本五项全 0；p95 用 nearest-rank `ceil(n × 0.95) - 1`；`fps = 1000 / meanMs`；`summary()` 返回新快照，改它不影响内部数据。
6. **D06**：只读校验 manifest 与 4 个 GLB 的声明一致性——ID 集合、裸文件名（硬拒路径穿越）、GLB magic／版本 2／头部长度／JSON chunk、accessor 面数、scene 中 mesh 节点数、文件字节数；CLI 失败输出「文件 + 原因」并退出 1，成功打印 `verified 4 models, 533812 bytes` 并退出 0。测试夹具建在 `artifacts/local/assets-test-<pid>/` 并于 `after` 钩子清理，`public/models` 原件未改。

## Codex 审查结论（2026-10-15，docs/reports/codex-20261015-DSH-review.md）

**D01—D04 已被接受，可接入游戏。** DSH 原列 6 项已知问题已全部得到决策：readonly 属调用方约束、不要求运行时冻结（问题 1）；解过热与射击可同一步、保留既定顺序（问题 2）；防御归一化可保留（问题 3）；v1 严格版本检查保留，但**浏览器集成必须捕获「访问 `window.localStorage` 属性本身」可能抛出的异常**，不能只依赖 getItem 内部捕获（问题 4，属 Codex 集成侧要求）；单个固定 digest 加多种子不变量足够（问题 5）；强制失败用于验证状态机可接受（问题 6）。冷却 epsilon 修复保留。

据此已修正 D01/D02 报告中两处过强措辞（readonly 冻结注释、热平衡用语），未改弱任何断言。计数口径已统一为 `npm test`。

## 已知问题（已写入各项报告）

1. `activeEnemyIds` 未冻结——**已决策**：readonly 是调用方约束，现策略满足契约，不增加每步冻结、不改 API（D01）。
2. 解过热与射击可在同一步发生——**已决策**：保留既定顺序（D02）。
3. `advanceWeapon` 对外部异常 state 字段做钳制而非抛错——**已决策**：可保留（D02）。
4. D03 `version` 严格 `=== 1` 无迁移逻辑——**已决策**：首版无迁移需求；但集成侧需按上条捕获 localStorage 属性访问异常。
5. D04 digest 基线只固定 seed 1；失败分支由固定步号强制触发——**已决策**：作为状态机回归足够，不作为真实战斗物理验收。
6. D05：p95 秩用浮点 `ceil(n × 0.95)`，极端 n 下理论上可能偏移 1；已固定 n=10/19/20/100 的当前行为，改口径需 Codex 明确（D05）。
7. D05：`summary()` 每次复制并排序整个窗口（O(n log n)，n ≤ 10000），未做性能声明；若每帧调用建议降低频率（D05）。
8. D06：只校验 GLB 的**声明值**，不解析 binary chunk 实际字节，因此「accessor count 与 buffer 长度不符」的坏文件不会被发现；也未强制要求 BIN chunk 存在（D06）。
9. D06：预期 ID 常量 `EXPECTED_MODEL_IDS` 固化在脚本内（与 `MVP_CONFIG.models` 一致）；模型集合变化需同步，或由 Codex 授权改为 shared 驱动（D06）。

## 未验证项

- 全部任务均未做视觉验收、未采集截图；逻辑测试通过不代表画面、模型比例或飞行观感通过，这些由 Codex 判定。**D06 未对模型外观、比例或造型做任何判断**，也未验证 GLB 能否被 three.js `GLTFLoader` 实际加载。
- **未测量真实游戏帧率**；D05 的测试样本是构造数据，D04 的毫秒数只证明有界，均不用于推断 GPU 性能或声称性能达标。
- 未在浏览器中运行；settings 只用注入的假存储验证，未测真实 localStorage 的隐私模式/配额行为（Codex 审查特别提示的属性访问异常场景未覆盖）。
- 未验证与 src/app 主循环的集成（Codex 正在实现中）；D05 未接入 `requestAnimationFrame` 真实帧时间采集。
- `npm run check` 退出码 0 对应本报告记录的最后一次运行；Codex 若继续大幅改动 src/**，需重跑门槛。

## 阻塞

无已知阻塞。此前 `npm run check` 因 Codex 未完成的 `src/app/style.css` 与 `ImportMeta.hot` 类型而失败，Codex 已自行补齐 `src/app/style.css` 与 `src/vite-env.d.ts`，门槛在 D05/D06 加入后仍为退出码 0。

## Codex 需处理（最小操作）

1. 审查 D05 的 src/platform/frame-stats.ts、D06 的 scripts/verify-assets.mjs 及两个测试文件，置 DONE 或给出偏差。D01—D04 已接受。
2. 集成要点（D01—D04）：每步只调用一次 `advanceMission` 并消费当步 `events`；收到 `spawn-wave` 立即生成敌机；该步死亡 ID 放到下一步 `destroyedEnemyIds`；用 `advanceWeapon` 的 `fired` 创建弹体；三维命中后交给 `applyDamage`；设置读写传入 `window.localStorage` 并**捕获属性访问本身的异常**。
3. D05 集成：由 Codex 采集真实 `requestAnimationFrame` 帧时间后 `push`；HUD 若需 p99/标准差需新增条目。
4. D06 集成：可在 CI/导出流程调用 `node scripts/verify-assets.mjs`（退出码即可用作门禁）；模型集合变化时同步 `EXPECTED_MODEL_IDS`。

## 最近历史报告

- docs/reports/dsh-20261015-D01.md — 任务状态机
- docs/reports/dsh-20261015-D02.md — 伤害与武器状态（含冷却 epsilon 缺陷的可复现计时证据）
- docs/reports/dsh-20261015-D03.md — 设置存储
- docs/reports/dsh-20261015-D04.md — 有界确定性回归与移交清单
- docs/reports/dsh-20261015-D05.md — 有界帧时间统计
- docs/reports/dsh-20261015-D06.md — 导出模型文件一致性检查
- docs/reports/codex-20261015-DSH-review.md — Codex 对 D01—D04 的审查与决策（他方文档）

## 下一步

D05、D06 已按 docs/tasks/DSH_NEXT.md 完成并置 REVIEW，两项完成即收束：不增加新工具、不擅自扩展接口（如 p99/标准差、GLB 二进制深度校验、模型尺寸语义检查均需 Codex 新增条目）。队列无剩余 READY 任务。若 Codex 给出契约偏差或新增工作包，DSH 从对应报告恢复即可复现成果（`npm test` 与 `npm run check` 均退出码 0，`node scripts/verify-assets.mjs` 输出 `verified 4 models, 533812 bytes`，seed 1 digest `e67c7fa0`）。DSH 未领取 C01 模型工作，未对模型外观或比例作判断，未引入新玩法，未扩大首版范围。
