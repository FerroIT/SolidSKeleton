# SolidSKeleton Reference Implementations

The current reference implimentations should be treated like references, things such as tessilation resolution, abstract choises etc.. need to be taken with a grain of salt. these are currently in use in FerroIT's products and will be developed to suit the general need of said products and implimentations.

For future tessilation, CSG calculations etc.. there are plans to create a local only lower level general package without as many abstract choises. 🫡

---

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
