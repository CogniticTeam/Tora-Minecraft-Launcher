"""Build the public corresponding-source offer from an explicit project allowlist."""
from pathlib import Path
import os,tarfile,json,hashlib,re
root=Path(__file__).resolve().parents[1]
roots=['xmcl','server','scripts']
root_files=['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','package.json','README.md','docs/TMCL管理端与陶瓦联机.md']
skip_dirs={'node_modules','.git','.wrangler','dist','release','release-xmcl','output','artifacts','screenshots','备份','__pycache__','.cache','.next','.pnpm-store','.idea','.vscode','data','logs','coverage'}
skip_names={'.DS_Store','.dev.vars','.npmrc','pnpm-debug.log','yarn-error.log','snapshot.json','secrets.json','gateway.env','forum.env'}
paths=[]
for folder in roots:
 for base,dirs,files in os.walk(root/folder,followlinks=False):
  dirs[:]=[d for d in dirs if d not in skip_dirs and not (Path(base)/d).is_symlink()]
  for name in files:
   p=Path(base)/name
   if p.is_symlink() or name in skip_names or (name.startswith('.env') or name.startswith('.dev.vars')) or p.suffix in {'.log','.sqlite','.sqlite3','.db','.pem','.key','.p12','.pfx','.dmg','.asar','.zip','.tgz','.tar','.gz','.xz','.pyc','.heapsnapshot'}:continue
   paths.append(p)
for name in root_files:
 p=root/name
 if p.is_file():paths.append(p)
# Refuse likely live credentials. Report filenames only, never matching bytes.
secret=re.compile(rb'(?<![A-Za-z0-9])sk-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
for p in paths:
 if p.stat().st_size<4_000_000 and secret.search(p.read_bytes()):raise RuntimeError('credential-like material: '+str(p.relative_to(root)))
out=root/'release'/'TORA-Minecraft-Launcher-source.tar.gz';out.parent.mkdir(exist_ok=True)
with tarfile.open(out,'w:gz',compresslevel=6) as archive:
 for p in sorted(paths):archive.add(p,arcname='TORA-Minecraft-Launcher/'+str(p.relative_to(root)),recursive=False)
print(json.dumps({'files':len(paths),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
