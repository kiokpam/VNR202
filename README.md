Magazine Viewer (image-based)

This viewer expects your magazine page images to sit in the same folder as the HTML file.
By default it looks for images named `1.png`, `2.png`, ... `12.png` (cover = `1.png`).

Features
- Cover (page 1) shown alone, other pages shown as two-page spreads.
- Click hotspots on pages to read attached text aloud using the browser Speech Synthesis API.
- Edit Hotspots mode: click-and-drag on an image to draw a region, then enter its text.
- Hotspots are saved to localStorage and can be exported/imported as JSON (`Export Hotspots` / `Import`).
- Adjust read-aloud rate and pitch using the controls in the toolbar.

How to use
1. Open `index.html` in a modern browser (Chrome/Edge/Safari recommended).
2. If your images use different filenames, either rename them to `1.png`... or use the Import feature with an exported JSON that references your filenames.
3. Toggle "Edit Hotspots", draw areas on the image, and enter the text to attach.
4. Click a hotspot to hear the text; click again to stop.

Hotspot JSON format (exported)
{
  "pages": [ { "title": "Cover", "img": "1.png" }, ... ],
  "hotspots": {
    "1.png": [ { "x":0.12, "y":0.1, "w":0.3, "h":0.15, "text":"Passage text" } ]
  }
}

If you want, I can:
- Adjust the code to try multiple filename patterns (jpg/webp) automatically.
- Add an auto-generated manifest from your image names.
- Preload your actual passages if you have a CSV/JSON of texts mapped to filenames — I can import and map them for you.
