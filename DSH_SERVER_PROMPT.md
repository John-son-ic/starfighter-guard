# 给DSH的第九批提示词

C34更新：D15已经完成并接受为DONE，本文件保留启动时提示词，不重复执行。当前没有新READY，先读DSH_HANDOFF.md顶部最新说明。

项目目录：C:\Users\Johnsonzinc\Desktop\sw\starfighter-guard

请读取AGENTS.md、DSH_HANDOFF.md顶部C33指示、docs/DUEL_SERVER.md和docs/tasks/DSH_DUEL_SERVER.md，执行READY的D15联机服务独立黑盒回归。D13/D14已DONE，不重复实现。

只新增tests/dsh/duel-server-regression.test.mjs及任务书允许的报告/状态，不改服务端、共享契约、其他测试、依赖、图形或Git。使用已有ws和真实127.0.0.1临时端口，不访问公网、不公开监听。按冻结API构造/listen/close服务，用真实客户端消息验证准入限流、分片/非法文本、倒计时退出与换人、显式Origin/连接上限、拒绝seq重试、过载追步上限及关闭边界。不要复制已有16个测试冒充独立回归，也不要改内部state/血量或伪造网络成功。

每项等待有超时，t.after确保客户端和服务都关闭。遇到环境不允许监听，保存原始错误并报告待Codex重跑，不将环境失败改成测试通过；契约/实现问题写最小复现，不越界修源码，继续其余独立用例。

执行node --test tests/dsh/duel-server-regression.test.mjs，报告真实退出码与通过/失败/跳过数。完成后写docs/reports/dsh-20261018-D15.md，更新DSH_REPORT.md顶部和任务状态为REVIEW（有失败也如实记录），不要自行DONE。不要构建、导出资产、部署或操作Git。本批完成后停止，前端/预测/视觉留给Codex。
