"""
Root conftest.py — ensures the project root is on sys.path so that
`from bindings.python.se import ...` resolves from any test directory.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
