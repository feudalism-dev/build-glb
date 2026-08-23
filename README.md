# build-glb

Turn **Instamat** / **Materialize** PBR texture exports into Second Life–ready GLB material packs — plus Blinn-Phong Diffuse/Specular helpers — without opening Blender.

## What it does

1. Watches (or one-shot scans) an Exports folder for texture sets  
2. Builds a self-contained **GLB** with BaseColor, Normal, ORM (+ occlusion), and optional Emissive  
3. Converts **16-bit** Instamat PNGs to **8-bit** (Second Life silently drops 16-bit maps)  
4. Bakes **Diffuse** = BaseColor × AO for Blinn-Phong  
5. Archives each set into a tidy folder:

```
MyMesh_MySet/
  MyMesh_MySet.glb
  *_AO-*.png                 ← AO next to the GLB
  pbr_textures/              ← BaseColor, Normal, ORM, Emissive
  Blinn-Phong_textures/      ← Diffuse, Specular, copy of Normal
```

A master mesh `.glb` is **optional**. If missing, a materials-only GLB is created (fine for **Build → Upload → Material** in Second Life).

## Requirements

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)
- Windows, macOS, or Linux

## Quick start

```bash
git clone https://github.com/feudlaism-dev/build-glb.git
cd build-glb
npm install
```

### Point it at your Exports folder

**Option A — config file (easiest on Windows)**

```bash
copy exports-path.example.txt exports-path.txt
```

Edit `exports-path.txt` to one line, e.g.:

```
C:\Users\YourName\Documents\InstaMAT\Exports
```

**Option B — environment variable**

```bash
# Windows PowerShell
$env:INSTAMAT_EXPORTS = "C:\Users\YourName\Documents\InstaMAT\Exports"

# macOS / Linux
export INSTAMAT_EXPORTS="$HOME/Documents/InstaMAT/Exports"
```

**Option C — CLI flag every time**

```bash
npx tsx src/index.ts watch -f "C:\Users\YourName\Documents\InstaMAT\Exports"
```

If none of the above are set, it uses `./Exports` under the project folder.

### Run

| Action | Windows | Any OS |
|--------|---------|--------|
| Watch & auto-build | Double-click `watch-exports.bat` | `npm run watch` |
| Build once | Double-click `build-once.bat` | `npm run build` |
| Inspect detected sets | Double-click `inspect.bat` | `npm run inspect` |

Watch mode also processes any texture sets already sitting in the folder when it starts.

## Instamat export filename template

Use:

```
{textureSetID}_{GRAPH.NAME}_{OUTPUT.NAME}-{FORMAT.WIDTH}x{FORMAT.HEIGHT}
```

Examples of good names:

```
red_MyNewSectional_Base_BaseColor-2048x2048.png
red_MyNewSectional_Cushion_AO-2048x2048.png
paisley1_PBR_BaseColor-2048x2048.png
```

Pattern:

```
<textureSetID>_<meshName>_<materialName>_<textureType>-<resolution>.png
```

| Part | Meaning |
|------|---------|
| textureSetID | Set / variant name (`red`, `Set3`, …) |
| meshName | Model name, or `PBR` for generic materials |
| materialName | Must match a GLB material slot when a master mesh is present. Optional for Materialize one-material packs (defaults to textureSetID). |
| textureType | `BaseColor`, `Normal`, `ORM`, `Emissive`, `AO` / `AmbientOcclusion`, `Specular` |
| resolution | Ignored for matching (e.g. `2048x2048`) |

**PBR → GLB:** BaseColor, Normal, ORM, Emissive  

**Blinn-Phong helpers:** AO → baked Diffuse; Specular from Instamat glossiness is archived (not inverted by this tool)

## Commands reference

```bash
npm run build
npm run watch
npm run inspect

npx tsx src/index.ts build -f "D:\path\to\Exports"
npx tsx src/index.ts build -s red -m MyNewSectional
npx tsx src/index.ts build --no-archive
npx tsx src/index.ts watch -d 60
npx tsx src/index.ts make-placeholder -n MyMesh
```

## Notes for Second Life

- Upload the generated `.glb` via **Build → Upload → Material…** for PBR materials.
- Use files in `Blinn-Phong_textures/` for classic diffuse / specular / normal uploads.
- ORM packing: **R** = occlusion, **G** = roughness, **B** = metallic.

## Development

```bash
npm run test:parse
npx tsx src/blinnphong.test.ts
npx tsx src/materials-only.test.ts
```

## License

MIT — see [LICENSE](LICENSE).
