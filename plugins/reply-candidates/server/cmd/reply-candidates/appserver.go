package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"
)

type rpcMessage struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type appServer struct {
	command  *exec.Cmd
	input    io.WriteCloser
	messages chan rpcMessage
	done     chan error
	sequence int
	cancel   context.CancelFunc
}

func openAppServer(ctx context.Context, cli, codexHome string) (*appServer, error) {
	ctx, cancel := context.WithCancel(ctx)
	command := hiddenCommand(ctx, cli, "app-server", "--listen", "stdio://")
	if codexHome != "" {
		command.Env = append(os.Environ(), "CODEX_HOME="+codexHome)
	}
	input, err := command.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		cancel()
		return nil, err
	}
	server := &appServer{command: command, input: input, messages: make(chan rpcMessage, 32), done: make(chan error, 1), cancel: cancel}
	go func() {
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 4096), 8<<20)
		for scanner.Scan() {
			var message rpcMessage
			if json.Unmarshal(scanner.Bytes(), &message) == nil && message.ID != 0 {
				select {
				case server.messages <- message:
				case <-ctx.Done():
					return
				}
			}
		}
		server.done <- scanner.Err()
	}()
	var initialized any
	if err := server.call(ctx, "initialize", map[string]any{"clientInfo": map[string]any{"name": "reply-candidates-installer", "version": "0.2.0"}, "capabilities": map[string]any{"experimentalApi": true}}, &initialized); err != nil {
		server.close()
		return nil, err
	}
	if err := json.NewEncoder(input).Encode(map[string]any{"method": "initialized"}); err != nil {
		server.close()
		return nil, err
	}
	return server, nil
}

func (s *appServer) call(ctx context.Context, method string, params any, output any) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	s.sequence++
	id := s.sequence
	if err := json.NewEncoder(s.input).Encode(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return err
	}
	for {
		select {
		case message := <-s.messages:
			if message.ID != id {
				continue
			}
			if message.Error != nil {
				return fmt.Errorf("%s: %s", method, message.Error.Message)
			}
			if output == nil {
				return nil
			}
			return json.Unmarshal(message.Result, output)
		case err := <-s.done:
			return fmt.Errorf("Codex app-server stopped: %v", err)
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (s *appServer) close() { _ = s.input.Close(); s.cancel(); _ = s.command.Wait() }

func configureTools(ctx context.Context, codexHome string) error {
	cli, err := installedCLI(ctx)
	if err != nil {
		return err
	}
	server, err := openAppServer(ctx, cli, codexHome)
	if err != nil {
		return err
	}
	defer server.close()
	tools := map[string]any{"settings_read": map[string]any{"approval_mode": "approve"}, "settings_update": map[string]any{"approval_mode": "approve"}}
	value := map[string]any{pluginID: map[string]any{"mcp_servers": map[string]any{"reply_candidates": map[string]any{"tools": tools}}}}
	return server.call(ctx, "config/batchWrite", map[string]any{"edits": []any{map[string]any{"keyPath": "plugins", "value": value, "mergeStrategy": "upsert"}}, "reloadUserConfig": true}, nil)
}
