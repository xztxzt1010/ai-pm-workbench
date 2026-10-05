# Third-Party Notices

This project distributes or adapts third-party material under the licenses below. The project itself is MIT licensed (see `LICENSE`).

## shadcn/ui

- **Component / variant source**: UI patterns and Tailwind data-variant definitions used by this workspace
- **License**: MIT License
- **Copyright (c) 2023 shadcn**
- **Upstream**: https://github.com/shadcn-ui/ui
- **Package version source**: shadcn@4.21.1
- **Local adaptation**: `src/styles/shadcn-variants.css` contains only the data-* custom variants and `no-scrollbar` utility referenced by this repository’s source, extracted from the upstream package’s `tailwind.css`. Unused upstream utilities were not copied.

### MIT License (shadcn/ui)

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Other dependencies

Runtime and build dependencies remain under their respective upstream licenses as recorded in `package-lock.json` and `sidecar/package-lock.json`.
