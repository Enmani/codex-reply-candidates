package server

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Options struct{ DataDir string }
type Runtime struct {
	mcp      *mcp.Server
	settings *settingsStore
}
type emptyInput struct{}
type settingsUpdateInput struct {
	Set SettingsPatch `json:"set"`
}
type settingsReadOutput struct {
	Schema map[string]any `json:"schema"`
	Values Settings       `json:"values"`
	Layout []any          `json:"layout"`
}
type settingsUpdateOutput struct {
	Values Settings `json:"values"`
}

func New(options Options) (*Runtime, error) {
	store, err := newSettingsStore(options.DataDir)
	if err != nil {
		return nil, err
	}
	r := &Runtime{settings: store}
	r.mcp = mcp.NewServer(&mcp.Implementation{Name: "reply-candidates", Version: "0.2.0"}, &mcp.ServerOptions{
		Capabilities: &mcp.ServerCapabilities{Experimental: map[string]any{"openai/settings": map[string]any{"readTool": "settings_read", "updateTool": "settings_update"}}},
	})
	mcp.AddTool(r.mcp, &mcp.Tool{Name: "settings_read", Title: "Read reply suggestion settings", Description: "Read the reply suggestion toggle and count.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, r.settingsRead)
	mcp.AddTool(r.mcp, &mcp.Tool{Name: "settings_update", Title: "Update reply suggestion settings", Description: "Set the reply suggestion toggle or count (1–3).",
		InputSchema: map[string]any{"type": "object", "properties": map[string]any{"set": map[string]any{"type": "object", "properties": map[string]any{
			"enabled": map[string]any{"type": "boolean"}, "count": map[string]any{"type": "integer", "minimum": 1, "maximum": 3}}, "additionalProperties": false}}, "required": []string{"set"}, "additionalProperties": false}}, r.settingsUpdate)
	return r, nil
}

func Run(ctx context.Context, dataDir string) error {
	r, err := New(Options{DataDir: dataDir})
	if err != nil {
		return err
	}
	return r.mcp.Run(ctx, &mcp.StdioTransport{})
}

func (r *Runtime) settingsRead(context.Context, *mcp.CallToolRequest, emptyInput) (*mcp.CallToolResult, settingsReadOutput, error) {
	return nil, settingsReadOutput{Schema: map[string]any{"type": "object", "properties": map[string]any{
		"enabled": map[string]any{"type": "boolean", "title": "启用回复建议"},
		"count":   map[string]any{"type": "integer", "title": "建议条数", "minimum": 1, "maximum": 3}}, "required": []string{"enabled", "count"}},
		Values: r.settings.read(), Layout: []any{map[string]any{"kind": "group", "title": "回复建议", "items": []any{
			map[string]any{"kind": "property", "property": "enabled"}, map[string]any{"kind": "property", "property": "count"}}}}}, nil
}

func (r *Runtime) settingsUpdate(_ context.Context, _ *mcp.CallToolRequest, input settingsUpdateInput) (*mcp.CallToolResult, settingsUpdateOutput, error) {
	value, err := r.settings.update(input.Set)
	return nil, settingsUpdateOutput{Values: value}, err
}
