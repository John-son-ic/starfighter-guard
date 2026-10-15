# DSH第三批：D07提前量求解 / D08试玩说明

D05/D06已经由Codex审查并接入：暂停面板显示帧统计，npm run check包含模型完整性检查。下一批只做下面两项，继续不修改图形和主循环。

## D07 — 精确匀速截击点求解

状态：READY。
文件：src/sim/intercept.ts、tests/dsh/intercept.test.mjs、DSH_REPORT.md、自己的报告和本文件状态。

从shared/types.ts使用Vec3，导出：

```ts
interface Intercept { point: Vec3; time: number }
solveIntercept(shooter: Vec3, target: Vec3, targetVelocity: Vec3, projectileSpeed: number, maxTime?: number): Intercept | null
```

目标按targetVelocity匀速运动，弹体在世界空间以projectileSpeed直线飞行（不继承射手速度），求最早非负碰撞时间和目标未来点；无解、超出maxTime返回null。默认maxTime=2秒，与现有弹体寿命一致。三个向量各分量须有限，speed和maxTime须有限正数，否则RangeError。射手与目标同点则time=0。不能修改参数、依赖Three.js/DOM、改接口或把无法求解的结果伪装成命中。

需要覆盖静止目标、横向目标、迎面目标、远离且更快无解、等速退化线性情况、最近正根、超时、重合、非法输入、不变性。至少用一种代回检查：point与target+velocity*time一致，并且|point-shooter|约等于speed*time。针对实际游戏量级（米、720m/s、0..2秒）处理浮点容差，不必为宇宙级数值构造通用高精度系统。

Codex接入前不修改world.ts中的近似提前量。DSH完成后给出一个具体截击点示例和误差，供Codex决定替换。

## D08 — 给首次试玩者的说明和检查表

状态：READY，与D07独立。
文件：docs/PLAYER_GUIDE.md、docs/MANUAL_CHECKLIST.md、DSH_REPORT.md和自己的报告、本文件状态。

根据当前src/app/game的实际行为写简洁中文说明：双击启动、开始、鼠标离中心越远转向越快、回到中心停止转向、W/S、Q/E、Shift、左键、Tab、1/2、暂停/失焦、重开、设置保存、回看模型页。说明击毁三波并保持座机和母舰存活的条件，以及游戏仍是原型。

检查表覆盖首次操控是否易懂、目标/提前量是否看得见、长时间转弯是否晕、母舰是否遮挡、碰撞反馈、僚机集火/归队、失败/重开、低画质。只提供可执行步骤和期望，不填写未经实际验证的通过项，不评价截图或宣称帧率达标。

## 收束

逐项自测，状态置REVIEW，更新DSH_REPORT.md。代码改动用npm run check验证；纯文档不必为了报告重复跑全仓测试。不要自动领取新任务、改首版范围或修改其他Agent负责的文件。完成即等待下一次具体任务。
