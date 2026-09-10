# Supplier Z-Score Automation · Financial Risk Analytics Platform

> **Language / 语言：** [中文](./README.md) · **English**
>
> Supplier financial risk analytics built on the **Altman Z-Score** model
> Upload statements → auto-parse → compute Z → visualize → self-audit dictionary → compare suppliers

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white">
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white">
</p>

---

## Table of Contents

- [What It Is](#what-it-is)
- [Key Capabilities](#key-capabilities)
- [Download & Install](#download--install)
- [Quick Start](#quick-start)
- [Run From Source](#run-from-source)
- [Project Structure](#project-structure)
- [Documentation Index](#documentation-index)
- [Data & Privacy](#data--privacy)
- [Tech Stack](#tech-stack)

---

## What It Is

Drop in a supplier's **financial statements (PDF / scanned image / PPTX)**. The system locates the statement pages, extracts the relevant line items, runs a three-tier retrieval chain plus five validation gates, and finally computes an **Altman Z-Score** with a risk classification (safe / grey / distress).

Built for procurement, supply-chain risk, and credit review: **batch due diligence on supplier financial health**, with line-item-level provenance retained for every number.

Supported model variants:

| Model | Applies to | Factors | Notes |
|-------|-----------|---------|-------|
| **Z** (1968) | Listed companies | 5 | Includes market-value equity factor X4 |
| **Z′** (1983) | Unlisted manufacturers | 5 | X4 replaced with book equity |
| **Z″** (1995) | Unlisted non-manufacturers | 4 | Drops the turnover factor |

---

## Key Capabilities

### Parsing Engine (Python)
- **Multi-format ingestion**: digital PDF (pdfplumber), scanned OCR (GLM-4V-Flash vision model), PPTX statements (python-pptx)
- **Multi-file merge**: several PDFs for one supplier can be uploaded at once and merged server-side before parsing
- **Statement auto-location**: identifies balance-sheet / income-statement pages by page features, not hard-coded page numbers
- **Three-tier retrieval chain**: `L1 direct line match` → `L2 component aggregation` → `L3 accounting identity derivation`, with graceful fallback at each level
- **Row-number guard**: filters out bare integers 1–999 so line numbers are never mistaken for amounts
- **EBIT decision tree**: `Profit before tax + interest expense` first, with a fallback when interest expense is absent
- **Five validation gates**: G1 double-entry balance, G2 cross-statement ties, G3 value sanity, G4 EBIT cross-check, G5 completeness
- **Dictionary self-audit loop**: unrecognized line items land in a review panel and are written back to the production dictionary once confirmed — accuracy improves over time

### Web Application (Next.js)
- **Upload & analyze**: drag-and-drop upload plus industry / period / accounting standard / currency inputs
- **Visualization**: Z-score SVG gauge, factor breakdown bars, line-item provenance table, validation-gate status lights
- **Manual entry & recompute**: fill in missing fields by hand and recompute instantly; derived values are flagged "pending confirmation"
- **Supplier library**: history archiving, multi-period aggregation per supplier, single / batch delete with cascade cleanup
- **Comparison view**: select multiple analysis runs and compare Z-scores and factor composition side by side
- **Bilingual UI**: switch between Chinese and English from the top-right dropdown; preference persisted (localStorage + cookie)

### Output & Export
- **Excel export**: risk ranking sheet + factor detail sheet (matching the existing calculator format)
- **JSON API**: full `ExtractionResult` + `ZScoreResult` for downstream systems
- **On-page review**: field → page number → source text → extraction method / confidence, fully traceable

---

## Download & Install

### Option 1: Git Clone (recommended — easy to keep updated)

```bash
git clone https://github.com/Peterolll/zscore-supplier-risk.git
cd zscore-supplier-risk
```

To update later, simply run inside the directory:

```bash
git pull
```

### Option 2: Download ZIP (no Git required)

1. Open the repository: <https://github.com/Peterolll/zscore-supplier-risk>
2. Click the green **`Code`** button at the top right → **`Download ZIP`**
3. Unzip and enter the extracted directory

> Best when you only want to browse the code / docs, or Git is unavailable in your environment.

### Just want the docs?

All design documents, review notes, and verification reports are archived under **[`docs/`](./docs/README.md)** and can be read directly on GitHub — no need to download the code:

| Category | Directory | Contents |
|----------|-----------|----------|
| Design & review | [`docs/design/`](./docs/design) | PRD, solution design, design review, statement sample analysis, workflow diagram |
| Reports & post-mortems | [`docs/reports/`](./docs/reports) | End-to-end verification report, defect root-cause & fix report |
| Samples & assets | [`docs/samples/`](./docs/samples) | Financial-statement layout sample screenshots (redacted) |

---

## Quick Start

### Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| **Node.js** | 22.x | Needs built-in `node:sqlite` (validated on 22.22.2) |
| **Python** | 3.10+ | Runs the `zscore_pipeline` engine |
| **Git** | any | Only needed for the "Git Clone" option |

> Scanned-document OCR additionally requires a `GLM_API_KEY` (vision model). **Without it, digital-text statements still work** — scanned files return an explicit "pending" status instead of failing.

### One-command Startup (recommended)

```bash
# Install dependencies first — see "Run From Source" below
./start-zscore.sh
```

The script locates the repo root automatically, starts the dev server in the background (survives terminal close), and prints the URL once ready:

```
启动成功 → http://localhost:3000
```

---

## Run From Source

### 1. Prepare the Python engine environment

Run from the **repository root**:

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

### 2. Install web frontend dependencies

```bash
cd zscore-web
npm install
```

### 3. Start the dev server

```bash
npm run dev
# open http://localhost:3000
```

### Environment Variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `ZSCORE_PYTHON` | Auto-detected (repo-root `.venv` → system `python3`) | Python interpreter that can `import zscore_pipeline` |
| `ZSCORE_WORKSPACE` | Parent directory of `zscore-web` | Engine working directory, must contain the `zscore_pipeline/` package |

Usually no configuration is needed. If auto-detection fails, set `ZSCORE_PYTHON` explicitly in `zscore-web/.env.local`.

---

## Project Structure

```
zscore-supplier-risk/
├── README.md                  # Chinese README
├── README.en.md               # This file (English)
├── requirements.txt           # Python engine dependencies
├── start-zscore.sh            # One-command startup script
├── .gitignore                 # Excludes secrets / real statements / databases
│
├── docs/                      # Documentation archive (see docs/README.md)
│   ├── README.md              #   Documentation index
│   ├── design/                #   Design & review documents
│   ├── reports/               #   Verification / fix / review reports
│   └── samples/               #   Statement layout samples (redacted)
│
├── scripts/
│   └── push-to-github.sh      # GitHub push helper script
│
├── zscore-web/                # Next.js 16 web application
│   ├── app/                   #   Pages and API routes
│   ├── components/            #   UI components
│   ├── lib/                   #   Engine bridge / database / i18n / compute
│   ├── public/                #   Static assets (user manual, workflow diagram)
│   ├── docs/                  #   AI-assist feature PRD
│   └── README.md / README.en.md  # Bilingual user manual
│
└── zscore_pipeline/           # Python computation engine
    ├── m2_extract*.py         #   Text / PPTX extraction
    ├── m3_locate.py           #   Statement page location
    ├── m4_map.py              #   Three-tier mapping & EBIT derivation
    ├── m5_validate.py         #   Five validation gates
    ├── m6_calc.py             #   Z-score computation
    ├── dict/                  #   Data dictionary (synonyms / field tree)
    └── benchmarks/            #   Regression benchmarks
```

---

## Documentation Index

| Document | Language | Description |
|----------|----------|-------------|
| [`docs/README.md`](./docs/README.md) | ZH | **Master documentation index** (start here) |
| [`zscore-web/README.md`](./zscore-web/README.md) | ZH | User manual v2.0: features, architecture, workflows |
| [`zscore-web/README.en.md`](./zscore-web/README.en.md) | EN | User manual (English) |
| [`docs/design/`](./docs/design/) | ZH | PRD, solution design, design review |
| [`zscore-web/docs/AI_ASSIST_PRD.md`](./zscore-web/docs/AI_ASSIST_PRD.md) | ZH | AI-assist feature PRD |

> See [`docs/README.md`](./docs/README.md) for the full listing.

---

## Data & Privacy

This repository contains **no real sensitive data**. The following are excluded via `.gitignore` and are never pushed:

- Secrets & credentials: `.env`, `*.key`, `zscore_pipeline/.glm_key`, `**/ai-config.json`
- User data: `zscore-web/uploads/`, `zscore_pipeline/output/`, `*.db`
- The security-weakness review report: `docs/reports/Z-Score自动化_代码审查报告.md`
- `profiles.json`, whose benchmark entries reference personal paths (a redacted template is provided)

Financial-statement screenshots under `docs/samples/` are **redacted layout samples**, included only to illustrate page structure, and contain no complete identifiable business data.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4, Recharts |
| Backend | Next.js Route Handlers, Node `node:sqlite` |
| Engine | Python 3, pdfplumber, pypdf, python-pptx, Pydantic, openpyxl |
| OCR (optional) | GLM-4V-Flash vision model |

---

<p align="center">
  <sub>Supplier Z-Score Automation · Altman Z-Score Supplier Risk Platform</sub>
</p>
