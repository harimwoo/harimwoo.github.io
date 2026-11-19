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

function replaceRequired(text, original, replacement) {
  if (!text.includes(original)) throw new Error('The password page template did not match the expected version.');
  return text.replace(original, replacement);
}

function stylePasswordPage(html) {
  html = replaceRequired(html, '<div id="staticrypt_content" class="staticrypt-content hidden">',
    '<div id="staticrypt_content" class="staticrypt-content hidden"><header class="writing-header">Harim Woo</header>');
  html = replaceRequired(html, '<div class="staticrypt-password-container">',
    '<label class="writing-label" for="staticrypt-password">Password</label><p class="writing-hint" id="password-hint">hint: birthday</p><div class="staticrypt-password-container">');
  html = replaceRequired(html, 'id="staticrypt-password"',
    'id="staticrypt-password" inputmode="numeric" aria-describedby="password-hint" autocomplete="off"');
  html = replaceRequired(html, '</style>', `
    * { box-sizing: border-box; }
    .staticrypt-content { min-height: 100vh; height: auto; margin: 0; background: #fff; color: #242323; font-family: Georgia, 'Times New Roman', serif; }
    .writing-header { border-bottom: 1px solid #e8e8e8; padding: 18px 30px; color: #494949; font: 20px/1.3 Georgia, 'Times New Roman', serif; }
    .staticrypt-page { width: auto; min-height: calc(100vh - 63px); display: grid; place-items: center; padding: 32px 20px 96px; }
    .staticrypt-form { width: min(100%, 400px); max-width: none; margin: 0; padding: 42px 38px 38px; border: 1px solid #ebebeb; border-radius: 6px; text-align: left; box-shadow: 0 12px 36px rgba(30, 30, 30, .08); }
    .staticrypt-instructions, .staticrypt-hr, .staticrypt-toggle-password-visibility { display: none; }
    .writing-label { display: block; color: #555; font: 18px/1.4 Georgia, 'Times New Roman', serif; }
    .writing-hint { margin: 4px 0 18px; color: #888; font: italic 13px/1.5 Georgia, 'Times New Roman', serif; }
    .staticrypt-password-container { margin: 0; background: #fff; }
    .staticrypt-form input[type="password"], .staticrypt-form input[type="text"] { width: 100%; height: 45px; padding: 0 13px; border: 1px solid #cecece; border-radius: 3px; background: #fff; font: 16px Georgia, 'Times New Roman', serif; }
    .staticrypt-form input[type="password"]:focus, .staticrypt-form input[type="text"]:focus { outline: 2px solid #868686; outline-offset: 2px; }
    .staticrypt-form .staticrypt-decrypt-button { height: 45px; margin-top: 16px; padding: 0; border: 1px solid #262626; border-radius: 3px; background: #262626; color: #fff; text-transform: none; font: 14px Georgia, 'Times New Roman', serif; }
    .staticrypt-form .staticrypt-decrypt-button:hover, .staticrypt-form .staticrypt-decrypt-button:focus { background: #444; filter: none; }
    @media (max-width: 420px) { .writing-header { padding: 16px 20px; } .staticrypt-form { padding: 32px 26px; } }
  </style>`);
  return html;
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

  const result = spawnSync(process.execPath, [staticrypt, page, '--config', 'false', '--remember', 'false', '--short', '--template-title', 'Password | Harim Woo', '--template-placeholder', '', '--template-button', 'Unlock', '-d', path.dirname(page)], {
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Failed to encrypt a locked post.');
  const encrypted = fs.readFileSync(page, 'utf8');
  if (encrypted.includes(marker) || !encrypted.includes('staticryptEncryptedMsgUniqueVariableName')) {
    throw new Error('Locked post encryption could not be verified.');
  }
  fs.writeFileSync(page, stylePasswordPage(encrypted));
}

if (expectedIds.size !== 0) throw new Error('A locked post was not encrypted.');
fs.rmSync(contentPath, { force: true });
fs.rmSync(manifestPath);
console.log(`Encrypted ${pages.length} locked posts.`);
