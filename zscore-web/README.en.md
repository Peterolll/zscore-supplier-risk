# Supplier Z-Score Risk Analyzer — User Manual v2.0

> **Language / 语言：** [English](#) · [中文](./README.md)
>
> Version: v2.0 | Last updated: 2026-09-10
> Scope: `zscore-web` web application (Next.js 16 + Python engine)

> **UI Language Switch / 界面语言切换：** Switch between Chinese and English via the dropdown in the top-right of the web UI. Choice persists across reloads (localStorage + cookie).
> 系统右上角下拉支持中/英双语。偏好持久化到 localStorage + cookie，刷新保留。

A supplier financial risk analysis platform built on the Altman Z-Score model, providing the full closed loop: **upload financial statements → auto-extract → compute Z → visualize → dictionary self-review → multi-supplier comparison**.

---

## Features

### Core capabilities
- **Multi-format upload & analysis**: supports PDF (electronic text / scanned image) and PPTX financial statements; user fills in industry / period / accounting standard / currency; Z is computed automatically.
- **Multi-file upload + PDF merging**: Multiple PDFs of the same supplier can be uploaded together and merged server-side before extraction.
- **Three-tier extraction chain**: L1 direct hit → L2 sub-indicator aggregation → L3 accounting-identity fallback — every tier guarantees the next best result.
- **Dictionary self-review loop**: System auto-detects unrecognized line items and routes them into the “Pending Review” panel where a human can confirm and write them back into the dictionary.
- **Visualized detail page**: SVG Z-gauge (zone arc), factor-decomposition bars, item-level evidence table, 5 validation gate states.
- **Manual override + confirmation tags**: Manually fill missing fields and recompute Z; derived values are flagged “Derived — Pending”.
- **Supplier library management**: Historical records archive, multi-period aggregation per supplier, single / batch delete (cascading cleanup).
- **Multi-supplier comparison**: Tick multiple analysis runs and compare Z ranges, factor composition, and grouped sub-indicators.
- **Listed / Unlisted dual-model**: Supports the original listed-company Z model (5 factors, market-cap-based X4) and unlisted Z′ / Z″ models.

### Extraction engine
- **Electronic-text channel**: pdfplumber for text and table extraction.
- **Scanned-image OCR**: GLM-4V-Flash visual OCR; returns an explicit “pending” state when the API key is missing.
- **Row-number anti-mis-extraction**: When a statement contains large-amount figures, pure integers in 1–999 are filtered out automatically to prevent row numbers being mistaken for amounts.
- **EBIT decision tree**: PBT + interest-expense preferred; falls back to PBT alone when no interest expense is found.

### Output & export
- **Excel export**: Risk-ranking sheet + factor-detail sheet, retaining the existing calculator format.
- **JSON API**: Full `ExtractionResult` + `ZScoreResult` payloads for downstream consumption.
- **Page-level review**: One page per supplier — field → page number → source text → extraction method / confidence.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js 16 (App Router, React 19, TypeScript, Tailwind v4)       │
│                                                                   │
│  app/page.tsx              Home: upload form + recent analyses    │
│  app/suppliers/            Supplier library + history + delete    │
│  app/runs/[runId]/         Single analysis detail (editable)      │
│  app/compare/              Multi-supplier comparison              │
│  app/dictionary/           Dictionary management + pending panel   │
│                                                                   │
│  app/api/analyze           Upload → engine call → persist + dict_gaps │
│  app/api/suppliers         Supplier list / delete                  │
│  app/api/runs/[id]         Analysis detail GET + PATCH (recomp.)   │
│  app/api/compare           Compare data                            │
│  app/api/dictionary        Dictionary GET/PUT                      │
│  app/api/dictionary/gaps   Pending item approve / ignore           │
│       │ spawn child process                                        │
│       ▼                                                          │
│  lib/engine.ts  ──►  python -m zscore_pipeline.serve ...          │
│                           │                                        │
│                           ▼                                        │
│              zscore_pipeline/ (Python compute engine)             │
│              pdfplumber text extraction + GLM-4V-Flash scan OCR    │
│              FIELD_TREE + three-tier chain (L1/L2/L3 + DERIVED)   │
│              Synonym mapping / row-number guard / 5 gates          │
│                           │ JSON single-line output                │
│       lib/db.ts (node:sqlite)  ◄── persist + dict_gaps            │
└─────────────────────────────────────────────────────────────────┘
```

Persistence: Node built-in `node:sqlite`, database file at `zscore-web/data/zscore.db`, uploaded files at `zscore-web/uploads/`. No external database service required.

---

## Runtime

| Dependency | Version / Path | Notes |
|------|------------|------|
| Node.js | 22.x (built-in `node:sqlite`) | Development uses 22.22.2 |
| Python | venv with `zscore_pipeline` deps | See `ZSCORE_PYTHON` below |
| GLM_API_KEY | optional | Only needed for scanned-image OCR; otherwise scanned statements return “pending” |

## Quick Start

```bash
# 0. Get the code
git clone <repo-url> zscore && cd zscore

# 1. Prepare the Python engine environment (run at repo root)
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 2. Enter the web project, install JS deps
cd zscore-web && npm install

# 3. (Optional) Specify the Python interpreter
cp .env.example .env.local   # Auto-detects .venv by default; usually no edit needed

# 4. Start the dev server
npm run dev
# Open http://localhost:3000
```

### Environment variables

| Variable | Default | Notes |
|------|--------|------|
| `ZSCORE_PYTHON` | auto-detected (repo-root `.venv` → system `python3`) | Python interpreter (must `import zscore_pipeline`) |
| `ZSCORE_WORKSPACE` | parent of `zscore-web` | Engine cwd; must contain the `zscore_pipeline/` package |

---

## Usage Workflow

### 1. Upload a financial statement

1. From the homepage, click **Upload & Analyze**, pick files (multi-select supported) and fill in:
   - **Supplier Name** (same name automatically groups under one supplier)
   - **Industry**: Manufacturing / Service (selects Z′ or Z″ model)
   - **Listing Status**: Listed / Unlisted (Listed uses market-cap-based original Z)
   - **Reporting Period**: Annual / Semi-annual / Q1–Q4 (non-annual auto-annualized)
   - **Accounting Standard**: CAS / IFRS / Taiwan GAAP / Hong Kong GAAP / Other
   - **Currency** (optional, label only)
2. Supported formats:
   - **PDF**: electronic text or scanned image
   - **PPTX**: PowerPoint-format financial statements
   - **Multi-file upload**: multiple PDFs for the same supplier are auto-merged
3. After submission the analysis is computed and you are redirected to the detail page.

### 2. View analysis detail

The detail page shows:

- **Z-Score gauge**: SVG arc, intuitive safe / grey / distress zones.
- **Factor breakdown**: X1–X5 bar chart + values.
- **Item-source evidence table**: matched item, page number, source text, extraction method (L1 / L2 / derived / manual), confidence.
- **Validation gates**: 5 gates — G1 Balance Sheet Equation, G2 Field Completeness, G3 Non-Negativity, G4 Magnitude Plausibility, G5 Sign Consistency.
- **Status flags**:
  - `Derived — Pending` (amber): derived via accounting identity, recommend manual review.
  - `Pending Confirmation` (amber): manually entered or low-confidence.
  - `Confirmed` (green): manually confirmed or high-confidence direct hit.

### 3. Manual override & recompute

When auto-extraction is wrong or missing:

1. On the detail page, click the edit button next to a field.
2. Enter the correct value.
3. The system auto-recomputes Z and the risk zone.
4. Manually entered fields are tagged `manual` method.

### 4. Dictionary management

Visit `/dictionary`:

- **Field cards**: synonym list for each Z-Score field, directly editable.
- **Indicator tree (FIELD_TREE)**: expand to view sub-indicators and their aliases.
- **Pending review panel**:
  - The system auto-detects unrecognized line items (rows with values that match no field).
  - These appear in the “Pending” panel showing item name, value, source page, sample file.
  - Click **Approve** to add it to the dictionary as a new alias (choose target field & type: direct / sub-indicator).
  - Click **Ignore** to skip the item.

### 5. Supplier library management

Visit `/suppliers`:

- View all suppliers and their historical analyses.
- Click a supplier to see multi-period Z trend.
- **Delete operations**:
  - Single delete: click the delete button on the supplier detail page.
  - Batch delete: tick multiple suppliers on the list page.
  - Cascading cleanup: supplier → analysis runs → field data → original files.

### 6. Multi-supplier comparison

Visit `/compare`:

- Tick multiple analysis runs (cross-supplier, cross-period).
- Compare Z scores and factor composition.
- View grouped sub-indicator detail.

---

## Models & Thresholds

| Model | Scenario | Safe Zone | Grey Zone | Distress Zone |
|------|---------|--------|------|--------|
| Z (1968 original, 5 factors) | Listed companies | Z > 2.99 | 1.81 < Z ≤ 2.99 | Z ≤ 1.81 |
| Z′ (1983, unlisted manufacturing, 5 factors) | Unlisted manufacturing | Z > 2.90 | 1.23 < Z ≤ 2.90 | Z ≤ 1.23 |
| Z″ (1995, unlisted non-manufacturing, 4 factors) | Unlisted service | Z > 2.60 | 1.10 < Z ≤ 2.60 | Z ≤ 1.10 |

**5 validation gates**:
- G1 Balance Sheet Equation: |Assets − (Liabilities + Equity)| < 1 yuan
- G2 Field Completeness: key fields non-empty
- G3 Non-Negativity: Assets / Liabilities ≥ 0
- G4 Magnitude Plausibility: key fields within reasonable magnitude
- G5 Sign Consistency: field sign logic is consistent

---

## Three-tier Extraction Chain (Detailed)

The system applies a tiered fallback strategy for the 6 core balance-sheet fields (CA / CL / EQ / RE / TA / TL):

| Tier | Method | Confidence | Notes |
|------|------|--------|------|
| L1 direct hit | match the subtotal row directly via the synonym library | 1.0 | Preferred — grabs “Total Current Assets”, “Total Assets”, etc. |
| L2 sub-indicator aggregation | sum sub-indicators via FIELD_TREE | 0.85 (coverage ≥ 25%) | When L1 misses or returns too-small values: sum Cash + Receivables + Inventory… |
| L3 identity fallback | infer via accounting identities | 0.7 | TL = TA − EQ; EQ = TA − TL; TA = TL + EQ; CL = TL − non-current liabilities; CA = TA − non-current assets |

**Anti-mis-extraction guard**: When the statement contains large amounts (≥ 100,000), pure integers in 1–999 are filtered out automatically to prevent row numbers being mistaken for amounts.

---

## Directory layout

```
zscore-web/
├── app/                        # Pages and API routes
│   ├── page.tsx                # Home: upload + recent analyses
│   ├── suppliers/              # Supplier library (list + detail + delete)
│   ├── runs/[runId]/            # Analysis detail (editable)
│   ├── compare/                 # Multi-supplier comparison
│   ├── dictionary/              # Dictionary management + pending panel
│   └── api/                     # API routes
│       ├── analyze/             # Upload → engine → persist
│       ├── suppliers/           # Supplier list / delete
│       ├── runs/[id]/           # Analysis detail GET + PATCH
│       ├── compare/             # Compare data
│       ├── dictionary/          # Dictionary GET/PUT
│       └── dictionary/gaps/     # Pending item approve/ignore
├── components/                  # Visualization components
│   ├── ZGauge                   # Z-Score gauge
│   ├── FactorBars               # Factor decomposition bars
│   ├── EvidenceTable            # Item-source evidence table
│   ├── EditableRunDetail        # Editable analysis detail
│   ├── CompareView              # Comparison view
│   └── GapsPanel                # Pending-item panel
├── lib/                         # Core libraries
│   ├── db.ts                    # node:sqlite persistence layer
│   ├── engine.ts                # Python child-process invocation
│   ├── types.ts                 # TypeScript types
│   ├── constants.ts             # Z coefficients and thresholds
│   ├── zscore.ts                # Z-recompute logic
│   ├── messages/                # i18n: zh.ts / en.ts / index.ts / types.ts
│   └── i18n.tsx                 # React Context + useT() hook + persistence
├── types/                       # node:sqlite type patches
├── data/                        # zscore.db (runtime)
└── uploads/                     # Uploaded files (runtime)
```

Python engine directory:

```
zscore_pipeline/
├── serve.py                     # CLI entry (JSON output)
├── pipeline.py                  # Main pipeline (PDF/PPTX branching)
├── config.py                    # OCR prompts and config
├── models.py                    # Data models (ExtractMethod enum)
├── synonym.py                   # Dictionary load + match_component + suggest_field_for_gap
├── m4_map.py                    # Three-tier chain core (L1/L2/L3 + sanitize)
├── m2_extract_pptx.py           # PPTX extraction module
├── override.py                  # Manual override (MANUAL mode)
└── dict/
    └── synonyms.json            # Data dictionary (SYNONYMS + FIELD_TREE + EQUITY_INCL_MINORITY)
```

---

## Known limitations

- **Scanned-image OCR requires GLM_API_KEY**: When missing, scanned statements return `422 OCR_UNAVAILABLE` with a prompt to configure the key. Electronic-text statements are unaffected.
- **Image-based PDFs are non-deterministic**: GLM-4V-Flash OCR results on scanned / image-based PDFs may vary due to row-number interference. The row-number anti-mis-extraction guard mitigates this; manual override is recommended in extreme cases.
- Same-vendor multi-period statements are archived as “same supplier + multiple runs” — no automatic cross-period comparison (use the comparison view manually).
- Data is fully local, no authentication, no multi-user isolation — local / intranet use only.