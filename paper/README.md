# Hundred Step paper

Run `npm ci`, then `sh paper/template/reproduce.sh` from the repository root.
Use Node 22 with npm 10, Python 3, Tectonic, and Poppler (`pdfinfo` and `pdftotext`).
The output is `paper/hundred-step-paper.pdf`. PDFs and downloaded styles remain untracked.
The unchanged pilot template downloads the official style and checks its archive hash.
Experiments use local scripted adapters through the public runner. No provider credentials or paid calls are used.

The packet contains 240 control episodes and 4,608 simulated episodes, each repeated.
Simulation varies omission probability and recovery, with matched task and seed draws.
Every simulated rate describes the stipulated process, not a learned model.
Control completion uses Wilson reference intervals. Score and survival use workflow-cluster bootstrap intervals.
Simulation uses seed-cluster bootstrap intervals and paired contrasts. Boundary bootstrap intervals can collapse.
The plan commit precedes results. It is not an independent external registration.
The frozen source commit and hashes appear in `data/provenance.generated.json`.
`data/verification.generated.json` records full replay and summary checks.
Raw actions, control transcripts, and simulated states remain in generated JSON files.

The family report supplies context, not imported scores. There is no hosted-model or human study.
No earlier paper exists in this repository. Rendered evidence therefore shows the new document only.
Do not publish or merge this packet. The parent handles review and publication.
Paper text and generated figures use CC-BY-4.0. Benchmark software retains MIT.
