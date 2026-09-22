"""Explicit local-workspace budgets; oversized operations never return partial results."""
import os


class ResourceLimitError(RuntimeError):
    pass


def budget(name, default):
    value = int(os.getenv('MAHA_MAX_' + name, default))
    if value < 1:
        raise ValueError('MAHA_MAX_' + name + ' must be positive')
    return value


def check(count, name, default):
    maximum = budget(name, default)
    if count > maximum:
        raise ResourceLimitError(f'Local {name.lower().replace("_", " ")} limit ({maximum:,}) exceeded. Use a smaller import or case scope; no partial result was returned.')
