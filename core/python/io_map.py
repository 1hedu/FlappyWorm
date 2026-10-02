"""Sensory inputs (game events -> neurons) and command readouts (neurons -> commands).
These tables are ENGINEERED choices, grounded in the literature cited in docs/DECISIONS.md."""
SENSORY = {
    "touch_anterior":  ["ALML", "ALMR", "AVM"],
    "touch_posterior": ["PLML", "PLMR", "PVM"],
    "tap":             ["ALML", "ALMR", "AVM", "PLML", "PLMR", "PVM"],
    "noxious_nose":    ["ASHL", "ASHR"],
    "salt_on":         ["ASEL"],
    "salt_off":        ["ASER"],
    "odor_on":         ["AWAL", "AWAR"],
    "odor_off":        ["AWCL", "AWCR"],
    "temperature":     ["AFDL", "AFDR"],
    "nose_touch":      ["FLPL", "FLPR", "OLQDL", "OLQDR", "OLQVL", "OLQVR"],
}
READOUT = {
    # Premotor hubs that directly drive A-type (backward) / B-type (forward) motor neurons.
    # AVD/AVE and PVC are upstream and act only through the wiring.
    "reverse": ["AVAL", "AVAR"],
    "forward": ["AVBL", "AVBR"],
    "omega":   ["AIBL", "AIBR", "RIVL", "RIVR"],
    "turn_ventral": ["SMDVL", "SMDVR", "RIVL", "RIVR"],
    "turn_dorsal":  ["SMDDL", "SMDDR"],
    "steer_left":   ["AIYL", "RMDL", "RMDDL", "RMDVL"],
    "steer_right":  ["AIYR", "RMDR", "RMDDR", "RMDVR"],
}
