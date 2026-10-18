# 双人服务接口 / C33

2026-10-18。C34已接入房间和双机驾驶界面，本机开发/生产双页面验证通过；跨设备和公网未验收。首版规则见[DUEL_MODE.md](DUEL_MODE.md)。

## 启动

需要Node.js 24和仓库依赖，首次npm ci；在仓库中运行：

```text
npm run build
npm run duel:serve
```

默认http://127.0.0.1:8787，双人页面为/?mode=duel，WebSocket路径/ws。也可双击根目录start-duel.cmd启动并自动打开双人页面（首次需要npm ci和npm run build）。HTTP托管已有dist，保留原单人页面；单人start-play.cmd继续使用5174。开发时另运行npm run dev，Vite的/ws代理转发至127.0.0.1:8787，允许127.0.0.1/localhost的5173来源。

CLI为node scripts/serve-duel.mjs，支持--port N、--host ADDRESS、可重复--origin EXACT_ORIGIN和--open（启动后打开双人页面）。--port必须1..65535；API测试可用port:0自动分配临时端口。不自动开放防火墙、不设置代理、不安装系统服务。异地部署、HTTPS/WSS和公开访问未实施。

若后续明确需要局域网，可显式指定本机局域网地址；监听0.0.0.0必须额外提供真实网页的--origin，例如--host 0.0.0.0 --origin http://192.168.1.2:8787。该地址只是格式例子，必须替换成实际本机地址，不能把0.0.0.0当分享网址。C33只验证127.0.0.1，没有两台设备的实测结论。

## 程序接口（D15冻结）

从src/server/duel-server.ts导入createDuelServer(options?)。导入模块不启动服务，构造时读取共享碰撞文件但不监听/安装定时器。返回对象：

```ts
listen(): Promise<{ host: string; port: number; origin: string; wsUrl: string }>
close(): Promise<void>
advance(count = 1): void
maintain(): void
stats(): { connections: number; rooms: number; serverTick: number;
           reserved: number; droppedSteps: number; queuedInputs: number }
```

- listen调用后才监听，重复listen复用同一个Promise；关闭后不能再启动这个对象。端口占用以Promise拒绝返回EADDRINUSE，不抛未处理的EventEmitter错误。
- close幂等；清计时器、断开WebSocket、删除房间、释放端口。100ms后强制关闭未完成握手/HTTP/WS的连接，正常关闭尽量先发送closed通知；测试不能假设异常网络下一定收到该通知。
- advance/maintain是服务对象的本机测试API，不通过HTTP/WS开放。只在automatic:false时允许；advance要求已listen且未close、count为1..5整数。每个调用推进确定数量服务器tick，不读取客户端dt。自动模式调用这两个手动API报错。
- stats返回聚合新对象，没有connectionId、socket或房间可写引用。不要依赖不存在的getRoom/改血/强设比分接口。

可选options：host、port、staticRoot、allowedOrigins（严格HTTP(S) origin数组）、maxConnections（1..32，默认32）、maxRooms（1..16，默认16）、heartbeatMs（10..60000，默认10000）、idleMs（20..3600000，默认120000）、automatic（默认true）、nowMs（默认performance.now）、collider（默认加载共享实际舰体）。测试可注入单调非负时钟，不使用Date替换/全局Monkey patch；advance不会自行推进该时钟，测试自行增加毫秒数。

automatic:false不创建模拟/巡检定时器；测试需要实际HTTP/WS连接，再调用advance/maintain。手动maintain等价一次巡检：先检查是否缺失上次pong，再发新ping，同时处理闲置；两次巡检间应让正常客户端有机会回复，不能连续同步调用来伪造掉线。

## 连接与消息规则

1. 仅/ws允许升级；缺少或不在白名单的Origin返回403，其他路径404，连接上限503。默认只允许本机服务地址及本机5173开发来源；配置allowedOrigins后以显式列表为准，不再自动扩充。
2. 客户端六种消息以src/shared/duel-contract.ts及D14解码器为准；服务端消息以src/shared/duel-snapshot.ts为准。create/join成功收到welcome（code、slot），随后房间成员收到snapshot；非房间成员ping可用，但ready/input返回not-member。
3. 每条消息先扣基础1令牌；合法create/join再扣19，总成本20，业务失败也收费。其余和无效消息成本1。额度不足发送fatal rate-limited并关闭，避免通过错误消息绕过限流。
4. 非法JSON/schema连续3次关闭该连接；有效消息会清连续非法计数。二进制消息直接拒绝关闭。ws聚合消息限制8192字节，压缩关闭、UTF-8校验开启；超限或编码错误可直接由传输层关闭，不保证先收到应用error或某个唯一关闭码。
5. 每连接只属于一间房，房间最多两人；满房返回room-full，不退出原房去挤入其他房。房间数量到上限返回server-full，不影响已有房间。内部连接ID由服务生成，只用于本机状态机，不出现在快照。
6. 只有playing接受input，matchId/roundId必须匹配，同包单调由D14验证、跨包第一seq必须大于此前接受的最高seq。每连接队列最多6帧，溢出整包拒绝，不丢旧包、不更新最高seq；每模拟tick最多消费1帧。
7. 无新帧暂时延续轴向/boost/fire，动作脉冲归false；超过250ms无有效输入则清队列并改中性输入，正常惯性飞行继续。切阶段清队列/按键，新match还清最高seq。状态的lastProcessedSeq只在真正消费时推进。
8. 默认自动60Hz、每次唤醒最多追5步；过载丢积压，stats.droppedSteps记录丢弃量。每3tick（20Hz）广播快照；成员/准备/阶段变化立即广播。输入消息自身不推进tick。
9. 重赛创建新flight并清ack和效果窗口；轮间reset保留本场ID序列。回合/整场结束立即清残弹，不让轮间出现冻结激光。事件最多最近12tick/96条，客户端按(matchId,event.id)去重。
10. 主动leave发送closed并关闭该连接，立即退出房间；断线/错误按正常disconnect处理，playing/intermission判另一人获胜，countdown回waiting且flight=null。未做重连续局。
11. ws默认每10秒巡检ping，下一次仍缺pong即断开；从故障到发现可能需要约10–20秒。未加入房间的连接30秒回收；仅一人waiting或finished房间120秒无有效活动回收，在下一次巡检生效。ping不刷新房间活动，结算后仅一人反复改ready也不能无限续期。
12. 服务端发送缓冲超过256KiB会关闭慢连接。当前只有代码路径保护，尚未用真实慢消费网络压测证明阈值触发；不把它列为实测通过。

## C33验证范围

tests/duel-server.test.mjs有16项真实本机HTTP/WS测试，包括双连接一致性、输入消费/拒绝/超时、房间隔离、掉线/真实ping无pong、消息超限、闲置、半截HTTP关闭、实际操控三次击毁与重赛、自动时钟及端口复用。使用真实导出舰体，不用伪命中/写血量替代交战。

另以两个Node ws客户端经实际Vite /ws代理，用真实自动时钟完成3秒倒计时，双方收到同一playing快照；记录artifacts/local/c33-proxy-qa.json。它验证开发代理与连接，仍不等于浏览器画面或两台设备联网。

D15独立回归已审查接受DONE，见[tasks/DSH_DUEL_SERVER.md](tasks/DSH_DUEL_SERVER.md)；C34房间UI/模型/预测及本机浏览器双页面已完成，下一步C35继续两台设备、真实延迟与手感验收。
