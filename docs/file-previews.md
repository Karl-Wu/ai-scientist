# File previews

Click any file in the project browser to open it in a built-in viewer — no download, no external app. Kady recognizes a wide range of scientific formats and renders each one appropriately: tables as tables, structures in 3D, spectra as plots, images as slice browsers.

Previews render in the browser and, for binary/scientific formats, in Python helpers on the BYOK backend host. The helper environment installs during setup. Large formats use bounded summaries or slice views; unsupported or oversized files remain available for download and analysis.

## What you can preview

### Documents & code
| Format | Extensions | Viewer |
|---|---|---|
| Images | `png` `jpg` `jpeg` `gif` `svg` `webp` `bmp` `ico` `heic` | Click to zoom to actual size; **annotate** with a red marker and save |
| Word | `docx` | Paged document preview; edit existing text and table cells |
| PowerPoint | `pptx` | Slide preview; edit existing slide text, table cells and notes |
| PDF | `pdf` | Paged viewer with selectable user highlights/notes and live expert annotations from lead or delegated AI agents |
| Markdown | `md` `mdx` | Rendered, with LaTeX math and Mermaid diagrams |
| Jupyter notebooks | `ipynb` | Cells with rich outputs — images, HTML tables, tracebacks |
| Text tables | `csv` `tsv` `json` (object arrays) `jsonl` `ndjson` | Table explorer: pagination, search, sorting, schema profiles, histograms, filtered CSV export and source view |
| LaTeX | `tex` `latex` | Split-pane editor with autocomplete, outline & spell check, two-way SyncTeX pdf.js preview, inline compile diagnostics, AI fix/edit, and Ask Kady handoff |
| Anything else | any text file | Syntax-highlighted, **editable** source |

LaTeX AI assistance preserves scientific content and makes minimal compile
fixes. When the supplied snippet is insufficient, it explains the missing
context without changing the document. Proposed replacements still use the
existing diff review. A suggestion is not a verified compilation; recompile
after accepting it. Missing-context responses are billed like other AI calls.

The LaTeX editor offers **Source**, **Split**, and **PDF** views and remembers
the selected view and split width. PDF previews start fitted to the pane and
resize with it; manual zoom and **Fit width** remain available. **Compile on
save** runs after an explicit save (it does not autosave as you type).

The PDF is marked out of date after source edits, and a failed build keeps the
previously displayed preview with a failure notice. Compiler errors in the open
file are clickable in the log; stale line locations cannot launch AI fixes.
The diagnostic gutter uses the final compiler pass, so warnings resolved by
reruns disappear. Bibliography failures still fail the build even if a later
TeX pass produces a PDF. Long logs retain both their beginning and final summary.

Select source and choose **Edit with AI** (⌘K / Ctrl+K). For chapter files with a
`% !TEX root = ../main.tex` comment, AI assistance also reads the root preamble.
Finish the diff review before saving, compiling, or requesting another AI edit.
Edits typed during a save stay unsaved, and the editor's **Close** button prompts
before discarding them.

### Genomics & sequences
| Format | Extensions | Viewer |
|---|---|---|
| FASTA / FASTQ | `fasta` `fa` `faa` `fna` `ffn` `fastq` `fq` | Color-coded sequences, per-record length / GC% / quality bars |
| Bioinformatics tables | `vcf` `bcf` `bed` `gff` `gtf` `gff3` `sam` `tsv` | Column table with header metadata |
| Multiple-sequence alignments | `aln` `clustal` `sto` `stk` `phy` `phylip` | Color-coded residue grid (N sequences × L columns) |
| Phylogenetic trees | `nwk` `newick` `tree` `nhx` | SVG cladogram |

### Chemistry & structures
| Format | Extensions | Viewer |
|---|---|---|
| 2D molecules | `smi` `smiles` `inchi` `mol` `sdf` `mol2` | 2D depiction with formula, molecular weight, atom/bond counts (multi-molecule SDF shows a gallery) |
| 3D structures | `pdb` `ent` `cif` `mmcif` `xyz` `gro` `pdbqt` | **Interactive 3D viewer** — rotate/zoom — plus a summary card (chains, residues, ligands, resolution) |

### Mass spec & spectroscopy
| Format | Extensions | Viewer |
|---|---|---|
| Mass-spec runs & spectra | `mzml` `mzxml` `mgf` | Total-ion chromatogram plus a selectable per-scan peak plot |
| JCAMP-DX (NMR / IR / MS) | `jdx` `dx` | Single numeric (AFFN) spectral curve with spacing and scale factors applied; compressed and compound encodings are rejected |

