# Codex 回复候选

在 Codex 输入框附近显示多条预测回复，支持换一批、填入草稿和选择发送。

默认生成 3 条候选。每条可“填入”后修改，也可直接“发送”；“换一批”重新生成。已有草稿时禁用候选操作，防止覆盖输入。

等当前任务结束并完全退出原版 Codex，双击 `dist/启动候选版.cmd`。候选版是添加了内嵌面板的 Codex 本地副本，使用原有账号、对话和设置。原安装包保留，可退出候选版后从原来的入口恢复。

当前支持 Windows 包 `26.1007.2314.0`，客户端版本 `26.1007.21434`。更新后需要重新适配。候选生成沿用账号和模型的可用范围。

隔离对话已验证真实生成、重新生成、列表显示、填入草稿和发送后的模型回复。14 项检查通过。正式会话没有切换到候选版。

机制与证据见 [预测回复调查](docs/预测回复调查.md)。

开发需要 Node.js、Python、`pefile` 和 `npm ci` 安装的依赖。检查入口：`npm run precheck`。构建：`npm run build`。打包副本与启动器：`npm run package`。不需要管理员权限。

隔离联调入口依次为 `node scripts/stage-test.mjs`、`node scripts/seed-test.mjs`、`node scripts/launch-test.mjs`、`node scripts/runtime-integration.mjs --send`。它会调用真实模型，只向自己的测试对话发送。临时数据位于 `work/`，测试浏览器配置位于 `%APPDATA%/Codex/web/CodexCandidatesTest`。
