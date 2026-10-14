package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaultsPersistAndValidate(t *testing.T) {
	dir := t.TempDir()
	store, err := newSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.read(); got != (Settings{Enabled: true, Count: 3}) {
		t.Fatalf("defaults = %+v", got)
	}
	disabled := false
	count := 2
	if _, err := store.update(SettingsPatch{Enabled: &disabled, Count: &count}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := newSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.read(); got != (Settings{Enabled: false, Count: 2}) {
		t.Fatalf("reloaded = %+v", got)
	}
	bad := 4
	if _, err := reloaded.update(SettingsPatch{Count: &bad}); err == nil {
		t.Fatal("expected count validation error")
	}
	if got := reloaded.read(); got.Count != 2 {
		t.Fatalf("invalid update changed count: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatalf("settings file missing: %v", err)
	}
}