### Omics & data arrays
| Format | Extensions | Viewer |
|---|---|---|
| Single-cell (AnnData) | `h5ad` `h5ad.gz` | Structured card — obs/var columns, layers, embeddings you can color by any column |
| HDF5 | `h5` `hdf5` | Group / dataset tree plus selectable numeric heatmaps and line plots |
| Parquet | `parquet` | Schema, searchable/sortable row sample, selectable numeric scatter plot |
| NumPy | `npy` `npz` | Array selector, heatmap / line plot, multidimensional slice controls, displayed-value statistics |
| NetCDF | `nc` `nc4` `cdf` | Dimensions, root variables, attributes and numeric slice plots; masked values remain gaps |
| MATLAB | `mat` | Dense numeric variables from v4–v7.2 files; v7.3 uses the HDF5 dataset viewer and storage-axis order |
| Matrix Market | `mtx` | Dense or sparse matrix heatmap; sparse sources are sampled before conversion to a small dense grid |
| FITS images | `fits` `fit` `fts` | Image HDU selector, slice controls, heatmaps / line plots with FITS value scaling |

### Data tables & workbooks
| Format | Extensions | Viewer |
|---|---|---|
| Legacy Excel | `xls` | Read-only worksheet preview with sheet selection, Table Explorer with sampled search, sorting, schema profiles, histograms and filtered preview export |
| Excel | `xlsx` | Worksheet grid with basic cell/formula editing; Table Explorer offers sampled search, sorting, schema profiles, histograms and filtered preview export |
| Arrow IPC / Feather v2 | `arrow` `ipc` `feather` | File/stream schema and Table Explorer over a bounded row sample |
| DuckDB | `duckdb` | Read-only schema-qualified table/view selector with Table Explorer; external file/network access and extension loading disabled |
| SQLite | `sqlite` `sqlite3` `db` | Read-only ordinary-table selector with Table Explorer over a bounded row sample |

The read-only Data tools tables show up to **5,000 rows × 50 columns**; search, sorting and plots use only
that sample. Pagination (100 rows by default) navigates the sample, not the whole source file. Export filtered preview exports matching sample rows only; Copy preview CSV copies the loaded sample. Native column types appear alongside inferred types in Schema. Large cell text is capped at 512 characters. Where a format lacks
a cheap exact row count, the viewer explicitly reports that the total was not
scanned. SQLite views and virtual tables are excluded. DuckDB views that require external access show a preview error while keeping the collection selector available. A database held open by another writing process may need to be closed before preview. Charts omit missing/nonnumeric pairs; empty
cells and booleans are not treated as zero.

Numeric arrays show a line plot for vectors and a heatmap for matrices. For
higher dimensions, the slice control walks the leading dimensions in C order
while displaying the last two axes. Indices start at zero. Plots use at most
**1,024 vector points** or a **128 × 128 strided grid**. The viewer labels
sampling, missing values, and statistics from the displayed slice/sample;
these are not full-dataset statistics. Hover over a heatmap cell or plot point
to inspect its value. Striding can miss isolated features in large arrays.
Integer samples outside the browser's exact numeric range use exact text
previews instead of rounded plots; slice navigation remains available.

HDF5/NetCDF and NumPy `.npy` previews read slices; Parquet reads a limited row
batch. XLSX expanded content, Arrow files/batches, individual NPZ arrays and
classic MATLAB files/variables have a 64 MiB preview ceiling. Matrix Market is
limited to 64 MiB and two million stored entries / axis. JSON Lines scans at
most 8 MiB, with a 1 MiB per-line limit. File/container metadata and codec work
can still require additional memory. Oversized inputs show an explanation and
remain available for download or analysis. Array/variable and sheet/table lists
are bounded and show truncation notices. NumPy object arrays are never unpickled;
HDF5 external links and external/virtual dataset storage are not followed.

### Bio-imaging
| Format | Extensions | Viewer |
|---|---|---|
| DICOM | `dcm` `dicom` | Slice image with technical metadata — **patient-identifying tags are never shown** |
| NIfTI | `nii` `nii.gz` | Affine-aware sagittal / coronal / axial slices, including permuted/flipped storage; oblique or unspecified orientations use explicitly labeled native voxel planes |
| Microscopy / TIFF | `tif` `tiff` `ome.tif` `ome.tiff` | Page/plane browser (RGB and multi-plane stacks) |

## Notes

