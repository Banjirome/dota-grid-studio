package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const (
	dotaFontSize      = 16.0
	dotaLetterSpacing = 2.0
	dotaPaddingLeft   = 4.0
	dotaControlHeight = 20.0
)

var dotaLabelColor = color.RGBA{R: 0x80, G: 0x8f, B: 0xa6, A: 0xff}

type renderDocument struct {
	Configs []renderConfig `json:"configs"`
}

type renderConfig struct {
	Name       string           `json:"config_name"`
	Categories []renderCategory `json:"categories"`
}

type renderCategory struct {
	Name   string  `json:"category_name"`
	X      float64 `json:"x_position"`
	Y      float64 `json:"y_position"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type logicalBounds struct{ minX, minY, maxX, maxY float64 }

func selectRenderConfig(document renderDocument, selector string) (renderConfig, error) {
	if len(document.Configs) == 0 {
		return renderConfig{}, fmt.Errorf("the document has no configs")
	}
	if selector == "" {
		return document.Configs[0], nil
	}
	if index, err := strconv.Atoi(selector); err == nil {
		if index < 0 || index >= len(document.Configs) {
			return renderConfig{}, fmt.Errorf("config index %d is out of range", index)
		}
		return document.Configs[index], nil
	}
	for _, config := range document.Configs {
		if strings.EqualFold(config.Name, selector) {
			return config, nil
		}
	}
	return renderConfig{}, fmt.Errorf("config %q was not found", selector)
}

func newDotaFace(scale float64) (font.Face, error) {
	fontData, err := assets.ReadFile("frontend/src/assets/fonts/radiance-semibold.otf")
	if err != nil {
		return nil, fmt.Errorf("embedded Radiance font is unavailable: %w", err)
	}
	parsed, err := opentype.Parse(fontData)
	if err != nil {
		return nil, fmt.Errorf("could not parse embedded Radiance font: %w", err)
	}
	face, err := opentype.NewFace(parsed, &opentype.FaceOptions{Size: dotaFontSize * scale, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		return nil, fmt.Errorf("could not initialise embedded Radiance font: %w", err)
	}
	return face, nil
}

func textWidth(face font.Face, text string, spacing float64) float64 {
	runes := []rune(text)
	width := 0.0
	for _, character := range runes {
		width += float64(font.MeasureString(face, string(character))) / 64
	}
	if len(runes) > 1 {
		width += float64(len(runes)-1) * spacing
	}
	return width
}

func measureConfig(config renderConfig, face font.Face, glow float64) (logicalBounds, error) {
	if len(config.Categories) == 0 {
		return logicalBounds{}, fmt.Errorf("config %q has no categories", config.Name)
	}
	bounds := logicalBounds{minX: math.Inf(1), minY: math.Inf(1), maxX: math.Inf(-1), maxY: math.Inf(-1)}
	effect := math.Max(6, glow)
	for _, category := range config.Categories {
		label := strings.ToUpper(category.Name)
		width := textWidth(face, label, dotaLetterSpacing)
		left := category.X + dotaPaddingLeft
		top := category.Y + (dotaControlHeight-dotaFontSize)/2
		bounds.minX = math.Min(bounds.minX, math.Min(category.X, left)-effect)
		bounds.minY = math.Min(bounds.minY, math.Min(category.Y, top)-effect)
		bounds.maxX = math.Max(bounds.maxX, math.Max(category.X+category.Width, left+width)+effect)
		bounds.maxY = math.Max(bounds.maxY, math.Max(category.Y+category.Height, top+dotaFontSize)+effect)
	}
	return bounds, nil
}

func drawSpacedString(target draw.Image, face font.Face, source image.Image, x, baseline, spacing float64, text string) {
	drawer := font.Drawer{Dst: target, Src: source, Face: face, Dot: fixed.P(int(math.Round(x)), int(math.Round(baseline)))}
	for _, character := range []rune(text) {
		drawer.DrawString(string(character))
		drawer.Dot.X += fixed.Int26_6(math.Round(spacing * 64))
	}
}

func blurAlpha(source *image.Alpha, radius int) *image.Alpha {
	if radius <= 0 {
		return source
	}
	bounds := source.Bounds()
	temporary := image.NewAlpha(bounds)
	result := image.NewAlpha(bounds)
	window := radius*2 + 1
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		sum := 0
		for x := bounds.Min.X - radius; x <= bounds.Min.X+radius; x++ {
			if x >= bounds.Min.X && x < bounds.Max.X {
				sum += int(source.AlphaAt(x, y).A)
			}
		}
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			temporary.SetAlpha(x, y, color.Alpha{A: uint8(sum / window)})
			remove, add := x-radius, x+radius+1
			if remove >= bounds.Min.X {
				sum -= int(source.AlphaAt(remove, y).A)
			}
			if add < bounds.Max.X {
				sum += int(source.AlphaAt(add, y).A)
			}
		}
	}
	for x := bounds.Min.X; x < bounds.Max.X; x++ {
		sum := 0
		for y := bounds.Min.Y - radius; y <= bounds.Min.Y+radius; y++ {
			if y >= bounds.Min.Y && y < bounds.Max.Y {
				sum += int(temporary.AlphaAt(x, y).A)
			}
		}
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			result.SetAlpha(x, y, color.Alpha{A: uint8(sum / window)})
			remove, add := y-radius, y+radius+1
			if remove >= bounds.Min.Y {
				sum -= int(temporary.AlphaAt(x, remove).A)
			}
			if add < bounds.Max.Y {
				sum += int(temporary.AlphaAt(x, add).A)
			}
		}
	}
	return result
}

func parseBackground(value string) (color.Color, error) {
	if strings.EqualFold(value, "transparent") {
		return color.RGBA{}, nil
	}
	value = strings.TrimPrefix(value, "#")
	if len(value) != 6 {
		return nil, fmt.Errorf("background must be transparent or #RRGGBB")
	}
	parsed, err := strconv.ParseUint(value, 16, 32)
	if err != nil {
		return nil, fmt.Errorf("background must be transparent or #RRGGBB")
	}
	return color.RGBA{R: uint8(parsed >> 16), G: uint8(parsed >> 8), B: uint8(parsed), A: 0xff}, nil
}

func renderGridPNG(options cliOptions) error {
	data, err := os.ReadFile(options.RenderPath)
	if err != nil {
		return fmt.Errorf("could not read input JSON: %w", err)
	}
	if issues := validateDotaJSON(data); len(issues) > 0 {
		return fmt.Errorf("invalid Dota JSON: %s", strings.Join(issues, "; "))
	}
	var document renderDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return err
	}
	config, err := selectRenderConfig(document, options.Config)
	if err != nil {
		return err
	}
	measureFace, err := newDotaFace(1)
	if err != nil {
		return err
	}
	defer measureFace.Close()
	glow := 0.0
	if options.Glow {
		glow = 6
	}
	bounds, err := measureConfig(config, measureFace, glow)
	if err != nil {
		return err
	}
	width := int(math.Ceil((bounds.maxX-bounds.minX)*options.Scale)) + options.Padding*2
	height := int(math.Ceil((bounds.maxY-bounds.minY)*options.Scale)) + options.Padding*2
	if width <= 0 || height <= 0 || width > 32768 || height > 32768 {
		return fmt.Errorf("render size %dx%d is outside the supported range", width, height)
	}
	background, err := parseBackground(options.Background)
	if err != nil {
		return err
	}
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	if _, _, _, alpha := background.RGBA(); alpha != 0 {
		draw.Draw(canvas, canvas.Bounds(), image.NewUniform(background), image.Point{}, draw.Src)
	}
	mask := image.NewAlpha(canvas.Bounds())
	face, err := newDotaFace(options.Scale)
	if err != nil {
		return err
	}
	defer face.Close()
	metrics := face.Metrics()
	textHeight := float64(metrics.Ascent+metrics.Descent) / 64
	baselineOffset := (dotaControlHeight*options.Scale-textHeight)/2 + float64(metrics.Ascent)/64
	for _, category := range config.Categories {
		x := (category.X-bounds.minX)*options.Scale + float64(options.Padding) + dotaPaddingLeft*options.Scale
		baseline := (category.Y-bounds.minY)*options.Scale + float64(options.Padding) + baselineOffset
		drawSpacedString(mask, face, image.NewUniform(color.Alpha{A: 0xff}), x, baseline, dotaLetterSpacing*options.Scale, strings.ToUpper(category.Name))
	}
	if options.Glow {
		glowMask := blurAlpha(mask, int(math.Round(6*options.Scale)))
		draw.DrawMask(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{R: dotaLabelColor.R, G: dotaLabelColor.G, B: dotaLabelColor.B, A: 0xb0}), image.Point{}, glowMask, image.Point{}, draw.Over)
	}
	shadowMask := image.NewAlpha(canvas.Bounds())
	draw.Draw(shadowMask, shadowMask.Bounds().Add(image.Pt(int(math.Round(2*options.Scale)), int(math.Round(2*options.Scale)))), mask, image.Point{}, draw.Src)
	shadowMask = blurAlpha(shadowMask, int(math.Round(4*options.Scale)))
	draw.DrawMask(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{A: 0x44}), image.Point{}, shadowMask, image.Point{}, draw.Over)
	draw.DrawMask(canvas, canvas.Bounds(), image.NewUniform(dotaLabelColor), image.Point{}, mask, image.Point{}, draw.Over)

	if err := os.MkdirAll(filepath.Dir(options.OutputPath), 0o755); err != nil && filepath.Dir(options.OutputPath) != "." {
		return err
	}
	output, err := os.Create(options.OutputPath)
	if err != nil {
		return fmt.Errorf("could not create PNG: %w", err)
	}
	defer output.Close()
	if err := png.Encode(output, canvas); err != nil {
		return fmt.Errorf("could not encode PNG: %w", err)
	}
	return nil
}
