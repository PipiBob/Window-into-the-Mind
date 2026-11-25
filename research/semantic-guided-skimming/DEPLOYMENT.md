# Study reader and GitHub Pages

The study reader uses Academic Skimming v3 for all three papers when all local source assets are available. The application and annotations run in the browser. Use `npm ci` and `npm run build` for the local production build, then `npm run preview`. Open individual papers with `?paper=programming`, `?paper=anger`, or `?paper=ethereum`.

The Pages artifact is built with `npm run build:pages` and checked by `node scripts/frontend/check-pages.mjs`. It uses relative URLs and a separate staging directory. Only papers marked redistribution-cleared in [the pinned catalog](papers.json) are uploaded. The two Scientific Reports PDFs carry a CC BY 4.0 notice. The original PDFs are preserved byte-for-byte, and separate guide overlays identify the selected text. PDF.js redistribution notices are included in the vendored directories.

The Ethereum author submission gives arXiv permission to distribute the preprint. It does not grant this project permission to redistribute the PDF. This release excludes both that PDF and its quote-bearing annotations from the GitHub commit package and Pages artifact. The local copy remains available for the demo. [arXiv record](https://arxiv.org/abs/2502.05054) · [Submission license](https://arxiv.org/licenses/nonexclusive-distrib/1.0/)

The Pages workflow is manual so that pushing the integration does not publish the two-paper subset unintentionally. To deploy an approved release, select GitHub Actions as the Pages source and run the workflow from a repository branch with the workflow available on the default branch. Use the Pages environment URL after successful deployment. [GitHub Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
