# 共享接口 v1

类型真实来源为src/shared/types.ts。本文定义行为。除明确说明外，参数为合法有限数值；遇不合法输入抛RangeError，不静默传播NaN。所有函数不得修改传入对象/数组。

## D01 / src/sim/mission.ts

```ts
createMission(config: MissionConfig): MissionState
advanceMission(state: MissionState, dt: number, input: MissionInput, config: MissionConfig): MissionStep
```

createMission验证config：waves非空，每项为1到maxActiveEnemies的整数，maxActiveEnemies为正整数，两项时长为有限非负数。返回briefing、waveIndex=-1、空activeEnemyIds、elapsedSeconds=phaseSeconds=kills=0、lossReason=null。

advanceMission验证config和dt（有限、0到0.1秒），state仅要求来自createMission或此前advanceMission，不要求防御任意伪造状态。判定顺序固定：

1. won/lost为终态，返回原state及空events。dt/config仍先验证。
2. playerAlive=false优先判为player-destroyed；否则carrierAlive=false判carrier-destroyed。发生失败立即返回lost与单个mission-lost事件，不计击杀、不刷怪、不计时。
3. 累计elapsedSeconds与phaseSeconds。
4. combat时，只移除当前activeEnemyIds里出现在destroyedEnemyIds的ID；未知ID、重复ID、上波ID忽略。同一个ID最多计一次kills。
5. combat清空：最后一波则won及一次mission-won事件；否则进入intermission并把phaseSeconds置0，不在同一步刷下一波。
6. briefing到时或intermission到时：生成下一波，进入combat且phaseSeconds置0，返回一次spawn-wave。每步最多一次阶段转换，时间余量舍弃（最多0.1秒）。

敌机ID规则：`wave-{一基波号}-enemy-{一基序号}`，如wave-1-enemy-1。spawn-wave.enemyIds与返回state.activeEnemyIds内容一致，但外部调用方不得修改。该步spawn之后不处理destroyedEnemyIds，避免尚未生成的单位被提前计杀。

暂停由调用者停止调用函数实现。dt=0允许处理伤亡事件，不增加时间；零时长briefing可以在dt=0时启动。没有事件时events为[]，不得重复发送上一帧事件。

## D02 / src/sim/combat.ts

```ts
applyDamage(health: number, damage: number): number
createWeapon(): WeaponState
advanceWeapon(state: WeaponState, dt: number, triggerHeld: boolean, config: WeaponConfig): WeaponStep
```

applyDamage：health/damage必须有限且非负；返回max(0,health-damage)。不负责命中检测、护盾或击杀统计。

createWeapon返回heat=0、cooldownSeconds=0、overheated=false。

advanceWeapon：dt为有限0到0.1秒；maxHeat、heatPerShot、coolingPerSecond、shotIntervalSeconds均有限且大于0；heatPerShot<=maxHeat；unlockHeat有限且在[0,maxHeat)；初始state假设来自本模块。

顺序：先按dt冷却热量至不小于0，同时减少cooldown至不小于0；若原来overheated且热量<=unlockHeat，则解除过热；若triggerHeld且未过热且cooldown为0，则只发射一次，热量增加heatPerShot并截断到maxHeat，cooldown置shotIntervalSeconds。达到maxHeat立即进入过热，但该次射击有效。每调用最多一次射击，不追补间隔内的子弹。

dt=0也可在武器就绪时射击，但连续调用受cooldown约束。不射击也必须冷却。返回fired用于由Codex创建弹体。

## D03 / src/platform/settings.ts

```ts
loadSettings(storage: StorageLike): Settings
saveSettings(storage: StorageLike, value: Settings): boolean
```

使用shared/config中的SETTINGS_KEY与DEFAULT_SETTINGS；不得访问window/localStorage全局。load捕获getItem异常和JSON异常；null、非对象、数组、version不等于1返回一份新的完整默认设置。

合法version=1对象按字段恢复：volume有效有限数值时夹在[0,1]，sensitivity有效有限数值时夹在[0.2,3]，quality仅low/medium，否则取字段默认值；忽略额外字段。布尔/字符串数值不强转。返回新对象，不修改DEFAULT_SETTINGS。

save按同样规则规范化（运行时不信任TS类型），只保存四个规定字段。setItem成功返回true，抛异常返回false；不记录私密数据或制造浏览器弹窗。允许复用模块内部normalize函数，但不扩展公共API。

## 测试与集成约定

导入路径带.ts扩展，类型使用import type。不使用enum、namespace或构造器参数属性，保证Node 24类型擦除可运行。

DSH测试使用.mjs，Node执行TS时不进行类型检查，所以完整门槛仍是npm run check。所有随机压力测试使用固定种子和明确循环上限；出现失败打印种子和最小步骤序列。测试不需要渲染器或网页。
