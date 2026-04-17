from __future__ import annotations


class ProviderRateLimitError(Exception):
    pass


class ProviderAuthError(Exception):
    """Provider rejected request (invalid key / insufficient plan / unauthorized)."""
    pass

