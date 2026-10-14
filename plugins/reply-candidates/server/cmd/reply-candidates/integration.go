package main

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func integrateClient(ctx context.Context, cli, root string) (string, error) {
	source := filepath.Dir(filepath.Dir(cli))
	runtime := filepath.Join(root, "runtime")
	if err := ensureClientStopped(ctx, runtime, false); err != nil {
		return "", err
	}
	node := filepath.Join(source, "resources", "cua_node", "bin", "node.exe")
	if _, err := os.Stat(node); err != nil {
		return "", fmt.Errorf("Codex 自带的 Node 组件不可用：%w", err)
	}
	patcher := filepath.Join(root, "patcher.cjs")
	code, err := assets.ReadFile("assets/patcher.cjs")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(patcher, code, 0600); err != nil {
		return "", err
	}
	archive := filepath.Join(root, "integrated.asar")
	metadata := filepath.Join(root, "packaging.json")
	args := []string{patcher, source, archive, metadata}
	if port := os.Getenv("REPLY_CANDIDATES_TEST_DEBUG_PORT"); port != "" {
		args = append(args, port)
	}
	if output, err := hiddenCommand(ctx, node, args...).CombinedOutput(); err != nil {
		return "", fmt.Errorf("当前 Codex 版本无法接入回复建议：%w\n%s", err, output)
	}
	if err := copyTree(ctx, source, runtime); err != nil {
		return "", err
	}
	if err := copyFile(archive, filepath.Join(runtime, "resources", "app.asar")); err != nil {
		return "", err
	}
	data, err := os.ReadFile(metadata)
	if err != nil {
		return "", err
	}
	if err := stampResource(filepath.Join(runtime, "ChatGPT.exe"), data); err != nil {
		return "", err
	}
	if profile := os.Getenv("REPLY_CANDIDATES_TEST_PROFILE"); profile != "" {
		if !regexp.MustCompile(`^Codex[A-Za-z]+Test$`).MatchString(profile) {
			return "", fmt.Errorf("Invalid development profile")
		}
		path := filepath.Join(runtime, "resources", "owl-app.ini")
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		pattern := regexp.MustCompile(`(?m)^UserDataDirectoryName=[^\r\n]*`)
		if len(pattern.FindAll(data, -1)) != 1 {
			return "", fmt.Errorf("Unsupported Owl profile")
		}
		if err := os.WriteFile(path, pattern.ReplaceAll(data, []byte("UserDataDirectoryName="+profile)), 0600); err != nil {
			return "", err
		}
	}
	return runtime, nil
}

func copyTree(ctx context.Context, source, destination string) error {
	source, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}
	if source == destination || strings.HasPrefix(destination, source+string(os.PathSeparator)) {
		return fmt.Errorf("Invalid runtime destination")
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("Unsupported runtime link: %s", relative)
		}
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		return copyFile(path, target)
	})
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func ensureClientStopped(ctx context.Context, runtime string, includeOriginal bool) error {
	exe := filepath.Join(runtime, "ChatGPT.exe")
	quoted := "'" + strings.ReplaceAll(exe, "'", "''") + "'"
	predicate := "$_.ExecutablePath -eq " + quoted
	if includeOriginal {
		predicate += " -or $_.ExecutablePath -match 'WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\ChatGPT\\.exe$'"
	}
	query := "@(Get-CimInstance Win32_Process | Where-Object { " + predicate + " }).Count"
	output, err := hiddenCommand(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", query).Output()
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(output)) != "0" {
		return fmt.Errorf("请先结束当前任务并退出 Codex，再打开回复建议版")
	}
	return nil
}

func launchClient(ctx context.Context, root, codexHome string) error {
	if root == "" {
		self, err := os.Executable()
		if err != nil {
			return err
		}
		root = filepath.Dir(self)
	}
	runtime := filepath.Join(root, "runtime")
	if err := ensureClientStopped(ctx, runtime, true); err != nil {
		return err
	}
	command := hiddenCommand(ctx, filepath.Join(runtime, "ChatGPT.exe"))
	command.Env = append(os.Environ(), "CODEX_CLI_PATH="+filepath.Join(runtime, "resources", "codex.exe"))
	if codexHome != "" {
		command.Env = append(command.Env, "CODEX_HOME="+codexHome)
	}
	return command.Start()
}

func createShortcut(ctx context.Context, root string) error {
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	command := "$shell = New-Object -ComObject WScript.Shell\n$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex 回复建议.lnk'))\n$link.TargetPath = " + quote(filepath.Join(root, "CodexReplyCandidates.exe")) + "\n$link.Arguments = '--launch'\n$link.WorkingDirectory = " + quote(root) + "\n$link.IconLocation = " + quote(filepath.Join(root, "runtime", "ChatGPT.exe")) + "\n$link.Save()"
	return hiddenCommand(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command).Run()
}
