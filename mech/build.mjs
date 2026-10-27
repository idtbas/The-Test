// Bundles src/ into a single self-contained HTML page.
//   node build.mjs            → index.html (full document, for GitHub Pages)
//                               dist/cockpit.html (fragment for a claude.ai artifact)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: !dev,
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const body = readFileSync('src/template.html', 'utf8').replace('<!--APP-->', () => `<script type="module">\n${js}\n</script>`);

const full = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#050607">
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync('index.html', full);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/cockpit.html', body);
console.log(`index.html ${(full.length / 1024).toFixed(0)} KB`);
