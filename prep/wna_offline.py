"""WormNeuroAtlas without network access.

wormneuroatlas.NeuroAtlas() pings WormBase for a DB version check and crashes when
WormBase is unreachable (always true in the Claude sandbox). The atlas data itself is
bundled with the package, so we skip only the version check.
"""
import wormneuroatlas as wna

wna.WormBase.assert_db_version_consistency = lambda self: None

# WNA names AWC by function; cect/Cook use left/right.
WNA_TO_COOK = {"AWCOFF": "AWCL", "AWCON": "AWCR"}


def load_atlas():
    return wna.NeuroAtlas()


def receptor_signs():
    """Returns (neuron_names_in_cook_convention, nts, sign[k, post, pre])."""
    a = load_atlas()
    nts = list(a.synapsesign.get_neurotransmitters())
    sign = a.get_chemical_synapse_sign()
    names = [WNA_TO_COOK.get(str(n), str(n)) for n in a.neuron_ids]
    return names, nts, sign
