const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const outputDirectory = path.resolve('_site');
const manifestPath = path.join(outputDirectory, 'locked-build-info.json');
const contentPath = path.join(outputDirectory, 'locked-content.json');
const marker = '<!-- WRITING-LOCKED-POST -->';
const password = process.env.STATICRYPT_PASSWORD || '';
const staticrypt = process.env.STATICRYPT_CLI;

if (password.length < 16 && !/^\d{4}$/.test(password)) {
  throw new Error('LOCKED_POST_PASSWORD must be four digits or at least 16 characters.');
}
if (!staticrypt) throw new Error('STATICRYPT_CLI is not configured.');
if (!fs.existsSync(manifestPath)) throw new Error('Locked-post manifest is missing.');
const headTemplate = fs.readFileSync('_includes/head.html', 'utf8');
const feedTemplate = fs.readFileSync('feed.xml', 'utf8');
if (!headTemplate.includes("page.layout == 'locked'") || !feedTemplate.includes('post.layout != "locked"')) {
  throw new Error('Locked-post metadata or feed protection is missing.');
}
if (fs.existsSync(path.join(outputDirectory, 'feed'))) {
  throw new Error('Additional feeds require a privacy review before publishing.');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.ids) || manifest.ids.some((id) => typeof id !== 'string')) {
  throw new Error('Invalid locked-post manifest.');
}

function findMarkedPages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findMarkedPages(entryPath);
    if (entry.isFile() && entry.name.endsWith('.html') && fs.readFileSync(entryPath, 'utf8').includes(marker)) {
      return [entryPath];
    }
    return [];
  });
}

const pages = findMarkedPages(outputDirectory);
const expectedIds = new Set(manifest.ids);
if (expectedIds.size !== manifest.ids.length || pages.length !== expectedIds.size) {
  throw new Error('Locked-post manifest and rendered pages do not match.');
}

for (const page of pages) {
  const contents = fs.readFileSync(page, 'utf8');
  const match = contents.match(/<script type="application\/json" id="locked-build-post-id">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('A locked page is missing its build identifier.');
  const postId = JSON.parse(match[1]);
  if (!expectedIds.delete(postId)) throw new Error('Unexpected or duplicate locked-page identifier.');

  const result = spawnSync(process.execPath, [staticrypt, page, '--config', 'false', '--remember', 'false', '--short', '-d', path.dirname(page)], {
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Failed to encrypt a locked post.');
  const encrypted = fs.readFileSync(page, 'utf8');
  if (encrypted.includes(marker) || !encrypted.includes('staticryptEncryptedMsgUniqueVariableName')) {
    throw new Error('Locked post encryption could not be verified.');
  }
}

if (expectedIds.size !== 0) throw new Error('A locked post was not encrypted.');
fs.rmSync(contentPath, { force: true });
fs.rmSync(manifestPath);
console.log(`Encrypted ${pages.length} locked posts.`);
