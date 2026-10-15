# DSH执行队列

状态约定：READY可执行；DOING进行中；REVIEW自测完成待Codex；DONE由Codex验收；BLOCKED需说明原因。D01/D02/D03独立，D04依赖前三项实现及测试通过（可处于REVIEW）。

## D01 — 任务状态机

- 状态：DONE
- 依赖：共享接口v1已冻结
- 修改：src/sim/mission.ts、tests/dsh/mission.test.mjs、报告与本项状态
- 实现：docs/CONTRACTS.md中两个任务函数
- 必测：首波到时只生成一次；波内部分击杀；重复/未知/旧波ID；间隔不提前刷怪；每次刷新符合上限；三波清完胜利；玩家/母舰失败；同帧失败优先；终态幂等；dt=0；非法dt/config；输入不被修改；两局从新状态开始不串数据。
- 验证：node --test tests/dsh/mission.test.mjs，然后npm run check
- 结果：2026-10-15自测完成，起始commit b7da457。`node --test tests/dsh/mission.test.mjs`退出码0，20用例通过0失败；D01完成时`npm run check`退出码0（tsc --noEmit通过，23用例通过0失败，vite build通过）。复核轮（D04之后）对D01—D04逐个重跑标准命令并重跑`npm run check`，全部仍为退出码0（20/16/16/11用例通过，全仓70用例通过0失败，vite build通过）。必测项全部覆盖。证据：docs/reports/dsh-20261015-D01.md。已知问题：activeEnemyIds未冻结——Codex已决策readonly为调用方约束、不要求运行时冻结，现策略满足契约，不改API（见 docs/reports/codex-20261015-DSH-review.md 决策1），并已据此修正测试中过强注释。

## D02 — 伤害与武器状态

- 状态：DONE
- 依赖：共享接口v1已冻结，可独立于D01执行
- 修改：src/sim/combat.ts、tests/dsh/combat.test.mjs、报告与本项状态
- 实现：伤害扣减、冷却、射击间隔、过热恢复
- 必测：伤害归零；零伤害；非法数值；首次射击；dt=0连发不绕过冷却；按住射击达到过热；未到阈值不解锁；冷却到阈值恢复；松开扳机冷却；输入对象不变；长期状态保持有限且热量范围合法。
- 验证：node --test tests/dsh/combat.test.mjs，然后npm run check
- 结果：2026-10-15自测完成。`node --test tests/dsh/combat.test.mjs`退出码0，16用例通过0失败；D02完成时全仓`node --test`退出码0，40用例通过0失败；DSH范围严格tsc退出码0；本轮末`npm run check`退出码0（70用例通过0失败）。必测项全部覆盖。实现中修复一处真实数值缺陷：cooldown按1/60递减后余2.08e-17，原`===0`判断使每发子弹晚一帧、射速随帧率漂移；已用1e-9容差归零，修复后射击固定在0/9/18/27/36步。D02自测当时`npm run check`曾因Codex并行编辑中的src/app/main.ts（缺./style.css）与src/visual/viewer.ts（ImportMeta.hot）退出码1，该阻塞已由Codex补齐src/app/style.css与src/vite-env.d.ts解除，DSH未改动这些文件。证据：docs/reports/dsh-20261015-D02.md。

## D03 — 设置存储

- 状态：DONE
- 依赖：共享接口v1已冻结，可独立于D01/D02执行
- 修改：src/platform/settings.ts、tests/dsh/settings.test.mjs、报告与本项状态
- 实现：注入存储、带版本设置的读写、异常回退
- 必测：空值/坏JSON/null/数组/旧版本；缺字段；越界数值；字符串数值；错误quality；getItem/setItem抛错；完整保存加载往返；不污染默认值；忽略额外字段；检查写入的准确key与字段。
- 验证：node --test tests/dsh/settings.test.mjs，然后npm run check
- 结果：2026-10-15自测完成。`node --test tests/dsh/settings.test.mjs`退出码0，16用例通过0失败；D03完成时全仓`node --test`退出码0，60用例通过0失败；DSH范围严格tsc退出码0；`npx vite build`退出码0。必测项全部覆盖，另用Proxy断言模块只读取约定字段。D03自测当时`npm run check`仅tsc阶段因Codex编辑中的文件失败，该阻塞已由Codex新增src/vite-env.d.ts解除；本轮末`npm run check`退出码0。证据：docs/reports/dsh-20261015-D03.md。

## D04 — 有界确定性回归与移交

- 状态：DONE
- 修改：tests/dsh/regression.test.mjs、已有DSH模块中的已复现缺陷、报告与本项状态
- 任务：写一个无图形、无实际延时的固定种子脚本，模拟任务、武器、伤亡和重开。
- 通过：同种子同输入得到相同结果；最多4个activeEnemyIds；同一波只生成一次；生命值不负、热量有限；结束后无新波；100次重开不残留敌机ID/击杀；长序列不修改输入或共享默认值。
- 限制：总步数有界（建议<=100000）、无真实sleep、无网络；不得为延长运行而无限压力测试。测试完成记录时间和Node版本，不据此推断GPU帧率。
- 验证：node --test tests/dsh/regression.test.mjs，然后npm run check
- 结果：2026-10-15自测完成。`node --test tests/dsh/regression.test.mjs`退出码0，11用例通过0失败（连续3次digest一致）；`npm run check`退出码0（tsc通过，70用例通过0失败，vite build通过）。全部通过条件已覆盖：同种子digest逐位相同且跨进程一致（seed1=e67c7fa0），逐步断言activeEnemyIds<=4，spawn事件数==waveIndex+1且与配置波表前缀一致，生命/热量有限且在界内，终态后继续200-600步无事件无新波，100次重开全部收束且胜局零残留，长序列未改写输入与共享config。单局1158步约4-5ms，远低于100000步上限；无sleep、无网络、无渲染。未发现D01—D03缺陷，故未修改src/**。证据：docs/reports/dsh-20261015-D04.md。

## 首批验收完成

将D01—D04提交REVIEW后更新DSH_REPORT.md，列出测试证据与Codex需要集成的文件。不自行领取C01模型工作、不引入新玩法。若Codex暂不可用，保留当前可复现成果，下一轮从报告恢复。


Codex已于2026-10-15审查并接受D01—D04。后续只做docs/tasks/DSH_NEXT.md中的D05/D06；不再等待首批指示。审查决策见docs/reports/codex-20261015-DSH-review.md。
