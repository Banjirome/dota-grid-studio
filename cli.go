package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type cliOptions struct {
	OpenPath   string
	RenderPath string
	OutputPath string
	Config     string
	Background string
	Scale      float64
	Padding    int
	Glow       bool
	Help       bool
}

func parseCLI(args []string) (cliOptions, error) {
	options := cliOptions{Scale: 2, Padding: 32, Background: "transparent"}
	set := flag.NewFlagSet("dota-grid-maker", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.StringVar(&options.OpenPath, "open", "", "open a hero_grid_config.json in the editor")
	set.StringVar(&options.RenderPath, "render", "", "render a hero_grid_config.json to PNG and exit")
	set.StringVar(&options.OutputPath, "output", "", "PNG output path for --render")
	set.StringVar(&options.Config, "config", "", "config name or zero-based index")
	set.StringVar(&options.Background, "background", "transparent", "transparent or #RRGGBB")
	set.Float64Var(&options.Scale, "scale", 2, "PNG render scale")
	set.IntVar(&options.Padding, "padding", 32, "PNG padding in pixels")
	set.BoolVar(&options.Glow, "glow", false, "enable additional symbol glow")
	set.BoolVar(&options.Help, "help", false, "show command line help")
	set.BoolVar(&options.Help, "h", false, "show command line help")
	if err := set.Parse(args); err != nil {
		return options, err
	}
	if options.OpenPath == "" && options.RenderPath == "" && len(set.Args()) > 0 {
		options.OpenPath = set.Args()[0]
	}
	if options.OpenPath != "" && options.RenderPath != "" {
		return options, fmt.Errorf("--open and --render cannot be used together")
	}
	if options.Scale <= 0 || options.Scale > 16 {
		return options, fmt.Errorf("--scale must be greater than 0 and no more than 16")
	}
	if options.Padding < 0 || options.Padding > 4096 {
		return options, fmt.Errorf("--padding must be between 0 and 4096")
	}
	if options.RenderPath != "" && options.OutputPath == "" {
		extension := filepath.Ext(options.RenderPath)
		options.OutputPath = strings.TrimSuffix(options.RenderPath, extension) + ".png"
	}
	return options, nil
}

func printCLIHelp() {
	text := `Dota Grid Studio

Open in the desktop editor:
  dota-grid-maker.exe hero_grid_config.json
  dota-grid-maker.exe --open hero_grid_config.json

Render a PNG without opening the editor:
  dota-grid-maker.exe --render hero_grid_config.json --output preview.png

Render options:
  --config NAME|INDEX       Config name or zero-based index (default: 0)
  --scale NUMBER           Output scale (default: 2)
  --padding PIXELS         Output padding (default: 32)
  --background VALUE       transparent or #RRGGBB (default: transparent)
  --glow                   Enable additional glow
`
	_, _ = fmt.Fprint(os.Stdout, text)
}
