from .error import SSKError
from .api import (
    ConversionResult,
    DEFAULT_RESOLUTION,
    canonical_document,
    convert,
    document_differences,
    documents_equivalent,
    inspect_file,
    load,
    mesh_document,
    validate_document,
    validate_file,
)
from .parse_ssk import parse as parse_ssk
from .parse_sskb import parse as parse_sskb
from .resolve import resolve
from .validate import validate
from .write_sskb import write as write_sskb

__version__ = '1.0rc1'

__all__ = [
    'SSKError',
    'ConversionResult',
    'DEFAULT_RESOLUTION',
    '__version__',
    'canonical_document',
    'convert',
    'document_differences',
    'documents_equivalent',
    'inspect_file',
    'load',
    'mesh_document',
    'parse_ssk',
    'parse_sskb',
    'resolve',
    'validate',
    'validate_document',
    'validate_file',
    'write_sskb',
]
