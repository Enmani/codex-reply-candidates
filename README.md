# Codex 回复建议

在 Codex 输入框上方显示 1–3 条预测回复。可以填入后修改、选择发送，也可以刷新换一批。

![输入框上方的候选列表](docs/images/client-candidates-three.png)

安装 Codex 后，从 [Releases](https://github.com/Enmani/codex-reply-candidates/releases/latest) 下载并双击 `CodexReplyCandidates-Setup.exe`。安装完成后，退出当前 Codex，再打开桌面的「Codex 回复建议」。不需要运行 BAT，也不需要安装 Node.js 或 Python。

在 Codex「设置 → 插件 → 回复建议」中，可以关闭候选、设置建议条数为 1–3。关闭候选后，原生灰色自动填充继续工作。已有草稿时隐藏候选列表。

这是非官方扩展，由设置插件和客户端接入组件组成。安装器在本机复制已安装的 Codex 并添加候选功能，保留原安装。安装包不包含 OpenAI 客户端文件。当前适配 Windows 客户端 `26.1007.71326`；客户端更新后可能需要新的适配版本。

开发需要 Node.js 22 或更新版本、Go，以及本机已安装的 Windows Codex：

```sh
npm ci
npm run precheck
npm run build
```

安装器输出到 `dist/plugin/CodexReplyCandidates-Setup.exe`。`plugins/reply-candidates/server` 提供设置和 Windows 安装器，`src` 提供客户端接入逻辑。无法唯一识别对应代码时停止构建。

机制见 [预测回复调查](docs/预测回复调查.md)，实际验证见 [验证记录](docs/验证记录.md)。

项目采用 MIT 许可证。Codex 名称及客户端属于 OpenAI。
