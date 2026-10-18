# 第九批 / 联机服务独立回归 D15

2026-10-18。C33已实现服务及冻结启动/关闭接口，D13/D14已DONE；本批只新增黑盒回归，不改服务端、契约或图形。先读AGENTS、DSH_HANDOFF最新指示、docs/DUEL_MODE.md、docs/DUEL_SERVER.md以及src/shared/duel-{contract,snapshot}.ts。

## D15 — DONE（C34已审查接受；以下保留冻结任务要求）

允许新增/修改：tests/dsh/duel-server-regression.test.mjs、DSH_REPORT.md顶部本批摘要、docs/reports/dsh-20261018-D15.md（重名追加序号）、本文件末尾状态/结果栏。禁止修改src/**、其他测试、依赖/锁文件、Vite/TS配置、资产、脚本、设计、Git；不部署、不公开监听、不全局改代理。不复制服务实现、不添加测试专用改血/改房间接口。

使用Node内置test runner和已安装的ws。导入createDuelServer，使用host=127.0.0.1、port=0、automatic:false；listen后用返回的真实地址连接，Origin取address.origin。t.after中关闭所有客户端和await app.close，失败也清理；关闭不依赖用户手动杀进程。每个等待最多3秒，单文件有界，无无限轮询、不sleep等待十分钟、不改系统权限。

核心API见docs/DUEL_SERVER.md；可注入nowMs:()=>clock，测试自己推进clock及advance(1..5)。不得以客户端消息、私有socket访问或反射改服务内部state。要验证心跳需实际WebSocket ping/pong，不能只给函数塞“已断线”条件。所有测试启动127.0.0.1，不访问公网。

Codex已覆盖的16项见tests/duel-server.test.mjs；本批重点补独立边界，不机械复制这些用例。至少覆盖以下行为：

1. 固定时钟下，空服务器同一连接六次join合法但不存在的房间，每次都扣20；第七次触发fatal rate-limited和关闭。无效消息也收费；分别验证基础费用，不把六条error当作六个独立连接。
2. 分片文本合计超过8192字节会关闭该连接；发送非UTF-8文本/二进制也拒绝；同服务器另一健康连接还能ping/获取房间快照。关闭码以ws实际行为为准，不强求在传输错误后收到应用error。
3. 倒计时中对方退出：回waiting、flight=null、roundId=0；新对手加入后重新准备得到新matchId，零比分/全新飞船。通过真实消息和快照观察，不伪造room。
4. 显式allowedOrigins仅允许指定来源，不自动混入默认本机来源；拒绝握手不占有效连接/房间名额。达到连接上限时并发升级最多接纳上限，其他明确拒绝，关闭后可再连接。
5. 队列溢出被拒绝的seq没有被“接受”：消费旧队列后可重新提交同一seq且真正被确认；旧match/round、客户端伪造位置/血量、非法包不能改变实际tick/ack/比分。
6. 自动模式注入单调时钟并人为形成大积压：一次唤醒最多5步，droppedSteps增加；不能因一条输入推进几十帧。需真实定时器触发一次，等待有明确超时，不能通过调用被禁用的advance来制造结果。
7. 未listen时close、重复close、listen过程中close以及失败listen后的close不会留下端口/定时器；构造/import不自动监听。若环境权限导致无法监听，记录原始错误并标待运行，不改成假成功。

真实慢消费压测需要较长网络负载，不要求本批强造bufferedAmount或篡改ws内部字段；报告明确未验证即可。既有单人/模型视觉由Codex负责，本批不构建、不导出、不截图审美评判。命中得分完整流Codex已有实际输入证据，不通过改血重演。

运行node --test tests/dsh/duel-server-regression.test.mjs。必要时可再跑已有tests/duel-server.test.mjs核对差异，不反复全仓构建；完整npm run check留给Codex集成。若环境明确拒绝本地监听，请记录具体错误给Codex在正常本机环境重跑，不跳过所有测试后称验收通过。

发现问题先写最小复现和期望/实际，不改服务端。可继续其余独立用例；纯测试修好自测后写REVIEW，若有失败仍如实写REVIEW并标明失败，不伪造PASS。报告列起始/结束HEAD、改动文件、命令/退出码/通过失败跳过数、已知问题/未验证、Codex最小修复步骤。本批后停止，不自动实现C34或其他玩法。

## 状态与结果

| ID | 状态 | 结果 / 报告 |
| --- | --- | --- |
| D15 | DONE | C34 Codex已独立审查并重跑10/10通过，接受。仅给等待open补充3秒超时，保留全部断言；未改服务端规则。已纳入全仓检查，详见docs/reports/codex-20261018-C34-duel-client.md。原始自测报告docs/reports/dsh-20261018-D15.md保留；慢消费者/两设备LAN/WSS仍未验证。本批停止，无新READY。 |
