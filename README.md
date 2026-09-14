# Green Steel Passport (GSP)

**AI-assisted, auditable carbon traceability for scrap-to-steel production**

Green Steel Passport fuses computer-vision scrap grading, furnace-process carbon regression, and a blockchain-backed Digital Product Passport (DPP) into a single per-heat carbon record — built for India's fragmented EAF/IF secondary steel sector and the documentation demands of the EU's Carbon Border Adjustment Mechanism (CBAM).

> Built for Smart India Hackathon 2026 · Problem Statement 
> *(fill in PS number/org — e.g. "PS-XXXXX, Ministry of Steel")*

---

## Table of contents

- [Why this exists](#why-this-exists)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Results](#results)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Scope & limitations](#scope--limitations)
- [Roadmap](#roadmap)
- [Team](#team)
- [License](#license)

---

## Why this exists

India's secondary steel sector (EAF/IF) makes up roughly **47% of national steel capacity**, but scrap grading is still manual and inconsistent, and mills have no cheap way to prove per-batch carbon intensity. At the same time, this is the steel sector most exposed to **CBAM**, which requires exactly that kind of evidence at the EU border — and a carbon number with no link back to furnace data or scrap imagery isn't defensible to an auditor, a lender, or a customer.

Green Steel Passport turns scrap images and furnace logs into an **evidence-linked, auditable per-heat carbon record** — not a bare number, but a certificate where every field is tagged by how it was produced (measured / CV-derived / model-derived / provenance) and anchored on-chain for tamper-evidence.

## How it works

1. **Grade the scrap** — classify composition/contamination from intake images.
2. **Fuse with furnace data** — join CV output to process logs via Heat ID / Camera ID / Truck ID (leakage-safe).
3. **Regress carbon intensity** — benchmark 5 models under grouped cross-validation; keep confidence intervals, not just a point estimate.
4. **Explain every prediction** — SHAP attributes each heat's estimate to specific features.
5. **Issue an auditable certificate** — every field tagged `measured` / `CV-derived` / `model-derived` / `provenance`.
6. **Anchor & verify on-chain** — hash the evidence to Hyperledger Fabric; prove claims about a heat (e.g. "carbon intensity below X") via zero-knowledge verification, without exposing the mill's private process data.

## Architecture

```
Scrap Image + Furnace Data (Heat ID linked)
        │
   ┌────┴────┐
   ▼         ▼
CV Subsystem   Furnace Regression
(scrap grade)  (carbon intensity)
   │         │
   └────┬────┘
        ▼
Certificate / Audit Layer
(measured / CV-derived / model-derived / provenance)
        ▼
DPP Application (per-heat record)
        │
   ┌────┴────┐
   ▼         ▼
Off-Chain    On-Chain Store
(images,     (hashes, events,
logs,         model version,
reports)      ZK proof)
   ⋮         │
             ▼
      Hyperledger Fabric
      (smart contracts, permissioned)
             ▼
       ZK Verification
             ▼
     Public / Customer DPP Viewer
        (lookup by Heat ID)
```

### Computer-vision subsystem
- **Detector:** CSP+SE+BiFPN, framed as multi-object detection to catch multiple contamination types (galvanized sheet, paint, grease, inclusions) at different scales in one pass.
- **Fine-grained classifier:** Swin Transformer on low-confidence crops — chosen over ResNet-50 and plain ViT for CNN-like local texture sensitivity plus transformer-level long-range shape context, without ViT's need for heavy pretraining/data on a small dataset.
- **Uncertainty:** Split Conformal Prediction — calibrated prediction sets instead of a bare softmax score, so a low-confidence classification is flagged for review rather than silently trusted.
- **Explainability:** Score-CAM overlay shows the exact image region driving every classification call.

### Furnace-data fusion & carbon regression
- **Leakage-safe linkage:** Heat ID + Camera ID + Truck ID join CV output to furnace process records; every evaluation split (not just calibration) is grouped by these keys.
- **Feature screening:** correlation + mutual information (train-fold only) plus a MARS-style nonlinear term.
- **Benchmark:** ElasticNet, MARS, Random Forest, XGBoost, and a small ANN under identical grouped CV + grid search.
- **Model selection rule:** when the top two models' bootstrapped 95% confidence intervals overlap, the more interpretable model (ElasticNet/MARS) wins over a marginally-lower-error black box — auditable coefficients matter more than a statistically indistinguishable performance edge.
- **Uncertainty vs. explainability, kept distinct:** bootstrapped prediction intervals (~100x resampling) quantify confidence; SHAP (global + local) attributes cause.

### Certificate / audit layer
Every field on the output certificate is tagged by evidentiary status — `measured`, `CV-derived`, `model-derived`, or `provenance` — so an auditor can tell a sensor reading from a model estimate at a glance, without reading a methodology appendix.

### Blockchain / DPP layer
- **Off-chain:** images, furnace logs, certificates, lab reports — kept off the shared ledger since none of it needs replicating across nodes, and some of it is confidentiality-sensitive.
- **On-chain (Hyperledger Fabric, permissioned):** Heat ID, DPP events, content hashes of the off-chain evidence, model version, access policies, ZK proof references — tamper-evident, never the raw data itself.
- **Smart contracts** restrict who may write a DPP event to enrolled mill organizations, and make each heat's record immutable once written.
- **Zero-knowledge verification** lets an auditor or customer verify a claim (e.g. "carbon intensity ≤ X") without ever seeing the mill's private furnace data or imagery.

## Results

### Carbon-intensity regression benchmark

| Model | Best params | MAE (kgCO₂e/t) | RMSE | R² |
|---|---|---|---|---|
| **ElasticNet** (selected) | `alpha=0.001, l1_ratio=0.5` | **0.716** | **1.203** | **0.986** |
| XGBoost | `learning_rate=0.1, max_depth=3, n_estimators=400` | 3.326 | 4.410 | 0.812 |
| MARS | spline approx., `n_knots=4, degree=1` | 4.530 | 6.131 | 0.637 |
| Random Forest | `max_depth=None, min_samples_leaf=3, n_estimators=200` | 6.402 | 8.343 | 0.327 |
| ANN | small feed-forward net | ~29.8 | — | — |

ElasticNet vs. XGBoost 95% bootstrap CIs (~100x resampling) **do not overlap** — ElasticNet is the statistically distinguishable winner, not just the nominal one.

### CV classifier (Swin-T)

| Metric | Value |
|---|---|
| Accuracy | 0.990 |
| Macro precision | 0.745 |
| Macro recall | 0.740 |
| Macro F1 | 0.743 |

The gap between raw accuracy (0.99) and macro-averaged F1 (0.743) is expected given the dataset's **72:1 class imbalance** (504 images in the largest class, 7 in the smallest) — macro averaging weights every class equally, so it's the honest read on rare-class performance rather than the majority-class-dominated accuracy figure.

### Conformal calibration

| Metric | Value |
|---|---|
| Target coverage | 0.90 |
| Empirical coverage | 0.911 |
| Avg. prediction-set size | 0.924 |
| Singleton sets | 92.4% |
| Empty sets (flagged for review) | 7.6% |

An empty prediction set means the model declines to commit to any class for that image rather than guessing — at 90% target coverage this is the conformal method correctly flagging ambiguous scrap images for human review.

## Tech stack

| Layer | Tools |
|---|---|
| Detection & transformers | CSP+SE+BiFPN, Swin Transformer |
| Regression / stats ML | ElasticNet, MARS, Random Forest, XGBoost, ANN |
| Explainability | SHAP, Score-CAM, Split Conformal Prediction |
| Ledger | Hyperledger Fabric (permissioned) |
| Verification | Zero-knowledge proofs |
| Data linkage | Heat ID / Camera ID / Truck ID |

## Repository structure

> Adjust this to match your actual repo layout before publishing — this reflects the project as described, not a verified file tree.

```
green-steel-passport/
├── cv/                     # scrap detection + Swin classifier, conformal prediction, Score-CAM
├── regression/             # feature screening, 5-model benchmark, SHAP
├── certificate/            # certificate assembly (measured/CV/model/provenance tagging)
├── chaincode/
│   └── gsp-dpp-chaincode.js   # Hyperledger Fabric smart contract (CreateDPPEvent, SubmitVerification, ...)
├── demo/
│   └── index.html          # standalone DPP viewer / mill portal / ledger explorer demo
├── data/                   # dataset references (see Getting started — not committed directly)
├── docs/
│   └── approach.docx       # full solution write-up
└── README.md
```

## Getting started

> Fill in exact commands once the repo's actual entry points are finalized — placeholders below assume a typical Python + Node layout.

### Prerequisites
- Python 3.10+
- Node.js 18+ (for chaincode and demo tooling)
- A Hyperledger Fabric test network (e.g. `fabric-samples/test-network`) if deploying the chaincode

### Datasets
- **Scrap grading:** Roboflow export, 2,003 images across 8 real EFR/BIR grade classes.
- **Furnace process data:** Kaggle EAF process tables (gas/O₂, materials, chemistry), keyed by Heat ID.

```bash
# clone
git clone https://github.com/<org>/green-steel-passport.git
cd green-steel-passport

# python environment
pip install -r requirements.txt

# run the CV pipeline / regression benchmark
# (fill in actual entry-point scripts)
```

### Deploying the chaincode
```bash
cd chaincode
npm install
# install/instantiate gsp-dpp-chaincode.js on your Fabric channel
# see chaincode/gsp-dpp-chaincode.js header comments for the contract API
```

## Live demo

`demo/index.html` is a standalone, no-server-needed walkthrough of the DPP layer:
- **Mill Portal** — submit a heat record; only enrolled mill identities can write (smart-contract access control).
- **DPP Viewer** — switch between Public and Auditor roles; Public sees ZK-style claim verification only, Auditor sees the full evidence-linked certificate.
- **Ledger Explorer** — inspect the hash-linked chain of blocks, including a live tamper-evidence test.

Open it directly in a browser — no build step required.

## Scope & limitations

Stated plainly, because it matters for how these results should be read:

- This system produces an **auditable, evidence-linked estimate** — it is not a certification authority in itself. Every field's evidentiary status is disclosed on the certificate rather than presented as uniformly certain.
- The CV pipeline's classification-first components (Swin classifier, conformal prediction, Score-CAM) are validated against the current dataset; the full per-object detector (CSP+SE+BiFPN) is scoped against a separately-collected, manually-boxed dataset.
- The zero-knowledge verification in the live demo simulates the **disclosure boundary** (public sees a boolean claim result, never the raw value) rather than implementing an actual zk-SNARK circuit — a real proving system is a substantial follow-on effort.
- Ledger persistence in the demo is local to the browser; a production deployment targets a real multi-org Hyperledger Fabric network (chaincode included in this repo).

## Roadmap

- [ ] Full per-object scrap detector on a manually-boxed dataset
- [ ] Production zk-SNARK circuit for threshold claims
- [ ] Multi-org Fabric network deployment (beyond single-node/demo)
- [ ] Confusion matrix + per-class recall reporting for the minority grade classes

## Student

> *(SAHAJ IIT Guwahati)*


