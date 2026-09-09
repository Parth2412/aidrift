# AIDrift offline quickstart

This example proves the complete `0.9.0-beta.0` baseline-to-regression workflow without an API key or network call. It uses AIDrift's deterministic mock provider so the result is reproducible; replace the synthetic assertion and provider with behavior from your application after the walkthrough.

From the repository root, build the packages once and run the local CLI:

```bash
pnpm build
cd examples/quickstart
node ../../packages/cli/dist/cli.js validate
node ../../packages/cli/dist/cli.js snapshot --with-evals --with-probes --samples 5 --label clean
node ../../packages/cli/dist/cli.js check --samples 5
```

The first `check` prints `Result: PASS` and exits `0`. Now introduce the included behavioral regression and run the same gate:

```bash
cp fixtures/regressed-system.md prompts/system.md
node ../../packages/cli/dist/cli.js check --samples 5
```

The second `check` prints `Result: FAIL` and exits `1`. Restore the example before another run:

```bash
git restore prompts/system.md
rm -rf .aidrift
```

After the npm beta is published, the equivalent clean-install flow is:

```bash
npm install --global @zettacore/aidrift@0.9.0-beta.0
aidrift validate
aidrift snapshot --with-evals --with-probes --samples 5 --label clean
aidrift check --samples 5
```

Exit `2` means configuration or runtime failure, not detected drift. See the repository `README.md` and generated CLI reference for live OpenAI/Anthropic credentials, mandatory cost ceilings, and CI output formats.
