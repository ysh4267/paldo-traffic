// index.html을 Artifact 게시용으로 변환한다. 문서 뼈대는 게시 때 자동으로 씌워진다.
// 사용법: node tools/build-artifact.mjs → dist/artifact.html
import fs from 'node:fs';

const src = fs.readFileSync('index.html', 'utf8');
const head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
const body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'));
const keep = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n')
  .trim();
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/artifact.html', `${keep}\n${body.trim()}\n`);

const files = {};
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${f.name}`;
    if (f.isDirectory()) walk(p);
    else files[p] = p;
  }
};
['js', 'css', 'data', 'audio'].forEach(walk);
fs.writeFileSync('dist/artifact-files.json', JSON.stringify(files, null, 1));
console.log(Object.keys(files).length, 'files', Object.values(files).reduce((s, p) => s + fs.statSync(p).size, 0), 'bytes');
