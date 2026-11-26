# Study reader and GitHub Pages

The study reader uses Academic Skimming v7 for Anger, Similarity, and Ethereum. Use `npm ci` and `npm run build` for the local production build, then `npm run preview`. Open individual papers with `?paper=anger`, `?paper=similarity`, or `?paper=ethereum`. The local Ethereum build requires the PDF and local annotations listed in the catalog. It also uses the adjacent `-zh-CN.json` translation file.

The Pages artifact is built with `npm run build:pages` and checked by `node scripts/frontend/check-pages.mjs`. It hosts the Anger and Similarity PDFs under their attribution licenses, alongside their highlights and Simplified Chinese translations. The PDFs are preserved byte-for-byte. PDF.js redistribution notices accompany the vendored files.

The Ethereum reader fetches the original PDF directly from arXiv. Pages includes passage locations, labels, coordinates, and visual evidence locations. The reader checks the PDF digest, then extracts the passage text and crops the evidence from the original. Ethereum translations are available in the local build. [arXiv record](https://arxiv.org/abs/2502.05054) · [Submission license](https://arxiv.org/licenses/nonexclusive-distrib/1.0/)

Pushing `main` starts the GitHub Pages workflow automatically. The workflow is also available for manual runs from the Actions tab. Use the Pages environment URL after successful deployment. [GitHub Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
