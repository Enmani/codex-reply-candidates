package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

const (
	defaultCount = 3
	minCount     = 1
	maxCount     = 3
)

// Settings is the plugin's private configuration. It never changes Codex's
// native composer or autocomplete settings.
type Settings struct {
	Enabled bool `json:"enabled"`
	Count   int  `json:"count"`
}

type SettingsPatch struct {
	Enabled *bool `json:"enabled,omitempty"`
	Count   *int  `json:"count,omitempty"`
}

type settingsStore struct {
	mu    sync.RWMutex
	path  string
	value Settings
}

func newSettingsStore(dataDir string) (*settingsStore, error) {
	if dataDir == "" {
		dataDir = defaultDataDir()
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create plugin data directory: %w", err)
	}
	store := &settingsStore{
		path:  filepath.Join(dataDir, "settings.json"),
		value: Settings{Enabled: true, Count: defaultCount},
	}
	data, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read plugin settings: %w", err)
	}
	if err := json.Unmarshal(data, &store.value); err != nil {
		return nil, fmt.Errorf("decode plugin settings: %w", err)
	}
	if err := validateSettings(store.value); err != nil {
		return nil, err
	}
	return store, nil
}

func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		if root := os.Getenv("LOCALAPPDATA"); root != "" {
			return filepath.Join(root, "Codex", "reply-candidates")
		}
	}
	root, err := os.UserConfigDir()
	if err != nil || root == "" {
		root = "."
	}
	return filepath.Join(root, "Codex", "reply-candidates")
}

func validateSettings(value Settings) error {
	if value.Count < minCount || value.Count > maxCount {
		return fmt.Errorf("count must be between %d and %d", minCount, maxCount)
	}
	return nil
}

func (s *settingsStore) read() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.value
}

func (s *settingsStore) update(patch SettingsPatch) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.value
	if patch.Enabled != nil {
		next.Enabled = *patch.Enabled
	}
	if patch.Count != nil {
		next.Count = *patch.Count
	}
	if err := validateSettings(next); err != nil {
		return s.value, err
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return s.value, fmt.Errorf("encode plugin settings: %w", err)
	}
	if err := os.WriteFile(s.path, append(data, '\n'), 0o600); err != nil {
		return s.value, fmt.Errorf("write plugin settings: %w", err)
	}
	s.value = next
	return next, nil
}
