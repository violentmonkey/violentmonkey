const fs = require('fs');
const yaml = require('js-yaml');
const childProcess = require('child_process');

const [,, src, dst] = process.argv;
const srcText = fs.readFileSync(src, 'utf8');
const dstText = fs.readFileSync(dst, 'utf8');

const dstText2 = `declare type LocaleMessageId =
  '${Object.keys(yaml.load(srcText)).join("' |\n  '")}';\n`;

if (dstText2 !== dstText) {
  fs.writeFileSync(dst, dstText2, 'utf8');
  childProcess.execSync(`git add "${dst}"`);
}
