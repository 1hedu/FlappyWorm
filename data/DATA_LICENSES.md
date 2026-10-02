# Data sources and attribution

All data is loaded through OpenWorm's ConnectomeToolbox (`cect`, MIT), which bundles the
source spreadsheets. Derived files in this folder must cite their sources below.
Confirm each publisher's reuse terms before redistributing raw source files.

| Use | Source | Via |
|---|---|---|
| Wiring (chemical + gap junctions) | Cook et al. 2019, *Nature* 571:63 | `cect.readers.Cook2019HermReader` |
| Neurotransmitter identity | Wang et al. 2024, *eLife* 13:RP95402 | `cect.readers.Wang2024HermReader` |
| Per-edge sign predictions (optional) | Fenyves et al. 2020 / WormNeuroAtlas (Randi et al.) | `cect.readers.WormNeuroAtlasReader`, `wormneuroatlas` |
| Functional atlas (optional toggle) | Randi et al. 2023, *Nature* 623:406 | `cect.readers.WormNeuroAtlasFuncReader` |
| Eigenworm basis (48 angles x 7 modes, N2) | Schafer lab, via openworm/open-worm-analysis-toolbox `master_eigen_worms_N2.mat` | `data/raw/eigenworms_N2.npy` |
| Real escape recordings (12 x 20 s, 4 eigen-coefficients) | Broekmans et al. 2016 *eLife* 5:e17227, sample data in AntonioCCosta/local-linear-segmentation (Costa, Ahamed & Stephens 2019) | `data/raw/escape_tseries.npy` |

Body model derived from these: `data/body_model_v1.json` (prep/fit_body.py). Confirm reuse terms of the source repositories before redistributing the raw files.
