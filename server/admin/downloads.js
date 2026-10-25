const root = document.querySelector('#downloads');
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
try {
  const response = await fetch('/latest?channel=' + (new URL(location.href).searchParams.get('channel') === 'beta' ? 'beta' : 'stable'), { cache: 'no-store' }); if (!response.ok) throw new Error();
  const release = await response.json(); root.replaceChildren();
  if (!release.files.length) root.append(node('div', '当前还没有公开发布的安装包。', 'notice'));
  else { const panel = node('section', null, 'panel'); panel.append(node('h2', `${release.title || 'TMCL'} · v${release.name}`, 'panel-header')); const notes = node('p', release.body, 'release-notes panel-body'); panel.append(notes); for (const file of release.files) { const url = new URL(file.url); if (url.origin !== location.origin || !url.pathname.startsWith('/downloads/art_')) continue; const row = node('div', null, 'file-row'); const copy = node('div', null, 'file-name'); copy.append(node('strong', file.name), node('small', `${file.platform} / ${file.arch} · ${(file.size / 1048576).toFixed(1)} MB`), node('small', 'SHA-256 ' + file.sha256, 'mono')); const a = node('a', '下载安装包', 'btn primary'); a.href = url.href; row.append(copy, a); panel.append(row); } root.append(panel); }
} catch { root.replaceChildren(node('div', '暂时无法获取下载信息，请稍后刷新重试。', 'notice error')); }
