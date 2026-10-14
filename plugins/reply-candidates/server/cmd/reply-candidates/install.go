package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

const marketplaceName = "codex-reply-candidates"
const pluginID = "reply-candidates@" + marketplaceName

type installResult struct {
	Installed bool   `json:"installed"`
	Root      string `json:"root"`
	PluginID  string `json:"pluginId"`
	Runtime   string `json:"runtime"`
}

func hiddenCommand(ctx context.Context, program string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, program, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

func installedCLI(ctx context.Context) (string, error) {
	query := "$p = Get-AppxPackage OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation; if ($p) { Join-Path $p 'app/resources/codex.exe' }"
	output, err := hiddenCommand(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", query).Output()
	if err != nil {
		return "", fmt.Errorf("无法找到 Codex：%w", err)
	}
	path := strings.TrimSpace(string(output))
	if path == "" {
		return "", fmt.Errorf("请先安装 Codex 桌面版")
	}
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("Codex 运行组件不可用：%w", err)
	}
	return path, nil
}

func install(ctx context.Context, destination, codexHome string) (installResult, error) {
	result := installResult{PluginID: pluginID}
	if codexHome != "" {
		if err := os.MkdirAll(codexHome, 0o700); err != nil {
			return result, err
		}
	}
	cli, err := installedCLI(ctx)
	if err != nil {
		return result, err
	}
	if destination == "" {
		destination = filepath.Join(os.Getenv("LOCALAPPDATA"), "CodexReplyCandidates", "0.2.0")
	}
	root, err := filepath.Abs(destination)
	if err != nil {
		return result, err
	}
	result.Root = root
	pluginRoot := filepath.Join(root, "plugins", "reply-candidates")
	for _, directory := range []string{filepath.Join(root, ".agents", "plugins"), filepath.Join(pluginRoot, "bin"), filepath.Join(pluginRoot, ".codex-plugin")} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return result, err
		}
	}
	for _, pair := range [][2]string{{"plugin.json", "plugin.json"}, {"compatibility.json", ".codex-plugin/plugin.json"}, {"mcp.json", "mcp.json"}} {
		data, err := assets.ReadFile("assets/" + pair[0])
		if err != nil {
			return result, err
		}
		if err := os.WriteFile(filepath.Join(pluginRoot, pair[1]), data, 0o600); err != nil {
			return result, err
		}
	}
	self, err := os.Executable()
	if err != nil {
		return result, err
	}
	binary, err := os.ReadFile(self)
	if err != nil {
		return result, err
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, "bin", "reply-candidates.exe"), binary, 0o700); err != nil {
		return result, err
	}
	if err := os.WriteFile(filepath.Join(root, "CodexReplyCandidates.exe"), binary, 0o700); err != nil {
		return result, err
	}
	for _, name := range []string{"LICENSE.txt", "THIRD_PARTY_NOTICES.txt"} {
		data, err := assets.ReadFile("assets/" + name)
		if err != nil {
			return result, err
		}
		if err := os.WriteFile(filepath.Join(root, name), data, 0o600); err != nil {
			return result, err
		}
	}
	result.Runtime, err = integrateClient(ctx, cli, root)
	if err != nil {
		return result, err
	}
	marketplace := map[string]any{
		"name":      marketplaceName,
		"interface": map[string]any{"displayName": "回复建议"},
		"plugins": []any{map[string]any{"name": "reply-candidates", "source": map[string]any{"source": "local", "path": "./plugins/reply-candidates"},
			"policy": map[string]any{"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Productivity"}},
	}
	data, err := json.MarshalIndent(marketplace, "", "  ")
	if err != nil {
		return result, err
	}
	if err := os.WriteFile(filepath.Join(root, ".agents", "plugins", "marketplace.json"), data, 0o600); err != nil {
		return result, err
	}
	for _, args := range [][]string{{"plugin", "marketplace", "add", root, "--json"}, {"plugin", "add", pluginID, "--json"}} {
		cmd := hiddenCommand(ctx, cli, args...)
		if codexHome != "" {
			cmd.Env = append(os.Environ(), "CODEX_HOME="+codexHome)
		}
		if output, err := cmd.CombinedOutput(); err != nil {
			return result, fmt.Errorf("插件注册未完成：%w\n%s", err, output)
		}
	}
	result.Installed = true
	if err := configureTools(ctx, codexHome); err != nil {
		return result, err
	}
	if codexHome == "" {
		if err := createShortcut(ctx, root); err != nil {
			return result, err
		}
	}
	return result, nil
}
