# Research Intelligence

A public, read-only research atlas connecting disciplines, themes, scholars, and publication evidence.

[Open the research atlas](https://lio-snp.github.io/research-intelligence/)

Stable release: **v3.3.0**. Data snapshot: **2026-08-31**.

- Explore one shared discipline map with pan, zoom, and theme navigation.
- Browse 20 scholars and 375 distinct research works; search and filter the publication library.
- Trace 363 evidence-supported paper questions into 50 editorial question clusters; 12 metadata-only records remain explicitly pending source evidence.
- Inspect the original author order, each tracked scholar's position, contribution statements where supported, and source links.
- Distinguish 359 abstract-level summaries, 4 full-text reading syntheses, and 12 metadata-only records. One author order remains unverified.

Authorship position does not imply contribution size. Theme boundaries, research questions, and research lines are editorial curation, not official statements or a comprehensive ranking. Coverage and verification are separate; remaining unknowns are displayed explicitly.

This repository contains only the reviewed static release. Personal notes, application planning, raw source records, local server code, and cached PDFs are not published. The page uses no account system or personal-data saving API.

## Release integrity

`release-manifest.json` records the version, snapshot counts, and SHA-256 of the static files. The empty `.nojekyll` file lets GitHub Pages serve the prebuilt files directly from `main`.

Stable releases have version tags. Updates are new reviewed release commits; local development does not automatically publish. Rollbacks restore a prior release with a new commit, without moving existing tags or rewriting history.
