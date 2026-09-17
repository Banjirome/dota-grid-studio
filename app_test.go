package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateDotaJSONAcceptsUnknownFields(t *testing.T) {
	data := []byte(`{
		"version": 3,
		"future_root_field": {"kept": true},
		"configs": [{
			"config_name": "Art",
			"future_config_field": 42,
			"categories": [{
				"category_name": "/",
				"x_position": 500.25,
				"y_position": 200,
				"width": 30,
				"height": 30,
				"hero_ids": [],
				"future_category_field": "untouched"
			}]
		}]
	}`)
	if issues := validateDotaJSON(data); len(issues) != 0 {
		t.Fatalf("expected a valid extensible document, got %v", issues)
	}
}

func TestValidateDotaJSONReportsHumanReadablePath(t *testing.T) {
	data := []byte(`{"version":3,"configs":[{"config_name":"Broken","categories":[{"category_name":".","x_position":"bad","y_position":0,"width":30,"height":30,"hero_ids":[]}]}]}`)
	issues := validateDotaJSON(data)
	if len(issues) != 1 || issues[0] != "configs[0].categories[0].x_position must be a number" {
		t.Fatalf("unexpected issues: %v", issues)
	}
}

func TestReadReferenceImageReturnsEmbeddedDataURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reference.png")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	canvas := image.NewRGBA(image.Rect(0, 0, 2, 2))
	canvas.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(file, canvas); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	payload, err := NewApp().ReadReferenceImage(path)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Name != "reference.png" || !strings.HasPrefix(payload.DataURL, "data:image/png;base64,") {
		t.Fatalf("unexpected reference payload: %+v", payload)
	}
}

func TestReadReferenceImageRejectsNonImage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-an-image.png")
	if err := os.WriteFile(path, []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := NewApp().ReadReferenceImage(path); err == nil {
		t.Fatal("expected a non-image file to be rejected")
	}
}
