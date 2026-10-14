package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/Enmani/codex-reply-candidates/server"
	"os"
	"path/filepath"
)

//go:embed assets/*
var assets embed.FS

func dataDirectory() string {
	if value := os.Getenv("REPLY_CANDIDATES_DATA"); value != "" {
		return value
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Codex", "reply-candidates")
}

func main() {
	mcpMode := flag.Bool("mcp", false, "run MCP settings transport")
	launch := flag.Bool("launch", false, "open the integrated client")
	headless := flag.Bool("headless", false, "installer integration test")
	destination := flag.String("destination", "", "installation directory")
	codexHome := flag.String("codex-home", "", "Codex home for isolated tests")
	flag.Parse()
	var err error
	var reported bool
	switch {
	case *mcpMode:
		err = server.Run(context.Background(), dataDirectory())
	case *launch:
		err = launchClient(context.Background(), *destination, *codexHome)
	default:
		if !*headless && !confirmInstall() {
			return
		}
		var result installResult
		work := func() (installResult, error) { return install(context.Background(), *destination, *codexHome) }
		if *headless {
			result, err = work()
		} else {
			result, err = installWithProgress(work)
		}
		if *headless {
			_ = json.NewEncoder(os.Stdout).Encode(result)
		} else {
			showInstallResult(result, err)
			reported = true
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		if !*headless && !*mcpMode && !reported {
			showMessage(err.Error(), 0x10)
		}
		os.Exit(1)
	}
}
