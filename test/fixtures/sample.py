"""
Sample Python file to test the Python parser.
Tests: imports, classes, methods, functions, decorators, async, calls.
"""

# Various import styles
import os
import json as j
from pathlib import Path
from typing import List, Optional
from collections import defaultdict, Counter as C
from . import utils
from ..helpers import format_string

# Constants
MAX_SIZE = 1024


def helper_function(x: int, y: int) -> int:
    """Simple helper function."""
    return x + y


def process_data(items: List[str]) -> dict:
    """Process a list of items and return counts."""
    counter = Counter(items)
    result = defaultdict(int)

    for item in items:
        result[item] = helper_function(len(item), 1)
        print(f"Processing: {item}")

    return dict(result)


async def fetch_data(url: str) -> Optional[dict]:
    """Async function to fetch data."""
    path = Path(url)
    if path.exists():
        with open(path) as f:
            return j.load(f)
    return None


class DataProcessor:
    """A class to process data with various strategies."""

    def __init__(self, name: str, config: dict = None):
        self.name = name
        self.config = config or {}
        self._internal_state = []

    def process(self, data: list) -> list:
        """Process the data and return results."""
        results = []
        for item in data:
            transformed = self._transform(item)
            results.append(transformed)
        return results

    def _transform(self, item):
        """Internal transform method."""
        return helper_function(item, 10)

    @staticmethod
    def validate(data) -> bool:
        """Static method for validation."""
        return isinstance(data, list) and len(data) > 0

    @classmethod
    def from_json(cls, json_str: str):
        """Create instance from JSON string."""
        config = j.loads(json_str)
        return cls(config.get('name', 'default'), config)


class AdvancedProcessor(DataProcessor):
    """Extended processor with additional features."""

    def __init__(self, name: str, mode: str = 'fast'):
        super().__init__(name)
        self.mode = mode

    def process(self, data: list) -> list:
        """Override parent process method."""
        if self.mode == 'fast':
            return self._fast_process(data)
        return super().process(data)

    def _fast_process(self, data: list) -> list:
        """Optimized processing."""
        return [helper_function(x, 0) for x in data]


@property
def decorated_func():
    """A decorated function."""
    pass


def main():
    """Entry point."""
    # Local function calls
    result = helper_function(1, 2)
    data = process_data(['a', 'b', 'c'])

    # Class instantiation and method calls
    processor = DataProcessor('test')
    processed = processor.process([1, 2, 3])
    is_valid = DataProcessor.validate([1, 2, 3])

    # Imported calls
    cwd = os.getcwd()
    path = Path('/tmp')

    # Builtin calls
    items = list(range(10))
    total = sum(items)
    print(f"Total: {total}")

    return result


if __name__ == '__main__':
    main()
