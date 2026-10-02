# Data sources and attribution

All data is loaded through OpenWorm's ConnectomeToolbox (`cect`, MIT), which bundles the
source spreadsheets. The files in this folder are derived from the sources below and keep their terms.

| Use | Source | Via |
|---|---|---|
| Wiring (chemical + gap junctions) | Cook et al. 2019, *Nature* 571:63 | `cect.readers.Cook2019HermReader` |
| Neurotransmitter identity | Wang et al. 2024, *eLife* 13:RP95402 | `cect.readers.Wang2024HermReader` |
| Per-edge sign predictions (optional) | Fenyves et al. 2020 / WormNeuroAtlas (Randi et al.) | `cect.readers.WormNeuroAtlasReader`, `wormneuroatlas` |
