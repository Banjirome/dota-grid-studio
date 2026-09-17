package main

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestParseCLIRenderOptions(t *testing.T) {
	options, err := parseCLI([]string{"--render", "grid.json", "--output", "grid.png", "--config", "Art", "--scale", "3", "--padding", "20", "--glow"})
	if err != nil {
		t.Fatal(err)
	}
	if options.RenderPath != "grid.json" || options.OutputPath != "grid.png" || options.Config != "Art" || options.Scale != 3 || options.Padding != 20 || !options.Glow {
		t.Fatalf("unexpected options: %+v", options)
	}
}

func TestParseCLIPositionalJSON(t *testing.T) {
	options, err := parseCLI([]string{"hero_grid_config.json"})
	if err != nil {
		t.Fatal(err)
	}
	if options.OpenPath != "hero_grid_config.json" {
		t.Fatalf("expected positional JSON to open in editor, got %+v", options)
	}
}

func TestHeadlessRenderUsesEmbeddedFont(t *testing.T) {
	directory := t.TempDir()
	input := filepath.Join(directory, "grid.json")
	output := filepath.Join(directory, "grid.png")
	content := `{"version":3,"configs":[{"config_name":"Art","categories":[{"category_name":"Привет :=/\\|","x_position":10,"y_position":20,"width":30,"height":30,"hero_ids":[]}]}]}`
	if err := os.WriteFile(input, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	options := cliOptions{RenderPath: input, OutputPath: output, Config: "Art", Background: "transparent", Scale: 2, Padding: 16}
	if err := renderGridPNG(options); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	image, err := png.DecodeConfig(file)
	if err != nil {
		t.Fatal(err)
	}
	if image.Width < 100 || image.Height < 40 {
		t.Fatalf("rendered image is unexpectedly small: %dx%d", image.Width, image.Height)
	}
}
