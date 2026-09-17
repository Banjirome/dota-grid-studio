package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	launchPath string
}

type FilePayload struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type LaunchOptions struct {
	OpenPath     string `json:"openPath"`
	SettingsPath string `json:"settingsPath"`
}

type ReferenceImagePayload struct {
	Name    string `json:"name"`
	DataURL string `json:"dataURL"`
}

func NewApp(launchPath ...string) *App {
	app := &App{}
	if len(launchPath) > 0 {
		app.launchPath = launchPath[0]
	}
	return app
}
func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func executableSidecarPath(name string) (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not locate executable: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err == nil {
		executable = resolved
	}
	return filepath.Join(filepath.Dir(executable), name), nil
}

func (a *App) GetLaunchOptions() (LaunchOptions, error) {
	settingsPath, err := executableSidecarPath("dota-grid-studio.settings.json")
	if err != nil {
		return LaunchOptions{}, err
	}
	return LaunchOptions{OpenPath: a.launchPath, SettingsPath: settingsPath}, nil
}

func (a *App) LoadAppSettings() (string, error) {
	path, err := executableSidecarPath("dota-grid-studio.settings.json")
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "{}", nil
	}
	if err != nil {
		return "", fmt.Errorf("could not read settings: %w", err)
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return "", fmt.Errorf("settings file contains invalid JSON: %w", err)
	}
	return string(data), nil
}

func (a *App) SaveAppSettings(content string) error {
	var value any
	if err := json.Unmarshal([]byte(content), &value); err != nil {
		return fmt.Errorf("could not save invalid settings JSON: %w", err)
	}
	path, err := executableSidecarPath("dota-grid-studio.settings.json")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("could not save settings next to the executable: %w", err)
	}
	return nil
}

func readDotaJSONPath(path string) (*FilePayload, error) {
	if path == "" {
		return nil, fmt.Errorf("JSON path is empty lol")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("could not resolve the JSON path: %w", err)
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return nil, fmt.Errorf("could not read the file: %w", err)
	}
	if issues := validateDotaJSON(data); len(issues) > 0 {
		return nil, fmt.Errorf("the file is not a valid Dota hero grid: %s", strings.Join(issues, "; "))
	}
	return &FilePayload{Path: absolute, Content: string(data)}, nil
}

func (a *App) ReadDotaJSON(path string) (*FilePayload, error) {
	return readDotaJSONPath(path)
}

func (a *App) ReadReferenceImage(path string) (*ReferenceImagePayload, error) {
	if path == "" {
		return nil, fmt.Errorf("image path is empty")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("could not resolve the image path: %w", err)
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return nil, fmt.Errorf("could not read the reference image: %w", err)
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("%s is not a supported image", filepath.Base(absolute))
	}
	return &ReferenceImagePayload{
		Name:    filepath.Base(absolute),
		DataURL: "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data),
	}, nil
}

func (a *App) OpenDotaJSON() (*FilePayload, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Open Dota hero grid",
		Filters: []runtime.FileFilter{{DisplayName: "Dota hero grid (*.json)", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	return readDotaJSONPath(path)
}

func (a *App) SaveDotaJSON(content, currentPath string, choosePath bool) (string, error) {
	data := []byte(content)
	if issues := validateDotaJSON(data); len(issues) > 0 {
		return "", fmt.Errorf("cannot save: %s", strings.Join(issues, "; "))
	}
	path := currentPath
	if choosePath || path == "" {
		var err error
		path, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title: "Export Dota hero grid", DefaultFilename: "hero_grid_config.json",
			Filters: []runtime.FileFilter{{DisplayName: "JSON (*.json)", Pattern: "*.json"}},
		})
		if err != nil || path == "" {
			return "", err
		}
	}
	if _, err := os.Stat(path); err == nil && strings.EqualFold(filepath.Base(path), "hero_grid_config.json") {
		stamp := time.Now().Format("20060102-150405")
		backup := filepath.Join(filepath.Dir(path), "hero_grid_config.backup-"+stamp+".json")
		old, readErr := os.ReadFile(path)
		if readErr != nil {
			return "", fmt.Errorf("could not create backup: %w", readErr)
		}
		if writeErr := os.WriteFile(backup, old, 0o644); writeErr != nil {
			return "", fmt.Errorf("could not create backup: %w", writeErr)
		}
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("could not save the file: %w", err)
	}
	return path, nil
}

func (a *App) ExportPNG(dataURL string) (string, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		return "", fmt.Errorf("invalid PNG data")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
	if err != nil {
		return "", fmt.Errorf("could not encode PNG: %w", err)
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Export grid preview", DefaultFilename: "dota-grid.png",
		Filters: []runtime.FileFilter{{DisplayName: "PNG image (*.png)", Pattern: "*.png"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("could not save PNG: %w", err)
	}
	return path, nil
}

func validateDotaJSON(data []byte) []string {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		return []string{"invalid JSON (" + err.Error() + ")"}
	}
	issues := make([]string, 0)
	var version float64
	if raw, ok := root["version"]; !ok || json.Unmarshal(raw, &version) != nil {
		issues = append(issues, "version must be a number")
	}
	var configs []map[string]json.RawMessage
	if raw, ok := root["configs"]; !ok || json.Unmarshal(raw, &configs) != nil {
		return append(issues, "configs must be an array")
	}
	for ci, config := range configs {
		var name string
		if raw, ok := config["config_name"]; !ok || json.Unmarshal(raw, &name) != nil {
			issues = append(issues, fmt.Sprintf("configs[%d].config_name must be a string", ci))
		}
		var categories []map[string]json.RawMessage
		if raw, ok := config["categories"]; !ok || json.Unmarshal(raw, &categories) != nil {
			issues = append(issues, fmt.Sprintf("configs[%d].categories must be an array", ci))
			continue
		}
		for ei, category := range categories {
			prefix := fmt.Sprintf("configs[%d].categories[%d]", ci, ei)
			var categoryName string
			if raw, ok := category["category_name"]; !ok || json.Unmarshal(raw, &categoryName) != nil {
				issues = append(issues, prefix+".category_name must be a string")
			}
			for _, field := range []string{"x_position", "y_position", "width", "height"} {
				var number float64
				if raw, ok := category[field]; !ok || json.Unmarshal(raw, &number) != nil {
					issues = append(issues, prefix+"."+field+" must be a number")
				}
			}
			var heroes []json.RawMessage
			if raw, ok := category["hero_ids"]; !ok || json.Unmarshal(raw, &heroes) != nil {
				issues = append(issues, prefix+".hero_ids must be an array")
			}
			if len(issues) >= 12 {
				return append(issues, "more validation errors were omitted")
			}
		}
	}
	return issues
}
