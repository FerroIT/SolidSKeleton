# SolidSKeleton Reference Implementations

- [python/](python/)
- [typescript/](typescript/)

## Test Pipeline

Run Python checks from the repository root:

```sh
python -m unittest discover -s reference/python/tests -p test_conformance.py
python -m unittest discover -s reference/python/tests -p test_format_validation.py
python -m unittest discover -s reference/python/tests -p test_examples.py
python -m unittest discover -s reference/python/tests -p test_example_sweep.py
```

Run TypeScript checks from `reference/typescript`:

```sh
npm run typecheck
npm run test:format
npm run test:examples
npm pack --dry-run
```
