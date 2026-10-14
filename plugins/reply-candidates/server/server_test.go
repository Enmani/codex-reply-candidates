package server

import (
	"context"
	"encoding/json"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"testing"
)

func TestOfficialNativeSettingsProtocol(t *testing.T) {
	r, err := New(Options{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	s, err := r.mcp.Connect(context.Background(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := c.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if session.InitializeResult().Capabilities.Experimental["openai/settings"] == nil {
		t.Fatal("settings capability missing")
	}
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.Tools) != 2 {
		t.Fatalf("unexpected tools: %d", len(tools.Tools))
	}
	for _, tool := range tools.Tools {
		if tool.OutputSchema == nil {
			t.Fatalf("missing output schema: %s", tool.Name)
		}
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "settings_update", Arguments: map[string]any{"set": map[string]any{"count": 2, "enabled": false}}})
	if err != nil || result.IsError {
		t.Fatalf("update error %v %+v", err, result)
	}
	result, err = session.CallTool(context.Background(), &mcp.CallToolParams{Name: "settings_read", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatalf("read error %v %+v", err, result)
	}
	data, _ := json.Marshal(result.StructuredContent)
	var got settingsReadOutput
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Values.Enabled || got.Values.Count != 2 {
		t.Fatalf("values %+v", got.Values)
	}
	properties := got.Schema["properties"].(map[string]any)
	count := properties["count"].(map[string]any)
	if count["minimum"] != float64(1) || count["maximum"] != float64(3) {
		t.Fatal("count range missing")
	}
}