- **View-only vs. editable.** Office documents open in the built-in Office workspace (details below). Plain text and code are editable in place (⌘S to save); images can be annotated. The rich scientific viewers above are view-only — edit the underlying file with the agent or download it.
- **Text table explorer.** CSV, TSV, JSON object arrays, JSONL and NDJSON load complete files up to 8 MB and display 100 rows per page by default (select 10, 25, 50, 100 or 250). Search and sort cover all loaded rows; histograms and filtered CSV exports use all matching rows, not just the visible page. Schema profiles describe the complete loaded file. Empty/whitespace-only cells, absent fields and JSON null are missing; zero and false are values. Leading-zero identifiers and integers beyond JavaScript’s safe range stay text. Numeric inference is descriptive, not a data-dictionary guarantee. JSON nested values remain JSON text, and non-tabular JSON opens as source. Source view and Copy original preserve file text. Files over the byte limit, or tables over 1,000 columns / 1,000,000 cells, are rejected explicitly rather than silently truncated. Download remains available. Other text previews retain a 512 KB limit.
- **Reveal from chat.** When Kady references a file, line, or notebook cell, clicking it opens the file and jumps to that spot.
- **Provenance.** The preview header's **Provenance** button shows which tool call produced the file, what it read, its lineage back to uploaded data, and whether notebook citations are still current. See [Provenance](./provenance.md).
- **Missing dependency?** If the helper environment for a particular format hasn't finished installing, the viewer shows a friendly "preview unavailable" message instead of failing — reopen the file once setup completes.
- **Privacy.** DICOM previews omit patient-identifying fields from displayed metadata; this does not anonymize the underlying file. Hosted models, connectors or remote compute can receive data you ask the agent to use.

## Unsupported previews

There are no dedicated viewers for whole-slide imaging (`.svs`, `.ndpi`), GenBank/NEXUS annotated records, multi-channel OME-TIFF compositing or cross-file DICOM series stacking. The new data viewers do not cover legacy Excel `.xls`, ODS, Feather v1, FITS table HDUs, MATLAB cells/structs or nested NetCDF groups. NPZ previews accept NumPy header versions 1 and 2. Unrecognized files use the text fallback where possible; download binary formats or process them with the agent.

## Office documents: previews and the Office workspace

Open a `.docx`, `.pptx`, or `.xlsx` file for a quick preview, then choose
**Edit in Office** to open the full editor in a separate Kady browser tab.
The workspace uses Kady's typography, neutral colors and light/dark theme, with
Home, Insert, Layout and Review tabs. Its controls drive LibreOffice Writer, Calc
and Impress through ZetaOffice's WebAssembly engine. **All tools** reveals the
full native menus and toolbars without reopening the document. **Docker, a desktop Office installation, and an Office
account are not required.** Documents stay in the browser and local backend.

- **Word:** edit directly on the page, add paragraphs, format text and styles,
  work with tables, and adjust page layout using Writer's menus and toolbars.
- **Excel:** use the full cell grid, formula bar, worksheet tabs, formatting,
  row/column operations and chart tools. Calc recalculates supported formulas.
  The lightweight preview retains Kady's existing table/search/plot tools.
- **PowerPoint:** work with slide thumbnails, select and edit text and shapes
  on the canvas, change layouts, and add or rearrange slides in Impress.

Use Kady's **Save** button or **⌘S / Ctrl+S** to save back to the project.
The native Save toolbar action is also connected to project saves; native
Save As downloads a copy.
**Download copy** exports the current document in its original Office format.
Unsaved work stays in the editor tab; closing/reloading warns before discarding
it. Save before closing the tab. Kady's preview refreshes after an editor save.

Saves validate the exported package, atomically replace the original, and record
user provenance. SHA-256 revisions reject writes when another editor or agent
has changed the file. On conflict, the editor retains your work: download a copy
before reloading. Writer/Calc/Impress reserialize the document when exporting;
Microsoft-specific formatting, fonts, formulas, animations and advanced objects
may change or have limited support. The lightweight previews can also differ
from the full editor. This is a LibreOffice-based suite, not Microsoft Office.
Open project files from Kady's file browser and use **Download copy** for local
exports. Native New/Open/Close commands are disabled to keep the workspace tied
to its project file. Other native file dialogs (for example Insert Image) address
the engine's virtual filesystem.

