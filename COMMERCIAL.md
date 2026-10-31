# Commercial licensing

ScanRuler is open source under the **GNU AGPL-3.0-only** (see
[LICENSE](LICENSE)). In short: you may use, modify, self-host, and
redistribute it freely — but if you distribute it, or offer it (modified or
not) to users over a network, you must make the complete corresponding source
of your version available under the same license.

That last part matters more here than for most tools: this is a browser
application. Putting it on a web server — your own domain, an intranet, a
customer portal — is "offering it over a network", so an AGPL deployment of a
modified version must publish that version's source to its users.

If those terms don't work for your product — typically because you want to:

- embed the fitting / alignment / deviation engine, or the reverse-engineering
  and mesh tools, in **closed-source software** (scanner software, a metrology
  suite, a CAD plugin, an inspection cloud service), or
- host a modified version **without publishing your changes**, or
- ship it inside a product whose license terms are incompatible with the AGPL,

then a **commercial license exception** is available. The copyright to this
codebase is held by a single owner (enforced via the contributor agreement,
see [CONTRIBUTING.md](CONTRIBUTING.md)), so proprietary-use licenses can be
granted directly and simply.

Contact: **stefan@cnckitchen.com**

Notes:

- The project name and the CNC Kitchen name and logo are trademarks and are
  **not** licensed under the AGPL. Forks must use a different name.
- The bundled UI fonts (Barlow, Barlow Semi Condensed, B612 Mono in
  [public/fonts/](public/fonts/)) are third-party and stay under **SIL OFL
  1.1** — that license permits bundling with commercial software, but it does
  not convert them to AGPL or to any commercial exception granted here.
- The Reverse engineer workspace's CAD kernel, **Open CASCADE Technology**, is
  third-party and stays under the **LGPL-2.1 with the Open CASCADE exception**.
  It is loaded as a separate, replaceable file, and a commercial exception does
  not change its license: its notice, the pointer to its source and the right to
  replace it go with any product that ships it.
- The sample scan and reference meshes the tests look for (`ballbar.stl`,
  `block-marius.stl`, `side bracket left.stl`) are local fixtures, not
  committed and not part of the software. They are not covered by a commercial exception unless
  explicitly agreed.
