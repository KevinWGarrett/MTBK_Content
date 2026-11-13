# Bike Geometry Comparison

A static web page that draws up to three bicycles to scale from their geometry numbers, overlays them, and lets you download the result as an SVG. It is a JavaScript port of Kevin Garrett’s Python *Bike Geometry SVG* project, prepared so it can be hosted on GitHub Pages.

There is no build step and no framework. The page is plain HTML, CSS, and vanilla JavaScript (ES modules). Opening it through a static file server is enough.

## How to use

1. Open the page (see [Run locally](#run-locally) or [GitHub Pages](#publish-on-github-pages)).
2. In each of the three **Bike** slots, pick a catalog bike, one of your **My bikes**, choose **Custom geometry…** to type your own numbers, or leave the slot as **None**.
3. Pick a colour for each bike. Use **Align bikes at** to line every bike up, fore-aft, on the bottom bracket (the default), the rear wheel hub, or the front wheel hub. Vertical position is unchanged: all bikes share the same ground line.
4. The drawing, labels, and spec / difference blocks update as you edit. Differences are shown as bike *N* minus bike 1, under the heading `Diffs (N-1)`.
5. In the custom form you can set **crank length** (the original Python default is 165 mm; catalog bikes use that when they omit the field) and **Save to My bikes**. Saved bikes stay in this browser only — use **Export My bikes** to download a JSON backup, and **Import My bikes** to merge one back in. Clearing site or browser data removes them. A share link embeds the full geometry, so someone else can open it without your saved list.
6. **Download SVG** saves the current drawing. **Copy share link** copies a URL with the current bikes, alignment, colors, custom or saved geometry, and drawing settings in the hash (`#...`), so you can bookmark or send it. Older links that carried a per-bike X offset still load; the offset is ignored and the bikes are aligned at the bottom bracket.
7. **Drawing settings** (blend mode, canvas size, ground line, download zoom) stay at the original project defaults unless you change them. The canvas widens automatically if an alignment would otherwise clip a bike.

Units on the form: millimetres for lengths, degrees for head and seat-tube angles, inches for wheel diameters (the same convention as the original Python data). Invalid fields show a short message and that bike is left out of the drawing until the numbers are valid.

## Run locally

ES modules and `fetch` of `bikes/bikes.json` need an HTTP origin, so do not open `index.html` as a `file://` URL.

From this folder:

```bash
python3 -m http.server
```

Then visit [http://127.0.0.1:8000/](http://127.0.0.1:8000/) in a browser. Any other static server in this directory works the same way.

## How to add a bike

Edit `bikes/bikes.json` and append an object with a unique `id` and the same fields as the existing entries:

```json
{
  "id": "bike_myride",
  "model": "My Ride",
  "frame_size": "L",
  "notes": "Mixed wheels (29/27.5)",
  "top_tube_meas_l": 620,
  "seat_tube_l": 450,
  "head_tube_l": 120,
  "stand_over_h": 780,
  "bb_drop": 20,
  "wheel_base": 1220,
  "wheel_dia_front_in": 29,
  "wheel_dia_rear_in": 29,
  "chainstay_l": 435,
  "seat_tube_angle": 75.0,
  "head_angle": 66.0,
  "reach": 470,
  "stack": 630,
  "fork_offset": 44,
  "crank_length": 165
}
```

Lengths are millimetres, angles are degrees, wheel diameters are inches. The dropdown and the large SVG title use the short name `model`, `frame_size` (for example `Specialized Turbo Levo 4, S4`). Put extra wording — wheel setup, size equivalence, and similar — in `notes`, which is drawn in a smaller font under the name in the title block and in the details table. A legacy `description` field is still read as notes if `notes` is empty, so older share links keep working. Optional extra fields the app also uses: `category` (`trail`, `enduro`, `emtb`, or `light-emtb`) to group the catalog dropdown, plus `source_url`, `size`, `model_year`, and `setting` (shown as a source link under the picker). For mixed-wheel bikes use `wheel_dia_front_in` 29 and `wheel_dia_rear_in` 27.5, and record `bb_drop` relative to the rear axle. Optional `crank_length` is in millimetres; if it is omitted the original Python value of 165 mm is used. The new bike appears in the three slot dropdowns after you reload the page. You can also enter a one-off bike in the **Custom geometry** form without editing the file.

## Publish on GitHub Pages

1. Create a GitHub repository and put the contents of this folder at the **repository root** (`index.html` should sit next to `css/`, `js/`, and `bikes/`).
2. Push the files to the default branch (for example `main`).
3. In the repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick `main` and the `/ (root)` folder, and save.
4. After a short wait, the site is at `https://<user>.github.io/<repo>/`.

If you already have a project site and would rather keep these files in a `docs/` folder, set Pages to deploy the `/docs` folder instead.

Shareable links use the URL hash only (nothing is sent to a server). Anyone with the Pages URL and a hash from **Copy share link** will see the same bikes.

## Project layout

- `index.html`, `css/style.css` — page and layout
- `js/geometry.js` — pure math (frame points, wheels, specs, and alignment offsets)
- `js/svg.js` — SVG markup
- `js/app.js` — catalog, form, My bikes, live preview, hash, download
- `js/storage.js` — saved-bike serialize, validate, import merge, and localStorage access
- `bikes/bikes.json` — catalog
- `tests/compare.mjs` — compares JS results to a patched Python reference, plus crank-length, alignment, and storage helper checks

To run the comparison tests you need Node and the patched Python copy living next to this folder (`../py-fixed`). From this directory:

```bash
node tests/compare.mjs
```

## License

A license has not been chosen yet. Please ask before you assume you may copy, modify, or redistribute this project.
