from pathlib import Path
import hashlib,zipfile,json
root=Path.cwd()
files=sorted([p for folder in ['src','public','config','deployment'] for p in (root/folder).rglob('*') if p.is_file()]+[root/'package.json',root/'.dockerignore',root/'render.yaml'])
output=root/'data'/'vice-wire-private-staging-v1-rc.zip'
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_STORED) as archive:
 for p in files:
  name=p.relative_to(root).as_posix()
  if p.name.startswith('.env') or p.suffix in ['.sqlite','.db','.log']:raise RuntimeError('Forbidden release input')
  entry=zipfile.ZipInfo(name,date_time=(2026,10,6,0,0,0));entry.external_attr=0o644<<16;archive.writestr(entry,p.read_bytes())
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest={'phase':'PRIVATE_STAGING_DEPLOYMENT_V1','applicationVersion':json.loads((root/'package.json').read_text())['version'],'releaseArchive':output.name,'releaseArchiveSha256':sha(output.read_bytes()),'fileHashes':{p.relative_to(root).as_posix():sha(p.read_bytes()) for p in files},'migrationVersion':3,'bootstrapPayloadSha256':'7c047c63bcd54be0f9b9a0c04afdfb0033d3d31005fcfe0ab15ff48639449375','hostingTarget':'Render','serviceIdentifier':None,'stagingUrl':None,'deploymentTimestamp':None,'externallyDeployed':False,'publicLaunchAuthorized':False}
(root/'data'/'private-staging-release.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'archive':output.name,'sha256':manifest['releaseArchiveSha256'],'files':len(files)}))
