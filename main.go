package main

import (
	"embed"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist frontend/src/assets/fonts/radiance-semibold.otf
var assets embed.FS

func main() {
	cli, err := parseCLI(os.Args[1:])
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "Dota Grid Studio:", err)
		os.Exit(2)
	}
	if cli.Help {
		printCLIHelp()
		return
	}
	if cli.RenderPath != "" {
		if err := renderGridPNG(cli); err != nil {
			_, _ = fmt.Fprintln(os.Stderr, "Dota Grid Studio render failed:", err)
			os.Exit(1)
		}
		return
	}

	app := NewApp(cli.OpenPath)

	// Create application with options
	err = wails.Run(&options.App{
		Title:     "Dota Grid Studio",
		Width:     1500,
		Height:    900,
		MinWidth:  1100,
		MinHeight: 700,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 13, G: 15, B: 19, A: 1},
		DragAndDrop:      &options.DragAndDrop{EnableFileDrop: true},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