The first editor launch needs internet access to download about **50 MB** of
compressed runtime assets (about **250 MB** cached on disk). Subsequent launches
use that local cache. The Next.js server downloads only an allowlisted runtime
snapshot from the official ZetaOffice CDN and verifies pinned SHA-256 hashes
before serving it. Cache: `~/.kady/office-assets/zeta-2025-05-13/`, or
`KADY_OFFICE_ASSETS_DIR`. A changed upstream build fails explicitly rather than
silently running different code; updating it requires reviewing the manifest
in `web/src/lib/office-assets.ts`. For offline provisioning, place the exact
manifest files in that cache directory.

The editor requires a browser with WebAssembly threads and SharedArrayBuffer,
served through localhost or HTTPS. Only `/office` receives the COOP/COEP headers
needed for isolation; the rest of Kady keeps its existing browser behavior.
Macros and automatic external-link updates are disabled. Encrypted files are
unsupported; signed files and Word documents with enforced protection open
read-only. Calc honors individual worksheet protection. Files are limited to
**32 MiB compressed / 64 MiB expanded / 10,000 ZIP entries**. Quick text previews
add limits of **10,000 text runs / 500 slides**, with a text fallback if visual
rendering fails. The full editor does not use those quick-preview text limits.

Runtime sources and attribution: [ZetaOffice](https://zetaoffice.net/),
[ZetaJS (MIT)](https://github.com/allotropia/zetajs), and
[LibreOffice licensing and source](https://www.libreoffice.org/about-us/licenses/).
The vendored ZetaJS bridge includes its MIT license in `web/public/office/`.

### Distribution views
All Table Explorer formats share the same distribution controls. Numeric columns
show histograms and min/mean/max. Text and categorical columns show the 20 most
frequent exact values plus an explicit combined remainder. Boolean values are
counted as true/false (case-insensitive). Missing values are counted separately;
percentages use all matching rows, including missing values. A numeric or date
column can also be explicitly displayed as value frequencies, useful for coded
categories. This display choice does not modify source data or schema types.

Valid ISO calendar dates and full ISO timestamps are inferred as dates; ambiguous
slash dates, invalid days and numeric identifiers remain text. Dates are grouped
by day, month or year using the calendar date written in the source, without
browser timezone conversion. Periods without records are omitted. More than 200
date groups require a coarser grouping or a filter; counts are never silently
truncated. Existing full-file versus bounded-preview scope still applies.

### Local pages from trusted tools

In a local chat, ask the agent to open the application's resource, then click **Open preview** in the tool result. The existing HTML Preview panel loads the page directly. Closing and reopening it loads the same address. The application owns saved data and needs to allow the platform origin as a frame ancestor. A file opened from the file list uses the isolated file viewer as before.

Install the adapter outside the project workspace. Register it in `~/.config/kady/preview-adapters.json` (or set `KADY_PREVIEW_ADAPTERS` to an absolute configuration file path) and start a new chat. Each entry specifies a project and a fixed executable and arguments, for example:

```json
[{
  "project": "example",
  "id": "review",
  "description": "Open an existing review using its resource ID.",
  "executable": "/usr/bin/python3",
  "args": ["-I", "/opt/local-tools/open-review.py"]
}]
```

The agent calls `open_local_preview` with `adapter` and `resource`. The platform launches the registered command directly and sends one JSON object on stdin with `platform_origin`, `project_id`, `workspace`, and `resource`. The adapter uses that origin to configure its own service, starts or reuses it, then writes one JSON result on stdout:

```json
{"open_preview":{"kind":"local_url","url":"http://127.0.0.1:45123/editor?view=draft#example","title":"Review editor"}}
```

The title and resource identifier are visible in chat. Keep credentials exclusively in the private URL. Adapters should avoid logging that URL themselves. Allowed destinations are HTTP services on an explicit localhost or 127.0.0.1 port distinct from the platform UI and API. The page runs scripts on its own origin. After loading it can call `parent.postMessage({type: "local-preview-ready"}, platform_origin)`. Browsers conceal cross-origin embedding errors, so without confirmation the panel offers troubleshooting and reload. The browser and application service must be on the same machine. Match the platform's hostname when the application uses same-site cookies.

Only an opaque reference and the title enter the tool result. Clicking it resolves the address in the originating project, chat and browser origin. References expire after eight hours, may be evicted at capacity, and expire on backend restart. Ask the tool to reopen the resource to obtain a fresh reference.

To verify in Chrome, run the web dev service, then from `server/` run `node --import tsx scripts/local-preview-acceptance.mjs`. Set `PLAYWRIGHT_MODULE` to an installed Playwright module if needed and `CHROME_PATH` to a local browser executable. The check uses a temporary project, a separate local editor, and a recorded chat containing the real adapter result.
