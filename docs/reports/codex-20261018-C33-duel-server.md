# C33 / 本机联机服务与D15移交

2026-10-18（Asia/Shanghai），起始已提交HEAD 4ee85ee。用户问下一步，按既定C33推进；保留C31/C32/DSH未提交文件，不做Git写入/推送、不部署、不公开监听。DSH D13/D14已接受，不修改其实现/测试。

## 完成内容

src/server/duel-server.ts适配已有纯逻辑与真实碰撞：创建/加入/准备/断线/重赛，服务端60Hz推进、20Hz快照、事件窗口，连接归属与严格Origin、16房/32连接上限、入站8192字节/UTF-8/压缩禁用、令牌桶收费、6帧队列/旧包拒绝/250ms输入超时、心跳与闲置清理、慢发送缓冲保护。客户端输入不能改变模拟dt或报告血量/命中。退出与错误即时移除房间成员，双人回合/全场重置经实际网络验证。

冻结createDuelServer的listen/close/advance/maintain/stats接口，详见docs/DUEL_SERVER.md。构造不监听/安装定时器，关闭幂等、强制释放半截HTTP等连接；手动推进仅测试模式可用，不暴露给网络。默认127.0.0.1:8787，静态页面复用既有serve-release服务及路径拒绝规则，通过scripts/serve-release.d.mts提供最小类型适配，未修改原JS实现。

scripts/serve-duel.mjs及npm run duel:serve提供CLI，Vite增加/ws代理。固定依赖ws=8.22.0、@types/ws=8.18.2、@types/node=24.19.2；安装仅命令级代理，没有写入用户/系统代理配置。CLI只说明服务可用，明确房间与驾驶UI未接入，避免用户将旧单人页面误认为联机成功。

## 验证证据

- node --test tests/duel-server.test.mjs：退出0，16/16通过，无跳过。实际HTTP/WebSocket/控制帧，未用mock socket或直接设置血量。
- 内容包括两人快照一致、输入一次消费/队列溢出/重放/错误round拒绝、超时中性输入、第三人拒绝/独立房间、断线判负、连续非法/超大消息、真实ping不回pong、空房/未入房连接回收、半截HTTP关闭、3次实际射击击毁与3分胜利/重赛、自动时钟、端口复用和EADDRINUSE。
- 一次性开发代理联调：两个Node ws客户端经实际Vite /ws代理，使用自动时钟完成真实3秒倒计时，收到完全相同的playing快照（serverTick=191、matchId=1、roundId=1）。退出0，结果artifacts/local/c33-proxy-qa.json，之后客户端/Vite/服务均关闭。不是浏览器渲染验收，也不是两台设备的联网证据。
- npm.cmd run typecheck：退出0。
- 最终npm.cmd run check：退出0，345项中341通过、0失败、4个Windows文件符号链接权限跳过，模型资产校验和生产构建通过，dist更新。日志artifacts/local/c33-check-final.log（Git忽略）。
- 不重复模拟/浏览器检查来虚增计数；现有单人逻辑、模型工厂和旧测试未改，完整回归覆盖仍保留。

## D15与后续

D15已从旧BLOCKED转为READY，任务书docs/tasks/DSH_DUEL_SERVER.md，提示词DSH_SERVER_PROMPT.md。DSH只能新增黑盒测试与报告，重点准入费用/分片与非法文本/倒计时换人/Origin与并发限额/被拒seq重试/积压追步和关闭边界，不改服务/依赖。接口和允许路径已写清，可与Codex C34前端分文件并行。尚未执行D15，不声称独立回归已通过。

下一步C34：主菜单双人入口、创建/加入/准备页、原生WebSocket客户端、同工厂模型与双机画面、本地预测/ack重放/远机插值、网络状态、菜单不暂停。随后C35做真实双端浏览器、两台设备局域网和延迟/断线体验。当前没有可玩双人UI，没有公开服务或异地联机网址；没有做GPU、真人平衡或真实慢消费者压测。慢发送缓冲只是已实现的限制，未冒充实测触发。
